import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { MemoryIdempotencyStore, handleWebhook } from 'ring-partner-kit';
import type { Runtime } from './app.ts';
import { SCENARIOS, runScenario, skipAhead } from './demo/scenarios.ts';
import { signalFromWebhook } from './engine/interpret.ts';
import { localParts, localTimeToEpoch } from './engine/time.ts';
import type { DeviceRole } from './engine/types.ts';
import { handleMcp } from './mcp.ts';

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const ROLES: DeviceRole[] = ['entry_camera', 'indoor_camera', 'door_contact', 'climate', 'chime', 'other'];

export function stateFor(rt: Runtime) {
  const tz = rt.household.timeZone;
  const now = rt.clock.now();
  const lp = localParts(now, tz);
  const dayStart = localTimeToEpoch(lp.dateKey, 0, tz);
  const recent = rt.engine.concerns.filter((c) => c.status === 'open' || now - (c.resolvedAt ?? c.openedAt) < 36 * 3600_000);
  return {
    mode: rt.mode,
    now,
    timeZone: tz,
    today: lp.dateKey,
    household: { resident: rt.household.resident, circle: rt.household.circle, routine: rt.household.routine, careSchedule: rt.household.careSchedule },
    rhythm: rt.engine.rhythm,
    concerns: recent.slice(-30),
    timeline: rt.engine.signalsBetween(dayStart - 3 * 3600_000, now + 1).filter((s) => s.kind !== 'device_online'),
    activity: rt.engine.activity.slice(-120),
    devices: rt.household.devices.map((d) => {
      const dev = rt.devices.find((x) => x.id === d.deviceId);
      return { ...d, name: dev?.name ?? d.label, online: dev?.status?.online ?? null, battery: dev?.status?.battery_status?.percentage, imageUrl: dev?.imageUrl };
    }),
    home: rt.home,
    phone: rt.phone.slice(-40),
    digest: rt.lastDigest ?? null,
    ai: { enabled: rt.ai.enabled, why: rt.ai.why, textModel: rt.ai.textModelId, visionModel: rt.ai.visionModelId, vision: rt.vision.name, ask: rt.ask.model },
    apiLog: rt.apiLog.slice(-80),
    sim: rt.sim
      ? {
          speed: rt.sim.clock.speed,
          paused: rt.sim.clock.paused,
          pending: rt.sim.clock.pending().slice(0, 12),
          deliveries: rt.sim.world.deliveries.slice(-20),
          scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title, blurb: s.blurb })),
        }
      : null,
  };
}

export async function startHttpServer(rt: Runtime, opts: { port: number; host?: string }): Promise<{ server: Server; url: string }> {
  const webhookStore = new MemoryIdempotencyStore();
  const sseClients = new Set<ServerResponse>();
  rt.bus.on('event', (event) => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) client.write(line);
  });
  let baseUrl = '';

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: (err as Error).message });
      else res.end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Ring webhooks: verify the HMAC over the raw bytes, dedupe, answer fast, process after.
    if (method === 'POST' && path === '/webhooks/ring') {
      const raw = await readBody(req);
      const result = await handleWebhook({
        signingKey: rt.webhookKey,
        rawBody: raw,
        signature: header(req, 'x-signature'),
        store: webhookStore,
        onEvent: (event) => {
          const signal = signalFromWebhook(rt.household, event);
          if (signal) void rt.engine.ingest(signal);
        },
      });
      return json(res, result.status, result.body);
    }

    // Alexa+ integration: MCP over Streamable HTTP.
    if (path === '/mcp') {
      if (process.env.PORCHLIGHT_MCP_TOKEN && header(req, 'authorization') !== `Bearer ${process.env.PORCHLIGHT_MCP_TOKEN}`) return json(res, 401, { error: 'unauthorized' });
      if (method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' }).end();
        return;
      }
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      }
      return handleMcp(rt, req, res, body, baseUrl);
    }

    if (path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      sseClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
      req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(res);
      });
      return;
    }
    if (method === 'GET' && path === '/api/state') return json(res, 200, stateFor(rt));

    const snap = path.match(/^\/api\/snapshots\/([0-9a-f-]+)$/);
    if (method === 'GET' && snap) {
      const s = rt.snapshot(snap[1]);
      if (!s) return json(res, 404, { error: 'snapshot not found' });
      res.writeHead(200, { 'Content-Type': s.contentType, 'Cache-Control': 'private, max-age=3600' });
      res.end(s.bytes);
      return;
    }

    if (method === 'POST' && path.startsWith('/api/')) {
      const body = await readJson(req);
      switch (path) {
        case '/api/resident/ok':
          await rt.engine.residentOk();
          return json(res, 200, { ok: true });
        case '/api/resident/package-inside':
          await rt.engine.packageCollected();
          return json(res, 200, { ok: true });
        case '/api/check-in':
          await rt.engine.requestCheckIn(String(body.member ?? 'maria'));
          return json(res, 200, { ok: true });
        case '/api/ask':
          return json(res, 200, await rt.ask.ask(String(body.question ?? '').slice(0, 300), String(body.asker ?? 'Maria')));
        case '/api/digest':
          return json(res, 200, await rt.digest());
        case '/api/porch/check':
          return json(res, 200, await rt.checkPorchNow());
        case '/api/devices/refresh':
          await rt.refreshDevices();
          return json(res, 200, { ok: true });
        case '/api/data/delete':
          rt.deleteAllData();
          return json(res, 200, { ok: true });
        case '/api/sim/scenario':
          if (!rt.sim) return json(res, 400, { error: 'not in sim mode' });
          return json(res, 200, await runScenario(rt, String(body.id)));
        case '/api/sim/clock':
          if (!rt.sim) return json(res, 400, { error: 'not in sim mode' });
          if (typeof body.speed === 'number') rt.sim.clock.setSpeed(Math.min(1200, Math.max(0, body.speed)));
          if (body.pause) rt.sim.clock.pause();
          if (body.resume) rt.sim.clock.resume();
          if (body.skip) await skipAhead(rt);
          rt.bus.emit('event', { type: 'clock' });
          return json(res, 200, { now: rt.clock.now(), speed: rt.sim.clock.speed, paused: rt.sim.clock.paused });
        case '/api/live/whep': {
          const deviceId = String(body.deviceId ?? rt.household.devices.find((d) => d.role === 'entry_camera')?.deviceId ?? '');
          const r = await rt.client.startLiveView(deviceId, String(body.sdp ?? ''));
          return json(res, 200, { answer: r.answer, sessionUrl: r.sessionUrl });
        }
        case '/api/live/whep/stop':
          if (body.sessionUrl) await rt.client.stopLiveView(String(body.sessionUrl)).catch(() => {});
          return json(res, 200, { ok: true });
        default:
          break;
      }
      const ack = path.match(/^\/api\/concerns\/([0-9a-f-]+)\/(ack|resolve)$/);
      if (ack) {
        const member = String(body.member ?? 'maria');
        const c = ack[2] === 'ack' ? await rt.engine.acknowledge(ack[1], member) : await rt.engine.resolve(ack[1], member, body.note ? String(body.note).slice(0, 200) : undefined);
        return json(res, c ? 200 : 404, c ?? { error: 'no such open check-in' });
      }
      const dev = path.match(/^\/api\/devices\/([^/]+)$/);
      if (dev) {
        const setup = rt.household.devices.find((d) => d.deviceId === decodeURIComponent(dev[1]));
        if (!setup) return json(res, 404, { error: 'unknown device' });
        if (ROLES.includes(body.role as DeviceRole)) setup.role = body.role as DeviceRole;
        if (typeof body.label === 'string' && body.label.trim()) setup.label = body.label.trim().slice(0, 40);
        rt.bus.emit('event', { type: 'devices' });
        return json(res, 200, setup);
      }
      return json(res, 404, { error: 'not found' });
    }

    if (method === 'GET') return serveStatic(path, res);
    json(res, 404, { error: 'not found' });
  }

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host ?? '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://${opts.host === '0.0.0.0' ? 'localhost' : (opts.host ?? '127.0.0.1')}:${port}`;
  return { server, url: baseUrl };
}

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const rel = path === '/' ? 'index.html' : normalize(path).replace(/^([/\\])+/, '');
  if (rel.includes('..')) return json(res, 400, { error: 'bad path' });
  try {
    const data = await readFile(join(WEB_ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.length) return {};
  try {
    const v = JSON.parse(raw.toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

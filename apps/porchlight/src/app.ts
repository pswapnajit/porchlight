import { EventEmitter } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  RingApiError,
  RingClient,
  decodePng,
  downscale,
  encodePng,
  guessDeviceKind,
  isChime,
  isJpeg,
  isPng,
  maskZones,
  playChimeSlot,
  type Device,
  type RequestLog,
  type Zone,
} from 'ring-partner-kit';
import { SimClock, startSimServer, systemClock, type Clock, type RunningSimServer, type SimWorld } from 'ring-partner-kit/sim';
import { AskPorchlight } from './ai/agent.ts';
import { Bedrock, aiConfigFromEnv, type AiConfig } from './ai/bedrock.ts';
import { writeDigest, type Digest } from './ai/digest.ts';
import { BedrockVision, NoVision, SimulatorOracleVision, type VisionAnalyzer } from './ai/vision.ts';
import { DEMO_TZ, buildDemoWorld, demoHousehold, seedHistory, type DemoDevices } from './demo/household.ts';
import { CareEngine, expectedVisit, type CareActions } from './engine/engine.ts';
import { formatClock, localParts, localTimeToEpoch } from './engine/time.ts';
import type { ActionResult, CircleMember, Concern, DeviceRole, Household, Signal, SnapshotRef, VisionResult } from './engine/types.ts';
import { backfillFromRing, startHistoryPoller } from './ring/ingest.ts';

export interface PhoneMessage {
  id: string;
  at: number;
  to: string;
  toName: string;
  title: string;
  text: string;
  concernId?: string;
  urgent?: boolean;
}

export interface HomeScreen {
  message?: { text: string; concernId: string; kind: string; at: number };
  lastChime?: { at: number; name: string };
  /** The latest doorbell ring, for the resident's TV: a privacy-masked snapshot, and who the care schedule expects then (a schedule, never an identification). */
  visitor?: { at: number; deviceLabel?: string; expected?: { who: string; time: string }; snapshot?: SnapshotRef };
}

interface StoredSnapshot extends SnapshotRef {
  bytes: Uint8Array;
  contentType: string;
}

export interface Runtime {
  mode: 'sim' | 'live';
  clock: Clock;
  engine: CareEngine;
  client: RingClient;
  household: Household;
  bus: EventEmitter;
  ai: AiConfig;
  bedrock?: Bedrock;
  vision: VisionAnalyzer;
  ask: AskPorchlight;
  webhookKey: string;
  apiLog: RequestLog[];
  phone: PhoneMessage[];
  home: HomeScreen;
  devices: Device[];
  lastDigest?: Digest;
  snapshot(id: string): StoredSnapshot | undefined;
  refreshDevices(): Promise<Device[]>;
  checkPorchNow(): Promise<{ vision: VisionResult; snapshot?: SnapshotRef } | { error: string }>;
  digest(): Promise<Digest>;
  deleteAllData(): void;
  sim?: { world: SimWorld; clock: SimClock; devices: DemoDevices; server: RunningSimServer };
  close(): Promise<void>;
}

export interface RuntimeOptions {
  mode: 'sim' | 'live';
  env?: NodeJS.ProcessEnv;
  /** Where the webhook endpoint is reachable, so the simulator can deliver to it. */
  publicUrl?: string;
  simPort?: number;
  /** Sim only: when the simulated clock starts (defaults to 7:05 today, Rose's time). */
  simStart?: number;
  syncWebhooks?: boolean;
  /** Drive the clock and rules on a timer (default). Tests turn this off and advance time themselves. */
  autoTick?: boolean;
  log?: (line: string) => void;
}

export async function createRuntime(opts: RuntimeOptions): Promise<Runtime> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  const apiLog: RequestLog[] = [];
  const onRequest = (entry: RequestLog) => {
    apiLog.push(entry);
    if (apiLog.length > 300) apiLog.shift();
    bus.emit('event', { type: 'api', entry });
  };
  const ai = aiConfigFromEnv(env);
  const bedrock = ai.enabled ? new Bedrock(ai) : undefined;
  const webhookKey = env.RING_HMAC_KEY || randomBytes(24).toString('hex');

  let clock: Clock;
  let client: RingClient;
  let household: Household;
  let sim: Runtime['sim'];
  let seededSignals: Parameters<typeof backfillFromRing>[2] = [];

  if (opts.mode === 'sim') {
    const today = localParts(Date.now(), DEMO_TZ).dateKey;
    const start = opts.simStart ?? localTimeToEpoch(today, 7 * 60 + 5, DEMO_TZ);
    const simClock = new SimClock(start, 1);
    const { world, devices } = buildDemoWorld(simClock, { consentAt: start - 30 * 24 * 3600_000, syncWebhooks: opts.syncWebhooks });
    household = demoHousehold(devices);
    seededSignals = seedHistory(world, devices, household, start);
    const server = await startSimServer({ world, port: opts.simPort ?? 0 });
    if (opts.publicUrl) world.webhookTargets = [{ url: `${opts.publicUrl}/webhooks/ring`, signingKey: webhookKey }];
    client = new RingClient({ token: 'sim-token', baseUrl: server.url, onRequest });
    clock = simClock;
    sim = { world, clock: simClock, devices, server };
  } else {
    const token = env.RING_ACCESS_TOKEN;
    if (!token && !env.RING_REFRESH_TOKEN) throw new Error('Live mode needs RING_ACCESS_TOKEN (from the Ring Developer Playground) in .env');
    const { RefreshTokenProvider } = await import('ring-partner-kit');
    const provider = env.RING_REFRESH_TOKEN
      ? new RefreshTokenProvider({ clientId: env.RING_CLIENT_ID ?? '', clientSecret: env.RING_CLIENT_SECRET ?? '', refreshToken: env.RING_REFRESH_TOKEN })
      : token!;
    client = new RingClient({ token: provider, baseUrl: env.RING_API_BASE_URL, onRequest });
    clock = systemClock;
    household = liveHousehold(env);
  }

  const snapshots = new Map<string, StoredSnapshot>();
  // Returns only the reference: the bytes stay here and are served by /api/snapshots/:id, never inlined into state JSON.
  const putSnapshot = (deviceId: string, at: number, bytes: Uint8Array, contentType: string): SnapshotRef => {
    const id = randomUUID();
    const ref: SnapshotRef = { id, deviceId, at, url: `/api/snapshots/${id}` };
    snapshots.set(id, { ...ref, bytes, contentType });
    if (snapshots.size > 60) snapshots.delete(snapshots.keys().next().value!);
    return ref;
  };

  const vision: VisionAnalyzer = bedrock ? new BedrockVision(bedrock) : opts.mode === 'sim' ? new SimulatorOracleVision() : new NoVision();
  const phone: PhoneMessage[] = [];
  const home: HomeScreen = {};
  const pushPhone = (m: Omit<PhoneMessage, 'id' | 'at'>) => {
    const msg = { ...m, id: randomUUID(), at: clock.now() };
    phone.push(msg);
    if (phone.length > 80) phone.shift();
    bus.emit('event', { type: 'phone', message: msg });
    void sendNtfy(env, msg);
    return msg;
  };

  /** Snapshot -> privacy zones blacked out -> downscaled. Only the masked image is ever kept or analyzed. */
  const fetchMasked = async (deviceId: string, request: Parameters<RingClient['snapshot']>[1]) => {
    const config = await client.configurations(deviceId);
    if (config.e2e_encryption?.enabled === true) return { blocked: 'This camera uses end-to-end encryption, so Porchlight cannot see it.' } as const;
    const shot = await client.snapshot(deviceId, request);
    const zones: Zone[] = config.image_enhancements?.privacy_zones ?? [];
    if (isPng(shot.bytes)) {
      const img = decodePng(shot.bytes);
      const masked = maskZones(img, zones);
      const small = downscale(img, 1024);
      const bytes = encodePng(small, { text: img.text });
      return { bytes, format: 'png' as const, masked, at: shot.mediaTimestamp ?? clock.now() };
    }
    if (isJpeg(shot.bytes) && zones.length === 0) return { bytes: shot.bytes, format: 'jpeg' as const, masked: 0, at: shot.mediaTimestamp ?? clock.now() };
    return { blocked: "This snapshot couldn't be privacy-masked, so Porchlight won't analyze or store it." } as const;
  };

  let engine!: CareEngine;
  const actions: CareActions = {
    async nudgeResident(c: Concern, text: string, { quiet }): Promise<ActionResult> {
      home.message = { text, concernId: c.id, kind: c.kind, at: clock.now() };
      bus.emit('event', { type: 'home', home });
      const name = household.resident.preferredName;
      const chime = household.devices.find((d) => d.role === 'chime');
      const shown = `showed a check-in on ${name}'s home screen`;
      if (!chime) return { ok: true, channel: 'home screen', text: `Porchlight ${shown} (no Ring chime is connected).` };
      if (quiet) return { ok: true, channel: 'home screen', text: `Quiet hours, so the chime stayed silent; Porchlight ${shown}.` };
      try {
        const slotEvent = c.kind === 'quiet_morning' ? household.routine.chimeEvent : household.routine.reminderChimeEvent;
        const r = await playChimeSlot(client, chime.deviceId, slotEvent);
        if (r.played) {
          home.lastChime = { at: clock.now(), name: r.slot?.audio_name ?? 'chime' };
          bus.emit('event', { type: 'chime', name: home.lastChime.name, label: chime.label });
          return { ok: true, channel: 'Ring chime + home screen', text: `Played "${r.slot?.audio_name}" on the ${chime.label} and ${shown}.` };
        }
        const why = r.reason === 'snoozed' ? `is snoozed${r.snoozedUntil ? ` until ${formatClock(Date.parse(r.snoozedUntil), household.timeZone)}` : ''}` : r.reason === 'offline' ? 'is offline' : `can't play (${r.reason})`;
        return { ok: true, channel: 'home screen', text: `The ${chime.label} ${why}, so Porchlight only ${shown}.` };
      } catch (err) {
        return { ok: false, channel: 'home screen', text: `The chime didn't respond (${err instanceof RingApiError ? err.code ?? err.status : (err as Error).message}); Porchlight ${shown}.` };
      }
    },
    async textResident(c: Concern, text: string): Promise<ActionResult> {
      pushPhone({ to: 'resident', toName: household.resident.preferredName, title: 'Porchlight', text, concernId: c.id });
      return { ok: true, channel: 'text message', text: `Texted ${household.resident.preferredName}: "${text}"` };
    },
    async notifyFamily(member: CircleMember, c: Concern, text: string): Promise<ActionResult> {
      pushPhone({ to: member.id, toName: member.name, title: c.status === 'resolved' ? 'All clear' : c.title, text, concernId: c.id, urgent: c.severity === 'urgent' && c.status === 'open' });
      return { ok: true, channel: 'push', text: `Alerted ${member.name} (${member.relation.toLowerCase()}).` };
    },
    async checkPackage(deviceId: string, since: number) {
      const now = clock.now();
      try {
        const start = Math.max(since, now - 24 * 3600_000 + 60_000);
        const m = await fetchMasked(deviceId, { type: 'latest_in_range', start_timestamp: start, image_options: { format: 'png' } });
        if ('blocked' in m) return { vision: { packagePresent: null, confidence: 0, description: m.blocked!, model: 'none', at: now } };
        const snapshot = putSnapshot(deviceId, m.at, m.bytes, m.format === 'png' ? 'image/png' : 'image/jpeg');
        const v = await vision.analyzePorch(m.bytes, m.format, now);
        v.maskedPrivacyPixels = m.masked;
        return { vision: v, snapshot };
      } catch (err) {
        return { vision: { packagePresent: null, confidence: 0, description: `Couldn't get a snapshot (${err instanceof RingApiError ? err.code ?? err.status : (err as Error).message}).`, model: 'none', at: now } };
      }
    },
    async captureSnapshot(deviceId: string, at: number) {
      try {
        let m = await fetchMasked(deviceId, { type: 'at_timestamp', timestamp: Math.min(at, clock.now()), image_options: { format: 'png' } }).catch(() => undefined);
        if (!m) m = await fetchMasked(deviceId, { type: 'latest_in_range', start_timestamp: at - 60_000, image_options: { format: 'png' } });
        if ('blocked' in m) return undefined;
        return putSnapshot(deviceId, m.at, m.bytes, m.format === 'png' ? 'image/png' : 'image/jpeg');
      } catch {
        return undefined;
      }
    },
  };

  engine = new CareEngine({ household, clock, actions });
  for (const type of ['signal', 'concern', 'activity', 'rhythm'] as const) engine.on(type, (payload) => bus.emit('event', { type, payload }));
  engine.on('concern', (c: Concern) => {
    if (c.status === 'resolved' && home.message?.concernId === c.id) {
      home.message = undefined;
      bus.emit('event', { type: 'home', home });
    }
  });
  // The resident's TV shows who is at the door: one masked snapshot per ring, never sent to a model.
  engine.on('signal', (s: Signal) => {
    if (s.kind !== 'visitor_ring' || clock.now() - s.at > 5 * 60_000) return;
    void (async () => {
      const snapshot = s.deviceId ? await actions.captureSnapshot(s.deviceId, s.at) : undefined;
      home.visitor = { at: s.at, deviceLabel: s.deviceLabel, expected: expectedVisit(household, s.at), snapshot };
      bus.emit('event', { type: 'home', home });
    })();
  });

  let devices: Device[] = [];
  const refreshDevices = async () => {
    devices = await client.devices({ include: ['status', 'capabilities', 'configurations', 'location'] });
    if (opts.mode === 'live') autoAssignRoles(household, devices);
    bus.emit('event', { type: 'devices' });
    return devices;
  };

  const ask = new AskPorchlight(
    {
      engine,
      checkPorchNow: async () => {
        const r = await runtime.checkPorchNow();
        return 'error' in r ? r.error : `${r.vision.description} (checked ${formatClock(r.vision.at, household.timeZone)} with ${r.vision.model})`;
      },
      devices: () =>
        household.devices.map((d) => {
          const dev = devices.find((x) => x.id === d.deviceId);
          return { name: d.label, role: d.role, online: dev?.status?.online ?? null, battery: dev?.status?.battery_status?.percentage };
        }),
    },
    ai,
  );

  const stops: Array<() => void | Promise<void>> = [];
  const runtime: Runtime = {
    mode: opts.mode,
    clock,
    engine,
    client,
    household,
    bus,
    ai,
    bedrock,
    vision,
    ask,
    webhookKey,
    apiLog,
    phone,
    home,
    get devices() {
      return devices;
    },
    snapshot: (id) => snapshots.get(id),
    refreshDevices,
    async checkPorchNow() {
      const cam = household.devices.find((d) => d.role === 'entry_camera');
      if (!cam) return { error: 'No front-door camera is set up.' };
      const r = await actions.checkPackage(cam.deviceId, clock.now() - 10 * 60_000);
      bus.emit('event', { type: 'porch', result: r });
      return r;
    },
    async digest() {
      runtime.lastDigest = await writeDigest(engine, bedrock);
      bus.emit('event', { type: 'digest', digest: runtime.lastDigest });
      return runtime.lastDigest;
    },
    deleteAllData() {
      engine.signals = [];
      engine.concerns = [];
      engine.activity = [];
      snapshots.clear();
      phone.length = 0;
      home.message = undefined;
      home.visitor = undefined;
      runtime.lastDigest = undefined;
      void engine.relearn();
      bus.emit('event', { type: 'reset' });
    },
    sim,
    async close() {
      for (const stop of stops.reverse()) await stop();
    },
  };

  // Bootstrap: discover devices, learn the routine from Ring's event history.
  try {
    await refreshDevices();
    const added = await backfillFromRing(client, engine, seededSignals);
    log(`Porchlight learned from ${added} past events; check-in time ${formatClock(localTimeToEpoch(localParts(clock.now(), household.timeZone).dateKey, engine.rhythm.checkInBy, household.timeZone), household.timeZone)}.`);
  } catch (err) {
    log(`Startup sync with Ring failed: ${(err as Error).message}`);
  }

  // Keep time-based rules running, and write the digest at 8:30 PM local.
  let digestDate = '';
  const onTick = async () => {
    await engine.tick();
    const lp = localParts(clock.now(), household.timeZone);
    if (lp.minuteOfDay >= 20 * 60 + 30 && digestDate !== lp.dateKey) {
      digestDate = lp.dateKey;
      await runtime.digest();
    }
  };
  if (sim) {
    stops.push(sim.clock.onTick(onTick));
    if (opts.autoTick !== false) sim.clock.start(250);
    stops.push(() => sim!.clock.stop(), () => sim!.server.close());
  } else if (opts.autoTick !== false) {
    const timer = setInterval(() => void onTick(), 5_000);
    stops.push(() => clearInterval(timer));
    stops.push(startHistoryPoller(client, engine, { intervalMs: Number(env.PORCHLIGHT_POLL_MS ?? 15_000), onError: (e) => log(`Ring poll failed: ${(e as Error).message}`) }));
    const deviceTimer = setInterval(() => void refreshDevices().catch(() => {}), 60_000);
    stops.push(() => clearInterval(deviceTimer));
  }
  return runtime;
}

/** Live mode: the resident's details come from .env; device roles are guessed, then editable in the app. */
function liveHousehold(env: NodeJS.ProcessEnv): Household {
  const preferred = env.PORCHLIGHT_RESIDENT_NAME ?? 'Rose';
  return {
    id: 'live',
    resident: { name: env.PORCHLIGHT_RESIDENT_FULL_NAME ?? preferred, preferredName: preferred, pronoun: (env.PORCHLIGHT_RESIDENT_PRONOUN as 'she' | 'he' | 'they') ?? 'she' },
    timeZone: env.PORCHLIGHT_TIMEZONE ?? 'America/New_York',
    circle: [
      { id: 'maria', name: env.PORCHLIGHT_CAREGIVER_NAME ?? 'Maria', relation: 'Daughter', role: 'primary', receives: 'all', digest: true },
      { id: 'chen', name: 'Mrs. Chen', relation: 'Neighbor', role: 'secondary', receives: ['quiet_morning', 'long_silence', 'unanswered_door'], digest: false },
    ],
    devices: [],
    routine: {
      checkInBy: env.PORCHLIGHT_CHECK_IN_BY,
      quietHours: { start: '22:30', end: '06:00' },
      packageDwellMin: Number(env.PORCHLIGHT_PACKAGE_DWELL_MIN ?? 90),
      chimeEvent: 'ring-appstore-event-1',
      reminderChimeEvent: 'ring-appstore-event-2',
    },
    careSchedule: [],
  };
}

/** Ring devices carry no type or placement, so Porchlight proposes roles from capabilities and names. */
export function autoAssignRoles(household: Household, devices: Device[]): void {
  for (const d of devices) {
    if (household.devices.some((x) => x.deviceId === d.id)) continue;
    const kind = guessDeviceKind(d.capabilities, d.status);
    let role: DeviceRole = 'other';
    if (isChime(d.capabilities)) role = 'chime';
    else if (kind === 'camera') role = /living|kitchen|indoor|bed|hall|den|lounge/i.test(d.name) ? 'indoor_camera' : 'entry_camera';
    else if (d.status?.contact_detection) role = 'door_contact';
    else if (typeof d.status?.temperature === 'number') role = 'climate';
    household.devices.push({ deviceId: d.id, role, label: d.name });
  }
}

async function sendNtfy(env: NodeJS.ProcessEnv, m: PhoneMessage): Promise<void> {
  const topic = env.PORCHLIGHT_NTFY_TOPIC;
  if (!topic || m.to === 'resident') return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: `Porchlight: ${m.title}`, Priority: m.urgent ? 'high' : 'default', Tags: m.urgent ? 'warning' : 'house' },
      body: m.text,
    });
  } catch {
    // Push is best effort; the in-app feed is the source of truth.
  }
}

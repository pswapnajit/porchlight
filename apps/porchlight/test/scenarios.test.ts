import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePng } from 'ring-partner-kit';
import { createRuntime, type Runtime } from '../src/app.ts';
import { runScenario } from '../src/demo/scenarios.ts';
import { localTimeToEpoch, parseHHMM } from '../src/engine/time.ts';
import { startHttpServer } from '../src/server.ts';

// End-to-end: simulated Ring account -> signed webhooks + Ring API calls ->
// Porchlight engine -> chime, texts and family alerts. Time is driven by hand.

let rt: Runtime;
let baseUrl: string;
let close: () => Promise<void>;
let day = '';

before(async () => {
  rt = await createRuntime({
    mode: 'sim',
    syncWebhooks: true,
    autoTick: false,
    simStart: localTimeToEpoch('2026-10-19', 7 * 60 + 5, 'America/New_York'),
    env: { PORCHLIGHT_AI: 'off' },
    log: () => {},
  });
  const http = await startHttpServer(rt, { port: 0 });
  baseUrl = http.url;
  rt.sim!.world.webhookTargets = [{ url: `${baseUrl}/webhooks/ring`, signingKey: rt.webhookKey }];
  close = async () => {
    await rt.close();
    await new Promise<void>((r) => http.server.close(() => r()));
  };
});

after(async () => {
  await close();
});

async function play(id: string): Promise<void> {
  const run = await runScenario(rt, id);
  rt.sim!.clock.pause();
  day = run.dateKey;
}

async function until(hhmm: string): Promise<void> {
  const target = localTimeToEpoch(day, parseHHMM(hhmm), rt.household.timeZone);
  await rt.sim!.clock.advance(target - rt.clock.now(), 30_000);
  await rt.engine.idle();
}

const open = (kind: string) => rt.engine.openConcerns().find((c) => c.kind === kind);
const latest = (kind: string) => [...rt.engine.concerns].reverse().find((c) => c.kind === kind && c.dateKey === day);
const textsTo = (who: string) => rt.phone.filter((p) => p.to === who);

test('learns the routine from four weeks of Ring history at startup', () => {
  assert.equal(rt.engine.rhythm.confidence, 'good');
  assert.equal(rt.engine.rhythm.checkInSource, 'learned');
  assert.ok(rt.engine.rhythm.checkInBy >= 8 * 60 && rt.engine.rhythm.checkInBy <= 10 * 60, `check-in at minute ${rt.engine.rhythm.checkInBy}`);
  assert.ok(rt.apiLog.some((l) => l.path.includes('event_types=motion.package_delivery')), 'subtypes come from composite history filters');
});

test('quiet morning: Rose gets the first chance, then Maria; "I\'m OK" closes it and sends an all-clear', async () => {
  await play('quiet-morning');
  const chimesBefore = rt.sim!.world.chimePlays.length;
  const checkIn = rt.engine.rhythm.checkInBy;
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  await until(hhmm(checkIn + 2));
  const c = open('quiet_morning');
  assert.ok(c, 'quiet morning opened after the learned check-in time');
  assert.equal(rt.sim!.world.chimePlays.length, chimesBefore + 1, 'played the good-morning chime through the Ring API');
  assert.equal(rt.home.message?.concernId, c!.id);
  assert.equal(textsTo('maria').filter((m) => m.concernId === c!.id).length, 0, 'family not bothered yet');

  await until(hhmm(checkIn + 32));
  assert.ok(textsTo('resident').some((m) => m.concernId === c!.id), 'texted Rose second');
  assert.ok(textsTo('maria').some((m) => m.concernId === c!.id), 'Maria alerted third');

  await rt.engine.residentOk();
  assert.equal(c!.status, 'resolved');
  assert.equal(c!.resolution?.by, 'resident');
  assert.ok(textsTo('maria').some((m) => m.title === 'All clear'), 'Maria hears it is resolved');
  assert.equal(rt.home.message, undefined, 'home screen prompt cleared');
});

test('night door: urgent alert with a privacy-masked infrared snapshot; acknowledging stops the next alert', async () => {
  await play('night-door');
  await until('02:51');
  const c = open('night_door');
  assert.ok(c, 'night door opened');
  assert.equal(c!.severity, 'urgent');
  assert.ok(textsTo('maria').some((m) => m.concernId === c!.id && m.urgent), 'Maria alerted immediately');
  assert.ok(c!.snapshot, 'snapshot attached');
  const png = decodePng(rt.snapshot(c!.snapshot!.id)!.bytes);
  assert.ok(png.width <= 1024, 'downscaled before storing');
  // Privacy zone (neighbor's window, x 0.78-0.99, y 0.28-0.47) is solid black.
  const px = (Math.round(0.47 * png.height) - 3) * png.width + Math.round(0.9 * png.width);
  assert.deepEqual([...png.data.subarray(px * 4, px * 4 + 3)], [0, 0, 0]);

  await rt.engine.acknowledge(c!.id, 'maria');
  await until('03:10');
  const secondary = c!.ladder.find((s) => s.kind === 'notify_secondary');
  assert.equal(secondary?.skipped, true, 'Daniel is not woken up once Maria is on it');
  await rt.engine.resolve(c!.id, 'maria', 'She was letting the cat in');
  assert.equal(c!.status, 'resolved');
});

test("missed visit: the aide's unanswered ring is urgent; the door opening resolves it", async () => {
  await play('missed-visit');
  await until('10:05');
  const c = open('unanswered_door');
  assert.ok(c, 'unanswered door opened');
  assert.match(c!.summary, /Ana \(home aide\)/);
  assert.ok(textsTo('maria').some((m) => m.concernId === c!.id));
  await until('10:16');
  assert.equal(c!.status, 'resolved');
});

test('a new demo day drops checks still pending from the previous one', async () => {
  await play('missed-visit');
  await until('10:02'); // Ana has rung; the "was it answered?" check is due at 10:04
  await play('ordinary-day');
  await until('09:30');
  assert.equal(latest('unanswered_door'), undefined, "yesterday's ring did not leak into today");
});

test('hot afternoon: heat alert, then the package left out is confirmed by vision and cleared when brought in', async () => {
  await play('package-heat');
  await until('11:35');
  assert.ok(open('home_too_hot'), 'the climate sensor threshold webhook opened a heat check-in');
  assert.equal(latest('quiet_morning'), undefined, 'an ordinary morning was seeded before the scenario');

  await until('13:00');
  const c = open('package_waiting');
  assert.ok(c, 'package check-in opened after the shortened (hot day) dwell');
  assert.equal(c!.vision?.packagePresent, true);
  assert.ok((c!.vision?.maskedPrivacyPixels ?? 0) > 0, 'privacy zone masked before analysis');

  await until('14:00');
  assert.equal(c!.status, 'resolved');
  assert.match(c!.resolution!.text, /porch is clear/);
  await until('14:35');
  assert.equal(latest('home_too_hot')?.status, 'resolved', 'cleared when the temperature came back down');
});

test('ordinary day: no check-ins, and the evening note says so', async () => {
  await play('ordinary-day');
  await until('21:00');
  assert.equal(rt.engine.concerns.filter((c) => c.dateKey === day).length, 0);
  const digest = await rt.digest();
  assert.equal(digest.model, 'template');
  assert.match(digest.text, /Nothing unusual/);
  assert.equal(digest.facts.deliveries[0]?.broughtInside !== null, true);
});

test('Alexa+ MCP endpoint: Streamable HTTP, protocol 2025-11-25, status tool and MCP App card', async () => {
  const call = async (body: unknown) => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { result: any };
  };
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(init.result.protocolVersion, '2025-11-25');
  const list = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const status = list.result.tools.find((t: any) => t.name === 'get_status');
  assert.equal(status._meta.ui.resourceUri, 'ui://porchlight/status-card.html');
  const res = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_status', arguments: {} } });
  assert.equal(res.result.structuredContent.state, 'all_well');
  const ok = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_check_in', arguments: { requestedBy: 'Maria' } } });
  assert.match(ok.result.content[0].text, /chime/i);
  const im = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'resident_im_ok', arguments: {} } });
  assert.match(im.result.content[0].text, /let your family know/);
  assert.equal(rt.engine.openConcerns().length, 0);
});

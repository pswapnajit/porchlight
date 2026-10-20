import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SimClock } from 'ring-partner-kit/sim';
import { CareEngine, type CareActions } from '../src/engine/engine.ts';
import { isPresence, signalFromWebhook } from '../src/engine/interpret.ts';
import { learnRhythm } from '../src/engine/rhythm.ts';
import { localTimeToEpoch } from '../src/engine/time.ts';
import type { Household, Signal } from '../src/engine/types.ts';
import { parseVisionReply } from '../src/ai/vision.ts';

const TZ = 'America/New_York';
const household: Household = {
  id: 'h',
  resident: { name: 'Rose Alvarez', preferredName: 'Rose', pronoun: 'she' },
  timeZone: TZ,
  circle: [{ id: 'maria', name: 'Maria', relation: 'Daughter', role: 'primary', receives: 'all', digest: true }],
  devices: [
    { deviceId: 'cam', role: 'entry_camera', label: 'Front door' },
    { deviceId: 'indoor', role: 'indoor_camera', label: 'Living room' },
  ],
  routine: { quietHours: { start: '22:30', end: '06:00' }, packageDwellMin: 90, chimeEvent: 'e1', reminderChimeEvent: 'e2' },
  careSchedule: [],
};
const at = (day: string, hhmm: string) => localTimeToEpoch(day, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
const sig = (kind: Signal['kind'], t: number, strength: Signal['strength'] = 'strong'): Signal => ({ id: `${kind}:${t}`, kind, at: t, strength, source: 'history', deviceId: 'indoor' });

test('outdoor motion next to a doorbell ring is a visitor, not the resident', () => {
  const t = at('2026-10-05', '10:00');
  const motion = { ...sig('outdoor_motion', t - 30_000, 'medium'), deviceId: 'cam' };
  const ring = { ...sig('visitor_ring', t, 'none'), deviceId: 'cam' };
  assert.equal(isPresence(motion, [motion, ring]), false);
  assert.equal(isPresence(motion, [motion]), true);
});

test('webhook interpretation uses the household device roles', () => {
  const event = (deviceId: string, subType: string) => ({ id: 'x', requestId: 'r', type: 'motion_detected', family: 'camera' as const, deviceId, timestamp: 1, subType, raw: {} as never });
  assert.equal(signalFromWebhook(household, event('indoor', 'human'))?.kind, 'indoor_motion');
  assert.equal(signalFromWebhook(household, event('cam', 'human'))?.kind, 'outdoor_motion');
  assert.equal(signalFromWebhook(household, event('cam', 'package_delivery'))?.kind, 'delivery');
  assert.equal(signalFromWebhook(household, event('cam', 'vehicle'))?.strength, 'none');
});

test('check-in time is the latest usual start plus 45 minutes, clamped, and the family can override it', () => {
  const signals: Signal[] = [];
  const wakes = ['07:30', '07:40', '07:50', '08:00', '08:10', '07:35', '07:45', '07:55', '08:05', '07:50'];
  wakes.forEach((w, i) => {
    const day = `2026-10-${String(i + 1).padStart(2, '0')}`;
    signals.push(sig('indoor_motion', at(day, w)), sig('indoor_motion', at(day, '12:00')), sig('indoor_motion', at(day, '20:00')));
  });
  const now = at('2026-10-12', '06:00');
  const r = learnRhythm(signals, household, now);
  assert.equal(r.days, 10);
  assert.equal(r.confidence, 'low');
  assert.equal(r.checkInSource, 'learned');
  assert.equal(r.checkInBy, 8 * 60 + 55);
  const fixed = learnRhythm(signals, { ...household, routine: { ...household.routine, checkInBy: '09:30' } }, now);
  assert.equal(fixed.checkInBy, 9 * 60 + 30);
  assert.equal(learnRhythm([], household, now).checkInSource, 'default');
});

test('the same event from a webhook and from history is ingested once', async () => {
  const clock = new SimClock(at('2026-10-12', '10:00'));
  clock.pause();
  const noop = async () => ({ ok: true, channel: 'test', text: 'ok' });
  const actions: CareActions = { nudgeResident: noop, textResident: noop, notifyFamily: noop, checkPackage: async () => ({ vision: { packagePresent: null, confidence: 0, description: '', model: 't', at: 0 } }), captureSnapshot: async () => undefined };
  const engine = new CareEngine({ household, clock, actions });
  const t = clock.now() - 1000;
  assert.equal(await engine.ingest({ ...sig('indoor_motion', t), id: 'ring:a', source: 'webhook' }), true);
  assert.equal(await engine.ingest({ ...sig('indoor_motion', t + 2000), id: 'hist:b', source: 'history' }), false);
  assert.equal(engine.signals.length, 1);
});

test('vision guardrail: unsure or low-confidence answers become "ask a person"', () => {
  assert.equal(parseVisionReply('{"package_present": true, "confidence": 0.9, "description": "A box on the mat."}', 'm', 0).packagePresent, true);
  assert.equal(parseVisionReply('{"package_present": true, "confidence": 0.3}', 'm', 0).packagePresent, null);
  assert.equal(parseVisionReply('{"package_present": "unsure", "confidence": 0.95}', 'm', 0).packagePresent, null);
  assert.equal(parseVisionReply('I think there might be a package', 'm', 0).packagePresent, null);
  assert.equal(parseVisionReply('```json\n{"package_present": false, "confidence": 0.8, "description": "Clear."}\n```', 'm', 0).packagePresent, false);
});

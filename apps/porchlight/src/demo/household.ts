import type { SimClock, SimDevice } from 'ring-partner-kit/sim';
import { SimWorld } from 'ring-partner-kit/sim';
import { localParts, localTimeToEpoch } from '../engine/time.ts';
import type { Household, Signal } from '../engine/types.ts';

// The demo household: Rose, 81, lives alone in New Jersey. Her daughter Maria
// lives two hours away; her son Daniel is in another time zone; Mrs. Chen is
// next door. An aide, Ana, visits on weekday mornings. Every name is fictional.

export interface DemoDevices {
  doorbell: SimDevice;
  livingRoom: SimDevice;
  chime: SimDevice;
  doorContact: SimDevice;
  climate: SimDevice;
}

export const DEMO_TZ = 'America/New_York';

export function buildDemoWorld(clock: SimClock, opts: { consentAt: number; syncWebhooks?: boolean }): { world: SimWorld; devices: DemoDevices } {
  const world = new SimWorld({
    clock,
    timeZone: DEMO_TZ,
    consentAt: opts.consentAt,
    syncWebhooks: opts.syncWebhooks,
    accountId: 'ava1.ring.account.ROSE0001',
    user: { first_name: 'Rose', last_name: 'Alvarez', email: 'rose.alvarez@example.com' },
  });
  const devices: DemoDevices = {
    doorbell: world.addDevice({
      id: 'ava1.ring.device.SIMDOORBELL01',
      name: 'Front Door',
      kind: 'doorbell',
      smartAlerts: true,
      batteryPercent: 76,
      // The neighbor's front window is a privacy zone: never analyzed or stored.
      privacyZones: [{ id: 'neighbor-window', vertices: [{ x: 0.78, y: 0.28 }, { x: 0.99, y: 0.28 }, { x: 0.99, y: 0.47 }, { x: 0.78, y: 0.47 }] }],
    }),
    livingRoom: world.addDevice({ id: 'ava1.ring.device.SIMINDOORCAM1', name: 'Living Room', kind: 'indoor_camera', smartAlerts: true }),
    chime: world.addDevice({ id: 'ava1.ring.device.SIMCHIMEPRO01', name: 'Hallway Chime', kind: 'chime' }),
    doorContact: world.addDevice({ id: 'ava1.ring.device.SIMCONTACT001', name: 'Front Door Sensor', kind: 'contact_sensor', doorOpen: false, batteryPercent: 91 }),
    climate: world.addDevice({
      id: 'ava1.ring.device.SIMCLIMATE001',
      name: 'Living Room Climate',
      kind: 'temp_humidity',
      temperature: 22.4,
      humidity: 41,
      batteryPercent: 88,
      temperatureThreshold: { low: 16, high: 30 },
      humidityThreshold: { low: 20, high: 75 },
    }),
  };
  return { world, devices };
}

export function demoHousehold(devices: Pick<DemoDevices, 'doorbell' | 'livingRoom' | 'chime' | 'doorContact' | 'climate'>): Household {
  return {
    id: 'rose',
    resident: { name: 'Rose Alvarez', preferredName: 'Rose', pronoun: 'she' },
    timeZone: DEMO_TZ,
    circle: [
      { id: 'maria', name: 'Maria', relation: 'Daughter', role: 'primary', receives: 'all', digest: true },
      { id: 'daniel', name: 'Daniel', relation: 'Son', role: 'secondary', receives: ['quiet_morning', 'long_silence', 'unanswered_door', 'night_door', 'water_leak', 'air_quality', 'home_too_hot'], digest: false },
      { id: 'chen', name: 'Mrs. Chen', relation: 'Neighbor', role: 'secondary', receives: ['quiet_morning', 'long_silence', 'unanswered_door'], digest: false },
    ],
    devices: [
      { deviceId: devices.doorbell.id, role: 'entry_camera', label: 'Front door' },
      { deviceId: devices.livingRoom.id, role: 'indoor_camera', label: 'Living room' },
      { deviceId: devices.chime.id, role: 'chime', label: 'Hallway chime' },
      { deviceId: devices.doorContact.id, role: 'door_contact', label: 'Front door sensor' },
      { deviceId: devices.climate.id, role: 'climate', label: 'Living room climate' },
    ],
    routine: { quietHours: { start: '22:30', end: '06:00' }, packageDwellMin: 90, chimeEvent: 'ring-appstore-event-1', reminderChimeEvent: 'ring-appstore-event-2' },
    careSchedule: [{ who: 'Ana (home aide)', days: [1, 2, 3, 4, 5], time: '10:00', windowMin: 45 }],
  };
}

/**
 * Four weeks of Rose's ordinary days. Camera events go into the simulated Ring
 * account's event history (Porchlight reads them back through the Event History
 * API at startup). Door-sensor events have no history API, so they are returned
 * as signals, standing in for webhooks Porchlight persisted when they arrived.
 */
export function seedHistory(world: SimWorld, devices: DemoDevices, household: Household, endAt: number, days = 28, seed = 42): Signal[] {
  const rand = mulberry32(seed);
  const normal = (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  const tz = household.timeZone;
  const contact: Signal[] = [];
  const today = localParts(endAt, tz).dateKey;
  const firstDay = endAt - days * 24 * 3600_000;
  const door = (at: number) => {
    for (const [kind, t] of [['door_open', at], ['door_closed', at + (2 + rand() * 3) * 60_000]] as const) {
      contact.push({ id: `seed:${devices.doorContact.id}:${kind}:${Math.round(t)}`, kind, at: Math.round(t), deviceId: devices.doorContact.id, deviceLabel: 'Front door sensor', strength: 'strong', source: 'webhook' });
    }
  };
  const motion = (device: SimDevice, subType: string, at: number) =>
    world.recordHistory({ deviceId: device.id, eventType: 'motion', subType, start: Math.round(at), end: Math.round(at) + 20_000 });

  for (let d = 0; d < days; d++) {
    const dateKey = localParts(firstDay + d * 24 * 3600_000 + 12 * 3600_000, tz).dateKey;
    if (dateKey >= today) continue;
    const at = (minute: number) => localTimeToEpoch(dateKey, Math.round(minute), tz) + Math.floor(rand() * 59_000);
    const weekday = localParts(at(12 * 60), tz).weekday;
    const weekend = weekday === 0 || weekday === 6;

    const wake = clamp(normal(weekend ? 8 * 60 + 10 : 7 * 60 + 45, 18), 6 * 60 + 40, 9 * 60 + 5);
    const bed = clamp(normal(21 * 60 + 40, 20), 20 * 60 + 45, 22 * 60 + 25);
    for (let m = wake; m < bed; m += 25 + rand() * 60) motion(devices.livingRoom, 'human', at(m));
    if (rand() < 0.4) motion(devices.livingRoom, 'human', at(2 * 60 + rand() * 120));

    if (rand() < 0.75) {
      const mail = clamp(normal(10 * 60 + 50, 35), wake + 30, 13 * 60);
      motion(devices.doorbell, 'human', at(mail));
      door(at(mail) + 30_000);
    }
    if (!weekend) {
      const visit = 10 * 60 + normal(0, 5);
      motion(devices.doorbell, 'human', at(visit - 1));
      world.recordHistory({ deviceId: devices.doorbell.id, eventType: 'ding', start: at(visit), end: at(visit) + 15_000 });
      door(at(visit + 1 + rand() * 2));
      const leave = visit + 45 + rand() * 20;
      door(at(leave));
      motion(devices.doorbell, 'human', at(leave + 1));
    }
    if (rand() < 0.35) {
      const walk = clamp(normal(15 * 60 + 30, 40), 13 * 60 + 30, 17 * 60 + 30);
      door(at(walk));
      motion(devices.doorbell, 'human', at(walk + 1));
      const back = walk + 30 + rand() * 30;
      motion(devices.doorbell, 'human', at(back));
      door(at(back + 1));
    }
    if (rand() < 0.45) {
      const drop = 10 * 60 + 30 + rand() * 360;
      motion(devices.doorbell, 'package_delivery', at(drop));
      const pickup = drop + 5 + rand() * 45;
      motion(devices.doorbell, 'human', at(pickup));
      door(at(pickup) + 20_000);
    }
    if (rand() < 0.15) {
      const v = 11 * 60 + rand() * 420;
      motion(devices.doorbell, 'human', at(v - 1));
      world.recordHistory({ deviceId: devices.doorbell.id, eventType: 'ding', start: at(v), end: at(v) + 15_000 });
      door(at(v + 1 + rand()));
    }
    const cars = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < cars; i++) motion(devices.doorbell, 'vehicle', at(7 * 60 + rand() * 13 * 60));
  }
  return contact.sort((a, b) => a.at - b.at);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

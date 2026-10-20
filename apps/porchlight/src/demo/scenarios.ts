import type { Runtime } from '../app.ts';
import { localParts, localTimeToEpoch, parseHHMM } from '../engine/time.ts';

// Scripted days for the demo. Each step drives the simulated Ring account
// (motion, doorbell, door sensor, temperature, what the camera sees), which
// then reaches Porchlight the production way: signed webhooks and API calls.

interface Ctx {
  rt: Runtime;
  ids: { doorbell: string; livingRoom: string; door: string; climate: string };
}

interface Step {
  at: string;
  label: string;
  run: (ctx: Ctx) => Promise<void> | void;
}

export interface Scenario {
  id: string;
  title: string;
  blurb: string;
  start: string;
  speed: number;
  weekday?: boolean;
  steps: Step[];
}

const indoor = (at: string, label = 'Movement in the living room'): Step => ({ at, label, run: async ({ rt, ids }) => void await rt.sim!.world.motion(ids.livingRoom, 'human') });
const doorCycle = (at: string, label: string, holdMin = 2): Step[] => {
  const close = minutesAfter(at, holdMin);
  return [
    { at, label, run: ({ rt, ids }) => rt.sim!.world.setDoor(ids.door, true) },
    { at: close, label: 'Front door closed', run: ({ rt, ids }) => rt.sim!.world.setDoor(ids.door, false) },
  ];
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'ordinary-day',
    title: 'An ordinary day',
    blurb: 'Up on time, the aide visits, a delivery is brought in. Porchlight stays quiet and writes the evening note.',
    start: '06:50',
    speed: 240,
    weekday: true,
    steps: [
      indoor('07:41', 'Rose is up: movement in the living room'),
      indoor('08:20'),
      { at: '09:59', label: 'Ana walks up to the door', run: async ({ rt, ids }) => void await rt.sim!.world.motion(ids.doorbell, 'human') },
      { at: '10:00', label: 'Ana rings the doorbell', run: async ({ rt, ids }) => void await rt.sim!.world.ding(ids.doorbell) },
      ...doorCycle('10:01', 'Rose opens the door for Ana'),
      indoor('11:15'),
      { at: '12:40', label: 'Package delivered', run: ({ rt, ids }) => deliver(rt, ids.doorbell) },
      { at: '13:05', label: 'Rose collects the package', run: ({ rt, ids }) => collect(rt, ids) },
      indoor('15:10'),
      indoor('16:25'),
      indoor('17:35'),
      indoor('18:40'),
      indoor('19:50'),
      indoor('20:55'),
    ],
  },
  {
    id: 'quiet-morning',
    title: 'A quiet morning',
    blurb: "No sign of Rose by her usual time. Porchlight starts with a chime and a message to her, and only then involves Maria. Tap \"I'm OK\" on Rose's screen to resolve it.",
    start: '07:30',
    speed: 60,
    steps: [
      { at: '10:40', label: "Rose finally opens the front door (if nobody tapped I'm OK)", run: ({ rt, ids }) => rt.sim!.world.setDoor(ids.door, true).then(() => rt.sim!.world.setDoor(ids.door, false)) },
      indoor('10:55'),
      indoor('11:50'),
      indoor('12:45'),
      indoor('13:40'),
    ],
  },
  {
    id: 'package-heat',
    title: 'A package in the heat',
    blurb: "A hot afternoon and a delivery sits on the porch. Porchlight checks the doorbell snapshot with a vision model before reminding Rose, then Maria.",
    start: '11:20',
    speed: 60,
    steps: [
      indoor('11:25'),
      { at: '11:30', label: 'Living room reaches 31°C', run: ({ rt, ids }) => rt.sim!.world.setReading(ids.climate, 'temperature', 31.2) },
      { at: '12:10', label: 'Package delivered', run: ({ rt, ids }) => deliver(rt, ids.doorbell) },
      indoor('12:30'),
      { at: '13:50', label: 'Rose brings the package inside', run: ({ rt, ids }) => collect(rt, ids) },
      { at: '14:30', label: 'Living room cools to 26°C', run: ({ rt, ids }) => rt.sim!.world.setReading(ids.climate, 'temperature', 26) },
    ],
  },
  {
    id: 'night-door',
    title: 'The door opens at 2:48 AM',
    blurb: 'The front door opens in the middle of the night. Maria is alerted straight away with an infrared snapshot; the neighbor is next if Maria does not respond.',
    start: '02:30',
    speed: 30,
    steps: [
      indoor('02:41', 'Movement in the living room'),
      { at: '02:48', label: 'Someone steps out onto the porch', run: ({ rt, ids }) => {
        rt.sim!.world.place(ids.doorbell, 'person', rt.clock.now(), rt.clock.now() + 6 * 60_000);
      } },
      { at: '02:48', label: 'Front door opens', run: ({ rt, ids }) => rt.sim!.world.setDoor(ids.door, true) },
      { at: '02:49', label: 'Motion at the front door', run: async ({ rt, ids }) => void await rt.sim!.world.motion(ids.doorbell, 'human', { showObjectMs: 0 }) },
      { at: '02:54', label: 'Front door closes', run: ({ rt, ids }) => rt.sim!.world.setDoor(ids.door, false) },
      indoor('02:56', 'Movement in the living room'),
    ],
  },
  {
    id: 'missed-visit',
    title: "The aide can't get in",
    blurb: "Ana rings at 10:00 for her scheduled visit and nobody answers. That's urgent: Maria is alerted within minutes.",
    start: '09:40',
    speed: 45,
    weekday: true,
    steps: [
      { at: '09:59', label: 'Ana walks up to the door', run: async ({ rt, ids }) => void await rt.sim!.world.motion(ids.doorbell, 'human') },
      { at: '10:00', label: 'Ana rings the doorbell', run: async ({ rt, ids }) => void await rt.sim!.world.ding(ids.doorbell) },
      { at: '10:06', label: 'Ana rings again', run: async ({ rt, ids }) => void await rt.sim!.world.ding(ids.doorbell) },
      ...doorCycle('10:14', 'Rose opens the door (she was in the shower)'),
      indoor('10:16'),
    ],
  },
];

export interface ScenarioRun {
  id: string;
  title: string;
  dateKey: string;
  steps: Array<{ at: number; label: string }>;
}

/** Starts a scenario on a fresh simulated day and schedules its steps on the simulated clock. */
export async function runScenario(rt: Runtime, id: string): Promise<ScenarioRun> {
  const sim = rt.sim;
  if (!sim) throw new Error('Scenarios need --mode=sim');
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario ${id}`);
  const tz = rt.household.timeZone;
  const { world, clock, devices } = sim;
  const ids = { doorbell: devices.doorbell.id, livingRoom: devices.livingRoom.id, door: devices.doorContact.id, climate: devices.climate.id };

  clock.pause();
  clock.clearTasks();
  await rt.engine.idle();
  for (const c of rt.engine.openConcerns()) {
    c.status = 'resolved';
    c.resolvedAt = clock.now();
    c.resolution = { by: 'system', text: 'Closed when a new demo day started.' };
    for (const s of c.ladder) if (!s.firedAt) s.skipped = true;
  }
  rt.home.message = undefined;

  // Move to the next suitable day so every scenario starts from a clean morning.
  let t = clock.now() + 24 * 3600_000;
  while (scenario.weekday && [0, 6].includes(localParts(t, tz).weekday)) t += 24 * 3600_000;
  const dateKey = localParts(t, tz).dateKey;
  const start = localTimeToEpoch(dateKey, parseHHMM(scenario.start), tz);
  world.scenes = [];
  await world.setDoor(ids.door, false);
  await world.setReading(ids.climate, 'temperature', 22.4);
  clock.set(start);
  // Scenarios that start after breakfast get an ordinary morning first, recorded as past events.
  const wake = localTimeToEpoch(dateKey, 7 * 60 + 44, tz);
  if (start > wake) {
    const { signalFromHistory } = await import('../engine/interpret.ts');
    const past = [];
    for (let t = wake; t < start - 5 * 60_000; t += 47 * 60_000) {
      const ev = world.recordHistory({ deviceId: ids.livingRoom, eventType: 'motion', subType: 'human', start: t, end: t + 20_000 });
      const s = signalFromHistory(rt.household, { id: ev.id, deviceId: ids.livingRoom, eventType: 'motion', subType: 'human', start: t });
      if (s) past.push(s);
    }
    await rt.engine.backfill(past);
  }

  const steps = scenario.steps.map((s) => ({ ...s, time: localTimeToEpoch(dateKey, parseHHMM(s.at), tz) })).sort((a, b) => a.time - b.time);
  for (const s of steps) {
    clock.at(s.time, async () => {
      rt.bus.emit('event', { type: 'scenario-step', label: s.label, at: s.time });
      await s.run({ rt, ids });
    }, s.label);
  }
  // A normal day keeps going after the script: background movement indoors until bedtime.
  const last = steps.length ? steps[steps.length - 1].time : start;
  const tailStart = Math.max(last + 40 * 60_000, localTimeToEpoch(dateKey, 7 * 60 + 45, tz));
  const bedtime = localTimeToEpoch(dateKey, 21 * 60 + 40, tz);
  for (let t = tailStart; t < bedtime; t += 55 * 60_000) clock.at(t, async () => void (await world.motion(ids.livingRoom, 'human')), 'background');
  clock.setSpeed(scenario.speed);
  clock.resume();
  const run = { id, title: scenario.title, dateKey, steps: steps.map((s) => ({ at: s.time, label: s.label })) };
  rt.bus.emit('event', { type: 'scenario', run });
  return run;
}

/** Jumps the clock to one minute before the next scheduled step or ladder step. */
export async function skipAhead(rt: Runtime): Promise<number | undefined> {
  const sim = rt.sim;
  if (!sim) return undefined;
  const now = sim.clock.now();
  const ladderTimes = rt.engine.openConcerns().flatMap((c) => c.ladder.filter((s) => !s.firedAt).map((s) => s.dueAt));
  const candidates = [...sim.clock.pending().map((p) => p.at), ...ladderTimes, rt.engine.rhythm ? checkInTime(rt) : Infinity].filter((t) => t > now + 60_000);
  if (!candidates.length) return undefined;
  const target = Math.min(...candidates) - 60_000;
  sim.clock.set(target);
  return target;
}

function checkInTime(rt: Runtime): number {
  const tz = rt.household.timeZone;
  return localTimeToEpoch(localParts(rt.clock.now(), tz).dateKey, rt.engine.rhythm.checkInBy, tz);
}

async function deliver(rt: Runtime, doorbell: string): Promise<void> {
  const world = rt.sim!.world;
  world.place(doorbell, 'package', rt.clock.now());
  await world.motion(doorbell, 'package_delivery');
}

async function collect(rt: Runtime, ids: Ctx['ids']): Promise<void> {
  const world = rt.sim!.world;
  await world.setDoor(ids.door, true);
  world.remove(ids.doorbell, 'package');
  await world.motion(ids.doorbell, 'human');
  await world.setDoor(ids.door, false);
}

function minutesAfter(hhmm: string, minutes: number): string {
  const total = parseHHMM(hhmm) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

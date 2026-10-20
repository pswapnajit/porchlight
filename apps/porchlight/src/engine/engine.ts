import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Clock } from 'ring-partner-kit/sim';
import { appSignal, isPresence, setupFor } from './interpret.ts';
import { CO_CAVEAT, concernTitle, familyText, possessive, residentNudge, residentText, usualMorning } from './messages.ts';
import { MORNING_STARTS_AT, learnRhythm } from './rhythm.ts';
import { formatClock, formatDuration, formatMinuteOfDay, inWindow, localParts, localTimeToEpoch, parseHHMM } from './time.ts';
import type {
  ActionResult,
  CircleMember,
  Concern,
  ConcernKind,
  Household,
  LadderStep,
  Rhythm,
  Severity,
  Signal,
  SnapshotRef,
  StepKind,
  VisionResult,
} from './types.ts';

/** Side effects the engine asks for. Real ones call Ring and AWS; tests pass fakes. */
export interface CareActions {
  nudgeResident(concern: Concern, text: string, opts: { quiet: boolean }): Promise<ActionResult>;
  textResident(concern: Concern, text: string): Promise<ActionResult>;
  notifyFamily(member: CircleMember, concern: Concern, text: string): Promise<ActionResult>;
  checkPackage(deviceId: string, since: number): Promise<{ vision: VisionResult; snapshot?: SnapshotRef }>;
  captureSnapshot(deviceId: string, at: number): Promise<SnapshotRef | undefined>;
}

export interface ActivityEntry {
  id: number;
  at: number;
  kind: 'signal' | 'concern' | 'action' | 'vision' | 'system';
  text: string;
  ok?: boolean;
  concernId?: string;
}

export interface EngineOptions {
  household: Household;
  clock: Clock;
  actions: CareActions;
  /** How long a doorbell ring has to be answered. */
  answerWindowMs?: number;
  /** Signals older than this are not acted on (history backfill only informs the rhythm). */
  freshnessMs?: number;
}

const LADDERS: Record<ConcernKind, Array<[StepKind, number]>> = {
  quiet_morning: [['resident_nudge', 0], ['resident_call', 15], ['notify_primary', 30], ['notify_secondary', 60]],
  long_silence: [['resident_nudge', 0], ['resident_call', 15], ['notify_primary', 30], ['notify_secondary', 60]],
  package_waiting: [['resident_nudge', 0], ['notify_primary', 45]],
  unanswered_door: [['notify_primary', 0], ['resident_call', 0], ['notify_secondary', 15]],
  night_door: [['notify_primary', 0], ['resident_nudge', 0], ['notify_secondary', 15]],
  late_visitor: [['notify_primary', 0]],
  home_too_hot: [['resident_nudge', 0], ['notify_primary', 20]],
  home_too_cold: [['resident_nudge', 0], ['notify_primary', 30]],
  water_leak: [['notify_primary', 0], ['resident_nudge', 0], ['notify_secondary', 15]],
  freeze_risk: [['resident_nudge', 0], ['notify_primary', 30]],
  air_quality: [['notify_primary', 0], ['resident_nudge', 0]],
  camera_offline: [['notify_primary', 0]],
  family_check_in: [['resident_nudge', 0], ['notify_primary', 20]],
};

const PRESENCE_CONCERNS = new Set<ConcernKind>(['quiet_morning', 'long_silence', 'family_check_in']);
const ANSWER_KINDS = new Set(['door_open', 'door_closed', 'live_view', 'resident_ok', 'indoor_motion']);

export class CareEngine extends EventEmitter {
  readonly household: Household;
  readonly clock: Clock;
  readonly actions: CareActions;
  signals: Signal[] = [];
  concerns: Concern[] = [];
  activity: ActivityEntry[] = [];
  rhythm: Rhythm;
  readonly #answerWindowMs: number;
  readonly #freshnessMs: number;
  readonly #ids = new Set<string>();
  #pendingDeliveries: Array<{ signal: Signal; checkAt: number; checks: number }> = [];
  #pendingRings: Array<{ signal: Signal; checkAt: number }> = [];
  readonly #ringOutcomes = new Map<string, { answered: boolean; how?: string }>();
  readonly #deliveryOutcomes = new Map<string, { collectedAt?: number; how?: string }>();
  readonly #offlineSince = new Map<string, number>();
  readonly #recheckAt = new Map<string, number>();
  #rhythmDate?: string;
  #queue: Promise<unknown> = Promise.resolve();
  #tickQueued = false;
  #activitySeq = 0;

  constructor(opts: EngineOptions) {
    super();
    this.household = opts.household;
    this.clock = opts.clock;
    this.actions = opts.actions;
    this.#answerWindowMs = opts.answerWindowMs ?? 4 * 60_000;
    this.#freshnessMs = opts.freshnessMs ?? 15 * 60_000;
    this.rhythm = learnRhythm([], this.household, this.clock.now());
  }

  // ------------------------------------------------------------ public API --

  /** Adds a signal. Returns false for duplicates (the same event from webhook and history). */
  ingest(signal: Signal): Promise<boolean> {
    return this.#run(() => this.#ingest(signal));
  }

  /** Adds many past signals without acting on them, then relearns the rhythm. */
  backfill(signals: Signal[]): Promise<number> {
    return this.#run(async () => {
      let added = 0;
      for (const s of signals) if (this.#insert(s)) added++;
      this.#relearn();
      this.#log('system', `Learned from ${added} past Ring events: ${this.#rhythmLine()}`);
      return added;
    });
  }

  /** Evaluates time-based rules and fires due escalation steps. Safe to call often. */
  tick(): Promise<void> {
    if (this.#tickQueued) return Promise.resolve();
    this.#tickQueued = true;
    return this.#run(async () => {
      this.#tickQueued = false;
      await this.#tick();
    });
  }

  residentOk(): Promise<boolean> {
    return this.ingest(appSignal('resident_ok', this.clock.now(), `${this.household.resident.preferredName} tapped I'm OK`));
  }

  packageCollected(): Promise<boolean> {
    return this.ingest(appSignal('package_collected', this.clock.now(), `${this.household.resident.preferredName} said the package is inside`));
  }

  acknowledge(concernId: string, memberId: string): Promise<Concern | undefined> {
    return this.#run(async () => {
      const c = this.concerns.find((x) => x.id === concernId && x.status === 'open');
      const member = this.household.circle.find((m) => m.id === memberId);
      if (!c || !member) return undefined;
      c.acknowledgedBy = member.name;
      c.acknowledgedAt = this.clock.now();
      this.#log('concern', `${member.name} is handling "${c.title}". Porchlight won't alert anyone else.`, c.id);
      this.emit('concern', c);
      return c;
    });
  }

  resolve(concernId: string, memberId: string, note?: string): Promise<Concern | undefined> {
    return this.#run(async () => {
      const c = this.concerns.find((x) => x.id === concernId && x.status === 'open');
      const member = this.household.circle.find((m) => m.id === memberId);
      if (!c || !member) return undefined;
      await this.#close(c, 'family', `${member.name} marked it resolved${note ? `: "${note}"` : '.'}`);
      return c;
    });
  }

  /** A family member asks Porchlight to check on the resident now (for example by voice through Alexa+). */
  requestCheckIn(memberId: string): Promise<Concern | undefined> {
    return this.#run(async () => {
      const member = this.household.circle.find((m) => m.id === memberId) ?? this.household.circle[0];
      const existing = this.openConcerns().find((c) => c.kind === 'family_check_in');
      if (existing) return existing;
      const c = this.#open('family_check_in', 'gentle', `${member?.name ?? 'Family'} asked Porchlight to check on ${this.household.resident.preferredName}.`, [`Requested at ${formatClock(this.clock.now(), this.household.timeZone)}.`], {});
      await this.#tick();
      return c;
    });
  }

  relearn(): Promise<Rhythm> {
    return this.#run(async () => this.#relearn());
  }

  /** Waits until queued work has finished (tests, shutdown). */
  idle(): Promise<void> {
    return this.#run(async () => {});
  }

  openConcerns(): Concern[] {
    return this.concerns.filter((c) => c.status === 'open');
  }

  signalsBetween(from: number, to: number): Signal[] {
    return this.signals.filter((s) => s.at >= from && s.at < to);
  }

  /** Plain facts about one local day, for the digest and for questions. */
  dayFacts(dateKey = localParts(this.clock.now(), this.household.timeZone).dateKey) {
    const tz = this.household.timeZone;
    const from = localTimeToEpoch(dateKey, 0, tz);
    const to = from + 26 * 3600_000;
    const day = this.signals.filter((s) => s.at >= from && s.at < to && localParts(s.at, tz).dateKey === dateKey);
    const presence = day.filter((s) => isPresence(s, day) && localParts(s.at, tz).minuteOfDay >= MORNING_STARTS_AT);
    const temps = day.map((s) => s.detail?.reading?.temperature).filter((v): v is number => typeof v === 'number');
    return {
      date: dateKey,
      weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: tz }).format(from + 12 * 3600_000),
      resident: this.household.resident.preferredName,
      firstActivity: presence[0] ? formatClock(presence[0].at, tz) : null,
      lastActivity: presence.length ? formatClock(presence[presence.length - 1].at, tz) : null,
      usualFirstActivity: this.rhythm.firstActivity ? formatMinuteOfDay(this.rhythm.firstActivity.median) : null,
      activityCount: presence.length,
      visitors: day.filter((s) => s.kind === 'visitor_ring').map((s) => ({ time: formatClock(s.at, tz), answered: this.#ringOutcomes.get(s.id)?.answered ?? null })),
      deliveries: day.filter((s) => s.kind === 'delivery').map((s) => {
        const o = this.#deliveryOutcomes.get(s.id);
        return { time: formatClock(s.at, tz), broughtInside: o?.collectedAt ? formatClock(o.collectedAt, tz) : null };
      }),
      doorOpenings: day.filter((s) => s.kind === 'door_open').length,
      temperatureRangeC: temps.length ? [Math.min(...temps), Math.max(...temps)] : null,
      concerns: this.concerns
        .filter((c) => c.dateKey === dateKey)
        .map((c) => ({ title: c.title, opened: formatClock(c.openedAt, tz), status: c.status, resolution: c.resolution?.text ?? null, severity: c.severity })),
    };
  }

  // ------------------------------------------------------------- internals --

  #run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn, fn);
    this.#queue = next.catch((err) => {
      this.#log('system', `Engine error: ${(err as Error).message}`, undefined, false);
    });
    return next;
  }

  #insert(signal: Signal): boolean {
    if (this.#ids.has(signal.id)) return false;
    const twin = this.signals.find(
      (s) => s.kind === signal.kind && s.deviceId === signal.deviceId && s.source !== signal.source && Math.abs(s.at - signal.at) < 10_000,
    );
    if (twin) return false;
    this.#ids.add(signal.id);
    let i = this.signals.length;
    while (i > 0 && this.signals[i - 1].at > signal.at) i--;
    this.signals.splice(i, 0, signal);
    const horizon = this.clock.now() - 35 * 24 * 3600_000;
    while (this.signals.length && this.signals[0].at < horizon) this.#ids.delete(this.signals.shift()!.id);
    return true;
  }

  async #ingest(signal: Signal): Promise<boolean> {
    if (!this.#insert(signal)) return false;
    this.emit('signal', signal);
    const now = this.clock.now();
    const fresh = now - signal.at <= this.#freshnessMs;
    const tz = this.household.timeZone;
    const name = this.household.resident.preferredName;
    const when = formatClock(signal.at, tz);
    const quiet = this.#inQuietHours(signal.at);
    const where = signal.deviceLabel ?? 'a Ring device';
    if (signal.kind !== 'device_online') this.#log('signal', describeSignal(signal, name, when), undefined, true);
    if (!fresh) return true;

    const nearby = this.signals.filter((s) => Math.abs(s.at - signal.at) <= 5 * 60_000);
    if (isPresence(signal, nearby)) {
      for (const c of this.openConcerns()) {
        if (PRESENCE_CONCERNS.has(c.kind) && c.openedAt <= signal.at + 60_000) {
          await this.#close(c, signal.kind === 'resident_ok' ? 'resident' : 'signal', presenceSentence(signal, name, when));
        }
      }
    }

    if (signal.kind === 'door_open' || signal.kind === 'resident_ok') {
      for (const c of this.openConcerns().filter((x) => x.kind === 'unanswered_door' && x.openedAt <= signal.at + 60_000)) {
        await this.#close(c, signal.kind === 'resident_ok' ? 'resident' : 'signal', presenceSentence(signal, name, when));
      }
    }
    if (signal.kind === 'door_closed' || signal.kind === 'outdoor_motion') {
      // Someone may have just picked up the package: look again a minute from now.
      for (const c of this.openConcerns().filter((x) => x.kind === 'package_waiting')) this.#recheckAt.set(c.id, signal.at + 60_000);
    }

    switch (signal.kind) {
      case 'visitor_ring':
        if (quiet) {
          const c = this.#open('late_visitor', 'urgent', `Someone rang the doorbell at ${when}, during ${possessive(this.household)} quiet hours.`, [`Doorbell pressed at ${when} (${where}).`], { deviceId: signal.deviceId });
          await this.#attachSnapshot(c, signal.deviceId, signal.at);
        } else {
          this.#pendingRings.push({ signal, checkAt: signal.at + this.#answerWindowMs });
        }
        break;
      case 'delivery':
        if (!this.#away(now)) {
          const dwell = this.#packageDwellMs();
          this.#pendingDeliveries.push({ signal, checkAt: signal.at + dwell, checks: 0 });
          this.#log('system', `Delivery at ${when}. Porchlight will check the porch in ${formatDuration(dwell)}.`);
        }
        break;
      case 'door_open':
        if (quiet && !this.openConcerns().some((c) => c.kind === 'night_door')) {
          const c = this.#open('night_door', 'urgent', `The front door opened at ${when}, outside ${name}'s usual hours.`, [`Door contact opened at ${when} (${where}).`], { deviceId: signal.deviceId });
          await this.#attachSnapshot(c, this.#entryCameraId(), signal.at);
        }
        break;
      case 'package_collected':
        for (const d of this.#pendingDeliveries) this.#deliveryOutcomes.set(d.signal.id, { collectedAt: signal.at, how: signal.source });
        this.#pendingDeliveries = [];
        for (const c of this.openConcerns().filter((x) => x.kind === 'package_waiting')) {
          if (c.since) this.#markDeliveriesCollected(c.since, signal.at, signal.source);
          await this.#close(c, signal.source === 'vision' ? 'signal' : 'resident', signal.source === 'vision' ? `The doorbell camera shows the porch is clear at ${when}.` : `${name} said the package is inside (${when}).`);
        }
        break;
      case 'env_alert':
        await this.#openEnvironment(signal, when);
        break;
      case 'env_clear':
        for (const c of this.openConcerns().filter((x) => envKinds(signal.detail?.measure).includes(x.kind))) {
          await this.#close(c, 'signal', `${measureName(signal.detail?.measure)} back to normal at ${when}${readingText(signal)}.`);
        }
        break;
      case 'device_offline':
        if (setupFor(this.household, signal.deviceId)?.role === 'entry_camera') this.#offlineSince.set(signal.deviceId!, signal.at);
        break;
      case 'device_online':
        if (signal.deviceId && this.#offlineSince.delete(signal.deviceId)) {
          for (const c of this.openConcerns().filter((x) => x.kind === 'camera_offline' && x.deviceId === signal.deviceId)) {
            await this.#close(c, 'signal', `${where} is back online (${when}).`);
          }
        }
        break;
      default:
        break;
    }
    return true;
  }

  async #tick(): Promise<void> {
    const now = this.clock.now();
    const tz = this.household.timeZone;
    const lp = localParts(now, tz);
    const name = this.household.resident.preferredName;
    if (this.#rhythmDate !== lp.dateKey) this.#relearn();

    const away = this.#away(now);
    // Quiet morning: nothing that shows the resident is up by the check-in time.
    if (!away && lp.minuteOfDay >= this.rhythm.checkInBy && !this.#concernToday('quiet_morning', lp.dateKey)) {
      const morning = localTimeToEpoch(lp.dateKey, MORNING_STARTS_AT, tz);
      const today = this.signalsBetween(morning, now + 1);
      if (!today.some((s) => isPresence(s, today))) {
        const last = [...this.signals].reverse().find((s) => s.at < morning && isPresence(s, this.signals));
        const evidence = [
          `No activity seen since ${formatMinuteOfDay(MORNING_STARTS_AT)} today.`,
          last ? `Last sign of ${name}: ${describeSignal(last, name, formatClock(last.at, tz))} ${dayWord(last.at, now, tz)}.` : `No earlier activity on record.`,
        ];
        if (this.rhythm.firstActivity) evidence.push(`Usual range: ${formatMinuteOfDay(this.rhythm.firstActivity.p10)} to ${formatMinuteOfDay(this.rhythm.firstActivity.p90)} over ${this.rhythm.days} days.`);
        this.#open('quiet_morning', 'gentle', `No sign of ${name} yet this morning. ${usualMorning(this.household, this.rhythm)}.`, evidence, {});
      }
    }

    // Long silence: active earlier today, nothing for much longer than a normal quiet stretch.
    if (!away && !this.#inQuietHours(now)) {
      const morning = localTimeToEpoch(lp.dateKey, MORNING_STARTS_AT, tz);
      const today = this.signalsBetween(morning, now + 1);
      const presence = today.filter((s) => isPresence(s, today));
      const last = presence[presence.length - 1];
      const thresholdMin = Math.max(180, this.rhythm.usualLongestGapMin * 1.25);
      const endOfDay = this.rhythm.lastActivity?.p90 ?? 21 * 60;
      if (
        last &&
        (now - last.at) / 60_000 > thresholdMin &&
        lp.minuteOfDay < endOfDay &&
        !this.openConcerns().some((c) => PRESENCE_CONCERNS.has(c.kind)) &&
        !this.concerns.some((c) => c.kind === 'long_silence' && c.openedAt > last.at)
      ) {
        this.#open(
          'long_silence',
          'gentle',
          `No activity for ${formatDuration(now - last.at)}, longer than ${name}'s usual quiet stretch (${formatDuration(this.rhythm.usualLongestGapMin * 60_000)}).`,
          [`Last sign of ${name}: ${describeSignal(last, name, formatClock(last.at, tz))}.`],
          {},
        );
      }
    }

    // Doorbell rings that nobody answered.
    const dueRings = this.#pendingRings.filter((r) => r.checkAt <= now);
    this.#pendingRings = this.#pendingRings.filter((r) => r.checkAt > now);
    for (const ring of dueRings) await this.#checkRing(ring.signal, now);

    // Deliveries that may still be sitting outside.
    const dueDeliveries = this.#pendingDeliveries.filter((d) => d.checkAt <= now);
    this.#pendingDeliveries = this.#pendingDeliveries.filter((d) => d.checkAt > now);
    for (const d of dueDeliveries) await this.#checkDelivery(d, now);

    // Re-check open package concerns every 30 minutes; resolve when the porch is clear.
    for (const c of this.openConcerns().filter((x) => x.kind === 'package_waiting')) {
      const recheck = this.#recheckAt.get(c.id);
      if (c.deviceId && (!c.vision || now - c.vision.at >= 30 * 60_000 || (recheck !== undefined && recheck <= now))) {
        this.#recheckAt.delete(c.id);
        const { vision, snapshot } = await this.actions.checkPackage(c.deviceId, c.since ?? c.openedAt);
        c.vision = vision;
        if (snapshot) c.snapshot = snapshot;
        this.#log('vision', `Porch check: ${vision.description}`, c.id, vision.packagePresent !== null);
        if (vision.packagePresent === false) await this.#ingest({ ...appSignal('package_collected', now), source: 'vision', id: `vision:clear:${now}` });
        else this.emit('concern', c);
      }
    }

    // Front-door camera offline for 30 minutes: Porchlight is blind, so say so.
    for (const [deviceId, since] of this.#offlineSince) {
      if (now - since >= 30 * 60_000 && !this.openConcerns().some((c) => c.kind === 'camera_offline' && c.deviceId === deviceId)) {
        const label = setupFor(this.household, deviceId)?.label ?? 'The front door camera';
        this.#open(
          'camera_offline',
          'gentle',
          `${label} has been offline since ${formatClock(since, tz)}, so Porchlight can't check in on ${name}. Check its power and Wi-Fi in the Ring app.`,
          [`Ring reported ${label} offline at ${formatClock(since, tz)}.`],
          { deviceId },
        );
      }
    }

    // Escalation ladders.
    for (const c of this.openConcerns()) {
      for (const step of c.ladder) {
        if (step.firedAt || step.dueAt > now) continue;
        await this.#fire(c, step, now);
        if (c.status !== 'open') break;
      }
    }
  }

  async #checkRing(ring: Signal, now: number): Promise<void> {
    const tz = this.household.timeZone;
    const when = formatClock(ring.at, tz);
    const answer = this.signals.find((s) => s.at > ring.at && s.at <= ring.at + this.#answerWindowMs && ANSWER_KINDS.has(s.kind));
    if (answer) {
      this.#ringOutcomes.set(ring.id, { answered: true, how: answer.kind });
      this.#log('system', `Doorbell at ${when} was answered (${answer.kind.replace('_', ' ')}).`);
      return;
    }
    this.#ringOutcomes.set(ring.id, { answered: false });
    const visit = this.#expectedVisit(ring.at);
    const quietMorning = this.openConcerns().find((c) => c.kind === 'quiet_morning');
    const already = this.openConcerns().find((c) => c.kind === 'unanswered_door');
    if (visit && already) {
      already.evidence.push(`Rang again at ${when}; still no answer.`);
      this.emit('concern', already);
    } else if (visit) {
      this.#open(
        'unanswered_door',
        'urgent',
        `${visit.who} rang the doorbell at ${when} for ${possessive(this.household)} scheduled visit, and nobody answered within ${formatDuration(this.#answerWindowMs)}.`,
        [`Doorbell pressed at ${when}; no door opening or other activity afterwards.`, `Scheduled: ${visit.who} at ${visit.time}.`],
        { deviceId: ring.deviceId },
      );
    } else if (quietMorning) {
      quietMorning.evidence.push(`Someone rang the doorbell at ${when} and nobody answered.`);
      this.#escalate(quietMorning, now, 'Unanswered doorbell during a quiet morning');
    } else {
      this.#log('system', `Doorbell at ${when} wasn't answered. Nobody was expected, so no alert.`);
    }
  }

  async #checkDelivery(d: { signal: Signal; checkAt: number; checks: number }, now: number): Promise<void> {
    const tz = this.household.timeZone;
    const when = formatClock(d.signal.at, tz);
    const collected = this.signals.find((s) => s.at > d.signal.at && (s.kind === 'door_open' || s.kind === 'package_collected'));
    if (collected) {
      this.#deliveryOutcomes.set(d.signal.id, { collectedAt: collected.at, how: collected.kind });
      this.#log('system', `Delivery from ${when}: the front door opened at ${formatClock(collected.at, tz)}, so it was likely brought in.`);
      return;
    }
    const deviceId = d.signal.deviceId ?? this.#entryCameraId();
    if (!deviceId) return;
    const { vision, snapshot } = await this.actions.checkPackage(deviceId, d.signal.at);
    this.#log('vision', `Porch check for the ${when} delivery: ${vision.description}`, undefined, vision.packagePresent !== null);
    if (vision.packagePresent === false) {
      this.#deliveryOutcomes.set(d.signal.id, { collectedAt: now, how: 'vision' });
      return;
    }
    if (vision.packagePresent === null && d.checks < 1) {
      this.#pendingDeliveries.push({ ...d, checkAt: now + 15 * 60_000, checks: d.checks + 1 });
      return;
    }
    const name = this.household.resident.preferredName;
    const c = this.#open(
      'package_waiting',
      'gentle',
      vision.packagePresent
        ? `A delivery from ${when} is still on the porch ${formatDuration(now - d.signal.at)} later.`
        : `A delivery arrived at ${when} and Porchlight couldn't confirm it was brought in.`,
      [`Ring flagged a package delivery at ${when}.`, `Doorbell camera check at ${formatClock(now, tz)}: ${vision.description}`, `${name} hasn't opened the front door since.`],
      { deviceId, since: d.signal.at },
    );
    c.vision = vision;
    if (snapshot) c.snapshot = snapshot;
    this.emit('concern', c);
  }

  async #openEnvironment(signal: Signal, when: string): Promise<void> {
    const measure = signal.detail?.measure;
    const t = signal.detail?.reading?.temperature;
    let kind: ConcernKind | undefined;
    let severity: Severity = 'gentle';
    let summary = '';
    if (measure === 'temperature') {
      const hot = signal.detail?.direction === 'max' || (t !== undefined && t >= 27);
      kind = hot ? 'home_too_hot' : 'home_too_cold';
      severity = t !== undefined && (t >= 32 || t <= 13) ? 'urgent' : 'gentle';
      summary = `It's ${t !== undefined ? `${t.toFixed(1)}°C (${Math.round((t * 9) / 5 + 32)}°F)` : hot ? 'too hot' : 'too cold'} inside at ${when}.`;
    } else if (measure === 'flood') {
      kind = 'water_leak';
      severity = 'urgent';
      summary = `The flood sensor detected water at ${when}.`;
    } else if (measure === 'freeze') {
      kind = 'freeze_risk';
      summary = `The freeze sensor dropped below 4°C (40°F) at ${when}.`;
    } else if (measure === 'co') {
      kind = 'air_quality';
      severity = 'urgent';
      summary = `The air monitor reported carbon monoxide above its limit at ${when}. ${CO_CAVEAT}`;
    } else if (measure === 'pm25') {
      kind = 'air_quality';
      summary = `Fine-particle pollution (PM2.5) is high indoors at ${when}${readingText(signal)}.`;
    }
    if (!kind || this.openConcerns().some((c) => c.kind === kind)) return;
    this.#open(kind, severity, summary, [`${signal.deviceLabel ?? 'A sensor'} reported it at ${when}${readingText(signal)}.`], { deviceId: signal.deviceId });
  }

  #open(kind: ConcernKind, severity: Severity, summary: string, evidence: string[], extra: Partial<Concern>): Concern {
    const now = this.clock.now();
    const ladder: LadderStep[] = LADDERS[kind].map(([k, min]) => ({ kind: k, dueAt: now + (severity === 'urgent' && k === 'notify_primary' ? 0 : min) * 60_000 }));
    const concern: Concern = {
      id: randomUUID(),
      kind,
      severity,
      status: 'open',
      openedAt: now,
      title: concernTitle(kind),
      summary,
      evidence,
      ladder,
      dateKey: localParts(now, this.household.timeZone).dateKey,
      ...extra,
    };
    this.concerns.push(concern);
    if (this.concerns.length > 200) this.concerns = this.concerns.filter((c) => c.status === 'open' || now - c.openedAt < 7 * 24 * 3600_000);
    this.#log('concern', `${concern.title}: ${summary}`, concern.id);
    this.emit('concern', concern);
    return concern;
  }

  /** Raises a gentle concern to urgent and brings the family step forward to now. */
  #escalate(c: Concern, now: number, reason: string): void {
    c.severity = 'urgent';
    const notify = c.ladder.find((s) => s.kind === 'notify_primary' && !s.firedAt);
    if (notify) notify.dueAt = Math.min(notify.dueAt, now);
    this.#log('concern', `Escalated "${c.title}": ${reason}.`, c.id);
    this.emit('concern', c);
  }

  async #fire(c: Concern, step: LadderStep, now: number): Promise<void> {
    step.firedAt = now;
    const h = this.household;
    const isFamily = step.kind === 'notify_primary' || step.kind === 'notify_secondary';
    if (c.acknowledgedBy && isFamily) {
      step.skipped = true;
      step.outcome = `Skipped: ${c.acknowledgedBy} is handling it.`;
      this.emit('concern', c);
      return;
    }
    let result: ActionResult;
    if (step.kind === 'resident_nudge') {
      result = await this.actions.nudgeResident(c, residentNudge(h, c), { quiet: this.#inQuietHours(now) });
    } else if (step.kind === 'resident_call') {
      const primary = h.circle.find((m) => m.role === 'primary');
      result = await this.actions.textResident(c, residentText(h, c, primary?.name ?? 'your family'));
    } else {
      const role = step.kind === 'notify_primary' ? 'primary' : 'secondary';
      const members = h.circle.filter((m) => m.role === role && (m.receives === 'all' || m.receives.includes(c.kind)));
      if (!members.length) {
        step.skipped = true;
        step.outcome = `No ${role} contact wants "${c.title}" alerts.`;
        this.emit('concern', c);
        return;
      }
      const text = familyText(h, c, now);
      const outcomes = [];
      for (const m of members) outcomes.push(await this.actions.notifyFamily(m, c, text));
      result = { ok: outcomes.every((o) => o.ok), channel: outcomes.map((o) => o.channel).join(', '), text: outcomes.map((o) => o.text).join(' ') };
    }
    step.outcome = result.text;
    this.#log('action', result.text, c.id, result.ok);
    this.emit('concern', c);
  }

  async #close(c: Concern, by: NonNullable<Concern['resolution']>['by'], text: string): Promise<void> {
    if (c.status !== 'open') return;
    const now = this.clock.now();
    c.status = 'resolved';
    c.resolvedAt = now;
    const familyTold = c.ladder.some((s) => (s.kind === 'notify_primary' || s.kind === 'notify_secondary') && s.firedAt && !s.skipped);
    c.resolution = { by, text: familyTold || by === 'family' ? text : `${text} No one else was bothered.` };
    for (const step of c.ladder) if (!step.firedAt) {
      step.skipped = true;
      step.outcome = 'Not needed.';
    }
    this.#log('concern', `Resolved "${c.title}": ${c.resolution.text}`, c.id);
    if (familyTold && by !== 'family') {
      for (const m of this.household.circle.filter((x) => c.ladder.some((s) => s.firedAt && !s.skipped && s.kind === `notify_${x.role}`))) {
        const r = await this.actions.notifyFamily(m, c, `All clear: ${text}`);
        this.#log('action', r.text, c.id, r.ok);
      }
    }
    this.emit('concern', c);
  }

  async #attachSnapshot(c: Concern, deviceId: string | undefined, at: number): Promise<void> {
    if (!deviceId) return;
    try {
      const shot = await this.actions.captureSnapshot(deviceId, at);
      if (shot) {
        c.snapshot = shot;
        this.emit('concern', c);
      }
    } catch (err) {
      this.#log('system', `Couldn't get a snapshot: ${(err as Error).message}`, c.id, false);
    }
  }

  #markDeliveriesCollected(since: number, at: number, how: string): void {
    for (const s of this.signals) if (s.kind === 'delivery' && s.at >= since - 60_000 && s.at <= at) this.#deliveryOutcomes.set(s.id, { collectedAt: at, how });
  }

  #relearn(): Rhythm {
    const now = this.clock.now();
    this.rhythm = learnRhythm(this.signals, this.household, now);
    this.#rhythmDate = localParts(now, this.household.timeZone).dateKey;
    this.emit('rhythm', this.rhythm);
    return this.rhythm;
  }

  #rhythmLine(): string {
    const r = this.rhythm;
    if (!r.firstActivity || r.confidence === 'learning') return `still learning (${r.days} days so far); check-in time ${formatMinuteOfDay(r.checkInBy)} by default.`;
    return `usually up between ${formatMinuteOfDay(r.firstActivity.p10)} and ${formatMinuteOfDay(r.firstActivity.p90)}; check-in time ${formatMinuteOfDay(r.checkInBy)}.`;
  }

  #concernToday(kind: ConcernKind, dateKey: string): boolean {
    return this.concerns.some((c) => c.kind === kind && c.dateKey === dateKey);
  }

  #inQuietHours(t: number): boolean {
    const q = this.household.routine.quietHours;
    return inWindow(localParts(t, this.household.timeZone).minuteOfDay, parseHHMM(q.start), parseHHMM(q.end));
  }

  #away(now: number): boolean {
    const until = this.household.awayUntil;
    return typeof until === 'number' && now < until;
  }

  #packageDwellMs(): number {
    const recentTemp = [...this.signals].reverse().find((s) => typeof s.detail?.reading?.temperature === 'number')?.detail?.reading?.temperature;
    const base = this.household.routine.packageDwellMin;
    return (recentTemp !== undefined && (recentTemp >= 30 || recentTemp <= 5) ? Math.min(base, 45) : base) * 60_000;
  }

  #expectedVisit(at: number): { who: string; time: string } | undefined {
    const lp = localParts(at, this.household.timeZone);
    for (const v of this.household.careSchedule) {
      const start = parseHHMM(v.time);
      if (v.days.includes(lp.weekday) && lp.minuteOfDay >= start - v.windowMin && lp.minuteOfDay <= start + v.windowMin) {
        return { who: v.who, time: formatMinuteOfDay(start) };
      }
    }
    return undefined;
  }

  #entryCameraId(): string | undefined {
    return this.household.devices.find((d) => d.role === 'entry_camera')?.deviceId;
  }

  #log(kind: ActivityEntry['kind'], text: string, concernId?: string, ok?: boolean): void {
    const entry: ActivityEntry = { id: ++this.#activitySeq, at: this.clock.now(), kind, text, concernId, ok };
    this.activity.push(entry);
    if (this.activity.length > 400) this.activity.shift();
    this.emit('activity', entry);
  }
}

function describeSignal(s: Signal, name: string, when: string): string {
  const where = s.deviceLabel ? ` (${s.deviceLabel})` : '';
  switch (s.kind) {
    case 'indoor_motion':
      return `Movement inside at ${when}${where}`;
    case 'outdoor_motion':
      return `Someone at the front door at ${when}${where}`;
    case 'visitor_ring':
      return `Doorbell rang at ${when}${where}`;
    case 'delivery':
      return `Package delivery at ${when}${where}`;
    case 'vehicle':
      return `Vehicle passed at ${when}${where}`;
    case 'animal':
      return `Animal at ${when}${where}`;
    case 'door_open':
      return `Front door opened at ${when}${where}`;
    case 'door_closed':
      return `Front door closed at ${when}${where}`;
    case 'live_view':
      return `Live view opened in the Ring app at ${when}${where}`;
    case 'env_alert':
      return `${measureName(s.detail?.measure)} alert at ${when}${readingText(s)}${where}`;
    case 'env_clear':
      return `${measureName(s.detail?.measure)} back to normal at ${when}${readingText(s)}${where}`;
    case 'device_offline':
      return `${s.deviceLabel ?? 'A device'} went offline at ${when}`;
    case 'device_online':
      return `${s.deviceLabel ?? 'A device'} came online at ${when}`;
    case 'resident_ok':
      return `${name} tapped "I'm OK" at ${when}`;
    case 'package_collected':
      return `Package brought inside by ${when}`;
  }
}

function presenceSentence(s: Signal, name: string, when: string): string {
  switch (s.kind) {
    case 'resident_ok':
      return `${name} tapped "I'm OK" at ${when}.`;
    case 'door_open':
    case 'door_closed':
      return `${name}'s front door ${s.kind === 'door_open' ? 'opened' : 'closed'} at ${when}.`;
    case 'indoor_motion':
      return `Movement inside the home at ${when}.`;
    default:
      return `Activity at the front door at ${when}.`;
  }
}

function measureName(measure: string | undefined): string {
  return { temperature: 'Temperature', humidity: 'Humidity', pm25: 'Air quality (PM2.5)', co: 'Carbon monoxide', flood: 'Water sensor', freeze: 'Freeze sensor' }[measure ?? ''] ?? 'Sensor';
}

function readingText(s: Signal): string {
  const r = s.detail?.reading;
  if (r?.temperature !== undefined) return ` (${r.temperature.toFixed(1)}°C)`;
  if (r?.humidity !== undefined) return ` (${r.humidity.toFixed(0)}% humidity)`;
  if (r?.pm25 !== undefined) return ` (${r.pm25.toFixed(0)} µg/m³)`;
  return '';
}

function envKinds(measure: string | undefined): ConcernKind[] {
  if (measure === 'temperature') return ['home_too_hot', 'home_too_cold'];
  if (measure === 'flood') return ['water_leak'];
  if (measure === 'freeze') return ['freeze_risk'];
  if (measure === 'co' || measure === 'pm25') return ['air_quality'];
  return [];
}

function dayWord(at: number, now: number, tz: string): string {
  const a = localParts(at, tz).dateKey;
  const b = localParts(now, tz).dateKey;
  if (a === b) return 'today';
  const y = localParts(now - 24 * 3600_000, tz).dateKey;
  return a === y ? 'yesterday' : `on ${a}`;
}


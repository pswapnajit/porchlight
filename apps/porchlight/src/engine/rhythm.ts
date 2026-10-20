import { isPresence } from './interpret.ts';
import { localParts, parseHHMM, quantile } from './time.ts';
import type { Household, Rhythm, Signal } from './types.ts';

export const DEFAULT_CHECK_IN_BY = 10 * 60 + 30;
export const DEFAULT_LONGEST_GAP_MIN = 4 * 60;
const EARLIEST_CHECK_IN = 7 * 60;
const LATEST_CHECK_IN = 12 * 60;
/** Activity before this local time belongs to "last night", not "this morning". */
export const MORNING_STARTS_AT = 4 * 60;

/**
 * Learns the resident's usual day from past signals (up to 28 full days):
 * when the first sign of life usually comes, how long a normal quiet stretch
 * lasts, and how often deliveries and visitors happen. The check-in deadline is
 * the latest usual start (p90) plus a 45-minute grace, clamped to 7:00-12:00,
 * unless the family set it by hand.
 */
export function learnRhythm(signals: Signal[], household: Household, now: number, maxDays = 28): Rhythm {
  const tz = household.timeZone;
  const today = localParts(now, tz).dateKey;
  const byDay = new Map<string, Signal[]>();
  const horizon = now - (maxDays + 1) * 24 * 3600_000;
  for (const s of signals) {
    if (s.at < horizon || s.at > now) continue;
    const key = localParts(s.at, tz).dateKey;
    if (key === today) continue;
    const list = byDay.get(key) ?? [];
    list.push(s);
    byDay.set(key, list);
  }
  const days = [...byDay.keys()].sort().slice(-maxDays);
  const firsts: number[] = [];
  const lasts: number[] = [];
  const maxGaps: number[] = [];
  const hourly = new Array<number>(24).fill(0);
  let deliveries = 0;
  let visitors = 0;
  for (const day of days) {
    const list = byDay.get(day)!.sort((a, b) => a.at - b.at);
    deliveries += list.filter((s) => s.kind === 'delivery').length;
    visitors += list.filter((s) => s.kind === 'visitor_ring').length;
    const presence = list.filter((s) => isPresence(s, list)).map((s) => localParts(s.at, tz).minuteOfDay);
    for (const m of presence) hourly[Math.floor(m / 60)]++;
    const daytime = presence.filter((m) => m >= MORNING_STARTS_AT).sort((a, b) => a - b);
    if (!daytime.length) continue;
    firsts.push(daytime[0]);
    lasts.push(daytime[daytime.length - 1]);
    let maxGap = 0;
    for (let i = 1; i < daytime.length; i++) maxGap = Math.max(maxGap, daytime[i] - daytime[i - 1]);
    maxGaps.push(maxGap);
  }
  firsts.sort((a, b) => a - b);
  lasts.sort((a, b) => a - b);
  maxGaps.sort((a, b) => a - b);
  const n = firsts.length;
  const confidence: Rhythm['confidence'] = n < 5 ? 'learning' : n < 14 ? 'low' : 'good';
  const firstActivity = n ? { p10: quantile(firsts, 0.1), median: quantile(firsts, 0.5), p90: quantile(firsts, 0.9) } : null;
  const lastActivity = n ? { median: quantile(lasts, 0.5), p90: quantile(lasts, 0.9) } : null;

  let checkInBy = DEFAULT_CHECK_IN_BY;
  let checkInSource: Rhythm['checkInSource'] = 'default';
  if (household.routine.checkInBy) {
    checkInBy = parseHHMM(household.routine.checkInBy);
    checkInSource = 'family';
  } else if (firstActivity && confidence !== 'learning') {
    checkInBy = Math.min(LATEST_CHECK_IN, Math.max(EARLIEST_CHECK_IN, Math.ceil((firstActivity.p90 + 45) / 5) * 5));
    checkInSource = 'learned';
  }
  const usualLongestGapMin = maxGaps.length >= 5 ? Math.max(120, quantile(maxGaps, 0.9)) : DEFAULT_LONGEST_GAP_MIN;
  const perWeek = (count: number) => (days.length ? Math.round((count / days.length) * 7 * 10) / 10 : 0);
  return {
    days: n,
    confidence,
    firstActivity,
    lastActivity,
    checkInBy,
    checkInSource,
    usualLongestGapMin,
    deliveriesPerWeek: perWeek(deliveries),
    visitorsPerWeek: perWeek(visitors),
    hourly: hourly.map((c) => (days.length ? Math.round((c / days.length) * 100) / 100 : 0)),
  };
}

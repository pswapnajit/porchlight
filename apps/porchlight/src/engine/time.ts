// Local-time helpers. Rules are about the resident's day ("up by 9:30"), so every
// comparison happens in the household's time zone, not the server's.

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
  /** Minutes since local midnight. */
  minuteOfDay: number;
  /** YYYY-MM-DD in local time. */
  dateKey: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(t: number, timeZone: string): LocalParts {
  const map: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(t)) map[p.type] = p.value;
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute,
    second: Number(map.second),
    weekday: WEEKDAYS[map.weekday] ?? 0,
    minuteOfDay: hour * 60 + minute,
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

/** Epoch ms for a local date (YYYY-MM-DD) and minutes after local midnight. Handles DST. */
export function localTimeToEpoch(dateKey: string, minuteOfDay: number, timeZone: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const offset = asUtc - guess;
    const next = naive - offset;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

export function startOfLocalDay(t: number, timeZone: string): number {
  return localTimeToEpoch(localParts(t, timeZone).dateKey, 0, timeZone);
}

export function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`bad time ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinuteOfDay(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatClock(t: number, timeZone: string): string {
  return formatMinuteOfDay(localParts(t, timeZone).minuteOfDay);
}

/** True when minuteOfDay is inside [start, end), where the window may wrap past midnight. */
export function inWindow(minuteOfDay: number, start: number, end: number): boolean {
  return start <= end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

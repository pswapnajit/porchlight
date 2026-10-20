import { formatClock, formatDuration, formatMinuteOfDay } from './time.ts';
import type { Concern, Household, Rhythm } from './types.ts';

// Every message a person receives is a deterministic template: escalation is
// safety-relevant, so wording never depends on a model. (The optional AI layer
// only writes the end-of-day digest and answers questions, from the same facts.)

export function possessive(h: Household): string {
  return h.resident.pronoun === 'she' ? 'her' : h.resident.pronoun === 'he' ? 'his' : 'their';
}

export function subject(h: Household): string {
  return h.resident.pronoun === 'she' ? 'She' : h.resident.pronoun === 'he' ? 'He' : 'They';
}

export function usualMorning(h: Household, r: Rhythm): string {
  if (!r.firstActivity) return `${h.resident.preferredName}'s usual morning is still being learned`;
  return `${h.resident.preferredName} is usually up by ${formatMinuteOfDay(r.firstActivity.median)}`;
}

export function residentNudge(h: Household, c: Concern): string {
  const name = h.resident.preferredName;
  switch (c.kind) {
    case 'quiet_morning':
      return `Good morning, ${name}! Just checking in. Tap "I'm OK" when you see this.`;
    case 'long_silence':
      return `Hi ${name}, it's been quiet for a while. Tap "I'm OK" to let your family know you're fine.`;
    case 'package_waiting':
      return `${name}, a delivery is waiting at your front door. Please bring it inside when you can.`;
    case 'home_too_hot':
      return `${name}, it's getting hot inside. Please have some water and open a window or turn on the fan.`;
    case 'home_too_cold':
    case 'freeze_risk':
      return `${name}, it's getting cold inside. Please turn up the heat or put on a warm layer.`;
    case 'family_check_in':
      return `Hi ${name}! Your family is thinking of you. Tap "I'm OK" to let them know you're all right.`;
    case 'night_door':
      return `${name}, the front door is open. If you're up, please close it when you're back inside.`;
    default:
      return `Hi ${name}, just checking in. Tap "I'm OK" when you see this.`;
  }
}

export function residentText(h: Household, c: Concern, primaryName: string): string {
  return `Hi ${h.resident.preferredName}, this is Porchlight checking in for ${primaryName}. Reply OK or call ${primaryName} back. (${c.title})`;
}

export function familyText(h: Household, c: Concern, now: number): string {
  const tz = h.timeZone;
  const fired = c.ladder.filter((s) => s.firedAt && !s.skipped && (s.kind === 'resident_nudge' || s.kind === 'resident_call'));
  const tried = fired.length
    ? ` Porchlight already ${fired
        .map((s) => (s.kind === 'resident_nudge' ? `nudged ${possessive(h)} at home at ${formatClock(s.firedAt!, tz)}` : `texted ${possessive(h)} at ${formatClock(s.firedAt!, tz)}`))
        .join(' and ')}, with no response yet.`
    : '';
  const age = now - c.openedAt > 60_000 ? ` (open ${formatDuration(now - c.openedAt)})` : '';
  return `${c.title}${age}: ${c.summary}${tried}`;
}

export function concernTitle(kind: Concern['kind']): string {
  return {
    quiet_morning: 'Quiet morning',
    long_silence: 'Unusually quiet',
    package_waiting: 'Package still outside',
    unanswered_door: 'Doorbell not answered',
    night_door: 'Front door opened at night',
    late_visitor: 'Late-night visitor',
    home_too_hot: 'Home is too hot',
    home_too_cold: 'Home is too cold',
    water_leak: 'Water detected',
    freeze_risk: 'Freeze risk',
    air_quality: 'Air quality alert',
    camera_offline: "Can't see the front door",
    family_check_in: 'Check-in from family',
  }[kind];
}

export const CO_CAVEAT =
  'Porchlight is not a carbon monoxide alarm. If a CO alarm is sounding, get everyone outside and call 911.';

import type { RingEvent } from 'ring-partner-kit';
import type { DeviceSetup, Household, Signal, SignalKind, Strength } from './types.ts';

// Ring event -> Porchlight signal. This is where Ring data gets its meaning for
// caregiving: an indoor camera's motion is strong evidence the resident is up;
// motion at the front door might be a visitor; a vehicle means nothing at all.

export interface HistoryItem {
  id: string;
  deviceId: string;
  eventType: string;
  subType?: string;
  start: number;
}

const STRENGTH: Record<SignalKind, Strength> = {
  indoor_motion: 'strong',
  door_open: 'strong',
  door_closed: 'strong',
  resident_ok: 'strong',
  package_collected: 'strong',
  outdoor_motion: 'medium',
  live_view: 'weak',
  visitor_ring: 'none',
  delivery: 'none',
  vehicle: 'none',
  animal: 'none',
  env_alert: 'none',
  env_clear: 'none',
  device_offline: 'none',
  device_online: 'none',
};

export function setupFor(household: Household, deviceId: string | undefined): DeviceSetup | undefined {
  return deviceId ? household.devices.find((d) => d.deviceId === deviceId) : undefined;
}

function motionKind(role: DeviceSetup['role'] | undefined, subType: string | undefined): SignalKind {
  if (subType === 'package_delivery') return 'delivery';
  if (subType === 'vehicle') return 'vehicle';
  if (subType === 'animal') return 'animal';
  return role === 'indoor_camera' ? 'indoor_motion' : 'outdoor_motion';
}

function make(kind: SignalKind, base: Omit<Signal, 'kind' | 'strength'>): Signal {
  return { ...base, kind, strength: STRENGTH[kind] };
}

/** Maps one verified webhook to zero or one signal. Unknown types are ignored, not errors. */
export function signalFromWebhook(household: Household, event: RingEvent): Signal | undefined {
  const setup = setupFor(household, event.deviceId);
  const base = { id: `ring:${event.id}`, at: event.timestamp, deviceId: event.deviceId, deviceLabel: setup?.label, source: 'webhook' as const };
  switch (event.type) {
    case 'motion_detected':
      return make(motionKind(setup?.role, event.subType), { ...base, detail: { subType: event.subType } });
    case 'button_press':
      return make('visitor_ring', base);
    case 'contact_sensor_faulted':
      return make('door_open', base);
    case 'contact_sensor_cleared':
      return make('door_closed', base);
    case 'device_offline':
      return make('device_offline', base);
    case 'device_online':
      // For sensors device_online is a heartbeat, not a transition; it is still a liveness hint.
      return make('device_online', base);
    default:
      break;
  }
  const env = /^(temperature|humidity|pm25|co|flood|freeze)_(exceeded|cleared|detected)$/.exec(event.type);
  if (env) {
    const cleared = env[2] === 'cleared';
    return make(cleared ? 'env_clear' : 'env_alert', {
      ...base,
      detail: { measure: env[1], reading: event.reading, direction: event.thresholdType },
    });
  }
  return undefined;
}

/** Maps an Event History item. Subtypes come from which filtered query returned the event. */
export function signalFromHistory(household: Household, item: HistoryItem): Signal | undefined {
  const setup = setupFor(household, item.deviceId);
  const base = { id: `hist:${item.id}`, at: item.start, deviceId: item.deviceId, deviceLabel: setup?.label, source: 'history' as const };
  if (item.eventType === 'ding') return make('visitor_ring', base);
  if (item.eventType === 'on_demand') return make('live_view', base);
  if (item.eventType === 'motion') {
    return make(motionKind(setup?.role, item.subType), { ...base, detail: { subType: item.subType ?? 'motion' } });
  }
  return undefined;
}

export function appSignal(kind: 'resident_ok' | 'package_collected', at: number, note?: string): Signal {
  return make(kind, { id: `app:${kind}:${at}`, at, source: 'app', detail: note ? { note } : undefined });
}

/**
 * Outdoor motion only counts as the resident when nothing else explains it:
 * a doorbell ring, a delivery or a car within a few minutes means it was
 * probably someone else.
 */
export function isPresence(signal: Signal, all: Signal[], explainWindowMs = 3 * 60_000): boolean {
  if (signal.strength === 'strong') return true;
  if (signal.strength !== 'medium') return false;
  return !all.some(
    (other) =>
      (other.kind === 'visitor_ring' || other.kind === 'delivery' || other.kind === 'vehicle') &&
      Math.abs(other.at - signal.at) <= explainWindowMs,
  );
}

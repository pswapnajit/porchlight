// Porchlight's domain model. Ring tells us what happened at a device; the
// family tells us where each device is; Porchlight turns both into signals
// about the resident's day and opens a Concern when the day looks wrong.

/** Where a Ring device sits in the home. Ring's API has no type or placement field, so the family sets this up. */
export type DeviceRole = 'entry_camera' | 'indoor_camera' | 'door_contact' | 'climate' | 'chime' | 'other';

export interface DeviceSetup {
  deviceId: string;
  role: DeviceRole;
  /** Friendly name shown to the family, e.g. "Front door". */
  label: string;
}

export type SignalKind =
  | 'indoor_motion'
  | 'outdoor_motion'
  | 'visitor_ring'
  | 'delivery'
  | 'vehicle'
  | 'animal'
  | 'door_open'
  | 'door_closed'
  | 'live_view'
  | 'env_alert'
  | 'env_clear'
  | 'device_offline'
  | 'device_online'
  | 'resident_ok'
  | 'package_collected';

/** How strongly a signal shows the resident is up and about. */
export type Strength = 'strong' | 'medium' | 'weak' | 'none';

export interface Signal {
  /** Stable id from the source event, used to deduplicate webhook and history copies. */
  id: string;
  kind: SignalKind;
  at: number;
  deviceId?: string;
  deviceLabel?: string;
  strength: Strength;
  source: 'webhook' | 'history' | 'app' | 'status' | 'vision';
  detail?: {
    subType?: string;
    eventType?: string;
    reading?: { temperature?: number; humidity?: number; pm25?: number };
    measure?: string;
    direction?: 'min' | 'max';
    note?: string;
  };
}

export type ConcernKind =
  | 'quiet_morning'
  | 'long_silence'
  | 'package_waiting'
  | 'unanswered_door'
  | 'night_door'
  | 'late_visitor'
  | 'home_too_hot'
  | 'home_too_cold'
  | 'water_leak'
  | 'freeze_risk'
  | 'air_quality'
  | 'camera_offline'
  | 'family_check_in';

export type Severity = 'gentle' | 'urgent';

export type StepKind = 'resident_nudge' | 'resident_call' | 'notify_primary' | 'notify_secondary';

export interface LadderStep {
  kind: StepKind;
  dueAt: number;
  firedAt?: number;
  skipped?: boolean;
  outcome?: string;
}

export interface VisionResult {
  /** null when the model could not tell; Porchlight then asks a person instead of guessing. */
  packagePresent: boolean | null;
  personPresent?: boolean | null;
  confidence: number;
  description: string;
  model: string;
  maskedPrivacyPixels?: number;
  at: number;
}

export interface SnapshotRef {
  id: string;
  deviceId: string;
  at: number;
  /** URL the dashboard can load (served by Porchlight, never a Ring URL). */
  url: string;
}

export interface Concern {
  id: string;
  kind: ConcernKind;
  severity: Severity;
  status: 'open' | 'resolved';
  openedAt: number;
  title: string;
  summary: string;
  /** Plain-language facts with times, newest last. */
  evidence: string[];
  ladder: LadderStep[];
  acknowledgedBy?: string;
  acknowledgedAt?: number;
  resolvedAt?: number;
  resolution?: { by: 'signal' | 'resident' | 'family' | 'system'; text: string };
  deviceId?: string;
  /** For package_waiting: when the delivery happened. */
  since?: number;
  snapshot?: SnapshotRef;
  vision?: VisionResult;
  /** Local date this concern belongs to, for once-per-day rules. */
  dateKey: string;
}

export interface CircleMember {
  id: string;
  name: string;
  relation: string;
  role: 'primary' | 'secondary';
  /** Concern kinds this person wants. Families can opt down, not just out. */
  receives: ConcernKind[] | 'all';
  digest: boolean;
}

export interface CareVisit {
  who: string;
  /** 0 = Sunday. */
  days: number[];
  /** "HH:MM" local. */
  time: string;
  windowMin: number;
}

export interface Household {
  id: string;
  resident: { name: string; preferredName: string; pronoun: 'she' | 'he' | 'they' };
  timeZone: string;
  circle: CircleMember[];
  devices: DeviceSetup[];
  routine: {
    /** Override for the learned check-in time, "HH:MM". */
    checkInBy?: string;
    quietHours: { start: string; end: string };
    packageDwellMin: number;
    /** Morning nudge plays on the chime; never during quiet hours. */
    chimeEvent: string;
    reminderChimeEvent: string;
  };
  careSchedule: CareVisit[];
  /** "Away" mode: the resident is travelling, so absence rules pause until this time. */
  awayUntil?: number;
}

export interface Rhythm {
  days: number;
  confidence: 'learning' | 'low' | 'good';
  /** Minutes after local midnight. */
  firstActivity: { p10: number; median: number; p90: number } | null;
  lastActivity: { median: number; p90: number } | null;
  checkInBy: number;
  checkInSource: 'learned' | 'default' | 'family';
  /** The longest gap between activity that is still normal during the day, in minutes. */
  usualLongestGapMin: number;
  deliveriesPerWeek: number;
  visitorsPerWeek: number;
  /** Activity count per hour of day (0-23), averaged per day, for the rhythm chart. */
  hourly: number[];
}

export interface ActionResult {
  ok: boolean;
  channel: string;
  text: string;
}

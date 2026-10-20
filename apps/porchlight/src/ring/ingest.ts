import type { RingClient } from 'ring-partner-kit';
import type { CareEngine } from '../engine/engine.ts';
import { signalFromHistory, type HistoryItem } from '../engine/interpret.ts';
import type { Signal } from '../engine/types.ts';

// Event History carries the event type but not the motion subtype, so the
// subtype comes from asking again with composite filters (motion.human, ...)
// and tagging each event by the filter that returned it.
const SUBTYPES = ['human', 'package_delivery', 'vehicle', 'animal', 'other_motion'] as const;

export async function readHistory(client: RingClient, deviceId: string, opts: { maxPages?: number; firstPageOnly?: boolean } = {}): Promise<HistoryItem[]> {
  const items = new Map<string, HistoryItem>();
  const collect = async (eventTypes?: string[], subType?: string) => {
    if (opts.firstPageOnly) {
      const page = await client.historyPage(deviceId, { eventTypes });
      for (const e of page.events) tag(e, subType);
      return;
    }
    for await (const e of client.history(deviceId, { eventTypes, maxPages: opts.maxPages ?? 40 })) tag(e, subType);
  };
  const tag = (e: { id: string; attributes: { event_type: string; start: number } }, subType?: string) => {
    const existing = items.get(e.id);
    if (existing) {
      if (subType) existing.subType = subType;
      return;
    }
    items.set(e.id, { id: e.id, deviceId, eventType: e.attributes.event_type, start: e.attributes.start, subType });
  };
  await collect();
  for (const sub of SUBTYPES) await collect([`motion.${sub}`], sub);
  return [...items.values()].sort((a, b) => a.start - b.start);
}

/** Startup backfill: every camera's history becomes signals the engine learns the routine from. */
export async function backfillFromRing(client: RingClient, engine: CareEngine, extra: Signal[] = []): Promise<number> {
  const signals: Signal[] = [...extra];
  for (const d of engine.household.devices.filter((x) => x.role === 'entry_camera' || x.role === 'indoor_camera')) {
    for (const item of await readHistory(client, d.deviceId)) {
      const s = signalFromHistory(engine.household, item);
      if (s) signals.push(s);
    }
  }
  return engine.backfill(signals);
}

/**
 * Polls Event History for new camera events. This is how Porchlight runs against
 * the Ring Developer Playground, which has no webhook delivery; in production,
 * webhooks are primary and polling only fills gaps (the engine drops duplicates).
 */
export function startHistoryPoller(client: RingClient, engine: CareEngine, opts: { intervalMs?: number; onError?: (err: unknown) => void } = {}): () => void {
  let stopped = false;
  let running = false;
  const poll = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (const d of engine.household.devices.filter((x) => x.role === 'entry_camera' || x.role === 'indoor_camera')) {
        for (const item of await readHistory(client, d.deviceId, { firstPageOnly: true })) {
          const s = signalFromHistory(engine.household, item);
          if (s) await engine.ingest(s);
        }
      }
    } catch (err) {
      opts.onError?.(err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void poll(), opts.intervalMs ?? 15_000);
  void poll();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

#!/usr/bin/env node
// Checks a Ring token end to end and shows what Porchlight will see:
//   npm run probe
// Reads RING_ACCESS_TOKEN (Ring Developer Playground) from .env. Writes raw
// responses and snapshots to .fixtures-private/ (gitignored); never prints tokens.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { RingApiError, RingClient, guessDeviceKind, isChime, isPng, type RequestLog } from 'ring-partner-kit';

const root = new URL('../../../../', import.meta.url);
for (const line of safeRead(new URL('.env', root)).split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const token = process.env.RING_ACCESS_TOKEN;
if (!token) {
  console.error('No RING_ACCESS_TOKEN in .env. Get one at https://developer.amazon.com/ring/console/playground (Generate Token).');
  process.exit(1);
}
const out = new URL('.fixtures-private/', root);
mkdirSync(out, { recursive: true });
const calls: RequestLog[] = [];
const client = new RingClient({ token, baseUrl: process.env.RING_API_BASE_URL, onRequest: (l) => calls.push(l) });
const save = (name: string, data: unknown) => writeFileSync(new URL(name, out), typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2));

try {
  const me = await client.me().catch((e) => ({ error: describe(e) }));
  save('users-me.json', me);
  console.log(`Account: ${'error' in me ? `(users/me failed: ${me.error})` : 'ok'}`);
  const devices = await client.devices({ include: ['status', 'capabilities', 'configurations', 'location'] });
  save('devices.json', devices.map((d) => ({ ...d, raw: undefined })));
  console.log(`\n${devices.length} device(s):`);
  for (const d of devices) {
    const kind = isChime(d.capabilities) ? 'chime' : guessDeviceKind(d.capabilities, d.status);
    const zones = d.configurations?.image_enhancements?.privacy_zones?.length ?? 0;
    console.log(`  - ${d.name} [${kind}] online=${d.status?.online} e2e=${d.configurations?.e2e_encryption?.enabled ?? 'n/a'} privacy_zones=${zones} components=${d.capabilities?.components?.items?.length ?? 1}`);
    if (kind !== 'camera') continue;
    const slug = d.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const all = await client.historyPage(d.id).catch((e) => ({ error: describe(e), events: [] as never[] }));
    save(`${slug}-history.json`, all);
    const counts: Record<string, number> = {};
    for (const sub of ['human', 'package_delivery', 'vehicle', 'animal', 'other_motion']) {
      const page = await client.historyPage(d.id, { eventTypes: [`motion.${sub}`] }).catch(() => ({ events: [] }));
      counts[sub] = page.events.length;
    }
    console.log(`      history (first page): ${all.events.length} events; motion by subtype ${JSON.stringify(counts)}`);
    try {
      const shot = await client.snapshot(d.id, { type: 'latest_in_range', start_timestamp: Date.now() - 23 * 3600_000, image_options: { format: 'png' } });
      save(`${slug}-snapshot.${isPng(shot.bytes) ? 'png' : 'jpg'}`, shot.bytes);
      console.log(`      snapshot: ${shot.contentType}, ${shot.bytes.length} bytes, origin=${shot.mediaOrigin}, at=${shot.mediaTimestamp ? new Date(shot.mediaTimestamp).toISOString() : '?'}`);
    } catch (e) {
      console.log(`      snapshot: ${describe(e)}`);
    }
  }
} catch (e) {
  console.error(`\nProbe failed: ${describe(e)}`);
  if (e instanceof RingApiError && e.unauthorized) console.error('The token is missing, wrong or expired (Playground tokens last about 30 minutes). Generate a new one.');
  process.exitCode = 1;
} finally {
  save('calls.json', calls);
  console.log(`\n${calls.length} API calls. Raw responses saved in .fixtures-private/ (not committed).`);
}

function describe(e: unknown): string {
  return e instanceof RingApiError ? `${e.status} ${e.code ?? ''} ${e.detail ?? ''}`.trim() : (e as Error).message;
}

function safeRead(file: URL): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

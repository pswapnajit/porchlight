#!/usr/bin/env node
// Porchlight entry point.
//   npm run demo                 -> simulated Ring account, scripted days (no keys needed)
//   npm start                    -> live Ring API (RING_ACCESS_TOKEN from the Developer Playground)
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createRuntime } from './app.ts';
import { startHttpServer } from './server.ts';

loadDotEnv(new URL('../../../.env', import.meta.url));

const { values } = parseArgs({
  options: {
    mode: { type: 'string' },
    port: { type: 'string', default: process.env.PORT ?? '4000' },
    host: { type: 'string', default: process.env.HOST ?? '127.0.0.1' },
  },
});
const mode = (values.mode ?? (process.env.RING_ACCESS_TOKEN || process.env.RING_REFRESH_TOKEN ? 'live' : 'sim')) as 'sim' | 'live';
const port = Number(values.port);
const publicUrl = `http://127.0.0.1:${port}`;

const rt = await createRuntime({ mode, publicUrl });
const { url } = await startHttpServer(rt, { port, host: values.host });
console.log(`\nPorchlight (${mode === 'sim' ? 'simulated Ring account' : 'live Ring API'}) on ${url}`);
console.log(`  Family app & demo controls: ${url}/`);
console.log(`  Alexa+ MCP endpoint:        ${url}/mcp`);
console.log(`  AI: ${rt.ai.enabled ? `Amazon Bedrock (${rt.ai.why})` : `off: ${rt.ai.why}`}\n`);

const shutdown = async () => {
  await rt.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/** Minimal .env reader (no dependency): KEY=value lines, # comments, optional quotes. Never overrides real env. */
function loadDotEnv(file: URL): void {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined && value !== '') process.env[m[1]] = value;
  }
}

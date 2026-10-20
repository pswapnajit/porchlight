import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Runtime } from './app.ts';
import { formatClock, formatMinuteOfDay, localParts, localTimeToEpoch } from './engine/time.ts';

// Porchlight as an Alexa+ integration: a self-hosted MCP server on the
// Streamable HTTP transport (protocol 2025-11-25). Family members ask Alexa
// how their parent is doing, ask for a check-in, or take ownership of an alert;
// the resident can answer a check-in by voice ("Alexa, tell Porchlight I'm OK").
// Status tools also point at an MCP Apps UI resource, so screen devices can show a card.

export const STATUS_CARD_URI = 'ui://porchlight/status-card.html';

export function statusFacts(rt: Runtime) {
  const { engine, household: h } = rt;
  const tz = h.timeZone;
  const now = rt.clock.now();
  const facts = engine.dayFacts();
  const open = engine.openConcerns();
  const urgent = open.some((c) => c.severity === 'urgent');
  const checkInAt = localTimeToEpoch(localParts(now, tz).dateKey, engine.rhythm.checkInBy, tz);
  const headline = open.length
    ? `${open[0].title}: ${open[0].summary}`
    : facts.firstActivity
      ? `All is well. ${h.resident.preferredName} has been up since ${facts.firstActivity}; last activity at ${facts.lastActivity}.`
      : now < checkInAt
        ? `Nothing yet this morning, which is normal: ${h.resident.preferredName} is usually up by ${engine.rhythm.firstActivity ? formatMinuteOfDay(engine.rhythm.firstActivity.median) : 'mid-morning'}.`
        : `No activity seen from ${h.resident.preferredName} yet today.`;
  return {
    resident: h.resident.preferredName,
    state: urgent ? 'urgent' : open.length ? 'checking_in' : 'all_well',
    headline,
    localTime: formatClock(now, tz),
    firstActivityToday: facts.firstActivity,
    lastActivity: facts.lastActivity,
    visitorsToday: facts.visitors.length,
    deliveriesToday: facts.deliveries.length,
    openCheckIns: open.map((c) => ({
      id: c.id,
      title: c.title,
      severity: c.severity,
      opened: formatClock(c.openedAt, tz),
      summary: c.summary,
      handledBy: c.acknowledgedBy ?? null,
      lastStep: [...c.ladder].reverse().find((s) => s.firedAt)?.outcome ?? null,
    })),
  };
}

export function buildMcpServer(rt: Runtime, opts: { baseUrl: string }): McpServer {
  const h = rt.household;
  const name = h.resident.preferredName;
  const primary = h.circle.find((m) => m.role === 'primary');
  const server = new McpServer(
    { name: 'porchlight', title: 'Porchlight', version: '0.1.0' },
    {
      instructions: `Porchlight keeps a gentle eye on ${h.resident.name} ("${name}"), who lives alone, using the Ring devices at ${name}'s home. Use get_status for "how is ${name}?" questions, ask for anything else about ${name}'s day, and send_check_in when the user wants someone to check on ${name}. Never present Porchlight as an emergency service: for emergencies the user should call 911.`,
    },
  );
  const ui = { ui: { resourceUri: STATUS_CARD_URI } };

  server.registerTool(
    'get_status',
    {
      title: `How is ${name} doing?`,
      description: `Current status of ${name}: whether all is well, today's first and last activity, and any open check-ins with what Porchlight has already done.`,
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async () => {
      const facts = statusFacts(rt);
      return { content: [{ type: 'text', text: facts.headline }], structuredContent: facts };
    },
  );

  server.registerTool(
    'get_day_summary',
    {
      title: 'Day summary',
      description: `A short, plain-language summary of ${name}'s day: when ${name} got up, visitors, deliveries and anything Porchlight checked on.`,
      inputSchema: { day: z.enum(['today', 'yesterday']).default('today').describe('Which day') },
      annotations: { readOnlyHint: true },
    },
    async ({ day }) => {
      const dateKey = localParts(rt.clock.now() - (day === 'yesterday' ? 24 * 3600_000 : 0), h.timeZone).dateKey;
      const { writeDigest } = await import('./ai/digest.ts');
      const digest = await writeDigest(rt.engine, rt.bedrock, dateKey);
      return { content: [{ type: 'text', text: digest.text }], structuredContent: { date: digest.date, summary: digest.text, writtenBy: digest.model } };
    },
  );

  server.registerTool(
    'check_porch',
    {
      title: 'Look at the front porch',
      description: "Takes a fresh snapshot from the front-door Ring camera (privacy zones blacked out) and reports whether a package or a person is there.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: ui,
    },
    async () => {
      const r = await rt.checkPorchNow();
      if ('error' in r) return { content: [{ type: 'text', text: r.error }], isError: true };
      const imageUrl = r.snapshot ? `${opts.baseUrl}${r.snapshot.url}` : null;
      return {
        content: [{ type: 'text', text: r.vision.description }],
        structuredContent: { ...statusFacts(rt), porch: { description: r.vision.description, packagePresent: r.vision.packagePresent, checkedBy: r.vision.model, imageUrl } },
      };
    },
  );

  server.registerTool(
    'send_check_in',
    {
      title: `Check on ${name}`,
      description: `Gently checks on ${name} now: plays a chime at home and shows an "I'm OK" prompt on ${name}'s screen. The family is told if ${name} doesn't respond within 20 minutes.`,
      inputSchema: { requestedBy: z.string().optional().describe('Who is asking, e.g. "Maria"') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ requestedBy }) => {
      const member = h.circle.find((m) => requestedBy && m.name.toLowerCase() === requestedBy.toLowerCase()) ?? primary;
      const c = await rt.engine.requestCheckIn(member?.id ?? '');
      const step = c?.ladder.find((s) => s.kind === 'resident_nudge');
      return { content: [{ type: 'text', text: `${step?.outcome ?? `Porchlight is checking on ${name}.`} I'll let you know when ${name} responds.` }] };
    },
  );

  server.registerTool(
    'acknowledge_check_in',
    {
      title: "I'm handling it",
      description: 'Tells Porchlight the user is handling the open check-in, so nobody else in the family circle is alerted.',
      inputSchema: { member: z.string().optional().describe('Name of the family member handling it') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ member }) => {
      const open = rt.engine.openConcerns()[0];
      if (!open) return { content: [{ type: 'text', text: 'There is no open check-in right now.' }] };
      const m = h.circle.find((x) => member && x.name.toLowerCase() === member.toLowerCase()) ?? primary;
      await rt.engine.acknowledge(open.id, m?.id ?? '');
      return { content: [{ type: 'text', text: `Thanks${m ? `, ${m.name}` : ''}. Porchlight won't alert anyone else about "${open.title}".` }] };
    },
  );

  server.registerTool(
    'resolve_check_in',
    {
      title: 'All is OK',
      description: 'Closes the open check-in because the user confirmed things are fine (for example after calling).',
      inputSchema: { note: z.string().optional().describe('What the user found out'), member: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ note, member }) => {
      const open = rt.engine.openConcerns()[0];
      if (!open) return { content: [{ type: 'text', text: 'There is no open check-in right now.' }] };
      const m = h.circle.find((x) => member && x.name.toLowerCase() === member.toLowerCase()) ?? primary;
      await rt.engine.resolve(open.id, m?.id ?? '', note);
      return { content: [{ type: 'text', text: `Closed "${open.title}". Glad ${name} is OK.` }] };
    },
  );

  server.registerTool(
    'resident_im_ok',
    {
      title: "I'm OK",
      description: `For ${name}'s own Alexa device: ${name} says they are fine. Answers any open check-in and stops the family from being alerted.`,
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const open = rt.engine.openConcerns().length;
      await rt.engine.residentOk();
      return { content: [{ type: 'text', text: open ? `Thank you, ${name}. I've let your family know you're OK.` : `Thanks, ${name}. Have a lovely day.` }] };
    },
  );

  server.registerTool(
    'ask',
    {
      title: `Ask about ${name}`,
      description: `Answers any other question about ${name}'s day from Porchlight's records (a Strands agent on Amazon Bedrock), e.g. "Did the pharmacy delivery come?"`,
      inputSchema: { question: z.string().min(2).max(300) },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ question }) => {
      const a = await rt.ask.ask(question, primary?.name);
      return { content: [{ type: 'text', text: a.text }], structuredContent: { answer: a.text, model: a.model, toolsUsed: a.toolsUsed } };
    },
  );

  server.registerResource(
    'status-card',
    STATUS_CARD_URI,
    { title: 'Porchlight status card', description: 'MCP App card for get_status and check_porch results', mimeType: 'text/html;profile=mcp-app' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: STATUS_CARD_HTML }] }),
  );
  return server;
}

/** Stateless Streamable HTTP: a fresh server and transport per request, JSON responses. */
export async function handleMcp(rt: Runtime, req: IncomingMessage, res: ServerResponse, body: unknown, baseUrl: string): Promise<void> {
  const server = buildMcpServer(rt, { baseUrl });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const STATUS_CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--bg:#fffaf2;--ink:#1f1a14;--muted:#6b6257;--ok:#2f7d4f;--warn:#b26a00;--bad:#b3261e;--card:#ffffff}
@media (prefers-color-scheme:dark){:root{--bg:#17130f;--ink:#f6efe6;--muted:#b9ad9f;--card:#221c16}}
body{margin:0;font:16px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--ink)}
.card{margin:12px;padding:16px 18px;border-radius:18px;background:var(--card);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.state{display:inline-block;font-weight:600;font-size:13px;letter-spacing:.02em;padding:3px 10px;border-radius:999px;color:#fff;background:var(--ok)}
.state.checking_in{background:var(--warn)}.state.urgent{background:var(--bad)}
h1{font-size:20px;margin:10px 0 6px}p{margin:6px 0;color:var(--muted)}img{width:100%;border-radius:12px;margin-top:10px}
ul{padding-left:18px;margin:8px 0}li{margin:4px 0}
</style></head><body><div class="card" id="root"><p>Waiting for Porchlight…</p></div>
<script>
const root=document.getElementById('root');
const label={all_well:'All is well',checking_in:'Checking in',urgent:'Needs attention'};
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function render(d){if(!d)return;let h='<span class="state '+esc(d.state)+'">'+esc(label[d.state]||d.state)+'</span>';
h+='<h1>'+esc(d.resident)+' · '+esc(d.localTime)+'</h1><p>'+esc(d.headline)+'</p>';
if(d.openCheckIns&&d.openCheckIns.length){h+='<ul>'+d.openCheckIns.map(c=>'<li><b>'+esc(c.title)+'</b> since '+esc(c.opened)+(c.handledBy?' · '+esc(c.handledBy)+' is on it':'')+'</li>').join('')+'</ul>'}
if(d.porch){h+='<p><b>Porch:</b> '+esc(d.porch.description)+'</p>'+(d.porch.imageUrl?'<img alt="Front porch snapshot with privacy zones masked" src="'+esc(d.porch.imageUrl)+'">':'')}
root.innerHTML=h}
window.addEventListener('message',e=>{const m=e.data||{};if(m.method==='ui/notifications/tool-result'){render((m.params||{}).structuredContent)}});
window.parent.postMessage({jsonrpc:'2.0',id:1,method:'ui/initialize',params:{appInfo:{name:'porchlight-status-card',version:'0.1.0'}}},'*');
</script></body></html>`;

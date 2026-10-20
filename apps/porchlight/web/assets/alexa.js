// A simulated Alexa+ host that is a real MCP client: it speaks JSON-RPC to
// Porchlight's /mcp endpoint over Streamable HTTP (initialize, tools/list,
// tools/call, resources/read) and renders MCP App cards in a sandboxed iframe.
// Alexa+ picks tools with its own model; this host maps an utterance to a tool
// with simple rules and sends anything else to Porchlight's `ask` tool.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function route(text) {
  const t = text.toLowerCase().replace(/^alexa,?\s*/, '').replace(/^(ask|tell) porchlight\s*(to|that|if|whether)?\s*/, '');
  if (/\b(i'?m|i am) (ok|okay|fine|alright|all right)\b/.test(t)) return { tool: 'resident_im_ok', args: {} };
  if (/\bcheck (on|in on)\b/.test(t)) return { tool: 'send_check_in', args: { requestedBy: 'Maria' } };
  if (/\b(i'?m|i am|i'?ll|i will) (on it|handling|handle|take)/.test(t)) return { tool: 'acknowledge_check_in', args: { member: 'Maria' } };
  if (/\b(she'?s|he'?s|mom'?s|dad'?s) (fine|ok|okay|alright)|\ball (good|ok|clear)\b|\bi (talked|spoke|called)\b/.test(t)) return { tool: 'resolve_check_in', args: { member: 'Maria', note: text.slice(0, 120) } };
  if (/\bporch\b|\bpackage\b.*\b(now|still|there)\b|\bat the door\b.*\bnow\b/.test(t)) return { tool: 'check_porch', args: {} };
  if (/\byesterday\b/.test(t)) return { tool: 'get_day_summary', args: { day: 'yesterday' } };
  if (/\b(summary|how was (her|his|their|mom'?s|dad'?s) day|her day|his day)\b/.test(t)) return { tool: 'get_day_summary', args: { day: 'today' } };
  if (/\bhow'?s\b|\bhow is\b|\bdoing\b|\bstatus\b|\bis (mom|dad|she|he) (ok|okay|alright)\b/.test(t)) return { tool: 'get_status', args: {} };
  return { tool: 'ask', args: { question: text.slice(0, 300) } };
}

export function createAlexa({ onChange }) {
  let session = null;
  let id = 0;
  const traceEl = $('#trace');

  function trace(dir, label, payload) {
    const li = document.createElement('li');
    li.innerHTML = `<details><summary><span class="dir">${dir}</span> ${esc(label)}</summary><pre>${esc(JSON.stringify(payload, null, 2))}</pre></details>`;
    traceEl.prepend(li);
    while (traceEl.children.length > 40) traceEl.lastChild.remove();
  }

  async function rpc(method, params, notification = false) {
    const body = notification ? { jsonrpc: '2.0', method, ...(params ? { params } : {}) } : { jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) };
    trace('→', method, body);
    const res = await fetch('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify(body),
    });
    if (notification) {
      trace('←', `${method} (HTTP ${res.status})`, {});
      return null;
    }
    const json = await res.json();
    trace('←', method, json);
    if (json.error) throw new Error(json.error.message);
    return json.result;
  }

  async function ensure() {
    if (session) return session;
    const init = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
      clientInfo: { name: 'alexa-plus-simulator', version: '0.1.0' },
    });
    await rpc('notifications/initialized', undefined, true);
    const list = await rpc('tools/list', {});
    session = { server: init.serverInfo, tools: list.tools };
    $('#echo-state').textContent = `Connected to ${session.server.title ?? session.server.name} · ${session.tools.length} tools`;
    return session;
  }

  async function showCard(uri, structured) {
    const frame = $('#echo-card');
    const res = await rpc('resources/read', { uri });
    const html = res.contents?.[0]?.text;
    if (!html) return;
    frame.hidden = false;
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || e.data?.method !== 'ui/initialize') return;
      frame.contentWindow.postMessage({ jsonrpc: '2.0', id: e.data.id, result: { protocolVersion: '2025-11-25', hostInfo: { name: 'alexa-plus-simulator' }, hostContext: { theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' } } }, '*');
      frame.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: structured } }, '*');
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
    frame.srcdoc = html;
  }

  function say(text) {
    $('#echo-reply').textContent = text;
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      speechSynthesis.speak(u);
    }
  }

  async function handle(text) {
    if (!text.trim()) return;
    const ring = $('#echo-ring');
    $('#echo-said').textContent = `“${text}”`;
    $('#echo-card').hidden = true;
    ring.className = 'echo-ring thinking';
    try {
      const s = await ensure();
      const { tool, args } = route(text);
      const result = await rpc('tools/call', { name: tool, arguments: args });
      const reply = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(' ') || 'Done.';
      say(reply);
      const uri = s.tools.find((t) => t.name === tool)?._meta?.ui?.resourceUri;
      if (uri && result.structuredContent) await showCard(uri, result.structuredContent);
      onChange?.();
    } catch (err) {
      say(`Sorry, Porchlight didn't answer (${err.message}).`);
    } finally {
      ring.className = 'echo-ring';
    }
  }

  $('#alexa-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#alexa-input');
    void handle(input.value);
    input.value = '';
  });

  const chips = [
    "Alexa, ask Porchlight how Mom's doing",
    'Ask Porchlight to check on Mom',
    'Is there a package on the porch right now?',
    "Did Mom's aide come today?",
    "Tell Porchlight I'm handling it",
    "(Rose) Alexa, tell Porchlight I'm OK",
  ];
  $('#alexa-chips').innerHTML = chips.map((c) => `<button class="chip" type="button">${esc(c)}</button>`).join('');
  $('#alexa-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) void handle(b.textContent.replace(/^\(Rose\)\s*/, ''));
  });

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $('#mic');
  if (!SR) mic.title = 'Voice input needs Chrome or Safari; type instead.';
  mic.addEventListener('click', () => {
    if (!SR) return $('#alexa-input').focus();
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    $('#echo-ring').className = 'echo-ring listening';
    $('#echo-state').textContent = 'Listening…';
    rec.onresult = (e) => void handle(e.results[0][0].transcript);
    rec.onend = () => ($('#echo-ring').className = 'echo-ring');
    rec.start();
  });
}

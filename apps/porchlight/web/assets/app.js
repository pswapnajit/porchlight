// Porchlight web client: family dashboard, the resident's screen, an Alexa+
// host that speaks real MCP to /mcp, and the behind-the-scenes control room.
import { createAlexa } from './alexa.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let S = null;
let view = 'family';
let audioCtx = null;
const ROLE_NAMES = { entry_camera: 'Front-door camera', indoor_camera: 'Indoor camera (motion only)', door_contact: 'Door sensor', climate: 'Temperature sensor', chime: 'Chime', other: 'Not used' };
const STEP_NAMES = { resident_nudge: 'Chime and a message on Rose’s screen', resident_call: 'Text Rose', notify_primary: 'Alert Maria', notify_secondary: 'Alert the rest of the circle' };

// ------------------------------------------------------------- data flow --
async function load() {
  const res = await fetch('/api/state');
  S = await res.json();
  render();
}
let pending = null;
function refreshSoon(ms = 120) {
  clearTimeout(pending);
  pending = setTimeout(load, ms);
}
function connect() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'chime') playChime();
    if (ev.type === 'phone' && ev.message.to === 'maria') buzz();
    if (ev.type === 'scenario-step') caption(`${fmt(ev.at)} · ${ev.label}`);
    if (ev.type === 'concern' && ev.payload?.status === 'open') caption(`${ev.payload.title}: ${ev.payload.summary}`);
    if (ev.type === 'home' && ev.home?.message) speak(ev.home.message.text);
    if (ev.type === 'api') return refreshSoon(400);
    refreshSoon();
  };
  es.onerror = () => setTimeout(() => { es.close(); connect(); }, 2000);
}
async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  refreshSoon(50);
  return json;
}

// ---------------------------------------------------------------- helpers --
function fmt(t, opts = { hour: 'numeric', minute: '2-digit' }) {
  return new Intl.DateTimeFormat('en-US', { timeZone: S?.timeZone ?? undefined, ...opts }).format(new Date(t));
}
function minuteOfDay(t) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: S.timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t));
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
}
function dayKey(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: S.timeZone }).format(new Date(t));
}
function hm(min) {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
const ICONS = {
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/></svg>',
};

// ----------------------------------------------------------------- render --
function render() {
  if (!S) return;
  const name = S.household.resident.preferredName;
  $('#who').textContent = `${S.household.resident.name} · ${fmt(S.now, { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`;
  const mode = $('#mode');
  mode.textContent = S.mode === 'live' ? 'Live · Ring Partner API' : 'Simulated Ring account';
  mode.className = `mode ${S.mode}`;
  document.querySelectorAll('.tab[data-view="home"] .tab-label').forEach((b) => (b.textContent = `${name}'s screen`));
  $('#family-title').textContent = `How's ${name} doing?`;
  renderHero(name);
  renderStats();
  renderTimeline();
  renderCheckins();
  renderFeed();
  renderDigest();
  renderRoutine();
  renderDevices();
  renderHome(name);
  renderScenes();
  renderDock();
  $('#ask-model').textContent = S.ai.ask;
}

function statusOf() {
  const open = S.concerns.filter((c) => c.status === 'open');
  if (open.some((c) => c.severity === 'urgent')) return { state: 'urgent', label: 'Needs attention', open };
  if (open.length) return { state: 'checking_in', label: 'Checking in', open };
  return { state: 'all_well', label: 'All is well', open };
}

function presenceToday() {
  const today = S.timeline.filter((s) => dayKey(s.at) === S.today && ['indoor_motion', 'door_open', 'door_closed', 'resident_ok'].includes(s.kind) && minuteOfDay(s.at) >= 240);
  return { first: today[0], last: today[today.length - 1] };
}

function renderStats() {
  const { first, last } = presenceToday();
  const today = S.timeline.filter((s) => dayKey(s.at) === S.today);
  const tiles = [
    [first ? fmt(first.at) : '—', 'First seen today'],
    [last ? fmt(last.at) : '—', 'Last activity'],
    [String(today.filter((s) => s.kind === 'visitor_ring').length), 'Doorbell rings'],
    [String(today.filter((s) => s.kind === 'delivery').length), 'Deliveries'],
  ];
  $('#stats').innerHTML = tiles.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
}

function renderHero(name) {
  const st = statusOf();
  const hero = $('#hero');
  hero.className = `hero ${st.state}`;
  const { first, last } = presenceToday();
  const r = S.rhythm;
  let headline, sub;
  if (st.open.length) {
    const c = st.open[0];
    headline = c.title;
    sub = c.summary;
  } else if (first) {
    headline = `${name} is up and about`;
    sub = `Up at ${fmt(first.at)}${r.firstActivity ? ` (usually ${hm(r.firstActivity.median)})` : ''} · last activity ${fmt(last.at)}`;
  } else {
    const before = minuteOfDay(S.now) < r.checkInBy;
    headline = before ? 'A quiet start, as usual' : `No sign of ${name} yet`;
    sub = before ? `${name} is usually up by ${r.firstActivity ? hm(r.firstActivity.median) : 'mid-morning'}. Porchlight checks in at ${hm(r.checkInBy)} if it hasn't seen anything.` : 'Porchlight is checking in.';
  }
  const icon = st.state === 'all_well' ? ICONS.sun : st.state === 'urgent' ? ICONS.alert : ICONS.bell;
  const c = st.open[0];
  hero.innerHTML = `<div class="badge" aria-hidden="true">${icon}</div>
    <div><div class="state">${esc(st.label)}</div><h2>${esc(headline)}</h2><p class="sub">${esc(sub)}</p></div>
    <div class="actions">${c ? `${c.acknowledgedBy ? `<span class="tag">${esc(c.acknowledgedBy)} is on it</span>` : `<button class="btn primary" data-ack="${c.id}">I'm on it</button>`}<button class="btn ok" data-resolve="${c.id}">I checked: all OK</button>` : ''}
      <button class="btn" id="check-now">Check on ${esc(name)} now</button></div>`;
}

function renderTimeline() {
  const W = 960, H = 214, L = 84, lanes = { inside: 46, door: 90, visitors: 130, checkins: 170 };
  const x = (min) => L + (min / 1440) * (W - L - 6);
  const r = S.rhythm;
  const q = S.household.routine.quietHours;
  const qs = Number(q.start.slice(0, 2)) * 60 + Number(q.start.slice(3)), qe = Number(q.end.slice(0, 2)) * 60 + Number(q.end.slice(3));
  let svg = `<rect class="tl-night" x="${x(0)}" y="20" width="${x(qe) - x(0)}" height="${H - 46}" rx="8"/><rect class="tl-night" x="${x(qs)}" y="20" width="${x(1440) - x(qs)}" height="${H - 46}" rx="8"/>`;
  const maxH = Math.max(0.01, ...r.hourly);
  r.hourly.forEach((v, h) => { const bh = (v / maxH) * 26; svg += `<rect class="tl-usual" x="${x(h * 60) + 1}" y="${lanes.inside + 13 - bh}" width="${x(60) - x(0) - 2}" height="${bh}" rx="2"><title>Usual activity ${hm(h * 60)}</title></rect>`; });
  if (r.firstActivity) svg += `<rect class="tl-wake" x="${x(r.firstActivity.p10)}" y="22" width="${Math.max(3, x(r.firstActivity.p90) - x(r.firstActivity.p10))}" height="${H - 50}" rx="4"><title>Usually up between ${hm(r.firstActivity.p10)} and ${hm(r.firstActivity.p90)}</title></rect>`;
  svg += `<line class="tl-checkin" x1="${x(r.checkInBy)}" x2="${x(r.checkInBy)}" y1="18" y2="${H - 24}"><title>Check-in time ${hm(r.checkInBy)}</title></line><text class="tl-hour" x="${x(r.checkInBy) + 5}" y="14">check-in ${hm(r.checkInBy)}</text>`;
  for (let h = 0; h <= 24; h += 3) svg += `<line class="tl-grid" x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${H - 26}" y2="${H - 20}"/><text class="tl-hour" x="${x(h * 60)}" y="${H - 4}" text-anchor="middle">${h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`}</text>`;
  for (const [k, y] of Object.entries(lanes)) svg += `<text class="tl-lane-label" x="0" y="${y + 4}">${{ inside: 'Inside', door: 'Front door', visitors: 'Visitors', checkins: 'Check-ins' }[k]}</text>`;
  const today = S.timeline.filter((s) => dayKey(s.at) === S.today);
  const lane = { indoor_motion: ['inside', 'tl-indoor'], resident_ok: ['inside', 'tl-ok'], door_open: ['door', 'tl-door'], door_closed: ['door', 'tl-door'], outdoor_motion: ['door', 'tl-outdoor'], visitor_ring: ['visitors', 'tl-ring'], delivery: ['visitors', 'tl-delivery'], package_collected: ['visitors', 'tl-ok'], env_alert: ['checkins', 'tl-env'] };
  for (const s of today) {
    const l = lane[s.kind];
    if (!l) continue;
    const label = `${fmt(s.at)} ${s.kind.replace(/_/g, ' ')}${s.deviceLabel ? ` (${s.deviceLabel})` : ''}`;
    svg += `<circle class="tl-dot ${l[1]}" cx="${x(minuteOfDay(s.at))}" cy="${lanes[l[0]]}" r="${s.kind === 'resident_ok' ? 9 : 7}"><title>${esc(label)}</title></circle>`;
  }
  for (const c of S.concerns.filter((c) => c.dateKey === S.today)) {
    const a = x(minuteOfDay(c.openedAt)), b = x(minuteOfDay(c.resolvedAt ?? S.now));
    svg += `<rect class="tl-concern ${c.severity} ${c.status}" x="${a}" y="${lanes.checkins - 10}" width="${Math.max(10, b - a)}" height="20" rx="10"><title>${esc(c.title)} ${fmt(c.openedAt)}${c.resolvedAt ? `–${fmt(c.resolvedAt)}` : ' (open)'}</title></rect>`;
  }
  if (dayKey(S.now) === S.today) svg += `<line class="tl-now" x1="${x(minuteOfDay(S.now))}" x2="${x(minuteOfDay(S.now))}" y1="18" y2="${H - 24}"/><text class="tl-hour tl-now-label" x="${x(minuteOfDay(S.now))}" y="${H - 18}" text-anchor="middle">now</text>`;
  $('#timeline').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="timeline-text">${svg}</svg>`;
  $('#legend').innerHTML = '<span><i style="background:var(--teal)"></i>Inside</span><span><i style="background:var(--blue)"></i>Door</span><span><i style="background:var(--yellow-deep)"></i>Doorbell</span><span><i style="background:var(--orange)"></i>Delivery</span><span><i style="background:var(--teal);opacity:.3"></i>Usual wake-up</span>';
  const { first } = presenceToday();
  $('#timeline-text').textContent = `Today: ${first ? `first activity at ${fmt(first.at)}` : 'no activity yet'}, ${today.filter((s) => s.kind === 'visitor_ring').length} doorbell rings, ${today.filter((s) => s.kind === 'delivery').length} deliveries. Usually up between ${r.firstActivity ? `${hm(r.firstActivity.p10)} and ${hm(r.firstActivity.p90)}` : 'unknown times'}.`;
}

function ladderHtml(c) {
  const nextIdx = c.ladder.findIndex((s) => !s.firedAt && !s.skipped);
  return `<ol class="ladder">${c.ladder.map((s, i) => {
    const cls = s.skipped ? 'skipped' : s.firedAt ? 'done' : i === nextIdx ? 'next' : '';
    const when = s.firedAt ? fmt(s.firedAt) : s.skipped ? '' : `at ${fmt(s.dueAt)}`;
    return `<li class="${cls}"><span class="icon" aria-hidden="true">${s.firedAt && !s.skipped ? '✓' : i + 1}</span><div><div class="what">${esc(STEP_NAMES[s.kind] ?? s.kind)}</div>${s.outcome ? `<div class="outcome">${esc(s.outcome)}</div>` : ''}</div><span class="when">${esc(when)}${s.skipped ? 'not needed' : ''}</span></li>`;
  }).join('')}</ol>`;
}

function renderCheckins() {
  const open = S.concerns.filter((c) => c.status === 'open');
  $('#open-checkins').innerHTML = open.length
    ? open.map((c) => `<article class="card checkin ${c.severity}">
        <h3>${esc(c.title)} <span class="sev ${c.severity}">${c.severity === 'urgent' ? 'Urgent' : 'Gentle'}</span><span class="tag">since ${fmt(c.openedAt)}</span></h3>
        <p>${esc(c.summary)}</p>
        <ul class="evidence">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        ${ladderHtml(c)}
        ${c.snapshot ? `<figure class="snapshot"><img src="${c.snapshot.url}" alt="Front porch snapshot at ${fmt(c.snapshot.at)}, privacy zones blacked out"><figcaption>${c.vision ? `<b>${esc(c.vision.description)}</b><br>` : ''}Snapshot ${fmt(c.snapshot.at)} from the Ring camera${c.vision ? `, checked by ${esc(c.vision.model)}` : ''}. Privacy zones are blacked out before anything looks at it.</figcaption></figure>` : ''}
        <div class="actions">${c.acknowledgedBy ? `<span class="tag">${esc(c.acknowledgedBy)} is handling it</span>` : `<button class="btn primary" data-ack="${c.id}">I'm on it</button>`}<button class="btn ok" data-resolve="${c.id}">All OK</button></div>
      </article>`).join('')
    : `<div class="empty">No open check-ins. Porchlight will only reach out if ${esc(S.household.resident.preferredName)}'s day looks different from usual.</div>`;
  const past = S.concerns.filter((c) => c.status === 'resolved').slice(-5).reverse();
  $('#past-checkins').innerHTML = past.length ? `<div class="past">${past.map((c) => `<div class="past-item"><span class="tick" aria-hidden="true">✓</span><div><b>${esc(c.title)}</b> · ${fmt(c.openedAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}<br><span class="muted">${esc(c.resolution?.text ?? '')}</span></div></div>`).join('')}</div>` : '';
}

function renderFeed() {
  const msgs = S.phone.filter((m) => m.to === 'maria').slice(-12).reverse();
  $('#feed').innerHTML = msgs.length
    ? msgs.map((m) => `<li class="${m.urgent ? 'urgent' : ''} ${m.title === 'All clear' ? 'clear' : ''}"><div class="t"><span>${esc(m.title)}</span><span>${fmt(m.at)}</span></div>${esc(m.text)}</li>`).join('')
    : '<li class="empty-feed">No alerts. That’s the point.</li>';
}

function renderDigest() {
  const d = S.digest;
  $('#digest').innerHTML = d ? `<p>${esc(d.text)}</p><p class="meta">${esc(d.date)} · ${d.model === 'template' ? 'written from a template (no Bedrock configured)' : `written by ${esc(d.model)} from Porchlight's facts`}</p>` : '<p class="muted">Arrives at 8:30 PM: a two-line note about the day, only facts.</p>';
}

function renderRoutine() {
  const r = S.rhythm;
  const conf = { learning: 'Still learning', low: 'Getting to know the routine', good: 'Confident' }[r.confidence];
  $('#routine').innerHTML = `<dl class="kv">
    <dt>Learned from</dt><dd>${r.days} days of Ring history · ${conf}</dd>
    <dt>Usually up</dt><dd>${r.firstActivity ? `${hm(r.firstActivity.p10)} – ${hm(r.firstActivity.p90)}` : 'not yet known'}</dd>
    <dt>Check-in time</dt><dd>${hm(r.checkInBy)} (${r.checkInSource === 'learned' ? 'learned' : r.checkInSource === 'family' ? 'set by family' : 'default'})</dd>
    <dt>Quiet stretch</dt><dd>up to ${Math.round(r.usualLongestGapMin / 6) / 10} h is normal</dd>
    <dt>Deliveries</dt><dd>about ${r.deliveriesPerWeek} a week</dd></dl>
    <div class="bars" aria-hidden="true">${r.hourly.map((v) => `<span style="height:${Math.max(2, (v / Math.max(0.01, ...r.hourly)) * 100)}%"></span>`).join('')}</div>
    <div class="bars-axis" aria-hidden="true"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span></div>`;
}

function renderDevices() {
  $('#devices').innerHTML = S.devices.length
    ? S.devices.map((d) => `<li><span class="name">${esc(d.label)}</span><span class="role">${esc(ROLE_NAMES[d.role] ?? d.role)}${d.battery != null && d.battery <= 100 ? ` · battery ${d.battery}%` : ''}</span><span class="status"><span class="dot ${d.online ? 'on' : ''}" aria-hidden="true"></span>${d.online ? 'Online' : d.online === false ? 'Offline: live checks are paused' : 'Unknown'}</span></li>`).join('')
    : '<li class="muted">No Ring devices are connected to Porchlight yet. Add Porchlight from the Ring Appstore in the Ring app to connect them.</li>';
}

function renderHome(name) {
  const now = new Date(S.now);
  $('#home-clock').innerHTML = `${fmt(now, { hour: 'numeric', minute: '2-digit' })}<div class="home-date">${fmt(now, { weekday: 'long', month: 'long', day: 'numeric' })}</div>`;
  const hour = Math.floor(minuteOfDay(S.now) / 60);
  $('#home-greeting').textContent = `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}, ${name}`;
  const m = S.home.message;
  const card = $('#home-card');
  if (m) {
    const isPackage = m.kind === 'package_waiting';
    card.innerHTML = `<div class="home-card pulse"><p>${esc(m.text)}</p>${isPackage ? `<button class="big ok" data-home="package">I brought it in</button>` : `<button class="big ok" data-home="ok">I'm OK</button>`}</div>`;
  } else {
    const visit = S.household.careSchedule[0];
    card.innerHTML = `<div class="home-card calm"><p>Have a lovely day, ${esc(name)}.</p><button class="big alt" data-home="ok">I'm OK</button></div>`;
    $('#home-today').textContent = visit ? `${visit.who} visits on weekdays at ${hm(Number(visit.time.slice(0, 2)) * 60 + Number(visit.time.slice(3)))}.` : '';
  }
}

function renderScenes() {
  const sim = S.sim;
  $('#sc-note').textContent = sim ? 'Each demo day runs on the simulated Ring account. Events reach Porchlight as signed webhooks and Ring API calls, exactly as they would from real devices.' : 'Live mode: events come from the Ring Partner API (Event History polling with the Developer Playground). Trigger Package, Vehicle or Motion events in the Playground and watch them arrive here.';
  $('#scenarios').innerHTML = sim ? sim.scenarios.map((s) => `<div class="scenario"><b>${esc(s.title)}</b><p>${esc(s.blurb)}</p><button class="btn primary small" data-scenario="${s.id}">Play</button></div>`).join('') : '';
  const ai = S.ai;
  $('#ai-status').innerHTML = `<dl class="ai-row"><dt>Rules</dt><dd>Deterministic and tested: who is told, and when, never depends on a model.</dd>
    <dt>Porch vision</dt><dd>${esc(ai.vision)}</dd><dt>Questions</dt><dd>${esc(ai.ask)}</dd><dt>Evening note</dt><dd>${ai.enabled ? `Amazon Bedrock (${esc(ai.textModel)})` : 'Template (add a Bedrock API key to use a model)'}</dd>
    <dt>Alexa+</dt><dd>MCP server at <code>/mcp</code> (Streamable HTTP, 2025-11-25)</dd></dl>
    ${S.mode === 'live' ? '<button class="btn" id="porch-btn">Check the porch now</button> <button class="btn" id="live-btn">Live view (WHEP)</button>' : '<button class="btn" id="porch-btn">Check the porch now</button>'}`;
  $('#api-base').textContent = S.mode === 'live' ? 'api.amazonvision.com' : 'local simulator';
  $('#api-log').innerHTML = S.apiLog.slice(-60).reverse().map((l) => `<li><span>${esc(l.method)}</span><span class="s${String(l.status)[0]}">${l.status || 'ERR'}</span><span class="path" title="${esc(l.path)}">${esc(decodeURIComponent(l.path))}</span><span>${l.durationMs}ms</span></li>`).join('') || '<li>No calls yet.</li>';
  $('#webhooks').innerHTML = sim ? sim.deliveries.slice().reverse().map((d) => `<li><span>${fmt(d.at)}</span><span class="s${String(d.status)[0]}">${d.status}</span><span class="path">${esc(d.type)}</span><span></span></li>`).join('') || '<li>No webhooks yet.</li>' : '<li>Webhooks need a public HTTPS URL registered in the Ring Developer Portal; the Playground does not send them, so Porchlight polls Event History instead.</li>';
  $('#activity').innerHTML = S.activity.slice(-80).reverse().map((a) => `<li><span class="t">${fmt(a.at)}</span><span class="k">${esc(a.kind)}</span><span>${esc(a.text)}</span></li>`).join('');
}

function renderDock() {
  const dock = $('#dock');
  if (!S.sim) { dock.hidden = true; return; }
  dock.hidden = false;
  $('#dock-clock').textContent = fmt(S.now, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  $('#dock-speed').textContent = S.sim.paused ? 'paused' : `${S.sim.speed}× time`;
  $('#dock-pause').textContent = S.sim.paused ? 'Resume' : 'Pause';
  document.querySelectorAll('.dock [data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === S.sim.speed && !S.sim.paused));
}

// ------------------------------------------------------------ side effects --
function caption(text) {
  $('#dock-caption').textContent = text;
}
function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}
function buzz() {
  if (view !== 'family') toast('New alert on Maria’s phone');
}
function speak(text) {
  if (view !== 'home' || !$('#speak-toggle').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.92;
  speechSynthesis.speak(u);
}
function playChime() {
  try {
    audioCtx ??= new AudioContext();
    const t0 = audioCtx.currentTime;
    [659.25, 523.25, 783.99].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.28);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.28 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 1.1);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.28);
      o.stop(t0 + i * 0.28 + 1.2);
    });
  } catch { /* audio is a nicety */ }
}

async function liveView() {
  const box = $('#live-view');
  box.innerHTML = '<video class="live" autoplay muted playsinline></video><p class="muted small">Connecting to the Ring camera over WebRTC (WHEP)…</p>';
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.ontrack = (e) => { box.querySelector('video').srcObject = e.streams[0]; };
  await pc.setLocalDescription(await pc.createOffer());
  await new Promise((r) => { if (pc.iceGatheringState === 'complete') r(); else { pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 2500); } });
  const res = await post('/api/live/whep', { sdp: pc.localDescription.sdp });
  if (!res.answer) { box.querySelector('p').textContent = `Live view failed: ${res.error ?? 'no answer'}`; return; }
  await pc.setRemoteDescription({ type: 'answer', sdp: res.answer });
  box.querySelector('p').textContent = 'Live from the Ring camera. Sessions end automatically after 30 to 60 seconds.';
  setTimeout(() => { pc.close(); post('/api/live/whep/stop', { sessionUrl: res.sessionUrl }); }, 30_000);
}

// ---------------------------------------------------------------- events --
document.addEventListener('click', async (e) => {
  audioCtx ??= (() => { try { return new AudioContext(); } catch { return null; } })();
  const t = e.target.closest('button');
  if (!t) return;
  if (t.matches('.tab')) return setView(t.dataset.view);
  if (t.dataset.ack) return post(`/api/concerns/${t.dataset.ack}/ack`, { member: 'maria' });
  if (t.dataset.resolve) return post(`/api/concerns/${t.dataset.resolve}/resolve`, { member: 'maria', note: 'Checked in with her, all OK' });
  if (t.id === 'check-now') { toast(`Porchlight is checking on ${S.household.resident.preferredName}…`); return post('/api/check-in', { member: 'maria' }); }
  if (t.dataset.home === 'ok') return post('/api/resident/ok');
  if (t.dataset.home === 'package') return post('/api/resident/package-inside');
  if (t.dataset.scenario) { caption('Starting a new day…'); return post('/api/sim/scenario', { id: t.dataset.scenario }); }
  if (t.dataset.speed) return post('/api/sim/clock', { speed: Number(t.dataset.speed), resume: true });
  if (t.id === 'dock-pause') return post('/api/sim/clock', S.sim.paused ? { resume: true } : { pause: true });
  if (t.id === 'dock-skip') return post('/api/sim/clock', { skip: true });
  if (t.id === 'digest-btn') { $('#digest').innerHTML = '<p class="muted">Writing…</p>'; return post('/api/digest'); }
  if (t.id === 'refresh-devices') return post('/api/devices/refresh');
  if (t.id === 'delete-data' && confirm('Delete everything Porchlight has stored about this household?')) return post('/api/data/delete');
  if (t.id === 'porch-btn') { const r = await post('/api/porch/check'); toast(r.vision ? r.vision.description : r.error); return; }
  if (t.id === 'live-btn') return liveView();
  if (t.classList.contains('chip') && t.closest('#ask-chips')) { $('#ask-input').value = t.textContent; $('#ask-form').requestSubmit(); }
});

$('#ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#ask-input').value.trim();
  if (!q) return;
  $('#ask-answer').innerHTML = '<div class="bubble">Thinking…</div>';
  const a = await post('/api/ask', { question: q, asker: 'Maria' });
  $('#ask-answer').innerHTML = `<div class="bubble">${esc(a.text)}</div><div class="meta">${esc(a.model)}${a.toolsUsed?.length ? ` · used ${a.toolsUsed.map(esc).join(', ')}` : ''}</div>`;
});

function setView(v) {
  view = v;
  for (const id of ['family', 'home', 'alexa', 'scenes']) $(`#view-${id}`).hidden = id !== v;
  document.querySelectorAll('.tab').forEach((b) => (b.dataset.view === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  history.replaceState(null, '', `#${v}`);
}

$('#ask-chips').innerHTML = ['When did Mom get up today?', 'Did the delivery get brought in?', 'Is anyone on the porch right now?', 'Has anyone visited today?'].map((c) => `<button class="chip" type="button">${c}</button>`).join('');
createAlexa({ onChange: () => refreshSoon(50) });
const fromHash = () => setView(['family', 'home', 'alexa', 'scenes'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'family');
window.addEventListener('hashchange', fromHash);
fromHash();
await load();
connect();
setInterval(() => S?.sim && refreshSoon(0), 1000);

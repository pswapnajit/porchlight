# Porchlight: Devpost submission

Everything needed for the "Enter a Submission" form at amazonappdev2026.devpost.com, in form order. Deadline: **Friday 23 October 2026, 12:00 PT (Saturday 24 October, 00:30 IST)**.

Before submitting, replace every `[[FILL: …]]` (search the file for `[[`). They are the only things this file cannot know yet: the video URL, and numbers from the first live Ring Playground and Bedrock run.

---

## Quick fields

| Field | Value |
|---|---|
| Project name | Porchlight |
| Elevator pitch (≤200 chars) | Ring tells you when something happens. Porchlight notices when something doesn't: gentle, learned check-ins for a parent living alone, using the Ring devices already at their door. |
| Primary track(s) | **Ring** (main). Also eligible for **Alexa+** (self-hosted MCP server, spec 2025-11-25, Streamable HTTP). A project can win only one track prize. |
| Mini challenge(s) | **AWS Builder** (Amazon Bedrock Converse API + Strands Agents SDK). **Open Source** (`ring-partner-kit`, MIT). |
| Code repository | https://github.com/pswapnajit/porchlight (public, MIT, license shown in the About section) |
| Demo video | [[FILL: YouTube or Vimeo URL, public, under 3:00]] |
| Built with | ring-partner-api, ring-developer-playground, amazon-bedrock, amazon-nova, strands-agents, model-context-protocol, mcp-apps, alexa-plus, node.js, typescript, webrtc, whep |
| New or existing | New. Built from scratch during the Submission Period (first commit 20 October 2026). |

---

## Text description

### Inspiration

More than a quarter of Americans over 65 live alone, and about one in four older adults falls each year. When you're the daughter two hours away, the question on your mind is rarely "what happened at the door?" It is "**is Mom up and about today?**"

Security cameras answer the first question. Nothing in the home answers the second without a wearable to charge, new hardware, or a camera pointed at the person. Yet a Ring doorbell, an indoor camera and a door sensor already record the shape of an ordinary day: up around 7:40, the aide rings at 10, a parcel at noon and brought in by one. What tells you something is wrong is the **absence** of those events.

Ring's own Appstore lists "Elderly care monitoring" as a category it is waiting for. Porchlight is built to be that app.

### What it does

Porchlight learns a person's ordinary day from four weeks of Ring Event History. When a day looks wrong, it checks in gently, first with the parent and then with family.

- **Quiet morning:** no sign of life by the check-in time it learned (the latest usual start plus 45 minutes).
- **Unusually quiet:** active earlier, then silent far longer than this person's normal quiet stretch.
- **Doorbell not answered:** the scheduled aide rang and nobody opened the door within 4 minutes. This is urgent.
- **Package still outside:** Ring's own `package_delivery` classification starts a timer (90 minutes, or 45 when the home reads 30 °C or more, or 5 °C or less). When it runs out, Porchlight takes a **privacy-masked** doorbell snapshot and asks a vision model on Amazon Bedrock whether the box is still there.
- **Front door at night:** the door sensor opens during quiet hours. This is urgent, and the alert includes an infrared snapshot.
- **Home too hot or cold, water, CO, camera offline:** a nudge first, then family. Porchlight also says when it can't see, instead of failing silently.

**The escalation ladder.** The parent always gets the first chance, through a chime and a big "I'm OK" button on their screen, or by voice: *"Alexa, tell Porchlight I'm OK."* Then they get a text. Only then is the primary caregiver alerted, and after that the rest of the circle. One tap of "I'm on it" stops everyone else being woken. When it resolves, everyone who was told gets an "All clear".

**Family dashboard:** today's timeline against the learned routine, open check-ins with exactly what Porchlight has done so far, an evening note, and "Ask Porchlight" (*"Did the delivery get brought in?"*). **Rose's screen:** a large-type home display for the parent that says plainly what the family can and cannot see. **Alexa+:** *"Alexa, ask Porchlight how Mom's doing"*, *"…check on Mom"*, *"…I'm handling it"*. Status answers come with an MCP Apps card for screen devices.

### Privacy and dignity by design

- **Nothing inside the home is ever viewed.** Indoor cameras contribute only "there was movement at 7:41".
- **Snapshots are taken only when a decision depends on one**, and only from the front door. Ring privacy zones from `configurations` are blacked out before any model or person sees the image. Cameras with end-to-end encryption are skipped, and Porchlight asks a person instead.
- **Who gets told, and when, never depends on a model.** The rules and ladder are deterministic and covered by tests. AI only writes the evening note, answers questions and looks at the porch. Anything uncertain (`"unsure"`, or confidence below 0.6) becomes "ask a person", never a guess.
- Each family member chooses which check-ins reach them. Quiet hours silence the chime. One click deletes all data.

### How I built it

**Ring Partner API**, through `ring-partner-kit`, a typed, zero-dependency TypeScript client I wrote for this project and released separately as open source:

- `GET /v1/devices?include=status,capabilities,configurations,location` discovers everything in one round trip. Roles are proposed from capabilities, because Ring has no device-type field, and chimes are detected by `audio.customizable_slots`.
- `GET /v1/history/devices/{id}/events`, with composite filters and `page[key]` pagination, learns the routine from 28 days of history. In live mode against the Developer Playground it is also the event feed.
- Webhooks (`motion_detected` with `sub_type`, `button_press`, contact sensor, temperature, `device_offline/online`) are verified with **HMAC-SHA256 over the raw bytes** (`X-Signature`), deduplicated on `meta.request_id`, and answered fast, with processing afterwards.
- `POST /v1/devices/{id}/media/image/download` (`latest_in_range`, PNG, 303 to a pre-signed URL) gives the porch checks and night snapshots, with privacy zones masked in a pure-TypeScript PNG decoder and encoder.
- `POST /v1/devices/{id}/media/audio/playback` plays the good-morning and reminder chimes. It is gated on online state, snooze and enabled slots, and never retried, because a retry is a second sound in someone's home.
- `POST …/media/streaming/whep/sessions` gives the family a "Live view" button over WebRTC.

Ring's computer-vision guidelines recommend a tiered funnel, and Porchlight follows it. Ring's free `sub_type` classification is stage 0, and the paid model runs once per decision, never once per motion event.

**Amazon Bedrock (Converse API):** image plus text in, with a strict JSON contract for the porch check (default `amazon.nova-lite`). A text model (default `amazon.nova-pro`) writes the evening note from structured facts only. A Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`) is enough to turn it on.

**Strands Agents SDK (TypeScript):** "Ask Porchlight" is a Strands agent on Bedrock with six tools over Porchlight's records and the live Ring camera: `get_day_summary`, `get_open_checkins`, `get_recent_activity`, `get_usual_routine`, `check_porch_now` and `get_devices`. It is told to answer only from tool results and never to guess about health or who a visitor was.

**Alexa+ via MCP:** `/mcp` is a self-hosted MCP server built with the official TypeScript SDK on Streamable HTTP, protocol **2025-11-25**, with 8 tools (`get_status`, `get_day_summary`, `check_porch`, `send_check_in`, `acknowledge_check_in`, `resolve_check_in`, `resident_im_ok`, `ask`). Status tools link an MCP Apps UI resource (`ui://porchlight/status-card.html`). The Alexa+ tab in the app is a simulated host that is a real MCP client (`initialize`, `tools/list`, `tools/call`, `resources/read`) and shows the JSON-RPC traffic.

**A contract-faithful Ring simulator** in `ring-partner-kit` serves the same REST shapes, signs real HMAC webhooks and renders porch snapshots. The five scripted demo days run through it end to end.

**Tests:** 40 (`npm test`), covering the SDK, the rules engine, end-to-end scenarios over HTTP and the MCP endpoint.

### Challenges I ran into

- **No webhooks in the Developer Playground.** Live mode polls Event History every 15 seconds. The engine treats webhooks and polling as one deduplicated stream, so production can use webhooks with polling only filling gaps.
- **Event History has no motion `sub_type`.** Telling a delivery from a person in history takes one unfiltered query plus five filtered ones (`motion.human`, `motion.package_delivery`, …), tagging each event by the filter that returned it.
- **`links.next` never goes away.** It appears even on an empty page, so a loop that follows the docs never ends. The kit stops on an empty page or a repeated cursor, with a page cap.
- **The official hello-world sample authenticates webhooks with a Bearer token, not the documented HMAC `X-Signature`.** I wrote the verifier from the API reference instead.
- **Designing for dignity.** The hardest product decision was the order of the ladder: the parent first, always, and the family only when the parent doesn't answer.

### Accomplishments that I'm proud of

- Porchlight works with hardware the family already owns, and it never needs to look inside the home.
- The decisions are deterministic and tested, and the models are fenced in with an explicit "ask a person" path.
- It respects Ring's own guidance: the computer-vision funnel, privacy zones, end-to-end encryption, UX rules (device names, not IDs; online state in text; WCAG 2.2 AA colors) and one-click delete.
- `ring-partner-kit` is something other Ring developers can use today, simulator included.

### What I learned

The most useful signal in a home is often the one that didn't fire. And for a caregiving app, the most important design choice is who gets asked first.

### What's next for Porchlight

- Real SMS and voice-call steps on the ladder. Family alerts already work as real phone push through ntfy.sh.
- Ring sensors and chimes on real hardware, once Early Access opens. Today they are built to the documented contract and exercised against the simulator.
- Multi-home circles (a parent and an in-law), and a weekly trend note: "Mom has been getting up 40 minutes later this month."
- Publishing on the Ring Appstore.

*Porchlight is not an emergency service or a medical device. It notices absence and asks people to check.*

---

## Demo video script (2:45)

Target length: 2:45, which is under the 3:00 limit judges watch to. Record at 1440×900 or larger, with the app at 100% zoom.

**Before recording:**
- `npm run demo` (port 4000) for segments 1–5. Add `AWS_BEARER_TOKEN_BEDROCK` to `.env` first, so the porch check and the answers come from Bedrock (the AWS Builder judges will look for it). Without it, the screen says "Simulator ground truth (no Bedrock configured)".
- For segment 6: a fresh Playground token in `.env` (it lasts about 30 minutes), then `npm start` in a second terminal on another port (`PORT=4001 npm start`), and the Ring Developer Playground open in a browser tab.
- **Segment 6 is required for the Ring track.** The rules say the video must show the project working through "a simulator or an actual Ring device", meaning one listed in Ring's documentation. That is the Developer Playground, not Porchlight's own simulator.

| Time | On screen | Voice-over |
|---|---|---|
| **0:00–0:15** | Title card, then the Family dashboard (open check-in, Maria's phone) | "Ring tells you when something happens. Porchlight notices when something doesn't. This is Rose. She's 78 and lives alone. Her daughter Maria lives two hours away, and every day she wonders one thing: is Mom up and about?" |
| **0:15–0:30** | "What Porchlight learned" card; Today timeline with the dashed check-in line | "Porchlight uses the Ring devices already at Rose's home. It read four weeks of Ring Event History and learned her day: usually up between 7:31 and 8:20, so if there's no sign of her by 9:10, it checks in." |
| **0:30–1:10** | Behind the scenes → Play "A package in the heat" at 240×. Webhook list fills (HMAC verified). Cut to the check-in card with the masked snapshot, then Rose's screen "I brought it in", Maria's phone, then the All clear | "Here's a hot afternoon. A delivery arrives. Ring itself classifies it as a package, and that starts a timer, shorter today because it's 31 degrees inside. When the timer runs out, Porchlight takes a doorbell snapshot, blacks out the privacy zones, and asks a vision model on Amazon Bedrock: is the box still there? It is. So Rose hears a soft chime and sees one big button. She doesn't answer, so Maria gets the alert. When Rose brings it in, the door sensor and the camera see it, and Maria gets an all clear." |
| **1:10–1:30** | Check-in card: ladder steps with times; tap "I'm on it" | "Every check-in climbs the same ladder: Rose first, always, then a text, then Maria, then the rest of the family. One tap of 'I'm on it' stops everyone else being woken. And who gets told is never a model's decision. The rules are deterministic and tested." |
| **1:30–1:55** | Alexa+ tab: "Alexa, ask Porchlight how Mom is doing" → reply + MCP App card; MCP traffic panel; then "(Rose) Alexa, tell Porchlight I'm OK" | "Maria can just ask Alexa. Porchlight is a self-hosted MCP server, spec 2025-11-25, and this page is a real MCP client. Status answers come with an MCP Apps card. And Rose can answer a check-in with her voice, which matters if a touchscreen is hard." |
| **1:55–2:25** | Split: Ring Developer Playground → simulate a Package event. Porchlight (live, `api.amazonvision.com`) → Behind the scenes, API log shows the Event History calls; the event lands on the timeline | "This is the live Ring API. In the Developer Playground I simulate a package at the front door. The Playground has no webhooks, so Porchlight polls Event History, and seconds later the delivery is on Rose's timeline, ready to start the same timer." [[FILL: adjust to what the live run shows]] |
| **2:25–2:40** | GitHub: `ring-partner-kit` README, then `npm test` passing (40) | "Everything talks to Ring through ring-partner-kit, a typed, zero-dependency client with HMAC webhook verification, privacy masking and a full Ring simulator. I've released it as open source, with 40 tests across the project." |
| **2:40–2:45** | Rose's screen: "They can't see inside your home." Logo. | "Porchlight. It never looks inside. It just notices." |

About 350 spoken words. At a calm 150 words a minute that is about 2:20 of speech, which leaves roughly 25 seconds of silence for the moments that need it: the scenario playing, the Alexa card appearing, the Playground event landing. The first two segments run near 155 wpm, so trim a few words there if they feel rushed.

---

## Product feedback

The form asks the same five questions for each tool, API and SDK.

### 1. Ring Partner API (Amazon Vision API, `api.amazonvision.com`)

**What I used and for what.** Device discovery with `include=status,capabilities,configurations,location`; Event History with composite `event_types` filters and `page[key]` pagination, to learn the routine (and as the live event feed); webhooks for real-time events (`motion_detected` with `sub_type`, `button_press`, `device_online/offline`, plus the Early Access contact and temperature sensor events); image snapshots (`latest_in_range`, PNG, the 303 to a pre-signed URL); `configurations` for privacy zones and `e2e_encryption`; chime audio playback; and WHEP live view.

**What worked well.**
- JSON:API with `include=` gives a complete picture of a home in one call. Compound documents are easy to resolve generically.
- Composite filters like `motion.package_delivery` are exactly the right primitive for "stage 0" of the vision funnel. Ring's classification is free, so Porchlight only spends model calls when a decision depends on one.
- Exposing privacy zones and `e2e_encryption` in `configurations` made it possible to respect what the user set in the Ring app without asking them twice. This was the most important thing for a caregiving app.
- The computer-vision and UX guides are unusually concrete (the tiered funnel, device names not IDs, online state in text). I followed them directly.
- The 303 to a pre-signed URL for media is clean, and it is easy to cache only the masked, downscaled copy.

**What needs work.**
- Event History doesn't return the motion `sub_type`, while webhooks do (friction F2).
- `links.next` is returned on empty pages, and the docs contradict themselves about it (friction F3).
- The motion subtype vocabulary differs between the webhook docs (`human`, `vehicle`, `package_delivery`, `other_motion`) and the Event History filter docs (`motion.human`, `motion.vehicle`, `motion.animal`, `motion.other_motion`) (friction F6).
- There is no device type or placement field, so "front door" or "indoor" has to be inferred from capabilities and then confirmed by the user.
- The docs themselves note that no API exposes whether Smart Alerts is enabled, so an app can't tell "no classification" from "nothing classified".

**Onboarding (zero to hello world).** The API reference is thorough, and the Playground token gets you to a first `GET /v1/devices` in minutes with no device and no app registration. The slow part was everything event-driven: without webhooks in the Playground, and with a hello-world sample that verifies webhooks the wrong way, I wrote the webhook layer from the reference and built a local simulator to test against. [[FILL: time from token to first live device list, e.g. "about 5 minutes"]]

**Would I build with it again?** **Yes.** Ring devices are already in millions of homes, and the API exposes exactly the signals a non-security app needs (classified events, history and privacy settings) without ever needing to look inside the home. Fixing F1–F3 would make it the easiest home-sensing platform I know of to build on.

### 2. Ring Developer Playground

**What I used and for what.** Playground tokens for live mode (`npm run probe`, `npm start`): real device discovery, Event History, snapshots, and simulated Package, Vehicle and Motion events to drive Porchlight end to end without hardware.

**What worked well.** No device and no app registration: generate a token and call the real API. Simulated events show up in Event History, so a whole app can be exercised against production endpoints. [[FILL: one concrete observation from the live run, e.g. "simulated Package events appeared in Event History within N s"]]

**What needs work.**
- No webhook delivery, so event-driven apps must be rewritten as pollers to use it (friction F1).
- Tokens last about 30 minutes, which interrupts longer test sessions and demo recordings. A refresh flow, or a longer-lived sandbox token, would help.
- Cameras only, so sensor and chime features (Early Access) can't be tested.

**Onboarding.** Fastest part of the whole stack: about a minute from the console to a working token.

**Would I build with it again?** **Yes.** It is the right idea, a zero-hardware sandbox against the real API. With webhook delivery it would cover the whole development loop.

### 3. Amazon Bedrock (Converse API)

**What I used and for what.** `ConverseCommand` from `@aws-sdk/client-bedrock-runtime` for:
1. **Porch vision check:** a privacy-masked PNG snapshot plus a strict JSON prompt goes to `us.amazon.nova-lite-v1:0`, returning `{package_present, person_present, confidence, description}`. A guardrail turns `"unsure"`, unparseable replies or confidence below 0.6 into "ask a person".
2. **Evening note:** `us.amazon.nova-pro-v1:0` writes two lines from structured facts only, with no images and no raw events.
3. The model behind the Strands agent (below).

Auth is a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`) or normal AWS credentials. Model IDs can be swapped through `.env`.

**What worked well.**
- One API for text and image input. The vision check and the note share a single code path, and switching models is a config change.
- Bedrock API keys remove the IAM setup that usually stands between a hackathon project and its first model call.
- Usage (input and output tokens) comes back on every response, so per-decision cost is easy to log.
- [[FILL after the live run: latency and quality, e.g. "Nova Lite answered the porch check in about N s and correctly said 'unsure' on the infrared night frame"]]

**What needs work.** [[FILL after the live run: anything real, e.g. model access approval, a region or model ID mismatch, or JSON adherence]]. One wish: a built-in JSON-schema response mode for Converse across models, so the strict-JSON contract doesn't need prompt engineering and a parser.

**Onboarding.** [[FILL: e.g. "API key to first Converse call: N minutes"]]

**Would I build with it again?** **Yes.** Choosing a model is a config line, and a Bedrock API key makes it practical for a small team.

### 4. Strands Agents SDK (TypeScript)

**What I used and for what.** `Agent`, `BedrockModel` and `tool` from `@strands-agents/sdk` for "Ask Porchlight": six tools with zod input schemas over Porchlight's records and the live Ring camera, a system prompt that forbids guessing, and a `toolsUsed` trace returned to the UI.

**What worked well.**
- Tools are plain functions with zod schemas, the same shape as tools in the MCP SDK, so Porchlight's capabilities are described one way for both the agent and Alexa+.
- `BedrockModel` takes the Bedrock API key directly, so there is no separate credential plumbing.
- The agent loop (choose a tool, call it, answer) needed no glue code.
- [[FILL after the live run: e.g. "it correctly chained get_open_checkins → check_porch_now for 'Is the package still out there?'"]]

**What needs work.** [[FILL after the live run]]. Requests: a documented way to cap tool calls per turn, and a first-class "answer only from tools" mode for grounded assistants.

**Onboarding.** Install, define one tool, and call `agent.invoke` (or the equivalent) quickly. The TypeScript docs are thinner than the Python ones. [[FILL: confirm against what you saw]]

**Would I build with it again?** **Yes**, for any assistant that has to answer from an app's own data.

### 5. MCP TypeScript SDK (for Alexa+)

**What I used and for what.** `McpServer` and `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` for a self-hosted MCP server at `/mcp`, protocol 2025-11-25. It has 8 tools (`get_status`, `get_day_summary`, `check_porch`, `send_check_in`, `acknowledge_check_in`, `resolve_check_in`, `resident_im_ok`, and `ask`, which is backed by the Strands agent), plus an MCP Apps UI resource (`ui://porchlight/status-card.html`) linked from the status tools through `_meta.ui.resourceUri`. The in-app Alexa+ host is a real MCP client that renders the card in a sandboxed iframe.

**What worked well.**
- `registerTool` with zod schemas, plus `structuredContent`, gives typed output that a card UI and a voice answer can both use.
- The Streamable HTTP transport drops into a plain Node `http` server. Stateless mode made the endpoint simple to test (`apps/porchlight/test/scenarios.test.ts` drives `initialize` and `tools/call` over HTTP).
- MCP Apps is a natural fit for Echo Show-style screens: one UI resource, data pushed in by the host.

**What needs work.**
- MCP Apps is new, and example hosts are scarce. I had to write a small host to see the card at all. A reference Alexa+ MCP host or simulator from Amazon would let developers test the real experience.
- There is no public way to connect a self-hosted MCP server to a real Alexa+ device for testing yet, so the voice experience has to be simulated.

**Onboarding.** Smooth: a working `tools/list` in under an hour, including Streamable HTTP.

**Would I build with it again?** **Yes.** MCP made Porchlight's Alexa+ integration a thin layer over the same functions the app already had.

### Feature requests (optional)

| Request | Why it matters to Porchlight | Priority |
|---|---|---|
| Webhook delivery from the Developer Playground (signed with a sandbox HMAC key) | Event-driven apps could be tested end to end without app registration; today they must be rewritten as pollers | **Critical** |
| `attributes.sub_type` on Event History events | Learning a routine from history needs to tell a delivery from a person; today it costs 6 calls per camera per poll | **Important** |
| Omit `links.next` on the last or empty page (or document an end sentinel) | Prevents infinite pagination loops and wasted rate limit | **Important** |
| A device type or placement hint (doorbell, indoor, outdoor) in device attributes | Caretaking logic depends on "front door" vs "indoor", which can only be guessed from capabilities now | Nice-to-have |
| Expose whether Smart Alerts is on (the docs say no API does) | Lets an app tell "no classification" from "nothing classified" and prompt the user to turn it on | Nice-to-have |
| Sensor and chime devices in the Playground | Lets Early Access features (door sensor, temperature, chimes) be tested without hardware | Important |

---

## Friction log (bonus: up to 10%)

Severity: **High** blocks or silently breaks a common path; **Medium** costs real time or calls but has a workaround; **Low** is a paper cut.

### F1. The Developer Playground doesn't deliver webhooks

- **Task attempted:** Run Porchlight's real-time path (motion, package and button events) against the live Ring API without hardware.
- **Steps taken:** Generated a Playground token. Ran `npm start` against `api.amazonvision.com`. Simulated Package, Vehicle and Motion events in the Playground. Looked for a place to register a webhook URL.
- **Expected:** The Playground POSTs signed webhooks (`motion_detected` with `sub_type`) to a URL I provide, as production does.
- **Actual:** There is no webhook configuration or delivery in the Playground. Events are only visible through Event History.
- **Severity:** High. Every event-driven Ring app has to grow a second, polling architecture just to use the sandbox, and the webhook code path (HMAC verification, dedup, fast acknowledgement) can't be tested live at all.
- **Workaround used:** Live mode polls `GET /v1/history/devices/{id}/events` every 15 s per camera (`apps/porchlight/src/ring/ingest.ts`, `startHistoryPoller`). The engine deduplicates, so webhooks and polling can both feed it in production. The webhook path is tested against the contract-faithful simulator in `ring-partner-kit`, which signs real HMAC webhooks.
- **Suggestion:** Let a Playground user register one webhook URL, signed with a sandbox HMAC key shown in the console, and add a "Send test webhook" button for each event type, including `button_press` and the Early Access sensor events.

### F2. Event History doesn't return the motion `sub_type`, so classifying history takes 6 calls

- **Task attempted:** Learn the resident's routine from 28 days of history, telling people from deliveries and vehicles (deliveries start the package timer; vehicles must not count as "Rose is up").
- **Steps taken:** Called `GET /v1/history/devices/{id}/events` and read each event's attributes.
- **Expected:** Each motion event carries `attributes.sub_type` (`human`, `package_delivery`, …), as webhook payloads do.
- **Actual:** History events have only `event_type`, `start`, `end` and `is_third_party_reviewed`. The only way to get the classification is to query again with composite filters.
- **Severity:** Medium. It multiplies API calls by 6: one unfiltered query plus five filtered ones (`motion.human`, `motion.package_delivery`, `motion.vehicle`, `motion.animal`, `motion.other_motion`), per camera, per page and per poll. With polling every 15 s (F1), that is 24 calls a minute per camera.
- **Workaround used:** `readHistory()` runs the unfiltered query, then each filtered query, and tags every event ID with the filter that returned it (`apps/porchlight/src/ring/ingest.ts`).
- **Suggestion:** Return `attributes.sub_type` on history events, with the same vocabulary as webhooks (and fix F6 at the same time).

### F3. `links.next` is present even on empty pages, and the docs contradict themselves

- **Task attempted:** Page through a device's full Event History.
- **Steps taken:** Followed `links.next` until it was absent, as the Pagination section says: "When links.next is absent, there are no more pages."
- **Expected:** The last page omits `links.next`.
- **Actual:** `links.next` is returned even when `data` is `[]`. The same docs page shows this in its own empty-result example (`{"data": [], "links": {"next": "…page[key]=…"}}`), contradicting the Pagination section. A client written to the docs never terminates and burns rate limit.
- **Severity:** Medium. It is an infinite loop for anyone who follows the docs literally.
- **Workaround used:** `RingClient.history()` stops on an empty page or a repeated cursor, with a `maxPages` safety cap (default 20) (`packages/ring-partner-kit/src/client.ts`). Covered by a test.
- **Suggestion:** Omit `links.next` on the last page. If that is a breaking change, document the real rule (stop when `data` is empty) in the Pagination section and in the example.

### F4. The official `ring-api-helloworld` sample authenticates webhooks with a Bearer token instead of HMAC `X-Signature`

- **Task attempted:** Start from the official sample (`AmazonAppDev/ring-api-helloworld`) to receive Ring webhooks securely.
- **Steps taken:** Read `app/api/webhook/route.ts` and the README's `RING_WEBHOOK_SECRET` setup, and compared them with the API reference ("Webhook Authentication & Verification").
- **Expected:** The sample verifies `X-Signature` (HMAC-SHA256 over the raw request body, with the HMAC signing key), as the reference says partners "must" do before processing any payload.
- **Actual:** The route compares `Authorization: Bearer ${RING_WEBHOOK_SECRET}` (lines 50–55 at commit `76100aa`) and parses the body with `request.json()`, so the raw bytes needed for an HMAC are gone. If `RING_WEBHOOK_SECRET` is unset, it accepts any POST. If it is set, genuine Ring webhooks should fail the check, because the reference documents only an `X-Signature` header and no `Authorization` header. The reference also says to "verify first, parse second". The README describes the variable as a "Bearer token for webhook auth".
- **Severity:** High. It is the canonical starting point, and copying it gives either an unauthenticated endpoint or one that rejects Ring's real traffic. Developers learn the wrong security model from the official source.
- **Workaround used:** Wrote the verifier from the reference: `verifySignature()` in `ring-partner-kit` does HMAC-SHA256 over the raw bytes, accepts the `sha256=` prefix, and compares in constant time with `timingSafeEqual` (`packages/ring-partner-kit/src/webhooks.ts`, 10 tests).
- **Suggestion:** Read the raw body (`await request.arrayBuffer()`), verify `X-Signature` with the HMAC signing key in constant time, then parse. Rename the variable to `RING_HMAC_SIGNING_KEY` to match the console. [[FILL: if you open a PR to the sample, link it here]]
- Link: https://github.com/AmazonAppDev/ring-api-helloworld/blob/76100aa2892b2f4ece7879701bd9934d3f1e7743/app/api/webhook/route.ts#L50-L55

### F5. The sample's webhook schema drops `button_press`, device online/offline and sensor events

- **Task attempted:** Use the sample's zod schema (`lib/schemas/webhook.ts`) to validate and normalize Ring webhook payloads.
- **Steps taken:** Compared its event enum with the "Event Types" table in the API reference.
- **Expected:** The enum covers the documented types: `motion_detected`, `button_press`, `device_added`, `device_removed`, `device_online`, `device_offline` (plus the Early Access sensor events).
- **Actual:** `z.enum(['motion_detected', 'device_added', 'device_removed', 'person_detected'])` (line 31). It omits `button_press`, `device_online` and `device_offline`, and includes `person_detected`, which doesn't appear anywhere in the API reference. Unmatched payloads fall through to `normalizeGenericEvent`, which reads top-level fields of the JSON:API envelope, so a doorbell press arrives as `event_type: "unknown"` with `device_id: null`. The schema also has no `sub_type` field, so the motion classification is lost.
- **Severity:** Medium. Nothing errors. The most basic doorbell event just silently loses its type and device, which makes this hard to notice.
- **Workaround used:** `ring-partner-kit` types event types as an open-ended union (known values plus `string`), as the docs recommend, and carries `sub_type` through (`packages/ring-partner-kit/src/types.ts`).
- **Suggestion:** Generate the enum from the documented table, include `sub_type` and `component_ids`, and treat unknown types as valid Ring events with their type preserved instead of falling back to "generic".
- Link: https://github.com/AmazonAppDev/ring-api-helloworld/blob/76100aa2892b2f4ece7879701bd9934d3f1e7743/lib/schemas/webhook.ts#L31

### F6. The motion subtype vocabulary differs between webhooks and Event History filters (docs)

- **Task attempted:** Use one list of motion subtypes for both webhooks and Event History filters.
- **Steps taken:** Compared the "Motion Detection" `sub_type` table with the Event History "Event types" table on the same reference page.
- **Expected:** One vocabulary.
- **Actual:** Webhooks list `human`, `vehicle`, `package_delivery` and `other_motion` (plus `motion` when Smart Alerts is off). The Event History filter table lists `motion.human`, `motion.vehicle`, `motion.animal` and `motion.other_motion`: it adds `animal` and leaves out `package_delivery`, the subtype a delivery app depends on most.
- **Severity:** Low (documentation), but it affects which filters a client dares to send.
- **Workaround used:** Query the union of both lists (5 filters) and treat the vocabulary as open-ended. [[FILL: after `npm run probe`, note whether `motion.package_delivery` and `motion.animal` returned events in the Playground]]
- **Suggestion:** Publish one subtype table and link to it from both places.

---

## Open Source mini challenge

| Field | Value |
|---|---|
| Contribution URL | https://github.com/pswapnajit/ring-partner-kit |
| Project repository URL | https://github.com/pswapnajit/porchlight |
| GitHub username | pswapnajit |

**What I did.** I built and released `ring-partner-kit`, a new MIT-licensed TypeScript toolkit for the Ring Partner API, during the hackathon. It is the layer Porchlight runs on, published as its own repository with history (split from `packages/ring-partner-kit` in the Porchlight monorepo).

**How it works.**
- **`RingClient`:** typed, zero-dependency (Node 22 `fetch`). Device discovery with `include=` and JSON:API compound-document resolution, Event History with composite filters and safe pagination (stops on empty pages and repeated cursors, see F3), snapshots (handles the 303 to a pre-signed URL), clip download, chime playback, WHEP live view, token refresh, and typed `RingApiError`s with retry hints.
- **Webhooks:** HMAC-SHA256 `X-Signature` verification over the raw body in constant time, a `meta.request_id` idempotency store, and typed payloads including `sub_type`, `button_press`, and contact and temperature sensor events.
- **Helpers:** sensor and chime capability parsing, device-kind guessing (Ring has no type field), and a pure-TypeScript PNG decoder and encoder that blacks out Ring privacy zones before an image is used.
- **A contract-faithful simulator** (`ring-partner-kit/sim`, also runnable as `npm run sim`). It serves the same REST shapes, sends signed webhooks, keeps Event History, renders porch snapshots with privacy zones, and has a controllable clock. Apps can be developed and tested without a device and without webhook access (see F1).
- **28 tests** run with `node --test` and no dependencies.

**Why it matters.** The official sample verifies webhooks the wrong way (F4) and drops event types (F5), the Playground has no webhooks (F1), and pagination loops forever if you follow the docs (F3). Every Ring developer hits these problems in their first week. `ring-partner-kit` fixes them in one import and gives developers a local Ring to test against, so their first week can go into the app itself.

[[OPTIONAL: if you also open the hello-world PR (F4 and F5), add it here as a second contribution: "Pull request to AmazonAppDev/ring-api-helloworld: verify X-Signature HMAC over the raw body and cover all documented webhook event types."]]

---

## AWS Builder mini challenge (for the Product Feedback answer)

- **Amazon Bedrock, Converse API** (`@aws-sdk/client-bedrock-runtime`): image plus text input to Amazon Nova Lite for the porch vision check, with a strict JSON contract and a confidence guardrail that falls back to "ask a person"; Amazon Nova Pro for the evening note from structured facts. Code: `apps/porchlight/src/ai/bedrock.ts`, `vision.ts`, `digest.ts`.
- **Strands Agents SDK** (`@strands-agents/sdk`, TypeScript): the "Ask Porchlight" agent on `BedrockModel` with six tools, including one that triggers a live Ring snapshot and vision check. Code: `apps/porchlight/src/ai/agent.ts`. The same agent answers Alexa+ questions through the MCP `ask` tool.
- **Pipeline:** Ring classification (free, stage 0) → timer → Ring snapshot → privacy mask → Bedrock vision (once per decision) → deterministic ladder. The model never decides who gets told.

---

## Submission checklist

- [ ] Both GitHub repos public, with the MIT license detected in the About section
- [ ] `npm run probe` and `npm start` work with a fresh Playground token; fill in the live `[[FILL]]` items above
- [ ] Bedrock key added, so the video shows real Bedrock output (porch check and Ask Porchlight)
- [ ] Video recorded per the script, under 3:00, uploaded **public** to YouTube or Vimeo, with no copyrighted music
- [ ] Devpost form: description, video URL, repo URL, tracks (Ring, Alexa+), mini challenges (AWS Builder, Open Source), product feedback, Open Source fields, feature requests, friction log
- [ ] Screenshots in the Devpost gallery: `docs/screenshots/family.png`, `all-clear.png`, `home.png`, `alexa.png`, `scenes.png`
- [ ] Submit before **Fri 23 Oct 2026 12:00 PT**

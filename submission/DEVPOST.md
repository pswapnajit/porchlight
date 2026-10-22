# Porchlight: Devpost submission

Everything needed for the "Enter a Submission" form at amazonappdev2026.devpost.com, in form order. Deadline: **Friday 23 October 2026, 12:00 PT (Saturday 24 October, 00:30 IST)**.

Before submitting, replace every `[[FILL: …]]` (search the file for `[[`). They are the only things this file cannot know yet: the video URL, and numbers from the first live Ring Playground and Bedrock run.

---

## Quick fields

| Field | Value |
|---|---|
| Project name | Porchlight |
| Elevator pitch (≤200 chars) | Ring tells you when something happens. Porchlight notices when something doesn't: gentle, learned check-ins for a parent living alone, using the Ring devices already at their door. |
| Primary track(s) | **Ring** (main). Also eligible for **Alexa+** (self-hosted MCP server, spec 2025-11-25, Streamable HTTP) and **Fire TV** (native Fire OS app in Kotlin and Compose for TV, run on the Android TV emulator, which the FAQ accepts). A project can win only one track prize. |
| Mini challenge(s) | **AWS Builder** (Amazon Bedrock Converse API + Strands Agents SDK). **Open Source** (`ring-partner-kit`, MIT). |
| Code repository | https://github.com/pswapnajit/porchlight (public, MIT, license shown in the About section) |
| Demo video | [[FILL: YouTube or Vimeo URL, public, under 3:00]] |
| Built with | ring-partner-api, ring-developer-playground, amazon-bedrock, amazon-nova, strands-agents, model-context-protocol, mcp-apps, alexa-plus, fire-tv, fire-os, kotlin, jetpack-compose, compose-for-tv, node.js, typescript, webrtc, whep |
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

**Rose's TV (Fire TV):** most older parents already watch TV every day, so Porchlight also lives there. On the Fire TV, Rose sees a large clock, a greeting and today's care visit, with the same promise as her home screen: the family can't see inside her home. When Porchlight checks in, one calm card fills the screen and is read aloud, with one big button ("I'm OK", or "I brought it in"), and a press of OK on the remote answers it. When the doorbell rings, the TV shows the privacy-masked Ring snapshot and who the care schedule says is due, such as "Ana (home aide) is due at 10:00 AM". That comes from the schedule, never from recognizing a face.

### Privacy and dignity by design

- **Nothing inside the home is ever viewed.** Indoor cameras contribute only "there was movement at 7:41".
- **Snapshots are taken only when a decision depends on one**, or when the doorbell rings so Rose's own TV can show who is there, and only from the front door. A doorbell snapshot is never sent to a model. Ring privacy zones from `configurations` are blacked out before any model or person sees the image. Cameras with end-to-end encryption are skipped, and Porchlight asks a person instead.
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

**Fire TV app:** `apps/porchlight-tv` is a native Fire OS app in Kotlin with Jetpack Compose for TV (`androidx.tv:tv-material`), modelled on Amazon's `hello-world-fire-tv` sample. It is another client of the same server: `GET /api/state`, the `/api/events` server-sent event stream, `POST /api/resident/ok` and `/api/resident/package-inside`, and `/api/snapshots/:id` for the doorbell picture. Read-aloud uses Android `TextToSpeech`, and the network code is plain `HttpURLConnection` with no Google Play Services. It follows the Fire OS manifest rules (`LEANBACK_LAUNCHER`, leanback and touchscreen not required, a 320×180 banner, minSdk 28 for Fire OS 7), with large type, WCAG AA contrast and a focus state you can see from the sofa, with no zoom or glow.

**A contract-faithful Ring simulator** in `ring-partner-kit` serves the same REST shapes, signs real HMAC webhooks and renders porch snapshots. The five scripted demo days run through it end to end.

**Tests:** 41 (`npm test`), covering the SDK, the rules engine, end-to-end scenarios over HTTP and the MCP endpoint.

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
- On Fire TV, a check-in only appears while Porchlight TV is open (it is the ambient screen). Next: interrupt whatever is playing, as a Fire TV notification or picture-in-picture card, so Rose sees it during a show.
- Publishing on the Ring Appstore.

*Porchlight is not an emergency service or a medical device. It notices absence and asks people to check.*

---

## Demo video (2:44)

The video is built from real captures of Porchlight: the web app in headless Chrome, the Fire TV app on the Android TV emulator, and a screen recording of the Ring Developer Playground. The voice-over is mine.

| Time | On screen | Voice-over |
|---|---|---|
| **0:00** | Title card, then the family dashboard on the heat day | "Ring tells you when something happens. Porchlight notices when something doesn't. Rose is 78, and lives alone. Every day, her daughter Maria wonders: is Mom up and about?" |
| **0:14** | "What Porchlight learned" card and the Today timeline | "Porchlight uses Rose's own Ring devices. From four weeks of Ring event history, it learned her day. She's usually up between 7:31 and 8:23, so if there's no sign of her by 9:10, it checks in." |
| **0:31** | Behind the scenes: "A package in the heat" plays; Ring API calls and signed webhooks arrive; the package check-in with the privacy-masked snapshot | "Here's a hot afternoon. A delivery arrives, and Ring itself classifies it as a package. Every event arrives as a signed webhook. The package starts a timer, shorter today because it's 31 degrees inside. When it runs out, Porchlight takes a doorbell snapshot, blacks out the privacy zones, and checks: is the box still there? It is. So Porchlight checks in with Rose first." |
| **1:01** | Fire TV (Android TV emulator): the check-in card, OK on the remote, "Thank you, Rose."; Maria's "All clear"; then the doorbell card | "Rose doesn't need a tablet. Porchlight is on the Fire TV she already watches: one calm card, read aloud, and one button. She presses OK on the remote, and Maria gets an all clear. When the doorbell rings, the TV shows the porch, and who's due." |
| **1:22** | "A quiet morning": the ladder climbs, Maria taps "I'm on it" | "If Rose doesn't answer, the ladder climbs: a chime, a text, then Maria. One tap of 'I'm on it' stops everyone else being woken. Who gets told is never a model's decision. The rules are deterministic, and tested." |
| **1:41** | Alexa+ tab: "how Mom's doing" with the MCP Apps card and MCP traffic; then Rose answers by voice | "Maria can just ask Alexa. Porchlight is a self-hosted MCP server, built to the November 2025 spec, and this page is a real MCP client, with an MCP Apps card for screens. And Rose can answer a check-in by voice." |
| **2:01** | The Ring Developer Playground streams its "package" scenario; Porchlight, live against `api.amazonvision.com`, logs the live views from Event History and shows the real snapshot it pulled from that camera | "This is the live Ring API. In the Ring Developer Playground, I open the package live stream. The Playground has no webhooks, so Porchlight polls event history, sees the live view, and pulls a real snapshot from the same camera." |
| **2:20** | `npm test` (41 passing), then both repo URLs | "Everything talks to Ring through ring-partner-kit: a typed, zero-dependency client with signed webhooks, privacy masking, and a full Ring simulator. It's open source, with 41 tests across the project." |
| **2:38** | Rose's TV, ambient; closing card | "Porchlight. It never looks inside. It just notices." |

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

**Onboarding (zero to hello world).** The API reference is thorough, and the Playground token gets you to a first `GET /v1/devices` in minutes with no device and no app registration. The slow part was everything event-driven: without webhooks in the Playground, and with a hello-world sample that verifies webhooks the wrong way, I wrote the webhook layer from the reference and built a local simulator to test against. From a fresh Playground token to the first live device list (`npm run probe`) took about five minutes.

**Would I build with it again?** **Yes.** Ring devices are already in millions of homes, and the API exposes exactly the signals a non-security app needs (classified events, history and privacy settings) without ever needing to look inside the home. Fixing F1–F3 would make it the easiest home-sensing platform I know of to build on.

### 2. Ring Developer Playground

**What I used and for what.** Playground tokens for live mode (`npm run probe`, `npm start`): real device discovery ("Playground Device", a front-door camera), Event History polling, image snapshots, and the scenario live streams (such as "Live Stream: package") to drive Porchlight end to end without hardware.

**What worked well.** No device and no app registration: generate a token and call the real API. Opening a scenario live stream creates a real `on_demand` event in Event History, which Porchlight picked up on its next 15-second poll. While a stream is playing, `POST …/media/image/download` returns a real frame from it (the package on the porch, watermarked "Partner: RingDeveloperPortalPlayground"). The page also shows the exact WHEP request and response for each stream, which is a great reference.

**What needs work.**
- No webhook delivery, so event-driven apps must be rewritten as pollers to use it (friction F1).
- Tokens last about 30 minutes, which interrupts longer test sessions and demo recordings. A refresh flow, or a longer-lived sandbox token, would help.
- Scenario streams are recorded as `on_demand` (live view) events, not as `motion_detected` with a `sub_type`. So an app that reacts to Ring's classification (`package_delivery`, `human`) can't be tested in the Playground at all (friction F11).
- Event History in the Playground ignores the `event_types` filter (friction F10).
- Snapshots only work while a stream is playing. Otherwise the download fails with `422 GRECO_NO_VALID_KEY`, and a range that starts before the token was issued fails with `403 TIME_RANGE_NOT_AUTHORIZED` (friction F12).
- Cameras only, so sensor and chime features (Early Access) can't be tested.

**Onboarding.** Fastest part of the whole stack: about a minute from the console to a working token.

**Would I build with it again?** **Yes.** It is the right idea, a zero-hardware sandbox against the real API. With webhook delivery and classified test events, it would cover the whole development loop.

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

**What needs work.** I built the integration to the documented Converse request and response shapes and tested the guardrail on sample model replies (valid JSON, low confidence, "unsure", prose, fenced JSON). I did not have Bedrock access during the hackathon, so latency and output quality are untested. One wish: a built-in JSON-schema response mode for Converse across models, so the strict-JSON contract doesn't need prompt engineering and a parser.

**Onboarding.** The Converse API reference and the Bedrock API key flow are short and clear. Wiring image plus text into one request took minutes; the strict-JSON guardrail took longer.

**Would I build with it again?** **Yes.** Choosing a model is a config line, and a Bedrock API key makes it practical for a small team.

### 4. Strands Agents SDK (TypeScript)

**What I used and for what.** `Agent`, `BedrockModel` and `tool` from `@strands-agents/sdk` for "Ask Porchlight": six tools with zod input schemas over Porchlight's records and the live Ring camera, a system prompt that forbids guessing, and a `toolsUsed` trace returned to the UI.

**What worked well.**
- Tools are plain functions with zod schemas, the same shape as tools in the MCP SDK, so Porchlight's capabilities are described one way for both the agent and Alexa+.
- `BedrockModel` takes the Bedrock API key directly, so there is no separate credential plumbing.
- The agent loop (choose a tool, call it, answer) needed no glue code.

**What needs work.** Without Bedrock access I exercised the agent's tools directly, not end to end through a model. Requests: a documented way to cap tool calls per turn, and a first-class "answer only from tools" mode for grounded assistants.

**Onboarding.** Install, define one tool, and call `agent.invoke` (or the equivalent) quickly. The TypeScript docs are thinner than the Python ones.

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

### 6. Fire TV: Fire OS on the Android TV emulator, Compose for TV, and the `hello-world-fire-tv` sample

**What I used and for what.** `apps/porchlight-tv`, a native Fire OS app for the parent's TV: Kotlin, Jetpack Compose for TV (`androidx.tv:tv-material` 1.1.0), Android `TextToSpeech` for read-aloud, and plain `HttpURLConnection` plus `org.json` for Porchlight's REST API and server-sent events, so it needs no Google Play Services. The manifest and app structure follow Amazon's `hello-world-fire-tv` sample. I ran it on the Android TV emulator (API 34, arm64), which the hackathon FAQ accepts for this track, against the same demo server, and drove the remote with `adb shell input keyevent`.

**What worked well.**
- Compose for TV's `Button` handles the remote for you: OK on the D-pad is a click, with no key handling of my own. Per-state colors and borders (`ButtonDefaults.colors`, `ButtonDefaults.border`) gave a focus state you can see from the sofa, and `ButtonDefaults.scale(focusedScale = 1f)` turned off the zoom, which matters for viewers who find motion distracting.
- The Fire TV manifest rules are short, and the sample shows them: `LEANBACK_LAUNCHER`, leanback and touchscreen not required, a banner.
- Fire OS is Android, so everything else was standard Android: the server client, text-to-speech, focus. Only the manifest is Fire-specific, which made the TV a thin client of the server Porchlight already had.
- `adb shell input keyevent KEYCODE_DPAD_CENTER` and `adb exec-out screencap -p` made the remote flow scriptable, so "press OK and the check-in resolves" could be checked against `/api/state` instead of by eye.

**What needs work.**
- There is no Fire OS emulator image (friction F7): `sdkmanager` lists only Android TV and Google TV images. The Android TV emulator can't show Fire-specific behavior: how the Fire TV launcher shows the app and its banner, VoiceView, and Amazon's own text-to-speech engine. Read-aloud did work there: the Android TV image ships Google's TTS engine (the phone image I tried first had none, so the app logs that and still shows the card).
- Initial focus on a screen change can leave a `tv-material` button focused but drawn unfocused (friction F9). On a remote that is the whole interaction, so it deserves a line in the focus guidance.
- The `hello-world-fire-tv` sample is pinned to AGP 8.2.2, Kotlin 1.9.0, Compose BOM 2023.08 and `tv-foundation` 1.0.0-alpha11, and configures Compose with `composeOptions { kotlinCompilerExtensionVersion }`, the setup from before Kotlin 2.0, so I took the manifest and structure from it but not the build files (friction F8). It also uses the square launcher icon as the TV banner, so it doesn't show what a 320×180 banner should look like.

**Onboarding.** Reading the sample and writing the manifest took minutes. Most of the time went into the emulator: a 777 MB Android TV system image, with no Fire OS image to choose instead.

**Would I build with it again?** **Yes.** The TV is the screen most older parents already use every day, and a Fire TV app is ordinary Android with Compose, so the parent's screen moved onto the TV in a day. A Fire OS emulator image would let developers check the Fire-specific parts before buying a device.

### Feature requests (optional)

| Request | Why it matters to Porchlight | Priority |
|---|---|---|
| Webhook delivery from the Developer Playground (signed with a sandbox HMAC key) | Event-driven apps could be tested end to end without app registration; today they must be rewritten as pollers | **Critical** |
| `attributes.sub_type` on Event History events | Learning a routine from history needs to tell a delivery from a person; today it costs 6 calls per camera per poll | **Important** |
| Omit `links.next` on the last or empty page (or document an end sentinel) | Prevents infinite pagination loops and wasted rate limit | **Important** |
| A device type or placement hint (doorbell, indoor, outdoor) in device attributes | Caretaking logic depends on "front door" vs "indoor", which can only be guessed from capabilities now | Nice-to-have |
| Expose whether Smart Alerts is on (the docs say no API does) | Lets an app tell "no classification" from "nothing classified" and prompt the user to turn it on | Nice-to-have |
| Sensor and chime devices in the Playground | Lets Early Access features (door sensor, temperature, chimes) be tested without hardware | Important |
| A Fire OS emulator system image (Fire TV launcher, VoiceView, Amazon text-to-speech) | Fire TV apps are tested on Google's Android TV emulator today, so Fire-specific behavior can't be checked without a device | Important |

---

## Friction log (bonus: up to 10%)

Severity: **High** blocks or silently breaks a common path; **Medium** costs real time or calls but has a workaround; **Low** is a paper cut.

### F1. The Developer Playground doesn't deliver webhooks

- **Task attempted:** Run Porchlight's real-time path (motion, package and button events) against the live Ring API without hardware.
- **Steps taken:** Generated a Playground token. Ran `npm start` against `api.amazonvision.com`. Opened the Playground's scenario live streams. Looked for a place to register a webhook URL.
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
- **Suggestion:** Read the raw body (`await request.arrayBuffer()`), verify `X-Signature` with the HMAC signing key in constant time, then parse. Rename the variable to `RING_HMAC_SIGNING_KEY` to match the console.
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
- **Workaround used:** Query the union of both lists (5 filters) and treat the vocabulary as open-ended. In the Playground both filters were accepted, but the answer can't be trusted there, because it ignores filters altogether (F10).
- **Suggestion:** Publish one subtype table and link to it from both places.

### F7. There is no Fire OS emulator image

- **Task attempted:** Test Porchlight TV, the Fire OS app for the parent's TV, without a Fire TV device.
- **Steps taken:** Listed system images with `sdkmanager --list`, looking for a Fire OS or Amazon image. Then installed `system-images;android-34;android-tv;arm64-v8a` and created a 1080p TV AVD on an M1 Mac.
- **Expected:** A Fire OS image (or an Amazon-hosted SDK add-on) that runs the Fire TV launcher, so the banner, launch behavior, VoiceView and Amazon's text-to-speech can be checked before buying a device.
- **Actual:** `sdkmanager` lists only Google's `android-tv` and `google-tv` images, with no Fire, Amazon or Vega entry. The Android TV emulator runs the app, which the hackathon FAQ accepts, but it shows Google's launcher, Google's TTS engine and Google promos: after one reinstall, the Google TV launcher came back in front of the app with a "Play Movies is becoming Shop" dialog, and the app had to be relaunched. The image also unpacks to 8.6 GB on disk, which is a lot for an 8 GB, nearly full laptop.
- **Severity:** Medium. Fire-specific behavior can't be verified without hardware, and every Fire TV developer tests on someone else's launcher.
- **Workaround used:** Built to the Fire OS manifest rules from Amazon's sample (`LEANBACK_LAUNCHER`, leanback and touchscreen not required, a 320×180 banner, minSdk 28, no Google Play Services), ran on the Android TV emulator, and drove the remote with `adb shell input keyevent` against the live demo server.
- **Suggestion:** Publish a Fire OS system image for the Android emulator (as an SDK add-on site that `sdkmanager` can use), and document which Fire behaviors the Android TV emulator cannot reproduce.

### F8. The `hello-world-fire-tv` sample is pinned to a 2023-era Android toolchain

- **Task attempted:** Start Porchlight TV from Amazon's native Fire TV sample (`AmazonAppDev/hello-world-fire-tv`, last commit 10 October 2024).
- **Steps taken:** Read its Gradle files and manifest to reuse the build setup with the current Android SDK (build-tools 36, Kotlin 2.x).
- **Expected:** A sample that builds with the current toolchain, so it can be copied as is.
- **Actual:** It pins AGP 8.2.2, Kotlin 1.9.0, `composeOptions { kotlinCompilerExtensionVersion = "1.5.1" }` (the Compose setup from before Kotlin 2.0's Compose compiler plugin), Compose BOM 2023.08.00 and `androidx.tv:tv-foundation:1.0.0-alpha11`. The manifest also uses the square launcher icon as the TV banner (`android:banner="@mipmap/ic_launcher"`), so it doesn't show what a 320×180 Fire TV banner should look like.
- **Severity:** Low. Copying the sample's build files means downgrading Kotlin or migrating the build first.
- **Workaround used:** Took the manifest and app structure from the sample and wrote fresh build files (AGP 9, Kotlin 2.4 with the Compose compiler plugin, Compose BOM 2026.06, `tv-material` 1.1.0), plus a real 320×180 banner.
- **Suggestion:** Move the sample to the Kotlin 2 Compose compiler plugin and stable `tv-material`, add a proper banner, and pin it in CI so it keeps building.
- Link: https://github.com/AmazonAppDev/hello-world-fire-tv/blob/50108f4fc4a9dc054be86d851286355df027524a/build.gradle.kts

### F9. A TV button can be focused but drawn unfocused when focus is requested as a screen appears

- **Task attempted:** When a check-in arrives, put remote focus on its one button ("I'm OK" or "I brought it in"), so the first press of OK answers it.
- **Steps taken:** Used `FocusRequester.requestFocus()` in a `LaunchedEffect` when the card appears, the usual Compose pattern, with `tv-material` `Button` and per-state `ButtonDefaults.colors`/`border`.
- **Expected:** The button is focused and shows its focused style.
- **Actual:** The UI tree reported the button `focused="true"`, and OK did press it, but it was drawn in its unfocused style when the screen switched from the ambient clock to a check-in. On a TV that is the one cue telling an older viewer what OK will do. The button's look comes from its interaction stream, and the fix below suggests focus arrived before that stream was being collected.
- **Severity:** Medium for TV apps: nothing errors, and the focus state is the whole interaction model on a remote.
- **Workaround used:** Drive the button's colors and border from `Modifier.onFocusChanged`, which always reports the current state (`apps/porchlight-tv/.../ui/Screens.kt`, `PorchButton`).
- **Suggestion:** Cover initial focus on screen changes in the Fire TV focus guidance (`vega-tv-interfaces-sample` already covers focus for Vega), with this pattern, and use it in the samples.

### F10. The Developer Playground ignores the `event_types` filter on Event History

- **Task attempted:** Classify Playground events the way Porchlight classifies production history: one unfiltered query, then one query per composite filter.
- **Steps taken:** With two events in the Playground camera's history (both `on_demand`, from scenario streams), called `GET /v1/history/devices/{id}/events` with `event_types=motion`, `motion.package_delivery`, `ding` and `on_demand`.
- **Expected:** Only `on_demand` returns the two events; the other filters return nothing.
- **Actual:** Every filter returned the same two `on_demand` events.
- **Severity:** Medium. Filter-based logic (and F2's workaround for the missing `sub_type`) silently mislabels events in the sandbox, so it can't be tested there.
- **Workaround used:** Porchlight keys on each event's own `event_type` first, and only uses the filter that returned it to fill in a motion `sub_type`, so the stray `on_demand` events still read as live views ("Live view opened in the Ring app at 5:00 PM").
- **Suggestion:** Apply `event_types` in the Playground exactly as in production.

### F11. Playground scenario streams can't produce classified events

- **Task attempted:** Drive Porchlight's package flow (Ring's `package_delivery` classification starts a timer) from the Playground.
- **Steps taken:** Opened "Live Stream: package" in the Playground, watched it play, then read Event History.
- **Expected:** The package scenario produces a `motion` event with `sub_type` `package_delivery` (and a webhook, see F1), like a real doorbell would.
- **Actual:** It produces only an `on_demand` (live view) event. There is no way to create a classified motion event, a doorbell press or a sensor event in the Playground.
- **Severity:** Medium. The most valuable part of the API for a non-security app, Ring's own classification, can only be exercised against a self-built simulator.
- **Workaround used:** The full flow runs against `ring-partner-kit`'s simulator; the video shows the Playground part honestly as a live view plus a real snapshot.
- **Suggestion:** Give each scenario stream a matching event (`motion_detected` with `sub_type`, written to Event History and sent as a webhook), plus buttons for `button_press` and the sensor events.

### F12. Playground snapshots work only while a stream is playing

- **Task attempted:** Take a porch snapshot with `POST /v1/devices/{id}/media/image/download`, as Porchlight does before every package check.
- **Steps taken:** `latest_in_range` with PNG output: first with a range starting 23 hours back, then with a recent range, both with and without a scenario stream playing.
- **Expected:** The latest frame, or a clear "no media in range" error.
- **Actual:** A range starting before the token was issued fails with `403 TIME_RANGE_NOT_AUTHORIZED` (reasonable, but not in the snapshot docs). With a recent range, it worked once, 19 seconds after a stream (the 303 redirect led to a real PNG); every later attempt redirected to a pre-signed URL that returned `422 GRECO_NO_VALID_KEY`.
- **Severity:** Medium. The error code doesn't say what's wrong, and the same call flips between working and failing.
- **Workaround used:** Porchlight treats a failed snapshot as "ask a person", never as "the porch is clear", and shows the error.
- **Suggestion:** Document that Playground snapshots need an active scenario stream, and return a 404-style "no media in range" instead of `GRECO_NO_VALID_KEY`.

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


---

## AWS Builder mini challenge (for the Product Feedback answer)

- **Amazon Bedrock, Converse API** (`@aws-sdk/client-bedrock-runtime`): image plus text input to Amazon Nova Lite for the porch vision check, with a strict JSON contract and a confidence guardrail that falls back to "ask a person"; Amazon Nova Pro for the evening note from structured facts. Code: `apps/porchlight/src/ai/bedrock.ts`, `vision.ts`, `digest.ts`.
- **Strands Agents SDK** (`@strands-agents/sdk`, TypeScript): the "Ask Porchlight" agent on `BedrockModel` with six tools, including one that triggers a live Ring snapshot and vision check. Code: `apps/porchlight/src/ai/agent.ts`. The same agent answers Alexa+ questions through the MCP `ask` tool.
- **Pipeline:** Ring classification (free, stage 0) → timer → Ring snapshot → privacy mask → Bedrock vision (once per decision) → deterministic ladder. The model never decides who gets told.
- **Auth and fallback:** a Bedrock API key (`AWS_BEARER_TOKEN_BEDROCK`) or standard AWS credentials; without either, each feature falls back to clearly labeled offline behavior. I didn't have Bedrock access during the hackathon, so the demo video runs that offline path.

---

## Submission checklist

- [ ] Both GitHub repos public, with the MIT license detected in the About section
- [ ] `npm run probe` and `npm start` work with a fresh Playground token; fill in the live `[[FILL]]` items above
- [ ] Bedrock key added, so the video shows real Bedrock output (porch check and Ask Porchlight)
- [ ] Video recorded per the script, under 3:00, uploaded **public** to YouTube or Vimeo, with no copyrighted music
- [ ] Devpost form: description, video URL, repo URL, tracks (Ring, Alexa+, Fire TV), mini challenges (AWS Builder, Open Source), product feedback, Open Source fields, feature requests, friction log
- [ ] Screenshots in the Devpost gallery: `docs/screenshots/family.png`, `all-clear.png`, `home.png`, `alexa.png`, `scenes.png`, `tv-checkin.png`, `tv-ambient.png`, `tv-visitor.png`, `tv-thanks.png`, `tv-checkin.png`, `tv-ambient.png`, `tv-visitor.png`
- [ ] Submit before **Fri 23 Oct 2026 12:00 PT**

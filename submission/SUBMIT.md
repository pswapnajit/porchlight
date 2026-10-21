# Submitting Porchlight: the complete process

**Deadline: Saturday 24 October 2026, 00:30 IST** (Friday 23 October, 12:00 PT). Aim to press Submit by **Friday 23 October, 21:00 IST**, which leaves 3½ hours for surprises. Devpost lets you edit the entry until the deadline, so submit early and polish afterwards.

Everything you paste into the form is in [`DEVPOST.md`](DEVPOST.md). This file is the order to do it in.

## Where things stand

| | Status |
|---|---|
| Code: web app, Ring engine, Alexa+ MCP server, Fire TV app, `ring-partner-kit` | ✅ Done. 41 tests pass. Fire TV checked on the Android TV emulator. |
| Public repos | ✅ [pswapnajit/porchlight](https://github.com/pswapnajit/porchlight) and [pswapnajit/ring-partner-kit](https://github.com/pswapnajit/ring-partner-kit), both MIT. The latest commits (Fire TV and fixes) are local until you OK a push. |
| Devpost text, feedback, friction log (F1–F9), Open Source fields | ✅ Written. 11 `[[FILL]]` markers wait for the live run and the video URL. |
| Screenshots and thumbnail | ✅ `docs/screenshots/` |
| Live Ring Playground run | ⏳ Needs your token (step 1) |
| Live Bedrock run | ⏳ Needs your Bedrock API key (step 1), optional but strongly recommended |
| Video | ⏳ You record (step 3) |
| YouTube and the Devpost form | ⏳ You (steps 4–5) |

## Timeline

| When (IST) | Step | Who | Time |
|---|---|---|---|
| Thu 22 Oct, morning | 1. Keys and live run | You (10 min), then me | 40 min |
| Thu 22 Oct | 2. Push the latest commits | Me, after your OK | 2 min |
| Thu 22 Oct, afternoon | 3. Record the video | You | 2–3 h |
| Thu 22 or Fri 23 Oct | 4. Upload to YouTube | You | 15 min |
| Fri 23 Oct, by 21:00 | 5. Fill and submit the Devpost form | You | 45 min |
| After submitting | 6. Check the entry | You | 10 min |

---

## 1. Keys and the live run

### a. Ring Developer Playground token (required: the Ring video must show the Playground)

1. Open https://developer.amazon.com/ring/console/playground and sign in.
2. Click **Generate Token** and copy it.
3. In `~/Documents/Experiment/amazon/.env`, set `RING_ACCESS_TOKEN=<the token>`. No quotes, and never paste it into a chat.
4. Tell me "token is in". I'll run `npm run probe` and `npm start`, then fill the Ring `[[FILL]]`s in `DEVPOST.md` from what really happens.

The token lasts **about 30 minutes**. Generate a new one right before you record segment 7 of the video.

### b. Amazon Bedrock API key (recommended, for the AWS Builder mini challenge)

1. In the AWS console, switch to **US East (N. Virginia), us-east-1**, open **Amazon Bedrock → API keys**, and create a key.
2. If Bedrock asks for model access, enable **Amazon Nova Lite** and **Amazon Nova Pro**.
3. In `.env`, set `AWS_BEARER_TOKEN_BEDROCK=<the key>`.
4. Tell me "Bedrock is in". I'll run the porch check, the evening note and "Ask Porchlight" for real, and fill the Bedrock and Strands `[[FILL]]`s.

Cost: a few cents for the whole hackathon, because the vision model runs once per decision, not per motion event. Delete the key after judging ends (20 November).

**If you skip Bedrock:** tell me, and I'll replace those `[[FILL]]`s with honest wording (the integration is written and documented but wasn't exercised live). The AWS Builder entry will be weaker, so getting the key is worth 10 minutes.

## 2. Push the latest commits

The Fire TV app and today's fixes are committed locally but not on GitHub yet. Judges only see what's pushed. Say "push" and I'll push `main` (the `ring-partner-kit` repo is unchanged). Then open both repo pages in a private window to confirm they're public and the About box shows **MIT license**.

## 3. Record the video

The script is in `DEVPOST.md` → **Demo video script (2:45)**. It must run under 3:00, in English. Keep in mind:

- **No copyrighted music.** Use no music, or royalty-free music you have rights to.
- **No third-party trademarks.** Never show the Google TV launcher behind the TV app, and show code in the terminal, not on github.com. Amazon, Ring and Alexa are the sponsor's own marks and are fine.
- **Segment 7 (the Ring Developer Playground) is required** for the Ring track.
- **The Fire TV segment must show the app running on the TV emulator** for the Fire TV track.

### Set up (about 15 minutes)

Terminal 1, the simulated household, used for most segments:
```bash
cd ~/Documents/Experiment/amazon && npm run demo
```

Terminal 2, the TV emulator with a window, so you can screen-record it:
```bash
~/Library/Android/sdk/emulator/emulator -avd porchlight_tv -no-snapshot -no-boot-anim &
```
Once the TV home screen appears:
```bash
~/Library/Android/sdk/platform-tools/adb shell am start -n io.github.pswapnajit.porchlight.tv/.MainActivity
```
If Google's launcher or a promo dialog ever comes to the front, press Back and run the `am start` line again. Don't record the launcher.

Browser: http://localhost:4000 in a window about 1440×900, at 100% zoom, with bookmarks and other tabs hidden.

For segment 7 only, with a fresh Playground token in `.env`, in Terminal 3:
```bash
cd ~/Documents/Experiment/amazon && PORT=4001 npm start
```
Then open http://localhost:4001 next to the Ring Developer Playground tab.

Close the TV emulator before segment 7 if the Mac feels slow (8 GB RAM).

### Record (about 1–1½ hours)

Record each segment as its own clip with **⌘⇧5 → Record Selected Portion**. Set Options → Microphone to "None" if you'll add the voice afterwards, or to the built-in mic to talk while you record.

| Segment | What to do on screen |
|---|---|
| 1 Hook (0:00–0:12) | Family tab during "A package in the heat", paused at about 1:44 PM: open check-ins and Maria's phone. |
| 2 Learned day (0:12–0:25) | Scroll to **What Porchlight learned**. Read the two times on the card and say those in the voice-over (the script has them in brackets). |
| 3 Package in the heat (0:25–1:00) | **Behind the scenes → Play "A package in the heat"**, set 240× in the bottom bar. Show the webhooks list filling, then the check-in card with the masked snapshot. |
| 4 Fire TV (1:00–1:20) | The TV emulator window shows the delivery check-in (read aloud). Press **Enter** in the emulator window (the remote's OK) and it shows "Thank you, Rose." Cut to the Family tab: resolved, "All clear". For the doorbell card, play "The aide can't get in" and record the TV at 10:00. |
| 5 Ladder (1:20–1:35) | Play **"A quiet morning"**. Use **Skip ahead** until Maria is alerted, then click **I'm on it**. |
| 6 Alexa+ (1:35–1:57) | **Alexa+** tab: click the chip "Alexa, ask Porchlight how Mom's doing", show the card and the MCP traffic, then the chip "(Rose) Alexa, tell Porchlight I'm OK". |
| 7 Live Ring (1:57–2:27) | Ring Developer Playground: simulate a **Package** event on the camera. In Porchlight on :4001, **Behind the scenes** shows the Event History calls to `api.amazonvision.com`, and the event lands on the timeline (polling every 15 s, so wait for it). |
| 8 Open source (2:27–2:40) | Terminal: `npm test` (41 pass), then a title card with both repo URLs (a Keynote slide works). |
| 9 Close (2:40–2:45) | The TV's ambient screen with the privacy line. |

### Voice-over and assembly (about 45 minutes)

1. Read the voice-over column of the script at a calm pace, one segment at a time. QuickTime → **File → New Audio Recording**, or Voice Memos, works.
2. Assemble in **iMovie** (free on the Mac): New Movie, drop the clips in order, add the narration, trim each clip to its segment, then **File → Share → File** at 1080p.
3. Check that it runs **under 3:00**: aim for 2:45.

**Or let me assemble it:** put the clips (`seg1.mov` … `seg9.mov`) and your narration in one folder and tell me where. I'll cut them to the script with ffmpeg and give you the MP4.

## 4. Upload to YouTube

1. https://studio.youtube.com → **Create → Upload videos**.
2. **Title:** `Porchlight: gentle check-ins for a parent living alone (Ring, Alexa+, Fire TV)`
3. **Description:**
   ```
   Porchlight notices when something doesn't happen. It learns an older parent's ordinary day from the Ring devices already at their door and checks in gently: first with them (chime, Fire TV, Alexa+), then with family.

   Built for the Amazon Developer Hackathon "Build, Ship, Shape" (Ring track, plus Alexa+ and Fire TV).
   Code: https://github.com/pswapnajit/porchlight
   Open-source Ring toolkit: https://github.com/pswapnajit/ring-partner-kit
   ```
4. Set **No, it's not made for kids**. Set visibility to **Public**: the rules say "publicly visible", so don't use Unlisted or Private.
5. Copy the video URL. Tell me, and I'll put it into `DEVPOST.md` (the last `[[FILL]]`), or replace it yourself.

## 5. Fill and submit the Devpost form

Go to **https://devpost.com/submit-to/30992-build-ship-shape-amazon-developer-hackathon/manage/submissions** (or **My projects** on the hackathon page) and start a new project. Devpost's form has four steps. Paste from `DEVPOST.md` as follows. If a label differs, match it by meaning: the hackathon's own questions follow the rules' list.

**Step 1: Project overview**
- **Project name:** `Porchlight`
- **Elevator pitch:** the line in *Quick fields* (180 characters).

**Step 2: Project details**
- **About the project:** paste everything from `### Inspiration` down to the line *"Porchlight is not an emergency service…"* (Markdown renders).
- **Built with:** type each tag from *Quick fields → Built with*, pressing Enter after each.
- **"Try it out" links:** https://github.com/pswapnajit/porchlight and https://github.com/pswapnajit/ring-partner-kit
- **Image gallery:** upload in this order: `family.png`, `tv-checkin.png`, `all-clear.png`, `alexa.png`, `home.png`, `tv-visitor.png`, `scenes.png`, `tv-ambient.png`, `tv-thanks.png`. All are under 5 MB.
- **Thumbnail** (if asked): `docs/screenshots/thumbnail.png` (1500×1000, 3:2).
- **Video demo link:** your YouTube URL.

**Step 3: Additional info (the hackathon's questions)**

| Question | Paste |
|---|---|
| Which primary track(s)? | **Ring**, **Alexa+**, **Fire TV** (tick all three) |
| Which mini challenge(s)? | **AWS Builder**, **Open Source** |
| Code repository URL | https://github.com/pswapnajit/porchlight |
| Product feedback (each tool: what you used it for, what worked, what needs work, onboarding, would you build again) | The whole `## Product feedback` section: Ring Partner API, Playground, Bedrock, Strands, MCP SDK, Fire TV. If there's one box per tool, paste each `###` part into its box. |
| AWS Builder: which AWS services and how | `## AWS Builder mini challenge`. Its Bedrock and Strands details are also in Product feedback 3 and 4. |
| Open Source: contribution URL | https://github.com/pswapnajit/ring-partner-kit |
| Open Source: project repository URL | https://github.com/pswapnajit/porchlight |
| Open Source: GitHub username | `pswapnajit` |
| Open Source: what you did, how it works, why it matters | The three paragraphs under `## Open Source mini challenge` |
| If the project existed before: what changed | "New: built from scratch during the Submission Period (first commit 20 October 2026)." |
| Feature requests (optional) | The table under `### Feature requests` |
| Friction log (optional, up to 10% bonus) | All of `## Friction log`, F1 to F9. Don't skip this: it's worth up to 10%. |

**Step 4: Submit**
- **Team:** solo (you're the only member).
- Tick the agreement to the **Official Rules** and Devpost's terms, then **Submit**.
- You should get a confirmation email, and the project shows as **Submitted** under My projects.

## 6. After submitting

- Open the public project page and check that the video plays, the images show and the links work.
- Until judging ends (20 November), keep both repos public and don't push changes that break `npm run demo`. Judges may clone and run it.
- Delete the Bedrock API key and stop the TV emulator after 20 November.

## If something goes wrong

| Problem | Fix |
|---|---|
| `npm run demo` says the port is in use | `lsof -tiTCP:4000 -sTCP:LISTEN \| xargs kill`, then run it again |
| TV app not in front, or the launcher is showing | Press Back in the emulator, then the `adb shell am start …` line above |
| TV says "Connecting" | Make sure `npm run demo` is running; the app reconnects on its own |
| Live mode says the token is expired | Generate a new Playground token (about 30 minutes each), update `.env`, restart `npm start` |
| Video runs over 3:00 | Trim segments 3 and 7 first; judges stop at 3:00 |
| Devpost rejects an image | It must be under 5 MB: `sips -Z 1600 file.png` shrinks it |

# Submitting Porchlight: the exact steps

**Deadline: tonight, Saturday 24 October, 00:30 IST.** Aim to press Submit by **Friday 23 October, 21:00 IST**. Devpost lets you edit the entry until the deadline, so submit as soon as it's complete and polish afterwards.

**Who does what.** I build the whole video from automatic screen captures (the web app in headless Chrome, the TV on the emulator), run the live Ring test, fill the remaining blanks in `DEVPOST.md`, and give you a page with a Copy button for every Devpost field. Your part is below. It's about an hour, in short pieces.

| # | Your step | When | Time |
|---|---|---|---|
| 1 | Put the Ring Playground token into `.env` | Now | 5 min |
| 2 | (Optional) Put a Bedrock API key into `.env` | Now | 10 min |
| 3 | Record one short clip of the Ring Developer Playground | When I say "ready for the Playground clip" | 5 min |
| 4 | Choose the narration: computer voice, or record yours | Any time before 18:00 | 0–15 min |
| 5 | Watch the video I send, then upload it to YouTube | When I send it | 15 min |
| 6 | Fill the Devpost form and submit | By 21:00 | 30 min |
| 7 | Check the submitted entry | After submitting | 5 min |

Every Terminal command below is one line. Copy it, paste it into **Terminal** (⌘Space, type "Terminal", Enter), and press Enter.

---

## Step 1. Ring Playground token (5 min, now)

1. Open **https://developer.amazon.com/ring/console/playground** in Chrome and sign in with your Amazon developer account.
2. Click **Generate Token**, then copy the token (select it and press ⌘C, or use its copy button).
3. Paste this into Terminal. It copies the token from your clipboard into `.env` without showing it:
   ```bash
   cd ~/Documents/Experiment/amazon && sed -i '' "s|^RING_ACCESS_TOKEN=.*|RING_ACCESS_TOKEN=$(pbpaste)|" .env && grep -c '^RING_ACCESS_TOKEN=..' .env
   ```
   It should print `1`. If it prints `0`, copy the token again and repeat.
4. Tell me: **"token is in"**. Never paste the token into the chat.

The token lasts about **30 minutes**. If I run out of time with it, I'll ask you for a fresh one (repeat 2–4).

## Step 2. Bedrock API key (optional, 10 min)

This makes the porch vision check, the evening note and "Ask Porchlight" run on Amazon Bedrock for real, which helps the AWS Builder prize. It needs an AWS account. Skip it if you don't have one, and I'll describe the Bedrock part honestly as written but not run live.

1. Open **https://console.aws.amazon.com/bedrock** and sign in.
2. Top right, set the region to **US East (N. Virginia)**.
3. In the left menu, open **API keys**. Generate a **long-term API key** (30 days is plenty) and copy it.
4. If Bedrock asks you to enable model access, enable **Amazon Nova Lite** and **Amazon Nova Pro**.
5. Paste this into Terminal:
   ```bash
   cd ~/Documents/Experiment/amazon && sed -i '' "s|^AWS_BEARER_TOKEN_BEDROCK=.*|AWS_BEARER_TOKEN_BEDROCK=$(pbpaste)|" .env && grep -c '^AWS_BEARER_TOKEN_BEDROCK=..' .env
   ```
   It should print `1`.
6. Tell me: **"Bedrock is in"**.

Cost: a few cents for the whole hackathon. Delete the key after 20 November.

## Step 3. The Ring Developer Playground clip (5 min, when I say "ready")

The rules say the Ring video must show Ring's own simulator, the Developer Playground. It's behind your Amazon login, so this one clip is yours. When I say **"ready for the Playground clip"**, Porchlight will be running live against your Playground at http://localhost:4001. Then:

1. In Chrome, open two tabs: the **Ring Developer Playground**, and **http://localhost:4001** with **Behind the scenes** open.
2. Press **⌘⇧5**, choose **Record Selected Portion**, drag the box over the Chrome window, and click **Record**.
3. In the Playground tab, simulate a **Package** event on the camera. Wait a few seconds and do it once more.
4. Switch to the **localhost:4001** tab and wait until the event appears in "Ring Partner API calls" or on the Family timeline. That takes up to 30 seconds, because the Playground has no webhooks and Porchlight polls.
5. Stop the recording with the **■** button in the menu bar. The clip lands on your Desktop as "Screen Recording ….mov".
6. Tell me: **"Playground clip done"**. I'll find it on the Desktop and cut it into the video.

## Step 4. Narration (0–15 min)

- **Option A: computer voice.** Do nothing. The video uses a clear macOS voice.
- **Option B: your voice** (sounds more personal):
  1. Open `~/Documents/Experiment/amazon/submission/NARRATION.txt` (I'll create it with the final lines).
  2. Open **QuickTime Player** → **File → New Audio Recording** → click the red button.
  3. Read the lines in order, calmly, with a **2-second pause** between lines.
  4. Click stop, then **File → Save** → name it `narration` → save to the **Desktop**.
  5. Tell me: **"narration is on the Desktop"**. I'll sync each line to its segment.

## Step 5. Watch the video, then upload it to YouTube (15 min)

I'll put the finished video at **`~/Desktop/porchlight-demo.mp4`** (under 3:00) and send it to you. Watch it once. If anything should change, tell me.

Then upload it:
1. Open **https://studio.youtube.com** and sign in.
2. Click **Create** (top right) → **Upload videos** → **Select files** → choose `porchlight-demo.mp4` on the Desktop.
3. **Title:**
   ```
   Porchlight: gentle check-ins for a parent living alone (Ring, Alexa+, Fire TV)
   ```
4. **Description:**
   ```
   Porchlight notices when something doesn't happen. It learns an older parent's ordinary day from the Ring devices already at their door and checks in gently: first with them (chime, Fire TV, Alexa+), then with family.

   Built for the Amazon Developer Hackathon "Build, Ship, Shape" (Ring track, plus Alexa+ and Fire TV).
   Code: https://github.com/pswapnajit/porchlight
   Open-source Ring toolkit: https://github.com/pswapnajit/ring-partner-kit
   ```
5. Choose **No, it's not made for kids**. Click **Next** three times.
6. Under **Visibility**, choose **Public**: the rules say "publicly visible". Click **Publish**.
7. Copy the video link and send it to me. I'll put it into the submission text and the copy page.

## Step 6. Fill and submit the Devpost form (30 min)

**Easiest way:** open `~/Documents/Experiment/amazon/submission/form.html` in Chrome (I'll make it once the blanks are filled). It lists every field below in form order, each with a **Copy** button: click Copy, click into the Devpost field, press ⌘V.

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

## Step 7. After submitting

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

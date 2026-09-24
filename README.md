# iMessage Persona Bot

A self-hosted AI character chatbot that connects to **real iMessage** via [Photon](https://photon.codes)'s Spectrum SDK, powered by Google Gemini. Your custom persona replies directly inside the native Messages app on your phone — not a web-based mockup like typical SillyTavern-style extensions.

## What makes this different

Most AI character chat tools (SillyTavern, browser extensions, etc.) simulate a chat bubble UI inside a web page. This project actually bridges your agent into the real iMessage protocol through Photon's cloud-hosted iMessage line, so messages from your character show up in your phone's default Messages app, in the same conversation thread as texts from real people. No app to install, no separate chat window.

## Prerequisites

- A server or machine that can run Docker (Linux, macOS, or Windows with Docker Desktop / WSL2)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed
- A [Google Gemini API key](https://aistudio.google.com/apikey) (free tier works)
- A [Photon](https://photon.codes) account with an iMessage-enabled project

## Setup

### 1. Clone this repository

```bash
git clone https://github.com/FutabaYuiko/iMessage-persona-bot.git
cd iMessage-persona-bot
```

### 2. Create your local config files

These files are intentionally excluded from the repo (see `.gitignore`) because they hold your personal credentials, character design, and runtime data. Create them now from the provided templates:

```bash
cp .env.example .env
cp persona.example.json persona.json
touch memory.md
```

- `.env` will hold your API keys and settings — you'll fill this in below.
- `persona.json` is your character's personality definition — see **Building Your Persona** further down for how to design one from scratch.
- `memory.md` is a long-term memory file the bot appends to automatically over time. It can start completely empty.

> **Note:** `state.db` (the conversation database) does *not* need to be created manually — it's generated automatically the first time the bot runs.

### 3. Get a Gemini API key

Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with a Google account, and generate a free API key. Copy it — you'll need it in the next step.

This project is built specifically around the Gemini API's request/response format (`systemInstruction`, `generationConfig`, `inlineData` for images, etc.), so it's designed to work with Gemini models only. You *can* point `LLM_API_URL` at a different Gemini model version (e.g. swap `gemini-3.6-flash-lite` for `gemini-2.5-pro`), but switching to a different model family entirely (Claude, GPT, etc.) would require rewriting the request-building code — that's out of scope for a drop-in config change.

### 4. Create a Photon account and project

Go to [app.photon.codes](https://app.photon.codes) and sign up. Once logged in, create a new project and enable the **iMessage** provider for it. Photon will provision a dedicated iMessage line for your project — this is the phone number your character will text from.

From your project's dashboard, copy two values:
- **Project ID**
- **Project Secret**

### 5. Fill in your `.env` file

Open `.env` in a text editor and fill in the values you've collected:

```
PHOTON_PROJECT_ID=your_photon_project_id
PHOTON_PROJECT_SECRET=your_photon_project_secret
LLM_API_KEY=your_gemini_api_key
LLM_API_URL=
TIMEZONE=
```

- `LLM_API_URL` can be left empty to use the default model (`gemini-3.5
-flash-lite`). If you want a different Gemini model, use the full endpoint URL, e.g.:
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`
- `TIMEZONE` should be an IANA timezone name (e.g. `America/New_York`, `Europe/London`, `Asia/Tokyo`). This is used so the character has an accurate sense of the current date and time — leave empty to default to UTC.

---

*(Continued in the next section — Building Your Persona, running the bot, and known limitations)*









































## Technical Behavior & Expected Quirks

This bot is not a simple request-response wrapper — it has several timing and background mechanisms that shape how it feels to chat with. Understanding these up front will save you from thinking something is broken when it's actually working as designed.

### Message debouncing (why it doesn't reply instantly)

When you send a text, the bot does **not** reply immediately. It waits **30 seconds** (`INBOUND_DEBOUNCE_MS`) after your *last* message before generating a response. If you send three messages in a row within that window, they all get batched into a single turn and answered together, the same way a real person would read a burst of texts before replying once.

**What this means in practice:** if you send one message and wait, expect a ~30 second pause before anything happens — this is not lag or a crash, it's intentional. If you send another message within those 30 seconds, the timer resets and waits another 30 seconds from that new message. A long typing spree with pauses under 30 seconds between messages will keep pushing the reply back further. This trades off responsiveness for feeling less like a bot firing off a reply to every single line.

### Bubble-by-bubble sending with typing indicators

Once a reply is generated, it isn't sent as one big block of text. The response is split by newlines into separate "bubbles" (`splitIntoBubbles`), and each bubble is sent as its own iMessage, in sequence. Before each bubble, the bot triggers the native "typing…" indicator and waits a calculated delay:

\[ \text{delay} = \min(1200\text{ms} + 35\text{ms} \times \text{bubble length}, 6000\text{ms}) \]

So a short bubble like "haha" waits close to the 1.2s floor, while a long bubble is capped at a 6 second typing delay regardless of length. This is what makes the character feel like it's actually typing out each line rather than instantly dumping a wall of text — but it also means a multi-bubble reply can take several seconds to fully arrive, bubble by bubble, after the initial 30-second debounce.

### Background summarization and memory (silent, non-blocking)

Two processes run silently in the background and never block your conversation:

- **Rolling summary** — every 8 turns (`SUMMARIZE_EVERY_N_TURNS`), the bot sends recent unsummarized history to Gemini to compress into a short running summary, which gets folded into future system prompts so old context isn't lost even as raw history is trimmed.
- **Long-term memory extraction** — triggered right after each summarization pass, a separate Gemini call scans the same transcript for stable facts (preferences, habits, relationships, recurring names) and appends new bullet points to `memory.md`, capped at 30 lines (`MAX_MEMORY_LINES`) on a first-in-first-out basis.

Both of these fire *after* your reply has already been sent — they never add latency to the conversation itself. You'll see `[summary updated]` and `[memory updated]` lines in the console logs when they run, but nothing user-facing changes in the moment. Memory is genuinely persistent across restarts since it's written to `memory.md` on disk; the conversation history itself lives in `state.db`.

### Automatic retry on API overload

If the Gemini API returns a 503 (overloaded) or 429 (rate limited) error, the bot doesn't fail immediately — it retries up to 5 times (`MAX_RETRIES`) with increasing backoff delays: 5s, 15s, 30s, 60s, then 90s. A request that also times out entirely (no response within 60 seconds) is retried the same way. In the worst case, a single reply can take several minutes to arrive if Gemini's API is under heavy load — this is deliberate, since retrying is more reliable than immediately giving up. If every retry is exhausted, the bot sends a single "." as a fallback so the conversation doesn't just go silent forever.

### Context window trimming

Raw conversation history sent to Gemini is capped at roughly 3000 characters (`MAX_HISTORY_CHARS`), trimmed from the oldest end first. Combined with the rolling summary mechanism above, this means very old raw exchanges eventually drop out of the model's direct view, but their gist should persist through the summary and memory layers instead.

### Time-awareness across gaps

Every time a reply is generated, the bot injects the current real-world date, time, and weekday into the system prompt, and — if the retained history spans across days — an explicit note that the conversation crosses a day boundary. This prevents the character from treating something mentioned two days ago as if it just happened, unless you bring it up again yourself.

### Known current limitation

Long-term memory extraction and the rolling summary have not yet been stress-tested across many real accumulated turns — expect to validate behavior over an extended real conversation before relying on it heavily for a long-running persona.

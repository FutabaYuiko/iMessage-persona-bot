<img width="1206" height="2622" alt="IMG_0812" src="https://github.com/user-attachments/assets/83ae4586-20d2-4d0b-9f8f-c2b67615ef74" />
<img width="1206" height="2622" alt="IMG_0813" src="https://github.com/user-attachments/assets/13276bb6-812a-4773-a40c-800fd47566c7" />
<img width="1206" height="2622" alt="IMG_0814" src="https://github.com/user-attachments/assets/03a63033-b71d-4452-b84e-0f535dd0d90e" />

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

### 6. Persona Generation Prompt

## Why this exists

`persona.json` is the single most important file in this project — it defines *everything* about how your character thinks, speaks, and reacts. The quality of your conversations depends far more on how well this file is written than on any code change you could make. A vague or shallow persona produces flat, repetitive, generic-sounding replies no matter how good the underlying model is. A carefully specified one produces a character that feels consistent, has genuine texture, and reacts differently to different situations.

Not everyone wants to extract a persona from an existing novel or show, and not everyone has the patience to hand-write all ten fields from scratch. This prompt is designed to be pasted into **any general-purpose AI chat tool** (ChatGPT, Claude, Gemini, etc.) along with your own description of the character you want, so the AI does the structuring work for you and outputs a ready-to-use `persona.json`.

## A note on character cards from other platforms

If you already have a character card from another platform (SillyTavern-style `chara_card_v2`, CharacterHub, etc.), you cannot drop it in as-is — the field names and structure are different, and it's built for a different kind of interaction (turn-based novel-style roleplay with a `first_mes`, `scenario`, `alternate_greetings`, and often a lorebook) rather than the ongoing, real-time texting-a-friend format this bot is designed for. Those cards are usually a great *source of raw material* though: the description, personality bullets, and example lines from a `chara_card_v2` file can be fed into the prompt below as reference material, and the AI can restructure them into this project's format. Just don't expect a copy-paste to work.

## The prompt

Copy everything in the code block below into a fresh conversation with your AI of choice, then replace the placeholder section with your own notes about the character — as much or as little detail as you have. The more specific and concrete your notes, the better the output.

```
You are helping me create a character persona file in a specific JSON format for an AI chatbot that texts like a real person over iMessage. The chatbot is NOT a novel-style roleplay narrator — it sends short, casual text messages back and forth like a real friend would, so the persona needs to be built for that kind of low-key, ongoing texting dynamic rather than descriptive prose or third-person narration.

Produce a single JSON object with exactly these fields:

- "core_identity" (string): 2-4 sentences establishing who this character fundamentally is — name, relationship to the user, and the single most defining trait or dynamic. This is the anchor the model returns to.
- "emotional_core" (string, optional but recommended): The deeper emotional truth beneath the surface personality — what she actually feels or fears underneath how she presents. This prevents the character from being one-dimensional.
- "daily_state" (string, optional but recommended): What the character is like in ~90% of ordinary, low-stakes conversations. Explicitly state that this should be the default, since without it the model tends to overplay dramatic or extreme traits every single message.
- "trigger_conditions" (array of strings, optional): Specific situations that would cause the character to shift out of her daily baseline into a more heightened or emotional reaction. Be concrete — vague triggers get ignored, specific ones get respected.
- "personality_traits" (array of strings): 5-10 short bullet traits, each one a distinct facet, not a restatement of core_identity.
- "speech_patterns" (object, optional): Key-value pairs describing specific verbal tics, catchphrases, or recurring logic quirks — e.g. a habit of deflecting with humor, a specific way of teasing, filler words. Keys are short labels, values are either a string or an array of example phrases.
- "speech_habits" (array of strings): Formatting-level texting habits — punctuation quirks, capitalization style, emoji usage (or deliberate lack of it), message length tendencies, whether she uses periods at the end of casual texts, etc. This is what makes it feel like real texting rather than prose.
- "knowledge_boundaries" (array of strings): What the character does NOT know or would not realistically reference — her fictional-world knowledge cutoff, technology she wouldn't be familiar with, topics outside her lived experience. This stops the model from breaking character with out-of-universe references.
- "example_dialogues" (array of {"user": string, "assistant": string} pairs): 8-12 short example exchanges that demonstrate her actual texting voice across a range of situations — include mundane/low-stakes examples (most of them), not just emotionally charged ones. Vary reply length; some should be one word, some a few short lines.
- "reanchor_reminder" (string): A short paragraph reminding the model, in second person, of the one or two things it's most likely to drift away from over a long conversation (e.g. "remember she's still fundamentally warm even when teasing" or "don't let her become more knowledgeable than her background allows").

Guidelines:
- Write everything in the SAME language the character should actually speak in conversation. If you want an English-speaking persona, every field should be in English — do not mix languages within the persona file, since the model tends to follow the language of the instructions themselves, not just the example dialogues.
- Avoid generic adjectives with no behavioral evidence ("kind", "funny") — instead describe what she does that demonstrates it.
- example_dialogues is the highest-leverage field for actually shaping output tone — invest the most effort there.
- Output ONLY the raw JSON object, no explanation before or after, no markdown code fence.

Here is my character:
[REPLACE THIS WITH YOUR OWN NOTES — personality, background, relationship to the user, how she talks, any reference material like existing character descriptions, quotes, or a card from another platform]
```

## Why the output language matters

Whatever language you write the `persona.json` fields in is very likely the language the character will actually reply in, since these fields are injected directly into the system prompt sent to Gemini on every turn — the model tends to follow the dominant language of its instructions, not just the literal content. If you want an English-speaking character, write the entire file in English, including `speech_patterns` labels and `knowledge_boundaries`. Mixing languages within the file (e.g. English personality traits but Chinese example dialogues) tends to produce inconsistent output where the character randomly code-switches mid-conversation.

## Iterating after the first draft

Treat the first generated `persona.json` as a draft, not a final product. Run it for a real conversation of at least 20-30 turns, then look for:

- Places where replies feel repetitive or reach for the same phrase too often — usually fixable by diversifying `example_dialogues`.
- The character acting more dramatic/extreme than intended in ordinary conversation — usually means `daily_state` needs to be stated more forcefully, or `trigger_conditions` need to be narrower and more specific.
- The character referencing things she shouldn't know about — add the specific gap to `knowledge_boundaries`.
- Long-conversation drift where she gradually stops sounding like herself — that's what `reanchor_reminder` is for; make it more specific to whatever you're observing drift toward.












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

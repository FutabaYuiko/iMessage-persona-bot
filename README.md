# iMessage Persona Bot

A self-hosted AI character chatbot that connects to **real iMessage** via [Photon](https://photon.codes)'s Spectrum SDK, powered by Gemini. Your custom persona replies directly inside the native Messages app on your phone — not a web-based mockup like typical SillyTavern-style extensions.

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

These files are intentionally excluded from the repo (see `.gitignore`) because they hold your personal credentials, character design, and runtime data. Create empty placeholders for them now:

```bash
cp .env.example .env
cp persona.example.json persona.json
touch memory.md
```

- `.env` will hold your API keys — you'll fill this in during the next steps.
- `persona.json` is your character's personality definition — see the **Building Your Persona** section below for how to design one.
- `memory.md` is a long-term memory file the bot appends to automatically over time. It can start completely empty.

> **Note:** `state.db` (the conversation database) does *not* need to be created manually — it's generated automatically the first time the bot runs.

### 3. Create a Photon account and project

Go to [app.photon.codes](https://app.photon.codes) and sign up. Once logged in, create a new project and enable the **iMessage** provider for it. Photon will provision a dedicated iMessage line for your project — this is the phone number your character will text from.

From your project's dashboard, copy two values:
- **Project ID**
- **Project Secret**

You'll paste these into your `.env` file in the next step (coming up).

---

*(Continued in the next section — API keys, `.env` configuration, and running the bot)*

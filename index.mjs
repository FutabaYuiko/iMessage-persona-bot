import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import Database from "better-sqlite3";
import fetch from "node-fetch";
import fs from "fs";

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_API_URL = process.env.LLM_API_URL || "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash-lite:generateContent";

const TIMEZONE = process.env.TIMEZONE || "UTC";
const INBOUND_DEBOUNCE_MS = 30000;
const REANCHOR_EVERY_N_TURNS = 10;
const SUMMARIZE_EVERY_N_TURNS = 8;
const RECENT_RAW_TURNS_KEPT = 6;
const MAX_HISTORY_CHARS = 3000;
const MAX_MEMORY_LINES = 30;
const BUBBLE_MIN_DELAY_MS = 1200;
const BUBBLE_MS_PER_CHAR = 35;
const BUBBLE_MAX_DELAY_MS = 6000;
const MEMORY_FILE = "./memory.md";
const MAX_RETRIES = 5;
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000, 90000];

const persona = JSON.parse(fs.readFileSync("./persona.json", "utf-8"));

const db = new Database("./state.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    space_id TEXT,
    role TEXT,
    content TEXT,
    ts INTEGER,
    summarized INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS chat_state (
    space_id TEXT PRIMARY KEY,
    turn_count INTEGER DEFAULT 0,
    summary TEXT DEFAULT \'\'
  );
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn("chat_state", "summary", "TEXT DEFAULT \'\'");
ensureColumn("messages", "summarized", "INTEGER DEFAULT 0");

function readMemory() {
  try {
    return fs.readFileSync(MEMORY_FILE, "utf-8").trim();
  } catch (_) {
    return "";
  }
}

function writeMemory(lines) {
  fs.writeFileSync(MEMORY_FILE, lines.join("\n") + "\n", "utf-8");
}

function describeTimeSpan(history) {
  if (!history || history.length === 0) return "";
  const now = new Date();
  const fmt = d => d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  const today = fmt(now);
  const yesterday = fmt(new Date(now.getTime() - 86400000));

  const oldestTs = history[0].ts;
  const newestTs = history[history.length - 1].ts;
  const oldestDay = fmt(new Date(oldestTs));
  const newestDay = fmt(new Date(newestTs));

  const dayLabel = d => {
    if (d === today) return "today";
    if (d === yesterday) return "yesterday";
    return d;
  };

  if (oldestDay === newestDay) {
    return "The recent conversation history below all happened " + dayLabel(oldestDay) + ".";
  }
  return "The recent conversation history below spans from " + dayLabel(oldestDay) + " to " + dayLabel(newestDay) + ", so it may cross into a different day.";
}

const pendingBuffers = new Map();

function getChatState(spaceId) {
  let row = db.prepare("SELECT * FROM chat_state WHERE space_id = ?").get(spaceId);
  if (!row) {
    db.prepare("INSERT INTO chat_state (space_id) VALUES (?)").run(spaceId);
    row = { space_id: spaceId, turn_count: 0, summary: "" };
  }
  return row;
}

function saveMessage(spaceId, role, content) {
  db.prepare("INSERT INTO messages (space_id, role, content, ts) VALUES (?, ?, ?, ?)")
    .run(spaceId, role, content, Date.now());
}

function getUnsummarizedHistory(spaceId) {
  return db.prepare(
    "SELECT id, role, content FROM messages WHERE space_id = ? AND summarized = 0 ORDER BY id ASC"
  ).all(spaceId);
}

function getRecentHistory(spaceId, limitPairs) {
  const rows = db.prepare(
    "SELECT role, content, ts FROM messages WHERE space_id = ? ORDER BY id DESC LIMIT ?"
  ).all(spaceId, limitPairs * 2);
  return rows.reverse();
}

function trimHistoryByChars(history, maxChars) {
  let total = 0;
  const kept = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const len = history[i].content.length;
    if (total + len > maxChars && kept.length > 0) break;
    kept.unshift(history[i]);
    total += len;
  }
  return kept;
}

function markSummarized(ids) {
  if (ids.length === 0) return;
  const stmt = db.prepare("UPDATE messages SET summarized = 1 WHERE id = ?");
  for (const id of ids) stmt.run(id);
}

function updateSummary(spaceId, newSummary) {
  db.prepare("UPDATE chat_state SET summary = ? WHERE space_id = ?").run(newSummary, spaceId);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callGeminiWithRetry(body) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(LLM_API_URL + "?key=" + LLM_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 503 || res.status === 429) {
        const waitMs = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        console.log("[retry] LLM returned " + res.status + ", waiting " + waitMs + "ms (attempt " + (attempt + 1) + "/" + MAX_RETRIES + ")");
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error("LLM API error " + res.status + ": " + errText);
      }

      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        lastErr = new Error("LLM request timed out after 60s");
        console.log("[timeout] LLM request aborted (attempt " + (attempt + 1) + "/" + MAX_RETRIES + ")");
      } else {
        lastErr = err;
      }
      if (attempt < MAX_RETRIES - 1) {
        const waitMs = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        await sleep(waitMs);
      }
    }
  }
  throw lastErr || new Error("LLM call failed after retries");
}

async function callLLMRaw(systemPrompt, userPrompt) {
  const body = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
  };
  return callGeminiWithRetry(body);
}

async function maybeUpdateMemory(spaceId, transcript) {
  const currentMemory = readMemory();
  const sysPrompt = "From the conversation below, extract facts worth remembering long-term. List them as short keywords or phrases only, not full sentences, each under 8 words. Only include: the user's stable preferences (likes/dislikes), habits, important relationships, anniversaries/birthdays, pet or item names, and other facts that don't change often. Ignore temporary emotions, one-off events, or anything trivial happening in the moment. If there is nothing worth remembering long-term, return an empty string and nothing else. Existing memory (do not repeat anything already listed below):\n" + (currentMemory || "(none yet)");

  try {
    const result = await callLLMRaw(sysPrompt, transcript);
    const newLines = result
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("-") && l.length > 2);

    if (newLines.length === 0) return;

    const existingLines = currentMemory
      ? currentMemory.split("\n").filter(l => l.trim().startsWith("-"))
      : [];
    let combined = existingLines.concat(newLines);

    if (combined.length > MAX_MEMORY_LINES) {
      combined = combined.slice(combined.length - MAX_MEMORY_LINES);
    }

    writeMemory(combined);
    console.log("[memory updated] " + spaceId + ": +" + newLines.length + " lines, total " + combined.length);
  } catch (err) {
    console.error("Memory update failed:", err.message);
  }
}

async function maybeSummarize(spaceId) {
  const unsummarized = getUnsummarizedHistory(spaceId);
  if (unsummarized.length < SUMMARIZE_EVERY_N_TURNS * 2) return;

  const state = getChatState(spaceId);
  const transcript = unsummarized.map(m => (m.role === "assistant" ? "Character: " : "User: ") + m.content).join("\n");

  const sysPrompt = "You are a conversation summarizer. Compress the conversation below into a short bullet-point summary. Only keep facts, the user's state or preferences, and important events mentioned by either side that would be useful for future conversation. Do not comment on tone, just record what happened. Keep it under 100 words.";
  const userPrompt = (state.summary ? "Existing summary:\n" + state.summary + "\n\n" : "") + "New conversation content:\n" + transcript;

  try {
    const newSummary = await callLLMRaw(sysPrompt, userPrompt);
    if (newSummary && newSummary.trim()) {
      updateSummary(spaceId, newSummary.trim());
      markSummarized(unsummarized.map(m => m.id));
      console.log("[summary updated] " + spaceId + ": " + newSummary.trim());
    }
  } catch (err) {
    console.error("Summarize failed:", err.message);
  }

  maybeUpdateMemory(spaceId, transcript).catch(err => console.error("Background memory error:", err.message));
}

function buildSystemPrompt(turnCount, summary, timeSpanDescription) {
  const memory = readMemory();
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: TIMEZONE,
    year: "numeric", month: "long", day: "numeric",
    weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false
  });

  let prompt = "You are roleplaying as a character, texting a close friend over iMessage.\n\n";
  prompt += "# Current real time\nIt is currently " + timeStr + ". ";
  if (timeSpanDescription) {
    prompt += timeSpanDescription + " Use this to judge whether anything in the conversation history has already passed — do not treat something from a previous day as if it is still happening today, unless the user brings it up again in their latest message.";
  }
  prompt += "\n\n";
  prompt += "# Core identity\n" + persona.core_identity + "\n\n";
  if (persona.emotional_core) {
    prompt += "# Emotional core\n" + persona.emotional_core + "\n\n";
  }
  if (persona.daily_state) {
    prompt += "# Daily baseline state (this is how she is 90%+ of the time — prioritize this)\n" + persona.daily_state + "\n\n";
  }
  if (persona.trigger_conditions) {
    prompt += "# Trigger conditions (only switch to an emotional reaction when one of these is clearly hit — otherwise respond in the daily baseline state)\n";
    prompt += persona.trigger_conditions.map(t => "- " + t).join("\n") + "\n\n";
  }
  prompt += "# Personality traits\n" + persona.personality_traits.map(t => "- " + t).join("\n") + "\n\n";
  if (persona.speech_patterns) {
    prompt += "# Specific speech patterns and phrasing (for reference — don't reuse the exact same words every time)\n";
    for (const [key, val] of Object.entries(persona.speech_patterns)) {
      prompt += "- " + key + ": " + (Array.isArray(val) ? val.join(", ") : val) + "\n";
    }
    prompt += "\n";
  }
  prompt += "# Speech habits\n" + persona.speech_habits.map(h => "- " + h).join("\n") + "\n\n";
  prompt += "# Knowledge boundaries\n" + persona.knowledge_boundaries.map(k => "- " + k).join("\n") + "\n\n";

  if (memory) {
    prompt += "# Long-term memory about the user (always take this into account — this is what you permanently remember)\n" + memory + "\n\n";
  }

  if (summary) {
    prompt += "# Summary of earlier conversation (older content has been compressed — for background context only)\n" + summary + "\n\n";
  }

  prompt += "# Example dialogues (match this tone and how sentences are split into lines — note both short and long replies appear, and most are ordinary daily scenarios)\n";
  for (const ex of persona.example_dialogues) {
    prompt += "User: " + ex.user + "\nYou: " + ex.assistant + "\n\n";
  }

  prompt += "# Important reminder\n" + persona.reanchor_reminder;

  return prompt;
}

async function callLLM(systemPrompt, history, currentImages) {
  const trimmedHistory = trimHistoryByChars(history, MAX_HISTORY_CHARS);

  const contents = trimmedHistory.map(h => ({
    role: h.role === "assistant" ? "model" : "user",
    parts: [{ text: h.content }],
  }));

  if (currentImages && currentImages.length > 0 && contents.length > 0) {
    const last = contents[contents.length - 1];
    if (last.role === "user") {
      const parts = [];
      for (const img of currentImages) {
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
      }
      parts.push({ text: last.parts[0].text });
      last.parts = parts;
    }
  }

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { temperature: 0.9, maxOutputTokens: 500 },
  };

  return callGeminiWithRetry(body);
}

function splitIntoBubbles(text) {
  return text
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

async function sendBubbles(space, spaceId, bubbles) {
  for (const bubble of bubbles) {
    const delay = Math.min(BUBBLE_MIN_DELAY_MS + bubble.length * BUBBLE_MS_PER_CHAR, BUBBLE_MAX_DELAY_MS);
    await space.startTyping();
    await sleep(delay);
    await space.send(bubble);
    saveMessage(spaceId, "assistant", bubble);
  }
  await space.stopTyping();
}

async function handleTurn(space, spaceId) {
  const buffered = pendingBuffers.get(spaceId);
  if (!buffered || buffered.texts.length === 0) return;

  const combinedText = buffered.texts.join("\n");
  const combinedImages = buffered.images || [];
  pendingBuffers.delete(spaceId);

  saveMessage(spaceId, "user", combinedText);

  const state = getChatState(spaceId);
  const history = getRecentHistory(spaceId, RECENT_RAW_TURNS_KEPT);
  const timeSpanDescription = describeTimeSpan(history);
  const systemPrompt = buildSystemPrompt(state.turn_count, state.summary, timeSpanDescription);

  let replyText;
  try {
    replyText = await callLLM(systemPrompt, history, combinedImages);
  } catch (err) {
    console.error("LLM call failed:", err.message);
    await sendBubbles(space, spaceId, ["."]).catch(e => console.error("Fallback send failed:", e.message));
    return;
  }

  const bubbles = splitIntoBubbles(replyText);
  if (bubbles.length === 0) return;

  await sendBubbles(space, spaceId, bubbles);

  db.prepare("UPDATE chat_state SET turn_count = turn_count + 1 WHERE space_id = ?")
    .run(spaceId);

  maybeSummarize(spaceId).catch(err => console.error("Background summarize error:", err.message));
}

function scheduleTurn(space, spaceId, text, image) {
  if (!pendingBuffers.has(spaceId)) {
    pendingBuffers.set(spaceId, { texts: [], images: [], timer: null });
  }
  const buffered = pendingBuffers.get(spaceId);
  if (text) buffered.texts.push(text);
  if (image) buffered.images.push(image);

  if (buffered.timer) clearTimeout(buffered.timer);
  buffered.timer = setTimeout(() => {
    handleTurn(space, spaceId);
  }, INBOUND_DEBOUNCE_MS);
}

async function main() {
  const app = await Spectrum({
    projectId: process.env.PHOTON_PROJECT_ID,
    projectSecret: process.env.PHOTON_PROJECT_SECRET,
    providers: [imessage.config()],
  });

  console.log("Connected to Spectrum. Listening for messages...");

  for await (const [space, message] of app.messages) {
    await message.read();

    let items;
    if (message.content.type === "group") {
      items = message.content.items;
    } else {
      items = [message];
    }

    let text = "";
    let image = null;

    for (const item of items) {
      const c = item.content;
      if (c.type === "text") {
        text = text ? text + "\n" + c.text : c.text;
      } else if (c.type === "attachment") {
        const mimeType = c.mimeType || "";
        if (mimeType.startsWith("image/")) {
          try {
            const attachment = await imessage(app).getAttachment(c.id);
            if (attachment) {
              const buffer = await attachment.read();
              image = { mimeType, data: buffer.toString("base64") };
              if (!text) text = "[The user sent an image: " + (c.name || "unknown") + "]";
            } else {
              if (!text) text = "[The user sent an image named " + (c.name || "unknown") + ", but it can't be viewed right now — respond naturally without describing it]";
            }
          } catch (err) {
            console.error("Attachment download failed:", err.message);
            if (!text) text = "[The user sent an image named " + (c.name || "unknown") + ", but it can't be viewed right now — respond naturally without describing it]";
          }
        } else {
          if (!text) text = "[The user sent a file: " + (c.name || "unknown") + "]";
        }
      }
    }

    if (!text) continue;

    console.log("[inbound] " + space.id + ": " + text + (image ? " [+image]" : ""));
    scheduleTurn(space, space.id, text, image);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

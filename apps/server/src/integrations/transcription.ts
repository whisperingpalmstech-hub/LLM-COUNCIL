import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ROOT, type Env } from "../config.ts";

const run = promisify(execFile);
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

/**
 * Speech-to-text for voice input, first available of:
 *   1. local whisper.cpp (audio never leaves the machine)
 *   2. OpenRouter with a cheap audio-capable model (default google/gemini-2.5-flash-lite)
 *   3. OpenAI's transcription API
 * Temp audio goes to the OS temp dir and is always deleted.
 */
export class Transcriber {
  private readonly env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  engine(): "whisper.cpp" | "openrouter" | "openai" | null {
    if (this.localReady()) return "whisper.cpp";
    if (this.env.OPENROUTER_API_KEY) return "openrouter";
    if (this.env.OPENAI_API_KEY) return "openai";
    return null;
  }

  async transcribe(audio: Buffer, mimeType: string, language = "auto"): Promise<{ text: string; engine: string }> {
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw Object.assign(new Error("Audio must be between 1 byte and 16 MB."), { status: 413 });
    const engine = this.engine();
    if (engine === "whisper.cpp") return { text: await this.local(audio, mimeType, language), engine };
    if (engine === "openrouter") return { text: await this.openrouter(audio, mimeType, language), engine: `openrouter/${this.openrouterModel()}` };
    if (engine === "openai") return { text: await this.openai(audio, mimeType, language), engine };
    throw Object.assign(new Error("Voice input is not configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY, or install whisper.cpp."), { status: 503 });
  }

  private binary(): string {
    return this.env.WHISPER_CPP_BIN || path.join(ROOT, "vendor/whisper.cpp/build/bin/whisper-cli");
  }

  private model(): string {
    return this.env.WHISPER_MODEL_PATH || path.join(ROOT, "data/whisper-models/ggml-base.bin");
  }

  private localReady(): boolean {
    try {
      fs.accessSync(this.binary(), fs.constants.X_OK);
      return fs.statSync(this.model()).size > 0;
    } catch {
      return false;
    }
  }

  private async local(audio: Buffer, mimeType: string, language: string): Promise<string> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "synod-voice-"));
    const input = path.join(dir, `input.${extension(mimeType)}`);
    const wav = path.join(dir, "audio.wav");
    try {
      await fs.promises.writeFile(input, audio, { mode: 0o600 });
      // Normalise to 16 kHz mono PCM with a short lead-in so the first word isn't clipped.
      await run(this.env.FFMPEG_BIN || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-af", "adelay=400:all=1", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeout: 60_000 });
      const threads = String(Math.max(1, Math.min(8, Number(this.env.WHISPER_THREADS) || 4)));
      const { stdout } = await run(this.binary(), ["-m", this.model(), "-f", wav, "-l", language || "auto", "-nt", "-np", "-t", threads], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
      const text = String(stdout).replace(/\s+/g, " ").trim();
      if (!text) throw Object.assign(new Error("No speech detected."), { status: 422 });
      return text;
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }

  private openrouterModel(): string {
    return this.env.OPENROUTER_TRANSCRIBE_MODEL || "google/gemini-2.5-flash-lite";
  }

  private async openrouter(audio: Buffer, mimeType: string, language: string): Promise<string> {
    const { data, format } = await toMp3(audio, mimeType, this.env.FFMPEG_BIN || "ffmpeg");
    const hint = language && language !== "auto" ? ` The speaker is most likely using language code "${language}".` : "";
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`, "X-Title": "Synod" },
      body: JSON.stringify({
        model: this.openrouterModel(),
        // Cheap audio-capable fallbacks if the primary is rate-limited upstream.
        models: [this.openrouterModel(), "google/gemini-3.1-flash-lite", "mistralai/voxtral-small-24b-2507"],
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Transcribe this audio verbatim, in the language spoken.${hint} Output only the transcript, with no commentary, labels, or quotes. If there is no speech, output nothing.` },
              { type: "input_audio", input_audio: { data: data.toString("base64"), format } }
            ]
          }
        ]
      }),
      signal: AbortSignal.timeout(90_000)
    });
    if (!res.ok) throw Object.assign(new Error(`Transcription failed: OpenRouter HTTP ${res.status} ${(await res.text()).slice(0, 200)}`), { status: 502 });
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = String(body.choices?.[0]?.message?.content ?? "").trim();
    if (!text) throw Object.assign(new Error("No speech detected."), { status: 422 });
    return text;
  }

  private async openai(audio: Buffer, mimeType: string, language: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), `audio.${extension(mimeType)}`);
    form.append("model", this.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
    if (language && language !== "auto") form.append("language", language);
    const res = await fetch(`${this.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(120_000)
    });
    if (!res.ok) throw Object.assign(new Error(`Transcription failed: HTTP ${res.status}`), { status: 502 });
    const data = (await res.json()) as { text?: string };
    const text = String(data.text ?? "").trim();
    if (!text) throw Object.assign(new Error("No speech detected."), { status: 422 });
    return text;
  }
}

/** Re-encode to small mono mp3 (OpenRouter audio input accepts wav/mp3); passes through if ffmpeg is missing. */
async function toMp3(audio: Buffer, mimeType: string, ffmpeg: string): Promise<{ data: Buffer; format: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "synod-voice-"));
  try {
    const input = path.join(dir, `input.${extension(mimeType)}`);
    const output = path.join(dir, "audio.mp3");
    await fs.promises.writeFile(input, audio, { mode: 0o600 });
    await run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", output], { timeout: 60_000 });
    return { data: await fs.promises.readFile(output), format: "mp3" };
  } catch {
    return { data: audio, format: extension(mimeType) };
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

function extension(mimeType: string): string {
  const type = mimeType.split(";")[0].toLowerCase();
  return ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" } as Record<string, string>)[type] ?? "webm";
}

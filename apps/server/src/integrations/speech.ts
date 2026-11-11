// Text-to-speech through OpenRouter's speech endpoint, cached on disk so replays are free.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DiscussionSettings, VoiceId } from "@synod/contracts";
import type { Env } from "../config.ts";
import { fetchOk } from "../providers/http.ts";

const MAX_CHARS = 2400;

/** Our voice ids are ElevenLabs voice names; the economy model has its own names. */
const ECONOMY_VOICES: Record<VoiceId, string> = {
  george: "bm_george",
  sarah: "af_sarah",
  brian: "am_michael",
  alice: "bf_alice",
  charlie: "am_puck",
  matilda: "af_heart",
  daniel: "bm_daniel",
  jessica: "af_jessica"
};

export class Speech {
  private readonly env: Env;
  private readonly dir: string;
  private readonly pending = new Map<string, Promise<Buffer>>();

  constructor(env: Env, dataDir: string) {
    this.env = env;
    this.dir = path.join(dataDir, "speech");
  }

  available(): boolean {
    return Boolean(this.env.OPENROUTER_API_KEY) && this.env.SYNOD_SPEECH !== "off";
  }

  /** MP3 audio of `text` in the given voice. */
  async synthesize(text: string, voice: VoiceId, quality: DiscussionSettings["voice"] = "natural", signal?: AbortSignal): Promise<Buffer> {
    if (!this.available()) throw Object.assign(new Error("Voices need an OpenRouter key on the server."), { status: 503 });
    const input = speakable(text).slice(0, MAX_CHARS);
    if (!input) throw Object.assign(new Error("Nothing to say."), { status: 400 });
    const model = quality === "economy" ? this.env.SPEECH_MODEL_ECONOMY || "hexgrad/kokoro-82m" : this.env.SPEECH_MODEL || "elevenlabs/eleven-flash-v2.5";
    const name = quality === "economy" && !this.env.SPEECH_MODEL_ECONOMY ? ECONOMY_VOICES[voice] : voice;
    const key = crypto.createHash("sha256").update(`${model}\n${name}\n${input}`).digest("hex");
    const file = path.join(this.dir, `${key}.mp3`);
    const cached = await fs.readFile(file).catch(() => null);
    if (cached) return cached;
    let job = this.pending.get(key);
    if (!job) {
      job = (async () => {
        const { res } = await fetchOk("https://openrouter.ai/api/v1/audio/speech", {
          label: "speech",
          timeoutMs: 45_000,
          signal,
          headers: { Authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`, "X-Title": "Synod" },
          body: { model, voice: name, input, response_format: "mp3" }
        });
        const audio = Buffer.from(await res.arrayBuffer());
        if (audio.length < 200) throw new Error("The speech service returned no audio.");
        await fs.mkdir(this.dir, { recursive: true });
        await fs.writeFile(file, audio, { mode: 0o600 }).catch(() => undefined);
        return audio;
      })().finally(() => this.pending.delete(key));
      this.pending.set(key, job);
    }
    return job;
  }
}

/** Strip markdown and anything that reads badly aloud. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

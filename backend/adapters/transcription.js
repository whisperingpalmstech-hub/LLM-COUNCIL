import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 60;
const PROBE_CACHE_MS = 5 * 60 * 1000;

export class LocalWhisperTranscriber {
  constructor({ env = process.env, root = process.cwd() } = {}) {
    this.env = env;
    this.root = root;
    this.lastProbe = null;
  }

  status() {
    const binary = this.binaryPath();
    const model = this.modelPath();
    const finalModel = this.modelPath({ quality: "final" });
    const executable = canExecute(binary);
    const modelReady = fs.existsSync(model) && fs.statSync(model).size > 0;
    const finalModelReady = fs.existsSync(finalModel) && fs.statSync(finalModel).size > 0;
    return {
      available: executable && modelReady,
      engine: "whisper.cpp",
      executable: executable ? "ready" : "missing",
      model: modelReady ? "loaded" : "missing",
      modelName: path.basename(model),
      finalModel: finalModelReady ? "loaded" : "missing",
      finalModelName: path.basename(finalModel),
      finalModelQuality: modelQuality(finalModel),
      maxAudioSeconds: MAX_AUDIO_SECONDS,
      checkedAt: new Date().toISOString()
    };
  }

  async probe() {
    if (this.lastProbe && Date.now() - this.lastProbe.timestamp < PROBE_CACHE_MS) return this.lastProbe.value;
    const status = this.status();
    if (!status.available) throw Object.assign(new Error("Local Whisper is not ready."), { status: 503 });
    const fixture = path.join(this.root, "vendor", "whisper.cpp", "samples", "jfk.wav");
    if (!fs.existsSync(fixture)) throw Object.assign(new Error("Voice readiness fixture is unavailable."), { status: 503 });
    try {
      await execFileAsync(this.binaryPath(), ["-m", this.modelPath(), "-f", fixture, "-l", "en", "-nt", "-ng", "-np"], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const value = { ...status, probed: true, ready: true, checkedAt: new Date().toISOString() };
      this.lastProbe = { timestamp: Date.now(), value };
      return value;
    } catch (error) {
      throw Object.assign(new Error(error.killed ? "Voice readiness probe timed out." : "Voice readiness probe failed."), { status: 503 });
    }
  }

  async transcribe({ dataUrl, audioBuffer, mimeType, language = "auto", signal, quality = "standard", leadingPadMs = 450, prompt = "" } = {}) {
    const availability = this.status();
    if (!availability.available) throw Object.assign(new Error("Local Whisper is not installed or its model is unavailable."), { status: 503 });
    const pcm = pcmWav(arguments[0]);
    // MediaRecorder commonly emits e.g. audio/webm;codecs=opus. Parameters
    // before ;base64 are valid data URLs and must not reject a real recording.
    const match = String(dataUrl || "").match(/^data:audio\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+(?:=[^;,]*)?)*;base64,([a-z0-9+/=]+)$/i);
    if (!pcm && !match && !Buffer.isBuffer(audioBuffer)) throw Object.assign(new Error("Provide a valid audio recording."), { status: 400 });
    const audio = pcm?.audio || audioBuffer || Buffer.from(match[1], "base64");
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw Object.assign(new Error("Audio must be between 1 byte and 16 MB."), { status: 413 });

    const tempDir = path.join(this.root, "data", "transcription-tmp");
    fs.mkdirSync(tempDir, { recursive: true });
    const token = crypto.randomUUID();
    const inputPath = path.join(tempDir, `${token}.${pcm ? "wav" : audioExtension(mimeType || dataUrl?.slice(5, dataUrl.indexOf(";")))}`);
    const wavPath = path.join(tempDir, `${token}.normalized.wav`);
    const model = this.modelPath({ quality });
    const pad = Math.max(0, Math.min(2000, Number(leadingPadMs) || 0));
    try {
      await fs.promises.writeFile(inputPath, audio, { mode: 0o600 });
      // Give Whisper a clean leading boundary. Speech beginning at sample zero
      // is frequently treated as a clipped onset, especially for plosives and
      // short multilingual utterances. Normalize every input, including PCM.
      await execFileAsync(this.ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-af", `adelay=${pad}:all=1`, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath], { timeout: 90000, maxBuffer: 1024 * 1024, signal });
      const whisperArgs = ["-m", model, "-f", wavPath, "-l", whisperLanguage(language), "-nt", "-ng", "-np", "-t", String(Math.max(1, Math.min(8, Number(this.env.WHISPER_THREADS) || 2)))];
      const cleanPrompt = String(prompt || this.env.WHISPER_INITIAL_PROMPT || "").trim();
      if (cleanPrompt) whisperArgs.push("--prompt", cleanPrompt.slice(0, 420));
      const { stdout } = await execFileAsync(this.binaryPath(), whisperArgs, { timeout: quality === "final" ? 240000 : 180000, maxBuffer: 2 * 1024 * 1024, signal });
      const text = String(stdout).replace(/\s+/g, " ").trim();
      if (!text) throw Object.assign(new Error("Whisper could not detect spoken words in that recording."), { status: 422 });
      return { text, engine: "local-whisper", quality, modelName: path.basename(model), modelQuality: modelQuality(model) };
    } catch (error) {
      if (error.status) throw error;
      const detail = String(error.stderr || error.message || "").trim();
      throw Object.assign(new Error(`Local transcription failed${detail ? `: ${detail.slice(0, 220)}` : ""}`), { status: 502 });
    } finally {
      await Promise.all([fs.promises.rm(inputPath, { force: true }), fs.promises.rm(wavPath, { force: true })]);
    }
  }

  binaryPath() {
    return this.env.WHISPER_CPP_BIN || path.join(this.root, "vendor", "whisper.cpp", "build", "bin", "whisper-cli");
  }

  modelPath({ quality = "standard" } = {}) {
    if (quality === "final") return this.finalModelPath();
    return this.env.WHISPER_MODEL_PATH || path.join(this.root, "data", "whisper-models", "ggml-base.bin");
  }

  finalModelPath() {
    if (this.env.WHISPER_FINAL_MODEL_PATH) return this.env.WHISPER_FINAL_MODEL_PATH;
    const modelDir = path.join(this.root, "data", "whisper-models");
    const candidates = [
      "ggml-large-v3-turbo.bin",
      "ggml-large-v3.bin",
      "ggml-medium.bin",
      "ggml-small.bin",
      path.basename(this.modelPath())
    ];
    for (const candidate of candidates) {
      const target = path.join(modelDir, candidate);
      if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;
    }
    return this.modelPath();
  }

  ffmpegPath() {
    if (this.env.FFMPEG_BIN) return this.env.FFMPEG_BIN;
    // launchd deliberately starts services with a minimal PATH, which normally
    // excludes Homebrew's executable directory on macOS.
    return fs.existsSync("/usr/local/bin/ffmpeg") ? "/usr/local/bin/ffmpeg" : "ffmpeg";
  }
}

function modelQuality(modelPath = "") {
  const name = path.basename(String(modelPath)).toLowerCase();
  if (name.includes("large-v3-turbo")) return "high";
  if (name.includes("large")) return "highest";
  if (name.includes("medium")) return "high";
  if (name.includes("small")) return "balanced";
  if (name.includes("base")) return "basic";
  if (name.includes("tiny")) return "preview";
  return "unknown";
}

function canExecute(file) {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function pcmWav({ pcmBase64, sampleRate } = {}) {
  if (!pcmBase64) return null;
  if (!/^[a-z0-9+/=]+$/i.test(String(pcmBase64))) {
    throw Object.assign(new Error("Provide microphone PCM as base64 audio."), { status: 400 });
  }
  const pcm = Buffer.from(pcmBase64, "base64");
  const rate = Number(sampleRate);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || !pcm.length || pcm.length % 2) {
    throw Object.assign(new Error("Provide valid 16-bit mono microphone audio."), { status: 400 });
  }
  if (pcm.length > MAX_AUDIO_BYTES) throw Object.assign(new Error("Audio must be between 1 byte and 16 MB."), { status: 413 });
  if (pcm.length / 2 / rate > MAX_AUDIO_SECONDS) throw Object.assign(new Error(`Audio must be ${MAX_AUDIO_SECONDS} seconds or shorter.`), { status: 413 });
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return { audio: wav };
}

function whisperLanguage(value) {
  return { en: "en", mr: "mr", hi: "hi", ru: "ru", nl: "nl", ar: "ar", es: "es", de: "de" }[String(value || "en").toLowerCase()] || "auto";
}

function audioExtension(value = "") {
  const type = String(value).split(";", 1)[0].toLowerCase();
  return ({ "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/basic": "au" })[type] || "audio";
}

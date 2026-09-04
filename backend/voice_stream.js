import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { LocalWhisperTranscriber } from "./adapters/transcription.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_SILENCE_MS = 5000;
const MIN_AUDIO_MS = 700;
const VOICE_RMS_THRESHOLD = 0.014;
const ACTIVITY_INTERVAL_MS = 250;

export function attachVoiceStreamServer(server, { env = process.env, root = process.cwd() } = {}) {
  const transcriber = new LocalWhisperTranscriber({ env, root });
  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url || "/", "http://synod.local").pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== "/api/v1/voice/stream") return;
    if (!authenticateUpgrade(req, env)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Synod", charset="UTF-8"\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n"));
    const connection = new VoiceStreamConnection(socket, { transcriber, env });
    if (head?.length) connection.receive(head);
  });
}

class VoiceStreamConnection {
  constructor(socket, { transcriber, env }) {
    this.id = randomUUID();
    this.socket = socket;
    this.transcriber = transcriber;
    this.env = env;
    this.buffer = Buffer.alloc(0);
    this.started = false;
    this.finalizing = false;
    this.closed = false;
    this.sampleRate = DEFAULT_SAMPLE_RATE;
    this.language = "auto";
    this.silenceMs = DEFAULT_SILENCE_MS;
    this.startedAt = Date.now();
    this.lastVoiceAt = this.startedAt;
    this.lastActivityAt = 0;
    this.heardVoice = false;
    this.peakRms = 0;
    this.peakLevel = 0;
    this.audioBytes = 0;
    this.chunks = [];
    this.socket.on("data", (chunk) => this.receive(chunk));
    this.socket.on("close", () => { this.closed = true; });
    this.socket.on("error", () => { this.closed = true; });
    this.send({ type: "hello", sessionId: this.id, status: this.transcriber.status() });
  }

  receive(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        const high = this.buffer.readUInt32BE(offset);
        const low = this.buffer.readUInt32BE(offset + 4);
        if (high !== 0) return this.close(1009, "Frame too large");
        length = low;
        offset += 8;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        const unmasked = Buffer.alloc(payload.length);
        for (let index = 0; index < payload.length; index += 1) unmasked[index] = payload[index] ^ mask[index % 4];
        payload = unmasked;
      }
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) {
        this.writeFrame(0xA, payload);
      } else if (opcode === 0x1) {
        this.handleText(payload.toString("utf8"));
      } else if (opcode === 0x2) {
        this.handleAudio(payload);
      }
    }
  }

  handleText(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      this.send({ type: "error", error: { message: "Invalid voice stream message.", status: 400 } });
      return;
    }
    if (message.type === "start") {
      const sampleRate = Number(message.sampleRate || DEFAULT_SAMPLE_RATE);
      this.sampleRate = Number.isInteger(sampleRate) && sampleRate >= 8000 && sampleRate <= 96000 ? sampleRate : DEFAULT_SAMPLE_RATE;
      this.language = String(message.language || "auto").slice(0, 16);
      this.silenceMs = Math.max(1500, Math.min(12000, Number(message.silenceMs || DEFAULT_SILENCE_MS)));
      this.startedAt = Date.now();
      this.lastVoiceAt = this.startedAt;
      this.started = true;
      this.send({ type: "ready", sessionId: this.id, sampleRate: this.sampleRate, silenceMs: this.silenceMs });
      return;
    }
    if (message.type === "stop") {
      void this.finalize(message.reason || "client-stop");
      return;
    }
    if (message.type === "cancel") {
      this.send({ type: "cancelled", sessionId: this.id });
      this.close(1000, "cancelled");
      return;
    }
    if (message.type === "ping") {
      this.send({ type: "pong", at: Date.now() });
    }
  }

  handleAudio(payload) {
    if (!this.started || this.finalizing || this.closed) return;
    if (!payload.length || payload.length % 2) return;
    this.audioBytes += payload.length;
    if (this.audioBytes > MAX_STREAM_BYTES) {
      this.send({ type: "error", error: { message: "Audio stream is too large.", status: 413 } });
      return this.close(1009, "audio-too-large");
    }
    const stats = pcm16Stats(payload);
    this.peakRms = Math.max(this.peakRms, stats.rms);
    this.peakLevel = Math.max(this.peakLevel, stats.peak);
    const now = Date.now();
    if (stats.rms >= VOICE_RMS_THRESHOLD || stats.peak >= VOICE_RMS_THRESHOLD * 4) {
      this.heardVoice = true;
      this.lastVoiceAt = now;
    }
    this.chunks.push(Buffer.from(payload));
    if (now - this.lastActivityAt >= ACTIVITY_INTERVAL_MS) {
      this.lastActivityAt = now;
      this.sendActivity(stats, now);
    }
    if (this.heardVoice && now - this.lastVoiceAt >= this.silenceMs) {
      this.send({ type: "silence", sessionId: this.id, silenceMs: now - this.lastVoiceAt, elapsedMs: now - this.startedAt });
      void this.finalize("server-silence");
    }
  }

  sendActivity(stats, now = Date.now()) {
    this.send({
      type: "activity",
      sessionId: this.id,
      elapsedMs: now - this.startedAt,
      silenceMs: this.heardVoice ? now - this.lastVoiceAt : 0,
      heardVoice: this.heardVoice,
      rms: round(stats.rms),
      peak: round(stats.peak),
      peakRms: round(this.peakRms),
      peakLevel: round(this.peakLevel),
      audioSeconds: round(this.audioBytes / 2 / this.sampleRate, 3)
    });
  }

  async finalize(reason) {
    if (this.finalizing || this.closed) return;
    this.finalizing = true;
    const audioSeconds = this.audioBytes / 2 / this.sampleRate;
    this.send({ type: "finalizing", sessionId: this.id, reason, audioSeconds: round(audioSeconds, 3), heardVoice: this.heardVoice });
    try {
      if (!this.heardVoice || audioSeconds < MIN_AUDIO_MS / 1000) {
        throw Object.assign(new Error("I could not detect enough speech. Try again closer to the microphone."), { status: 422 });
      }
      const pcm = Buffer.concat(this.chunks);
      const result = await this.transcriber.transcribe({
        pcmBase64: pcm.toString("base64"),
        sampleRate: this.sampleRate,
        language: this.language,
        quality: "final",
        leadingPadMs: 150,
        prompt: "Synod companion dictation. Preserve the user's language, code-switching, names, and punctuation."
      });
      this.send({
        type: "final",
        sessionId: this.id,
        text: result.text,
        engine: result.engine,
        quality: result.quality,
        modelName: result.modelName,
        audioSeconds: round(audioSeconds, 3),
        reason
      });
      this.close(1000, "complete");
    } catch (error) {
      this.send({
        type: "error",
        sessionId: this.id,
        error: {
          message: error.message || "Voice transcription failed.",
          status: error.status || 502
        }
      });
      this.close(1011, "transcription-error");
    }
  }

  send(message) {
    this.writeFrame(0x1, Buffer.from(JSON.stringify(message)));
  }

  writeFrame(opcode, payload = Buffer.alloc(0)) {
    if (this.closed || this.socket.destroyed) return;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    const reasonBuffer = Buffer.from(String(reason).slice(0, 120));
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    try { this.writeFrame(0x8, payload); } catch {}
    this.socket.end();
  }
}

function pcm16Stats(buffer) {
  let sum = 0;
  let peak = 0;
  const samples = Math.floor(buffer.length / 2);
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32768;
    const absolute = Math.abs(value);
    sum += value * value;
    if (absolute > peak) peak = absolute;
  }
  return { rms: Math.sqrt(sum / Math.max(1, samples)), peak };
}

function authenticateUpgrade(req, env) {
  if (!env.SYNOD_ACCESS_PASSWORD) return true;
  const expectedUser = env.SYNOD_ACCESS_USERNAME || "synod";
  const expectedPassword = env.SYNOD_ACCESS_PASSWORD;
  const [scheme, encoded] = String(req.headers.authorization || "").split(" ");
  let username = "";
  let password = "";
  if (/^basic$/i.test(scheme) && encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      username = separator >= 0 ? decoded.slice(0, separator) : decoded;
      password = separator >= 0 ? decoded.slice(separator + 1) : "";
    } catch {}
  }
  return safeEqual(username, expectedUser) && safeEqual(password, expectedPassword);
}

function safeEqual(actual, expected) {
  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function round(value, places = 5) {
  const scale = 10 ** places;
  return Math.round(Number(value || 0) * scale) / scale;
}

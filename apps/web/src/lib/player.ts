// The debate player: walks through a discussion one message at a time, speaking each
// panellist's words aloud (or pacing silently), and drives the avatars' mouths.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, Conversation } from "@synod/contracts";
import { api } from "./api";

export type PlayerStatus = "playing" | "paused" | "waiting" | "ended" | "blocked";

export interface DebatePlayer {
  items: ChatMessage[];
  index: number;
  /** The message on the floor right now, if any. */
  current: ChatMessage | undefined;
  status: PlayerStatus;
  /** The listener wants playback to run (it may still be waiting for the next speaker). */
  wanted: boolean;
  /** 0-1 through the current message. */
  progress: number;
  muted: boolean;
  rate: number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (index: number) => void;
  /** Jump past everything said so far (the listener spoke, or wants to be live). */
  skipToLive: () => void;
  setMuted: (muted: boolean) => void;
  setRate: (rate: number) => void;
}

/** Where each discussion's listener is, so switching views doesn't lose their place. */
const positions = new Map<string, number>();
const prefetched = new Set<string>();

const RATES = [1, 1.25, 1.5, 0.85];
export const nextRate = (rate: number) => RATES[(RATES.indexOf(rate) + 1) % RATES.length];

function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows: the preference just doesn't persist.
  }
}

/** Seconds a message takes when nobody is speaking it aloud. */
function readingSeconds(message: ChatMessage): number {
  const words = message.text.trim().split(/\s+/).length;
  return message.author.kind === "user" ? Math.min(7, Math.max(2.5, words * 0.28)) : Math.max(3, words * 0.36);
}

function setLevel(level: number) {
  document.documentElement.style.setProperty("--voice-level", level.toFixed(3));
}

interface AudioRig {
  audio: HTMLAudioElement;
  context?: AudioContext;
  analyser?: AnalyserNode;
  samples?: Uint8Array<ArrayBuffer>;
}

export function useDebatePlayer(conversation: Conversation, options: { enabled: boolean; speech: boolean }): DebatePlayer {
  const id = conversation.id;
  const items = useMemo(() => conversation.chat.filter((m) => m.text && !m.error), [conversation.chat]);
  const live = conversation.chatBusy || conversation.personaStatus === "casting";

  const [index, setIndexState] = useState(() => positions.get(id) ?? startIndex(items, live));
  const [wanted, setWanted] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [progress, setProgress] = useState(0);
  const [muted, setMutedState] = useState(() => readPref("synod:debate-muted", false));
  const [rate, setRateState] = useState(() => readPref("synod:debate-rate", 1));
  /** Messages whose audio failed: paced silently instead. */
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  const rig = useRef<AudioRig | null>(null);
  const elapsed = useRef(0);
  const shown = useRef(0);
  const state = useRef({ index, count: items.length });
  state.current = { index, count: items.length };

  const setIndex = useCallback(
    (next: number | ((i: number) => number)) => {
      setIndexState((i) => {
        const value = Math.max(0, Math.min(state.current.count, typeof next === "function" ? next(i) : next));
        positions.set(id, value);
        // Going "back" within a message restarts it.
        if (value === i && rig.current) rig.current.audio.currentTime = 0;
        return value;
      });
      elapsed.current = 0;
      shown.current = 0;
      setProgress(0);
    },
    [id]
  );

  const current = options.enabled ? items[index] : undefined;
  const aloud = Boolean(current && current.author.kind === "model" && options.speech && !muted && !failed.has(current.id));
  const playing = options.enabled && wanted && !blocked && Boolean(current);

  // One audio element for the whole session; its output also feeds the mouth animation.
  const getRig = useCallback((): AudioRig => {
    if (rig.current) return rig.current;
    const audio = new Audio();
    audio.preload = "auto";
    rig.current = { audio };
    return rig.current;
  }, []);

  const advance = useCallback(() => setIndex((i) => i + 1), [setIndex]);

  useEffect(() => {
    if (!options.enabled) return;
    const { audio } = getRig();
    const onEnded = () => advance();
    const onError = () => {
      const failedId = audio.dataset.message;
      if (failedId) setFailed((s) => new Set(s).add(failedId));
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      setLevel(0);
    };
  }, [options.enabled, getRig, advance]);

  // Load and start (or pause) the current message's audio.
  useEffect(() => {
    if (!options.enabled) return;
    const r = getRig();
    const { audio } = r;
    if (!current || !aloud) {
      audio.pause();
      return;
    }
    if (audio.dataset.message !== current.id) {
      audio.dataset.message = current.id;
      audio.src = api.speechUrl(id, current.id);
    }
    audio.playbackRate = rate;
    if (!playing) {
      audio.pause();
      return;
    }
    if (!r.context) {
      try {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaElementSource(audio).connect(analyser);
        analyser.connect(context.destination);
        Object.assign(r, { context, analyser, samples: new Uint8Array(analyser.fftSize) });
      } catch {
        // No Web Audio: the mouth falls back to a simple rhythm.
      }
    }
    void r.context?.resume().catch(() => undefined);
    audio.play().catch((error: Error) => {
      if (error.name === "NotAllowedError") setBlocked(true);
    });
  }, [options.enabled, id, current, aloud, playing, rate, getRig]);

  // The clock: progress, the mouth level, and silent pacing.
  useEffect(() => {
    if (!playing || !current) {
      setLevel(0);
      return;
    }
    let frame = 0;
    let last = performance.now();
    let level = 0;
    const total = readingSeconds(current);
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let p: number;
      let target = 0;
      const r = rig.current;
      if (aloud && r) {
        const { audio } = r;
        p = audio.duration > 0 && Number.isFinite(audio.duration) ? audio.currentTime / audio.duration : 0;
        if (!audio.paused && audio.currentTime > 0) {
          if (r.analyser && r.samples) {
            r.analyser.getByteTimeDomainData(r.samples);
            let sum = 0;
            for (const s of r.samples) sum += (s - 128) * (s - 128);
            target = Math.min(1, (Math.sqrt(sum / r.samples.length) / 128) * 5.5);
          } else {
            target = 0.35 + 0.3 * Math.sin(now / 90) * Math.sin(now / 37);
          }
        }
      } else {
        elapsed.current += dt * rate;
        p = elapsed.current / total;
        if (current.author.kind === "model") target = 0.3 + 0.3 * Math.sin(now / 95) * Math.sin(now / 41);
        if (p >= 1) {
          advance();
          return;
        }
      }
      level += (target - level) * 0.45;
      setLevel(Math.max(0, level));
      if (Math.abs(p - shown.current) > 0.012) {
        shown.current = p;
        setProgress(p);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, current, aloud, rate, advance]);

  // Warm the next speeches so there is no gap between speakers.
  useEffect(() => {
    if (!options.enabled || !options.speech || muted) return;
    for (const message of items.slice(index, index + 3)) {
      if (message.author.kind !== "model" || prefetched.has(message.id)) continue;
      prefetched.add(message.id);
      void fetch(api.speechUrl(id, message.id)).catch(() => prefetched.delete(message.id));
    }
  }, [options.enabled, options.speech, muted, id, items, index]);

  const play = useCallback(() => {
    setBlocked(false);
    setWanted(true);
    // Play again from the top once everything has been heard.
    if (state.current.index >= state.current.count && !live) setIndex(startIndex(items, false));
  }, [items, live, setIndex]);
  const pause = useCallback(() => setWanted(false), []);

  const status: PlayerStatus = blocked ? "blocked" : !current ? (live ? "waiting" : "ended") : wanted ? "playing" : "paused";

  return {
    items,
    index,
    current,
    status,
    wanted: wanted && !blocked,
    progress: current ? progress : 0,
    muted,
    rate,
    play,
    pause,
    toggle: () => (wanted && !blocked && status !== "ended" ? pause() : play()),
    next: () => setIndex((i) => i + 1),
    prev: () => setIndex((i) => (progress > 0.15 && current ? i : i - 1)),
    seek: (i) => {
      setIndex(i);
      setBlocked(false);
      setWanted(true);
    },
    skipToLive: () => {
      setIndex(state.current.count);
      setWanted(true);
    },
    setMuted: (value) => {
      setMutedState(value);
      writePref("synod:debate-muted", value);
    },
    setRate: (value) => {
      setRateState(value);
      writePref("synod:debate-rate", value);
    }
  };
}

/** A new listener starts at the latest exchange: the last thing the user said and what followed. */
function startIndex(items: ChatMessage[], live: boolean): number {
  let lastUser = 0;
  items.forEach((m, i) => {
    if (m.author.kind === "user") lastUser = i;
  });
  return live || lastUser < items.length - 1 ? lastUser : items.length;
}

/** Plain words for captions: markdown marks removed. */
export function plainText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .trim();
}

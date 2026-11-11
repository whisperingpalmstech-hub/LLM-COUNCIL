// A drawn face for each persona: deterministic from its name, blinks, and moves its mouth
// with the voice level (the --voice-level variable set by the debate player).
import type { CSSProperties } from "react";
import type { CouncilMember, Persona } from "@synod/contracts";
import { cn } from "~/lib/utils";
import { ModelLogo } from "../ModelLogo";

const SKIN = ["#f6d7bd", "#eec39a", "#d9a273", "#b97c50", "#8a5a3a", "#5e3d28"];
const HAIR = ["#1f1a17", "#3b2a20", "#6b4226", "#a0652c", "#c9c2b8", "#7d2f2a", "#2c3140"];
export const HUES = [255, 195, 150, 25, 340, 285, 90, 50];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type AvatarState = "idle" | "speaking" | "thinking" | "dim";

export interface Seat {
  member: Pick<CouncilMember, "id" | "label" | "provider" | "model">;
  persona?: Persona;
  /** Position at the table, for a stable colour. */
  index: number;
}

/** What a seat is called in the room. */
export function seatName(seat: Seat): string {
  return seat.persona?.name || seat.member.label;
}

export function PersonaAvatar({ seat, size = 48, state = "idle", badge = true, className }: { seat: Seat; size?: number; state?: AvatarState; badge?: boolean; className?: string }) {
  const hue = HUES[seat.index % HUES.length];
  const speaking = state === "speaking";
  return (
    <span
      className={cn("avatar relative inline-flex shrink-0", speaking && "is-speaking", state === "thinking" && "is-thinking", state === "dim" && "is-dim", className)}
      style={{ width: size, height: size, "--hue": hue } as CSSProperties}
    >
      <span className="avatar-halo" aria-hidden />
      {state === "thinking" && <span className="seat-ring" aria-hidden />}
      <span className="avatar-disc relative size-full overflow-hidden rounded-full">
        {seat.persona ? <Face seed={`${seat.persona.name}|${seat.member.id}`} feminine={FEMININE.has(seat.persona.voice)} /> : <ModelLogo member={seat.member} className="absolute top-1/2 left-1/2 size-[46%] -translate-x-1/2 -translate-y-1/2" />}
      </span>
      {badge && seat.persona && (
        <span
          className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center rounded-full border bg-card shadow-sm"
          style={{ width: Math.min(34, Math.max(16, size * 0.34)), height: Math.min(34, Math.max(16, size * 0.34)) }}
          title={`Played by ${seat.member.label}`}
        >
          <ModelLogo member={seat.member} className="size-[62%]" />
        </span>
      )}
    </span>
  );
}

/** Voices that sound like women, so the drawn face and the voice agree. */
const FEMININE = new Set(["sarah", "alice", "matilda", "jessica"]);

function Face({ seed, feminine }: { seed: string; feminine: boolean }) {
  const h = hash(seed);
  const pick = <T,>(list: T[], shift: number) => list[(h >>> shift) % list.length];
  const skin = pick(SKIN, 0);
  const hair = pick(HAIR, 4);
  // 0 short, 1 side-swept, 2 long, 3 bun, 4 cropped, 5 bob
  const style = (feminine ? [2, 3, 5, 2] : [0, 4, 1, 0])[(h >>> 9) % 4];
  const glasses = (h >>> 13) % 4 === 0;
  const brow = ((h >>> 16) % 3) - 1;
  const blinkDelay = `${((h >>> 19) % 40) / 10}s`;
  return (
    <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
      {/* shoulders */}
      <path d="M14 108c0-22 16-34 36-34s36 12 36 34z" fill={`oklch(0.42 0.09 var(--hue))`} />
      <path d="M41 70h18v10c0 5-4 8-9 8s-9-3-9-8z" fill={skin} filter="brightness(0.9)" />
      <g className="avatar-head">
        {style === 2 && <path d="M22 50c0-22 12-34 28-34s28 12 28 34v26c0 4-6 6-8 2l-2-30H32l-2 30c-2 4-8 2-8-2z" fill={hair} />}
        {style === 3 && <circle cx="50" cy="15" r="10" fill={hair} />}
        {style === 5 && <path d="M23 50c0-22 12-33 27-33s27 11 27 33v12c0 4-6 5-7 1l-2-20H32l-2 20c-1 4-7 3-7-1z" fill={hair} />}
        <ellipse cx="50" cy="48" rx="23" ry="26" fill={skin} />
        {/* ears */}
        <ellipse cx="27" cy="50" rx="3.5" ry="5.5" fill={skin} />
        <ellipse cx="73" cy="50" rx="3.5" ry="5.5" fill={skin} />
        {/* hair */}
        {style === 0 && <path d="M26 46c-2-18 8-28 24-28s26 10 24 28c-4-9-10-14-24-14S30 37 26 46z" fill={hair} />}
        {style === 1 && <path d="M25 48c-3-20 9-31 25-31s28 11 25 31c-3-8-6-12-10-14-10 4-24 4-32-1-4 3-6 8-8 15z" fill={hair} />}
        {(style === 2 || style === 5) && <path d="M27 44c0-16 9-25 23-25s23 9 23 25c-6-8-13-11-23-11s-17 3-23 11z" fill={hair} />}
        {style === 3 && <path d="M26 44c-1-16 9-24 24-24s25 8 24 24c-5-7-12-10-24-10s-19 3-24 10z" fill={hair} />}
        {style === 4 && <path d="M28 40c2-12 10-19 22-19s20 7 22 19c-6-5-13-7-22-7s-16 2-22 7z" fill={hair} opacity="0.55" />}
        {/* brows */}
        <g stroke={hair} strokeWidth="2" strokeLinecap="round" opacity="0.85">
          <path d={`M36 ${41 + brow}l9 ${-brow}`} />
          <path d={`M55 ${41}l9 ${brow}`} />
        </g>
        {/* eyes */}
        <g className="avatar-eyes" style={{ animationDelay: blinkDelay }} fill="#1d1b1a">
          <ellipse cx="40.5" cy="47" rx="2.6" ry="3.1" />
          <ellipse cx="59.5" cy="47" rx="2.6" ry="3.1" />
        </g>
        {glasses && (
          <g fill="none" stroke="#2a2a2e" strokeWidth="1.6">
            <rect x="32.5" y="41.5" width="15" height="11.5" rx="5" />
            <rect x="52.5" y="41.5" width="15" height="11.5" rx="5" />
            <path d="M47.5 46.5h5" />
          </g>
        )}
        <path d="M50 50v6.5l-2.5 1" fill="none" stroke="#000" strokeOpacity="0.18" strokeWidth="1.6" strokeLinecap="round" />
        {/* mouth: a resting line that opens with the voice */}
        <path d="M43 63.5q7 4 14 0" fill="none" stroke="#6b2f2a" strokeWidth="2" strokeLinecap="round" className="avatar-smile" />
        <ellipse cx="50" cy="64.5" rx="6.5" ry="4.2" fill="#5a1f1c" className="avatar-mouth" />
      </g>
    </svg>
  );
}

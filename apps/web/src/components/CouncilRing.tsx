import type { CSSProperties } from "react";
import { cn } from "~/lib/utils";
import { ModelLogo } from "./ModelLogo";
import { Logo } from "./Sidebar";

const SEATS = [
  { label: "GPT", model: "openai/gpt", provider: "openrouter" },
  { label: "Claude", model: "anthropic/claude", provider: "openrouter" },
  { label: "Gemini", model: "google/gemini", provider: "openrouter" },
  { label: "Grok", model: "x-ai/grok", provider: "openrouter" },
  { label: "DeepSeek", model: "deepseek/deepseek", provider: "openrouter" },
  { label: "GLM", model: "z-ai/glm", provider: "openrouter" }
] as const;

/**
 * The council as a table: lab marks seated around Synod. Plays one orchestrated
 * sequence (seats arrive, lines draw in, the floor passes around twice) and then rests.
 */
export function CouncilRing({ size = 320, className }: { size?: number; className?: string }) {
  const r = size / 2 - 34;
  const c = size / 2;
  const turn = 0.75; // seconds each seat holds the floor
  return (
    <div className={cn("relative", className)} style={{ width: size, height: size }} aria-hidden>
      <svg className="absolute inset-0" width={size} height={size}>
        <circle cx={c} cy={c} r={r} fill="none" className="stroke-border" strokeDasharray="2 6" />
        {SEATS.map((_, i) => {
          const a = (i / SEATS.length) * Math.PI * 2 - Math.PI / 2;
          const len = r - 30;
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * 30}
              y1={c + Math.sin(a) * 30}
              x2={c + Math.cos(a) * (r - 24)}
              y2={c + Math.sin(a) * (r - 24)}
              className="ring-line stroke-border-strong"
              strokeWidth={1}
              strokeDasharray={len}
              style={{ "--len": len, animationDelay: `${300 + i * 90}ms` } as CSSProperties}
            />
          );
        })}
      </svg>
      <div className="absolute top-1/2 left-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card shadow-[var(--shadow-raised)]">
        <Logo className="size-8" />
      </div>
      {SEATS.map((seat, i) => {
        const a = (i / SEATS.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={seat.label}
            className="ring-seat absolute flex flex-col items-center gap-1.5"
            style={{ left: c + Math.cos(a) * r, top: c + Math.sin(a) * r, animationDelay: `${i * 70}ms` } as CSSProperties}
          >
            <span className="relative flex size-12 items-center justify-center rounded-full border bg-card shadow-[var(--shadow-raised)]">
              <span
                className="ring-floor pointer-events-none absolute -inset-1 rounded-full border-2 border-accent-brand"
                style={{ animationDuration: `${turn * SEATS.length}s`, animationDelay: `${1.2 + i * turn}s` }}
              />
              <ModelLogo member={seat} className="size-6" />
            </span>
          </div>
        );
      })}
      <style>{`
        .ring-seat { transform: translate(-50%, -50%); }
        .ring-floor { opacity: 0; }
        @media (prefers-reduced-motion: no-preference) {
          .ring-seat { animation: ring-seat-in 500ms var(--ease-out) both; }
          .ring-line { stroke-dashoffset: var(--len); animation: ring-line-in 700ms var(--ease-out) forwards; }
          .ring-floor { animation-name: ring-floor; animation-timing-function: var(--ease-in-out); animation-iteration-count: 2; animation-fill-mode: both; }
        }
        @keyframes ring-seat-in { from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } }
        @keyframes ring-line-in { to { stroke-dashoffset: 0; } }
        @keyframes ring-floor { 0% { opacity: 0; transform: scale(0.94); } 6% { opacity: 1; transform: scale(1); } 14% { opacity: 0; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}

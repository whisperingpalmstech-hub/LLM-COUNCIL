// The council at work: each member is a seat with its company mark; a slim stepper shows
// where the deliberation is; details unfold into a T3-style work log.
import { Check, ChevronDown, Crown, Globe } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { CouncilMember, Turn, TurnStage } from "@synod/contracts";
import { useDraft } from "~/lib/store";
import { cn, formatDuration } from "~/lib/utils";
import { ModelLogo } from "../ModelLogo";
import type { PanelTab } from "./CouncilPanel";

type SeatState = "waiting" | "thinking" | "writing" | "done" | "skipped" | "failed";

const STEPS: { stage: TurnStage[]; label: string }[] = [
  { stage: ["clarify", "research", "stage1"], label: "Independent opinions" },
  { stage: ["stage2"], label: "Anonymous review" },
  { stage: ["stage3", "brief"], label: "Verdict" }
];

export function CouncilProgress({ turn, onOpenPanel }: { turn: Turn; onOpenPanel: (tab: PanelTab, memberId?: string) => void }) {
  const running = turn.status === "running";
  const [open, setOpen] = useState(false);
  const now = useNow(running);
  const total = (turn.completedAt ? new Date(turn.completedAt).getTime() : now) - new Date(turn.startedAt).getTime();
  const stageElapsed = turn.stageStartedAt ? now - new Date(turn.stageStartedAt).getTime() : 0;

  const stepIndex = turn.status === "completed" ? STEPS.length : Math.max(0, STEPS.findIndex((s) => turn.stage && s.stage.includes(turn.stage)));
  const top = turn.aggregate?.rankings[0]?.memberId;

  if (turn.stage === "clarify" && running) return <Status text="Reading the case…" />;

  return (
    <section className="fade-in rounded-3xl border bg-card px-5 pt-5 pb-3 shadow-[var(--shadow-raised)]" aria-label="Council progress">
      <p className="font-medium text-sm">{running ? statusLine(turn) : turn.status === "completed" ? "The council has reached a verdict" : "The council stopped"}</p>
      <p className="mt-0.5 text-muted-foreground text-xs tabular-nums">
        {turn.council.members.length} members, chaired by {turn.council.chairman.label}. {formatDuration(total)}
      </p>

      <div className="mt-5 flex flex-wrap gap-x-3 gap-y-4" role="list">
        {turn.council.members.map((m, i) => (
          <Seat key={m.id} turn={turn} member={m} index={i} crowned={m.id === top} onOpen={() => onOpenPanel("opinions", m.id)} />
        ))}
      </div>

      <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Stages">
        {STEPS.map((s, i) => {
          const state = i < stepIndex ? "done" : i === stepIndex && running ? "active" : "pending";
          return (
            <li key={s.label} className="min-w-0">
              <div className="h-1 overflow-hidden rounded-full bg-border">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]",
                    state === "done" ? "w-full bg-foreground/75" : state === "active" ? "w-1/2 animate-pulse bg-accent-brand" : "w-0"
                  )}
                />
              </div>
              <p className={cn("mt-1.5 truncate text-2xs", state === "pending" ? "text-faint" : "text-muted-foreground")}>{s.label}</p>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 flex w-full cursor-pointer items-center gap-1 rounded-lg py-1 text-muted-foreground text-xs transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("size-3.5 transition-transform duration-200 ease-out", open && "rotate-180")} />
        {open ? "Hide details" : "Show details"}
      </button>

      {open && (
        <div className="mt-1 border-t pt-2 pb-1">
          {turn.research.length > 0 && <Row icon={<Globe className="size-3.5" />} label={`Web research: ${turn.research.length} sources`} />}
          <Group title="Independent opinions">
            {turn.council.members.map((m) => {
              const r = turn.stage1.find((x) => x.memberId === m.id);
              return (
                <Row
                  key={m.id}
                  icon={<ModelLogo member={m} className="size-3.5" />}
                  label={r?.error ? `${m.label}: ${skippedText(r.error)}` : m.label}
                  trailing={r ? formatDuration(r.ms) : turn.stage === "stage1" && running ? formatDuration(stageElapsed) : ""}
                  onClick={r && !r.error ? () => onOpenPanel("opinions", m.id) : undefined}
                />
              );
            })}
          </Group>
          {turn.stage2.length > 0 && (
            <Group title="Anonymous review">
              {turn.stage2.map((r) => {
                const m = turn.council.members.find((x) => x.id === r.memberId);
                return (
                  <Row
                    key={r.memberId}
                    icon={m ? <ModelLogo member={m} className="size-3.5" /> : null}
                    label={r.error ? `${r.label}: ${skippedText(r.error)}` : `${r.label} ranked ${r.ranking.length} answers`}
                    onClick={!r.error ? () => onOpenPanel("reviews", r.memberId) : undefined}
                  />
                );
              })}
              {turn.aggregate && <Row icon={<Crown className="size-3.5 text-amber-500" />} label="See who ranked whom" onClick={() => onOpenPanel("agreement")} />}
            </Group>
          )}
        </div>
      )}
    </section>
  );
}

function statusLine(turn: Turn): string {
  switch (turn.stage) {
    case "research":
      return "Searching the web…";
    case "stage1":
      return `Forming independent opinions: ${turn.stage1.length} of ${turn.council.members.length} in`;
    case "stage2":
      return "Reviewing each other's answers anonymously…";
    case "stage3":
    case "brief":
      return `${turn.council.chairman.label} is weighing the opinions…`;
    default:
      return "Convening the council…";
  }
}

function skippedText(error: string): string {
  return error.startsWith("Too slow") ? "skipped (too slow)" : "failed";
}

function seatState(turn: Turn, memberId: string, draft: string | undefined): SeatState {
  const r = turn.stage1.find((x) => x.memberId === memberId);
  if (r) return r.error ? (r.error.startsWith("Too slow") ? "skipped" : "failed") : "done";
  if (turn.status !== "running") return "skipped";
  if (turn.stage !== "stage1" && turn.stage !== "research") return "waiting";
  return draft ? "writing" : "thinking";
}

function Seat({ turn, member, index, crowned, onOpen }: { turn: Turn; member: CouncilMember; index: number; crowned: boolean; onOpen: () => void }) {
  const draft = useDraft(turn.id, `stage1:${member.id}`);
  const answered = turn.stage1.some((r) => r.memberId === member.id && !r.error);
  const reviewing = turn.stage === "stage2" && turn.status === "running" && answered && !turn.stage2.some((r) => r.memberId === member.id);
  const state = seatState(turn, member.id, draft);
  const busy = state === "thinking" || state === "writing" || reviewing;
  const words = draft ? draft.split(/\s+/).length : 0;
  const caption = reviewing ? "Reviewing" : state === "writing" ? `${words} words` : state === "thinking" ? "Thinking" : state === "done" ? "Answered" : state === "skipped" ? "Skipped" : state === "failed" ? "Failed" : "Waiting";

  return (
    <button
      type="button"
      role="listitem"
      onClick={onOpen}
      className="group reveal flex w-[4.75rem] cursor-pointer flex-col items-center gap-2 rounded-2xl pt-1 pb-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      style={{ "--i": index } as React.CSSProperties}
      title={`${member.label} (${member.model || member.provider})`}
    >
      <span className="relative">
        {busy && <span className="seat-ring" aria-hidden />}
        <span
          className={cn(
            "relative flex size-11 items-center justify-center rounded-full border bg-background transition-[opacity,filter,scale] duration-300 ease-out group-active:scale-[0.96]",
            (state === "skipped" || state === "waiting") && !reviewing && "opacity-45 grayscale",
            state === "failed" && "opacity-45"
          )}
        >
          <ModelLogo member={member} className="size-5" />
        </span>
        {state === "done" && !busy && (
          <span className="fade-in absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-success text-white ring-2 ring-card">
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        )}
        {crowned && (
          <span className="fade-in absolute -top-2.5 left-1/2 -translate-x-1/2" title="Ranked best by the council">
            <Crown className="size-3.5 fill-amber-400 text-amber-500" />
          </span>
        )}
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate font-medium text-xs">{member.label}</span>
        <span className={cn("block truncate text-2xs tabular-nums", busy ? "text-accent-brand" : "text-faint")}>{caption}</span>
      </span>
    </button>
  );
}

function Status({ text }: { text: string }) {
  return (
    <div className="fade-in flex items-center gap-2.5 px-1 text-sm">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-brand opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-accent-brand" />
      </span>
      <span className="live-shine">{text}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <p className="px-1 pb-0.5 font-medium text-2xs text-faint">{title}</p>
      {children}
    </div>
  );
}

function Row({ icon, label, trailing, onClick }: { icon: ReactNode; label: string; trailing?: string; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} className={cn("flex min-h-7 w-full items-center gap-2 rounded-lg px-1 text-left text-[0.8125rem]", onClick && "cursor-pointer hover:bg-accent")}>
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
      {trailing && <span className="shrink-0 text-2xs text-faint tabular-nums">{trailing}</span>}
    </Comp>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

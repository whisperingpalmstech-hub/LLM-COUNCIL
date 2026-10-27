import { ChevronDown, FileText, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Turn } from "@synod/contracts";
import { api } from "~/lib/api";
import { useDraft } from "~/lib/store";
import { cn } from "~/lib/utils";
import { CopyButton, Markdown } from "../Markdown";
import { ModelLogo } from "../ModelLogo";
import { Button } from "../ui/button";
import { BriefCard } from "./BriefCard";
import type { PanelTab } from "./CouncilPanel";
import { CouncilProgress } from "./CouncilProgress";

export function TurnBlock({
  conversationId,
  turn,
  hermesConfigured,
  onOpenPanel
}: {
  conversationId: string;
  turn: Turn;
  hermesConfigured: boolean;
  onOpenPanel: (tab: PanelTab, memberId?: string) => void;
}) {
  return (
    <section className="flex flex-col gap-5">
      {turn.wrapUp ? (
        <p className="mt-6 flex items-center justify-center gap-2 text-muted-foreground text-xs">
          <span className="h-px flex-1 bg-border" />
          {turn.status === "running" ? <span className="live-shine">{turn.council.chairman.label} is wrapping up the discussion…</span> : `Wrapped up by ${turn.council.chairman.label}`}
          <span className="h-px flex-1 bg-border" />
        </p>
      ) : (
        <>
          <UserCase turn={turn} />
          {turn.clarification && <Intake conversationId={conversationId} turn={turn} />}
          {turn.clarification?.answer !== undefined || !turn.clarification ? <CouncilProgress turn={turn} onOpenPanel={onOpenPanel} /> : null}
        </>
      )}
      {turn.brief && <BriefCard conversationId={conversationId} turn={turn} brief={turn.brief} hermesConfigured={hermesConfigured} />}
      {!turn.brief && turn.briefError && (
        <p className="fade-in flex items-start gap-2.5 rounded-2xl bg-warning-surface px-4 py-3 text-sm text-warning-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {turn.briefError}
        </p>
      )}
      {turn.synthesis ? <FullOpinion turn={turn} defaultOpen={!turn.brief && turn.status === "completed"} /> : turn.status === "running" && <StreamingOpinion turn={turn} />}
      {turn.status === "failed" && (
        <div className="fade-in flex items-start gap-3 rounded-2xl bg-error-surface px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error" />
          <p className="flex-1 text-error-foreground">{turn.error}</p>
          {turn.error !== "Cancelled." && (
            <Button size="sm" variant="outline" onClick={() => api.send(conversationId, turn.prompt)}>
              <RotateCcw />
              Retry
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function UserCase({ turn }: { turn: Turn }) {
  const [expanded, setExpanded] = useState(false);
  const long = turn.prompt.length > 600;
  return (
    <div className="ml-auto max-w-[85%]">
      <div className="rounded-[1.25rem] rounded-br-md bg-message px-4 py-3">
        <div className={cn("relative overflow-hidden", long && !expanded && "max-h-48")}>
          <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{turn.prompt}</p>
          {long && !expanded && <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-message" />}
        </div>
        {long && (
          <button type="button" className="mt-1 cursor-pointer text-muted-foreground text-xs hover:text-foreground" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : "Show full case"}
          </button>
        )}
      </div>
      {turn.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
          {turn.attachments.map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="inline-flex max-w-56 items-center gap-1.5 rounded-full border bg-card py-1 pr-2.5 pl-2 text-xs transition-colors hover:bg-accent">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{a.name}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Intake({ conversationId, turn }: { conversationId: string; turn: Turn }) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const c = turn.clarification!;
  const waiting = turn.status === "awaiting_clarification";
  const submit = async (value: string) => {
    setSending(true);
    try {
      await api.answer(conversationId, value);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={cn("fade-in rounded-3xl border px-5 py-4", waiting ? "border-warning/30 bg-warning-surface" : "bg-card")}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span className="flex size-5 items-center justify-center rounded-full border bg-background">
          <ModelLogo member={turn.council.chairman} className="size-3" />
        </span>
        {waiting ? "Before the council starts, one question" : "Intake"}
      </div>
      <p className="mt-2 text-[0.9375rem] leading-relaxed">{c.question}</p>
      {c.answer !== undefined ? (
        <p className="mt-2.5 border-l-2 border-border-strong pl-3 text-muted-foreground text-sm">{c.answer || "Skipped. The council will state its assumptions."}</p>
      ) : (
        waiting && (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(answer);
            }}
          >
            <textarea
              autoFocus
              rows={2}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (answer.trim()) void submit(answer);
                }
              }}
              placeholder="Your answer…"
              className="w-full resize-none rounded-2xl border border-border-strong bg-card px-4 py-3 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button variant="ghost-muted" size="sm" disabled={sending} onClick={() => submit("")}>
                Skip, let the council assume
              </Button>
              <Button type="submit" size="sm" disabled={sending || !answer.trim()}>
                Answer
              </Button>
            </div>
          </form>
        )
      )}
    </div>
  );
}

/** The chairman's opinion, rendered as it is written. */
function StreamingOpinion({ turn }: { turn: Turn }) {
  const text = useDraft(turn.id, "synthesis");
  if (!text) return null;
  return (
    <div className="fade-in rounded-3xl border bg-card">
      <div className="flex items-center gap-2 px-5 py-3.5">
        <ModelLogo member={turn.council.chairman} className="size-3.5" />
        <span className="live-shine flex-1 font-medium text-sm">{turn.council.chairman.label} is writing the full opinion…</span>
      </div>
      <div className="border-t px-6 py-5">
        <Markdown text={text} />
      </div>
    </div>
  );
}

function FullOpinion({ turn, defaultOpen }: { turn: Turn; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const s = turn.synthesis!;
  return (
    <div className="rounded-3xl border bg-card">
      <button type="button" className="flex w-full cursor-pointer items-center gap-2.5 rounded-3xl px-5 py-3.5 text-left transition-colors hover:bg-accent/60" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ModelLogo member={turn.council.chairman} className="size-3.5" />
        <span className="flex-1 font-medium text-sm">Full opinion</span>
        <span className="text-muted-foreground text-xs">Written by {s.label}</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200 ease-out", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-6 py-5">
          {s.error && <p className="mb-3 rounded-lg bg-warning-surface px-3 py-2 text-warning-foreground text-xs">{s.error}</p>}
          <Markdown text={s.text} />
          <div className="mt-4 flex justify-end">
            <CopyButton text={s.text} label={<span className="text-xs">Copy</span>} />
          </div>
        </div>
      )}
    </div>
  );
}

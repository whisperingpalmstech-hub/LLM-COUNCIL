import { ChevronDown, FileText, MessageCircleQuestion, RotateCcw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Turn } from "@synod/contracts";
import { api } from "~/lib/api";
import { useDraft } from "~/lib/store";
import { cn } from "~/lib/utils";
import { CopyButton, Markdown } from "../Markdown";
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
    <section className="flex flex-col gap-4">
      <UserCase turn={turn} />
      {turn.clarification && <Intake conversationId={conversationId} turn={turn} />}
      {turn.clarification?.answer !== undefined || !turn.clarification ? <CouncilProgress turn={turn} onOpenPanel={onOpenPanel} /> : null}
      {turn.brief && <BriefCard conversationId={conversationId} turn={turn} brief={turn.brief} hermesConfigured={hermesConfigured} />}
      {turn.synthesis ? <FullOpinion turn={turn} defaultOpen={!turn.brief && turn.status === "completed"} /> : turn.status === "running" && <StreamingOpinion turn={turn} />}
      {turn.status === "failed" && (
        <div className="rise-in flex items-start gap-3 rounded-xl border border-error/30 bg-error-surface p-3 text-sm">
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
    <div className="ml-auto max-w-[85%] rise-in">
      <div className="rounded-2xl rounded-br-md bg-message px-4 py-3">
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
            <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="inline-flex max-w-56 items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-xs hover:bg-accent">
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
    <div className={cn("rise-in rounded-xl border p-4", waiting ? "border-warning/40 bg-warning-surface" : "bg-card")}>
      <div className="flex items-start gap-3">
        <MessageCircleQuestion className={cn("mt-0.5 size-4 shrink-0", waiting ? "text-warning" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-2xs text-muted-foreground uppercase tracking-[0.08em]">{waiting ? "The council needs one detail" : "Intake"}</p>
          <p className="mt-1 text-[0.9375rem]">{c.question}</p>
          {c.answer !== undefined ? (
            <p className="mt-2 border-l-2 pl-3 text-muted-foreground text-sm">{c.answer}</p>
          ) : (
            waiting && (
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
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
                      void submit(answer);
                    }
                  }}
                  placeholder="Your answer…"
                  className="min-w-0 flex-1 resize-none rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-ring/60"
                />
                <div className="flex gap-2 sm:flex-col">
                  <Button type="submit" size="sm" disabled={sending || !answer.trim()}>
                    Answer
                  </Button>
                  <Button variant="ghost-muted" size="sm" disabled={sending} onClick={() => submit("")}>
                    Skip
                  </Button>
                </div>
              </form>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** The chairman's opinion, rendered as it is written. */
function StreamingOpinion({ turn }: { turn: Turn }) {
  const text = useDraft(turn.id, "synthesis");
  if (!text) return null;
  return (
    <div className="rise-in rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="live-shine flex-1 font-medium text-sm">Council opinion · writing…</span>
        <span className="text-muted-foreground text-xs">by {turn.council.chairman.label}</span>
      </div>
      <div className="border-t px-5 py-4">
        <Markdown text={text} />
      </div>
    </div>
  );
}

function FullOpinion({ turn, defaultOpen }: { turn: Turn; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const s = turn.synthesis!;
  return (
    <div className="rise-in rounded-xl border bg-card">
      <button type="button" className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex-1 font-medium text-sm">Full council opinion</span>
        <span className="text-muted-foreground text-xs">by {s.label}</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-5 py-4">
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

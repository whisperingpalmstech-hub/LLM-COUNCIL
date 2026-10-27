import { AlertOctagon, CircleHelp, Download, GitCompareArrows, Handshake, Send } from "lucide-react";
import { useState } from "react";
import type { Brief, BriefItem, NextStep, Turn } from "@synod/contracts";
import { api } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { cn } from "~/lib/utils";
import { Button, buttonVariants } from "../ui/button";
import { Badge, Eyebrow } from "../ui/misc";

export function BriefCard({ conversationId, turn, brief, hermesConfigured }: { conversationId: string; turn: Turn; brief: Brief; hermesConfigured: boolean }) {
  const mode = MODE_UI[brief.mode];
  const ModeIcon = mode.icon;
  return (
    <article className="rise-in overflow-hidden rounded-2xl border bg-card shadow-xs/5">
      <header className="border-b px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <ModeIcon className={cn("size-3.5", mode.tint)} />
          <span>Second opinion · {mode.label}</span>
          {brief.version > 1 && <span>· v{brief.version}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h2 className="min-w-0 flex-1 font-semibold text-xl leading-snug tracking-tight">{brief.verdict || "Assessment"}</h2>
          <ConfidenceMeter value={brief.confidence} />
        </div>
        {brief.bottomLine && <p className="mt-2 text-[0.9375rem] text-foreground/90 leading-relaxed">{brief.bottomLine}</p>}
      </header>

      <div className="flex flex-col gap-6 px-5 py-5">
        {brief.redFlags.length > 0 && (
          <div className="rounded-xl border border-error/30 bg-error-surface p-3.5">
            <p className="flex items-center gap-1.5 font-semibold text-error-foreground text-xs uppercase tracking-[0.06em]">
              <AlertOctagon className="size-3.5" /> Red flags
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {brief.redFlags.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-error" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {brief.sections.map((section) => (
          <Section key={section.title} title={section.title} items={section.items} />
        ))}

        {brief.nextSteps.length > 0 && (
          <div>
            <Eyebrow>Next steps</Eyebrow>
            <ol className="mt-2 flex flex-col gap-2">
              {brief.nextSteps.map((s, i) => (
                <StepRow key={i} index={i + 1} step={s} />
              ))}
            </ol>
          </div>
        )}

        {(brief.consensus.length > 0 || brief.disagreements.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {brief.consensus.length > 0 && (
              <div className="rounded-xl border bg-muted/50 p-3.5">
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <Handshake className="size-4 text-success" /> Where the council agreed
                </p>
                <ul className="mt-2 space-y-1.5 text-muted-foreground text-sm">
                  {brief.consensus.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.disagreements.length > 0 && (
              <div className="rounded-xl border bg-muted/50 p-3.5">
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <GitCompareArrows className="size-4 text-warning" /> Where it disagreed
                </p>
                <ul className="mt-2 space-y-3 text-sm">
                  {brief.disagreements.map((d, i) => (
                    <li key={i}>
                      <p>{d.point}</p>
                      <ul className="mt-1 space-y-1 border-l-2 pl-3 text-muted-foreground text-xs">
                        {d.positions.map((p, j) => (
                          <li key={j}>{p}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {brief.openQuestions.length > 0 && (
          <div>
            <Eyebrow>Would change the opinion</Eyebrow>
            <ul className="mt-2 space-y-1.5 text-sm">
              {brief.openQuestions.map((q, i) => (
                <li key={i} className="flex gap-2 text-muted-foreground">
                  <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t bg-muted/40 px-5 py-3">
        {brief.caveats.length > 0 && <p className="mr-auto max-w-md text-2xs text-muted-foreground leading-snug">{brief.caveats.join(" ")}</p>}
        <div className="ml-auto flex items-center gap-2">
          <a className={buttonVariants({ variant: "outline", size: "sm" })} href={api.briefUrl(conversationId, turn.id)} download>
            <Download /> Export
          </a>
          {brief.mode === "code" && <Handoff conversationId={conversationId} turn={turn} configured={hermesConfigured} />}
        </div>
      </footer>
    </article>
  );
}

function Section({ title, items }: { title: string; items: BriefItem[] }) {
  const ranked = items.some((i) => i.level);
  return (
    <div>
      <Eyebrow>{title}</Eyebrow>
      <ul className="mt-2 divide-y rounded-xl border">
        {items.map((item, i) => (
          <li key={i} className="flex gap-3 px-3.5 py-2.5">
            {ranked && <LevelBar level={item.level} />}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-sm">{item.text}</p>
              {item.detail && <p className="mt-0.5 text-muted-foreground text-sm leading-relaxed">{item.detail}</p>}
            </div>
            {item.level && (
              <Badge tone={item.level === "high" ? "error" : item.level === "medium" ? "warning" : "neutral"} className="self-start capitalize">
                {item.level}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LevelBar({ level }: { level?: BriefItem["level"] }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  const color = level === "high" ? "bg-error" : level === "medium" ? "bg-warning" : "bg-muted-foreground/60";
  return (
    <div className="mt-1 flex h-3.5 shrink-0 items-end gap-0.5" aria-hidden>
      {[1, 2, 3].map((n) => (
        <span key={n} className={cn("w-1 rounded-sm", n <= filled ? color : "bg-border")} style={{ height: `${4 + n * 3}px` }} />
      ))}
    </div>
  );
}

function StepRow({ index, step }: { index: number; step: NextStep }) {
  const tone = step.urgency === "now" ? "error" : step.urgency === "soon" ? "warning" : "neutral";
  return (
    <li className="flex gap-3 rounded-xl border px-3.5 py-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-2xs text-primary">{index}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{step.action}</p>
        {step.why && <p className="mt-0.5 text-muted-foreground text-sm">{step.why}</p>}
      </div>
      <Badge tone={tone} className="self-start capitalize">
        {step.urgency}
      </Badge>
    </li>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const label = pct >= 75 ? "High" : pct >= 50 ? "Moderate" : "Low";
  return (
    <div className="w-36 shrink-0" title="The council's own estimate of its confidence">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">Confidence</span>
        <span className="font-medium tabular-nums">
          {label} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={cn("h-full rounded-full transition-[width] duration-700", pct >= 75 ? "bg-success" : pct >= 50 ? "bg-primary" : "bg-warning")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Handoff({ conversationId, turn, configured }: { conversationId: string; turn: Turn; configured: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  if (turn.handoff)
    return <Badge tone={turn.handoff.ok ? "success" : "error"}>{turn.handoff.ok ? (turn.handoff.simulated ? "Hand-off simulated" : "Sent to agent") : `Hand-off failed: ${turn.handoff.error}`}</Badge>;
  if (!confirming)
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        <Send /> Send to agent{configured ? "" : " (simulated)"}
      </Button>
    );
  return (
    <span className="flex items-center gap-2 text-xs">
      Authorize your agent to act on this?
      <Button
        size="sm"
        disabled={sending}
        onClick={async () => {
          setSending(true);
          await api.handoff(conversationId, turn.id).finally(() => setSending(false));
        }}
      >
        Send
      </Button>
      <Button size="sm" variant="ghost-muted" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

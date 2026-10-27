// The second opinion, set like a document: a serif verdict, then the reasoning in quiet sections.
import { AlertTriangle, Check, Copy, Download, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { Brief, BriefItem, CouncilMember, Turn } from "@synod/contracts";
import { api } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { cn } from "~/lib/utils";
import { ModelLogo } from "../ModelLogo";
import { Button, buttonVariants } from "../ui/button";
import { Badge, SectionTitle } from "../ui/misc";

const LEVEL_WORD: Record<string, Record<NonNullable<BriefItem["level"]>, string>> = {
  likelihood: { high: "Most likely", medium: "Possible", low: "Less likely" },
  severity: { high: "Serious", medium: "Moderate", low: "Minor" },
  priority: { high: "First", medium: "Next", low: "Later" },
  strength: { high: "Strong", medium: "Moderate", low: "Weak" }
};

function levelKind(title: string): keyof typeof LEVEL_WORD {
  const t = title.toLowerCase();
  // Severity first: "Can't-miss diagnoses" is about danger, not likelihood.
  if (/bug|risk|can.?t.?miss/.test(t)) return "severity";
  if (/differential|diagnos|options/.test(t)) return "likelihood";
  if (/argument/.test(t)) return "strength";
  return "priority";
}

export function BriefCard({ conversationId, turn, brief, hermesConfigured }: { conversationId: string; turn: Turn; brief: Brief; hermesConfigured: boolean }) {
  const mode = MODE_UI[brief.mode];
  const ModeIcon = mode.icon;
  // Animate the reveal only when the brief has just arrived, not when revisiting a case.
  const fresh = Boolean(turn.completedAt ? Date.now() - new Date(turn.completedAt).getTime() < 15_000 : turn.status === "running");
  let i = 0;
  const step = () => (fresh ? { className: "reveal", style: { "--i": i++ } as React.CSSProperties } : {});

  return (
    <article className="overflow-hidden rounded-3xl border bg-card shadow-[var(--shadow-raised)]">
      <header className="px-6 pt-6 pb-5 sm:px-8 sm:pt-8">
        <div {...step()}>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <ModeIcon className={cn("size-3.5", mode.tint)} />
            <span>{mode.label} second opinion</span>
            {brief.version > 1 && <span className="text-faint">(revision {brief.version})</span>}
          </div>
          <h2 className="mt-3 font-serif text-[1.75rem] leading-[1.15] tracking-[-0.015em] sm:text-[2rem]" style={{ fontVariationSettings: '"opsz" 36' }}>
            {brief.verdict || "Assessment"}
          </h2>
          {brief.bottomLine && <p className="mt-3 max-w-[62ch] font-serif text-[1.0625rem] text-foreground/80 leading-relaxed">{brief.bottomLine}</p>}
        </div>
        <div {...step()} className={cn("mt-5 flex flex-wrap items-center gap-x-6 gap-y-3", fresh && "reveal")}>
          <ConfidenceMeter value={brief.confidence} animate={fresh} />
          {brief.agreement != null && <Agreement value={brief.agreement} reviewers={turn.aggregate?.rankings.length ?? 0} rounds={turn.rounds ?? 3} converged={Boolean(turn.convergedEarly)} />}
          <CouncilStack members={turn.council.members} />
        </div>
      </header>

      <div className="flex flex-col gap-7 border-t px-6 py-6 sm:px-8">
        {brief.redFlags.length > 0 && (
          <div {...step()}>
            <div className="rounded-2xl bg-error-surface px-4 py-3.5">
              <SectionTitle icon={<AlertTriangle className="!text-error" />} className="text-error-foreground">
                Needs attention now
              </SectionTitle>
              <ul className="mt-2 space-y-1.5 text-[0.9375rem]">
                {brief.redFlags.map((f, k) => (
                  <li key={k} className="flex gap-2.5">
                    <span className="mt-2.5 size-1 shrink-0 rounded-full bg-error" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {brief.sections.map((section) => (
          <div key={section.title} {...step()}>
            <SectionTitle>{section.title}</SectionTitle>
            <ul className="mt-2 divide-y">
              {section.items.map((item, k) => (
                <li key={k} className="flex gap-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[0.9375rem]">{item.text}</p>
                    {item.detail && <p className="mt-0.5 text-muted-foreground text-sm leading-relaxed">{item.detail}</p>}
                  </div>
                  {item.level && <Level level={item.level} word={LEVEL_WORD[levelKind(section.title)][item.level]} />}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {brief.nextSteps.length > 0 && (
          <div {...step()}>
            <SectionTitle>Next steps</SectionTitle>
            <ol className="mt-2 divide-y">
              {brief.nextSteps.map((s, k) => (
                <li key={k} className="flex gap-3.5 py-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border font-medium text-2xs text-muted-foreground tabular-nums">{k + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[0.9375rem]">{s.action}</p>
                    {s.why && <p className="mt-0.5 text-muted-foreground text-sm">{s.why}</p>}
                  </div>
                  {s.urgency === "now" && <Badge tone="error" className="self-start">Now</Badge>}
                  {s.urgency === "later" && <span className="self-start pt-0.5 text-2xs text-faint">Later</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {(brief.consensus.length > 0 || brief.disagreements.length > 0) && (
          <div {...step()} className={cn("grid gap-6 sm:grid-cols-2", fresh && "reveal")}>
            {brief.consensus.length > 0 && (
              <div>
                <SectionTitle>Where the council agreed</SectionTitle>
                <ul className="mt-2 space-y-2 text-muted-foreground text-sm">
                  {brief.consensus.map((c, k) => (
                    <li key={k} className="flex gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {brief.disagreements.length > 0 && (
              <div>
                <SectionTitle>Where it disagreed</SectionTitle>
                <ul className="mt-2 space-y-4 text-sm">
                  {brief.disagreements.map((d, k) => (
                    <li key={k}>
                      <p className="font-medium">{d.point}</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {d.positions.map((p, j) => (
                          <Position key={j} text={p} members={[...turn.council.members, turn.council.chairman]} />
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
          <div {...step()}>
            <SectionTitle>What would change this opinion</SectionTitle>
            <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-muted-foreground text-sm sm:grid-cols-2">
              {brief.openQuestions.map((q, k) => (
                <li key={k} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3 border-t bg-muted/60 px-6 py-3.5 sm:px-8">
        {brief.caveats.length > 0 && <p className="mr-auto max-w-md text-2xs text-muted-foreground leading-snug">{brief.caveats.join(" ")}</p>}
        <div className="ml-auto flex items-center gap-1.5">
          <CopyBrief conversationId={conversationId} turnId={turn.id} />
          <a className={buttonVariants({ variant: "outline", size: "sm" })} href={api.briefUrl(conversationId, turn.id)} download>
            <Download /> Export
          </a>
          {brief.mode === "code" && <Handoff conversationId={conversationId} turn={turn} configured={hermesConfigured} />}
        </div>
      </footer>
    </article>
  );
}

/** Puts the member's mark next to a disagreement position that names them. */
function Position({ text, members }: { text: string; members: CouncilMember[] }) {
  const member = members.find((m) => text.toLowerCase().startsWith(m.label.toLowerCase()) || text.toLowerCase().includes(m.label.toLowerCase()));
  return (
    <li className="flex gap-2 text-muted-foreground">
      {member ? <ModelLogo member={member} className="mt-0.5 size-3.5" /> : <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />}
      <span className="min-w-0">{text}</span>
    </li>
  );
}

function Level({ level, word }: { level: NonNullable<BriefItem["level"]>; word: string }) {
  const filled = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const color = level === "high" ? "bg-foreground" : level === "medium" ? "bg-foreground/55" : "bg-foreground/30";
  return (
    <span className="flex shrink-0 items-center gap-2 self-start pt-1 text-2xs text-muted-foreground" title={word}>
      <span className="hidden sm:inline">{word}</span>
      <span className="flex items-end gap-[3px]" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={cn("w-[3px] rounded-full", n <= filled ? color : "bg-border-strong")} style={{ height: `${4 + n * 3}px` }} />
        ))}
      </span>
    </span>
  );
}

function ConfidenceMeter({ value, animate }: { value: number; animate: boolean }) {
  const pct = Math.round(value * 100);
  const label = pct >= 75 ? "High confidence" : pct >= 50 ? "Moderate confidence" : "Low confidence";
  // The chairman's own estimate; the measured agreement sits next to it.
  const [shown, setShown] = useState(animate ? 0 : pct);
  // Fill once, after the verdict has settled.
  useEffect(() => {
    if (!animate) return setShown(pct);
    const t = setTimeout(() => setShown(pct), 160);
    return () => clearTimeout(t);
  }, [animate, pct]);
  return (
    <div className="flex items-center gap-3" title="The council's own estimate">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-foreground transition-[width] duration-[900ms] ease-[var(--ease-out)]" style={{ width: `${shown}%` }} />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {label}, {pct}%
      </span>
    </div>
  );
}

/** Measured, not self-reported: how many reviewers independently picked the same best answer. */
function Agreement({ value, reviewers, rounds, converged }: { value: number; reviewers: number; rounds: number; converged: boolean }) {
  const pct = Math.round(value * 100);
  const word = pct >= 99 ? "Unanimous" : pct >= 60 ? "Majority agreed" : "Split council";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs", pct >= 99 ? "bg-success/12 text-success-foreground" : pct >= 60 ? "bg-muted text-muted-foreground" : "bg-warning-surface text-warning-foreground")}
      title={`Share of the ${reviewers} reviewers whose top pick (ignoring their own answer) matched the overall winner. ${rounds} rounds${converged ? ", stopped early on consensus" : ""}.`}
    >
      {word}
      <span className="tabular-nums opacity-70">{pct}%</span>
    </span>
  );
}

function CouncilStack({ members }: { members: CouncilMember[] }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs">
      <span className="flex -space-x-1.5">
        {members.map((m) => (
          <span key={m.id} className="flex size-6 items-center justify-center rounded-full border bg-background ring-2 ring-card" title={m.label}>
            <ModelLogo member={m} className="size-3.5" />
          </span>
        ))}
      </span>
      Weighed by {members.length} models
    </div>
  );
}

function CopyBrief({ conversationId, turnId }: { conversationId: string; turnId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      onClick={async () => {
        const text = await fetch(api.briefUrl(conversationId, turnId)).then((r) => r.text());
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Handoff({ conversationId, turn, configured }: { conversationId: string; turn: Turn; configured: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  if (turn.handoff)
    return <Badge tone={turn.handoff.ok ? "success" : "error"}>{turn.handoff.ok ? (turn.handoff.simulated ? "Hand-off simulated" : "Sent to agent") : `Hand-off failed: ${turn.handoff.error}`}</Badge>;
  if (!confirming)
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        <Send /> Send to agent{configured ? "" : " (simulated)"}
      </Button>
    );
  return (
    <span className="flex items-center gap-2 text-xs">
      Let your agent act on this?
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

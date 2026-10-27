// The intake as a short form: up to three questions, each with quick options and "Other".
import { Check, Loader2, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import type { IntakeQuestion, Turn } from "@synod/contracts";
import { api } from "~/lib/api";
import { cn } from "~/lib/utils";
import { ModelLogo } from "../ModelLogo";
import { Button } from "../ui/button";

type Answer = { picked: string[]; other: string };

export function IntakeForm({ conversationId, turn }: { conversationId: string; turn: Turn }) {
  const c = turn.clarification!;
  const questions = c.questions ?? [];
  const waiting = turn.status === "awaiting_clarification";
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => Object.fromEntries(questions.map((q) => [q.id, { picked: [], other: "" }])));
  const [sending, setSending] = useState(false);

  const set = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));
  const toggle = (q: IntakeQuestion, option: string) => {
    const current = answers[q.id].picked;
    const picked = q.multiple ? (current.includes(option) ? current.filter((o) => o !== option) : [...current, option]) : current[0] === option ? [] : [option];
    set(q.id, { picked });
  };
  const valueOf = (q: IntakeQuestion) => [...answers[q.id].picked, answers[q.id].other.trim()].filter(Boolean).join("; ");
  const answered = questions.filter((q) => valueOf(q)).length;

  const submit = async (skip = false) => {
    setSending(true);
    try {
      const text = skip ? "" : questions.map((q) => `${q.question} ${valueOf(q) || "(not answered)"}`).join("\n");
      await api.answer(conversationId, text);
    } finally {
      setSending(false);
    }
  };

  // Answered: show the questions with what was chosen.
  if (c.answer !== undefined) {
    const lines = c.answer.split("\n");
    return (
      <div className="fade-in rounded-3xl border bg-card px-5 py-4">
        <Header turn={turn} title="Intake" />
        {c.answer.startsWith("(no answer") ? (
          <p className="mt-2 text-muted-foreground text-sm">Skipped. The council will state its assumptions.</p>
        ) : (
          <dl className="mt-2.5 space-y-2 text-sm">
            {questions.map((q, i) => (
              <div key={q.id}>
                <dt className="text-muted-foreground">{q.question}</dt>
                <dd className="mt-0.5 font-medium">{lines[i]?.slice(q.question.length).trim() || "(not answered)"}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  }

  if (!waiting) return null;

  return (
    <form
      className="fade-in rounded-3xl border border-warning/30 bg-warning-surface px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Header turn={turn} title={questions.length > 1 ? `Before the council starts, ${questions.length} quick questions` : "Before the council starts, one question"} />
      <div className="mt-3 flex flex-col gap-5">
        {questions.map((q, i) => (
          <fieldset key={q.id}>
            <legend className="flex items-baseline gap-2 text-[0.9375rem]">
              <span className="text-faint text-xs tabular-nums">{i + 1}</span>
              {q.question}
              {q.multiple && <span className="text-2xs text-muted-foreground">Choose any</span>}
            </legend>
            {q.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-4" role={q.multiple ? "group" : "radiogroup"}>
                {q.options.map((o) => {
                  const on = answers[q.id].picked.includes(o);
                  return (
                    <button
                      key={o}
                      type="button"
                      role={q.multiple ? "checkbox" : "radio"}
                      aria-checked={on}
                      onClick={() => toggle(q, o)}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-[background-color,border-color,color,scale] duration-150 active:scale-[0.97]",
                        on ? "border-foreground bg-foreground text-background" : "border-border-strong bg-card hover:bg-accent"
                      )}
                    >
                      {on && <Check className="size-3.5" />}
                      {o}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              value={answers[q.id].other}
              onChange={(e) => {
                const other = e.target.value;
                // Writing your own answer replaces a single-choice pick.
                set(q.id, q.multiple || !other ? { other } : { other, picked: [] });
              }}
              placeholder={q.options.length ? "Other…" : "Your answer…"}
              className="mt-2 ml-4 h-9 w-[calc(100%-1rem)] rounded-xl border border-border-strong bg-card px-3 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]"
            />
          </fieldset>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="mr-auto text-muted-foreground text-xs">
          {answered} of {questions.length} answered
        </span>
        <Button variant="ghost-muted" size="sm" disabled={sending} onClick={() => submit(true)}>
          Skip, let the council assume
        </Button>
        <Button type="submit" size="sm" disabled={sending || answered === 0}>
          {sending && <Loader2 className="animate-spin" />}
          Continue
        </Button>
      </div>
    </form>
  );
}

function Header({ turn, title }: { turn: Turn; title: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs">
      <span className="flex size-5 items-center justify-center rounded-full border bg-background">
        {turn.council?.chairman ? <ModelLogo member={turn.council.chairman} className="size-3" /> : <MessageCircleQuestion className="size-3" />}
      </span>
      {title}
    </div>
  );
}

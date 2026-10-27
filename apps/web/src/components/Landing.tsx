import { AlertTriangle, Check, Code2, Crown, Scale, Stethoscope } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "~/lib/auth";
import { navigate } from "~/lib/router";
import { CouncilRing } from "./CouncilRing";
import { ModelLogo } from "./ModelLogo";
import { Logo } from "./Sidebar";
import { Button } from "./ui/button";

const LABS = [
  { label: "OpenAI", model: "openai/", provider: "openrouter" },
  { label: "Anthropic", model: "anthropic/", provider: "openrouter" },
  { label: "Google", model: "google/", provider: "openrouter" },
  { label: "xAI", model: "x-ai/", provider: "openrouter" },
  { label: "DeepSeek", model: "deepseek/", provider: "openrouter" },
  { label: "Zhipu", model: "z-ai/", provider: "openrouter" }
] as const;

export function Landing() {
  const auth = useAuth();
  const signedIn = auth.status === "signed-in";
  const go = (path: string) => () => navigate(path);

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          Synod
        </span>
        <nav className="flex items-center gap-1.5">
          {signedIn ? (
            <Button onClick={go("/new")}>Open Synod</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={go("/login")}>
                Sign in
              </Button>
              <Button onClick={go("/signup")}>Get started</Button>
            </>
          )}
        </nav>
      </header>

      <main>
        {/* Hero: the council itself is the image. */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-12 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-20 lg:pb-28">
          <div>
            <h1 className="max-w-[16ch] font-semibold text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem]">A second opinion from a council of AI models</h1>
            <p className="mt-6 max-w-[52ch] text-[1.0625rem] text-muted-foreground leading-relaxed">
              Describe a clinical case, a legal matter, or a risky change to your systems. Leading models answer it independently, critique each other without knowing who wrote what, and agree
              on a brief you can act on.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" className="h-11 rounded-xl px-5" onClick={go(signedIn ? "/new" : "/signup")}>
                {signedIn ? "Start a case" : "Get a second opinion"}
              </Button>
              {!signedIn && (
                <Button size="lg" variant="ghost" className="h-11 rounded-xl px-4" onClick={go("/login")}>
                  I have an account
                </Button>
              )}
            </div>
            <p className="mt-12 text-faint text-xs">With models from</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
              {LABS.map((lab) => (
                <span key={lab.label} className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <ModelLogo member={lab} className="size-4" />
                  {lab.label}
                </span>
              ))}
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <CouncilRing size={Math.min(380, window.innerWidth - 48)} />
          </div>
        </section>

        {/* How a case is decided: a real sequence, so it's numbered. */}
        <section className="border-y bg-sidebar">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="max-w-[24ch] font-semibold text-3xl tracking-[-0.02em]">How the council decides</h2>
            <p className="mt-3 max-w-[60ch] text-muted-foreground">One model can be confidently wrong. A council makes its reasoning visible: where the models agree, where they don't, and why.</p>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              <Step n={1} title="Independent opinions" body="Each model works your case alone, in parallel. No one sees anyone else's answer.">
                <div className="flex gap-2">
                  {LABS.slice(0, 4).map((lab, i) => (
                    <span key={lab.label} className="relative flex size-10 items-center justify-center rounded-full border bg-card">
                      {i === 2 && <span className="seat-ring" />}
                      <ModelLogo member={lab} className="size-5" />
                    </span>
                  ))}
                </div>
              </Step>
              <Step n={2} title="Anonymous review" body="Every answer is relabelled A, B, C. Each model ranks them blind, so no one can favour its own lab.">
                <div className="grid w-fit grid-cols-4 gap-1">
                  {[2, 1, 3, 4, 1, 2, 4, 3, 1, 3, 2, 4].map((rank, i) => (
                    <span
                      key={i}
                      className="flex size-7 items-center justify-center rounded-md font-semibold text-2xs tabular-nums"
                      style={{ background: `color-mix(in oklch, var(--accent-brand) ${Math.round(14 + (1 - (rank - 1) / 3) * 66)}%, transparent)`, color: rank === 1 ? "white" : undefined }}
                    >
                      {rank}
                    </span>
                  ))}
                </div>
              </Step>
              <Step n={3} title="One verdict" body="A chairman model weighs everything and writes a structured brief, keeping real disagreement in view.">
                <div>
                  <p className="font-serif text-lg leading-tight">Safe to merge after two fixes</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
                      <span className="block h-full w-[78%] rounded-full bg-foreground" />
                    </span>
                    <span className="text-muted-foreground text-xs">High confidence, 78%</span>
                  </div>
                </div>
              </Step>
            </ol>
          </div>
        </section>

        {/* Modes */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-[24ch] font-semibold text-3xl tracking-[-0.02em]">Built for decisions that matter</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border bg-border md:grid-cols-3">
            <Mode
              icon={<Stethoscope className="text-rose-500" />}
              title="Medical"
              question="58M, fever and productive cough, SpO₂ 93%. Admit or treat at home?"
              gets={["Differential diagnosis, ranked", "Can't-miss conditions to exclude", "Recommended workup", "Red flags"]}
            />
            <Mode
              icon={<Scale className="text-amber-500" />}
              title="Legal"
              question="Is this non-compete enforceable in California, and what's the risk?"
              gets={["The issues and governing law", "Strongest arguments on both sides", "Deadlines and procedure", "Next steps"]}
            />
            <Mode
              icon={<Code2 className="text-sky-500" />}
              title="Code and agents"
              question="My agent wants to run this UPDATE on 40M production rows. Is it safe?"
              gets={["Bugs and risks by severity", "Recommended changes", "Safer alternatives", "Hand the brief back to your agent"]}
            />
          </div>
        </section>

        {/* Example output */}
        <section className="border-t bg-sidebar">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <div>
              <h2 className="max-w-[20ch] font-semibold text-3xl tracking-[-0.02em]">A brief, not a chat log</h2>
              <p className="mt-3 max-w-[50ch] text-muted-foreground">
                The verdict comes first, with the council's confidence. Below it: what needs attention now, the reasoning, the next steps, and exactly where the models disagreed. Every
                individual answer and review is one click away.
              </p>
            </div>
            <figure className="rounded-3xl border bg-card p-7 shadow-[var(--shadow-raised)]">
              <p className="text-muted-foreground text-xs">Medical second opinion (example)</p>
              <p className="mt-3 font-serif text-[1.65rem] leading-[1.15] tracking-[-0.015em]">Community-acquired pneumonia, low severity; same-day review before discharge</p>
              <p className="mt-3 font-serif text-foreground/80 leading-relaxed">
                CURB-65 is 0, but RR 24 with SpO₂ 93% puts NEWS2 at 4 or more. Treat with oral amoxicillin and arrange a firm 24 to 48 hour safety net, since he lives alone.
              </p>
              <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-error-surface px-4 py-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" />
                Heart rate and temperature are missing and needed before disposition.
              </div>
              <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="font-semibold text-[0.8125rem]">Where the council agreed</p>
                  <p className="mt-1.5 flex gap-2 text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                    Chest X-ray is needed regardless of disposition
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-[0.8125rem]">Where it disagreed</p>
                  <p className="mt-1.5 flex gap-2 text-muted-foreground">
                    <ModelLogo member={{ label: "GLM", model: "z-ai/glm", provider: "openrouter" }} className="mt-0.5 size-3.5" />
                    Cited 94% as the admission threshold; the chairman corrected it to 92%
                  </p>
                </div>
              </div>
              <figcaption className="mt-5 flex items-center gap-2 border-t pt-4 text-muted-foreground text-xs">
                <Crown className="size-3.5 text-amber-500" />
                Chaired by Claude, weighed by four models
              </figcaption>
            </figure>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20 text-center">
          <h2 className="mx-auto max-w-[22ch] font-semibold text-3xl tracking-[-0.02em]">Bring your hardest case</h2>
          <p className="mx-auto mt-3 max-w-[56ch] text-muted-foreground">
            Synod is in early testing with clinicians, lawyers, and engineers. Please don't enter identifiable patient or client information yet.
          </p>
          <Button size="lg" className="mt-8 h-11 rounded-xl px-5" onClick={go(signedIn ? "/new" : "/signup")}>
            {signedIn ? "Start a case" : "Request access"}
          </Button>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-muted-foreground text-xs">
          <span className="flex items-center gap-2">
            <Logo className="size-4" /> Synod
          </span>
          <span>AI output can be wrong. Use your professional judgment.</span>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: ReactNode }) {
  return (
    <li>
      <div className="flex h-16 items-center">{children}</div>
      <p className="mt-6 flex items-baseline gap-2.5">
        <span className="font-medium text-faint text-sm tabular-nums">{n}</span>
        <span className="font-semibold">{title}</span>
      </p>
      <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{body}</p>
    </li>
  );
}

function Mode({ icon, title, question, gets }: { icon: ReactNode; title: string; question: string; gets: string[] }) {
  return (
    <div className="bg-card p-7">
      <span className="flex items-center gap-2 font-semibold [&_svg]:size-4.5">
        {icon}
        {title}
      </span>
      <p className="mt-4 font-serif text-[1.075rem] leading-snug">“{question}”</p>
      <ul className="mt-5 space-y-2 text-muted-foreground text-sm">
        {gets.map((g) => (
          <li key={g} className="flex gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-foreground/50" />
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

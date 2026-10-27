import { Briefcase, Code2, Loader2, Scale, Stethoscope, UserRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Profession, UserProfile } from "@synod/contracts";
import { api } from "~/lib/api";
import { signedIn, useAuth } from "~/lib/auth";
import { navigate } from "~/lib/router";
import { cn, firstName } from "~/lib/utils";
import { Logo } from "./Sidebar";
import { Button } from "./ui/button";

const ROLES: { value: Profession; label: string; icon: ReactNode; specialty: string; settings: string[]; suggestions: string[] }[] = [
  {
    value: "clinician",
    label: "Clinician",
    icon: <Stethoscope />,
    specialty: "Specialty",
    settings: ["Hospital", "Emergency department", "Primary care", "Private practice", "Academic"],
    suggestions: ["General practice", "Emergency medicine", "Internal medicine", "Cardiology", "Oncology", "Paediatrics", "Psychiatry", "Radiology", "Surgery", "Pharmacy"]
  },
  {
    value: "lawyer",
    label: "Lawyer",
    icon: <Scale />,
    specialty: "Practice area",
    settings: ["Law firm", "In-house", "Government", "Barristers' chambers", "Sole practice"],
    suggestions: ["Corporate", "Employment", "Litigation", "Contracts", "Intellectual property", "Real estate", "Family", "Criminal", "Regulatory", "Arbitration"]
  },
  {
    value: "engineer",
    label: "Engineer",
    icon: <Code2 />,
    specialty: "Focus",
    settings: ["Startup", "Scale-up", "Enterprise", "Agency", "Open source"],
    suggestions: ["Backend", "Frontend", "Infrastructure / SRE", "Data", "Security", "Mobile", "ML / AI agents"]
  },
  {
    value: "executive",
    label: "Founder or executive",
    icon: <Briefcase />,
    specialty: "Area",
    settings: ["Startup", "Scale-up", "Enterprise", "Non-profit"],
    suggestions: ["Strategy", "Product", "Finance", "Operations", "Sales", "Fundraising"]
  },
  { value: "other", label: "Something else", icon: <UserRound />, specialty: "What you do", settings: [], suggestions: [] }
];

const COUNTRIES = [
  "United Kingdom",
  "United States",
  "India",
  "Canada",
  "Australia",
  "Ireland",
  "Germany",
  "France",
  "Netherlands",
  "Singapore",
  "United Arab Emirates",
  "South Africa",
  "New Zealand",
  "Spain",
  "Italy",
  "Brazil",
  "Japan"
];

const field =
  "h-11 w-full rounded-xl border border-border-strong bg-card px-3.5 text-[0.9375rem] outline-none transition-shadow placeholder:text-faint focus:border-ring/50 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]";

/** First-run questions. The answers travel with every case so advice fits the person asking. */
export function Welcome() {
  const auth = useAuth();
  const existing = auth.status === "signed-in" ? auth.user.profile : null;
  const greetName = auth.status === "signed-in" ? firstName(auth.user.name) : "";
  const [profession, setProfession] = useState<Profession | null>(existing?.profession ?? null);
  const [answerStyle, setAnswerStyle] = useState<UserProfile["answerStyle"]>(existing?.answerStyle ?? "detailed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const role = ROLES.find((r) => r.value === profession);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profession) return setError("Choose what best describes your work.");
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { user } = await api.saveProfile({
        profession,
        specialty: String(form.get("specialty") ?? ""),
        country: String(form.get("country") ?? ""),
        region: String(form.get("region") ?? "") || undefined,
        setting: String(form.get("setting") ?? "") || undefined,
        answerStyle
      });
      signedIn(user);
      navigate("/new", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-2xl items-center px-6">
        <span className="flex items-center gap-2 font-semibold tracking-tight">
          <Logo />
          Synod
        </span>
      </header>
      <main className="mx-auto max-w-2xl px-6 pt-6 pb-20">
        <h1 className="font-semibold text-[1.9rem] tracking-[-0.025em]">{greetName ? `Welcome, ${greetName}` : "Welcome"}</h1>
        <p className="mt-2 max-w-[56ch] text-muted-foreground">
          Four quick questions. The council uses your answers on every case, so its advice follows your country's guidelines and law and fits the way you work. You can change them later.
        </p>

        <form className="mt-10 flex flex-col gap-9" onSubmit={submit}>
          <Question n={1} title="What best describes your work?">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={profession === r.value}
                  onClick={() => setProfession(r.value)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-sm transition-[background-color,border-color,box-shadow,scale] duration-150 active:scale-[0.98] [&_svg]:size-4 [&_svg]:text-muted-foreground",
                    profession === r.value ? "border-ring/50 bg-card shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_12%,transparent)]" : "hover:bg-accent"
                  )}
                >
                  {r.icon}
                  <span className="font-medium">{r.label}</span>
                </button>
              ))}
            </div>
          </Question>

          {role && (
            <Question n={2} title={`${role.specialty} and setting`} hint="So the council reasons like a colleague in your field.">
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="specialty" list="specialties" defaultValue={existing?.specialty ?? ""} className={field} placeholder={role.suggestions[0] ? `e.g. ${role.suggestions[0]}` : "e.g. Accounting"} />
                <input name="setting" list="settings" defaultValue={existing?.setting ?? ""} className={field} placeholder={role.settings[0] ? `e.g. ${role.settings[0]}` : "Where you work (optional)"} />
              </div>
              <datalist id="specialties">
                {role.suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <datalist id="settings">
                {role.settings.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Question>
          )}

          <Question n={role ? 3 : 2} title="Where do you practise?" hint="Guidelines, law, and units differ by country, and sometimes by state.">
            <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
              <input name="country" list="countries" required defaultValue={existing?.country ?? guessCountry()} className={field} placeholder="Country" />
              <input name="region" defaultValue={existing?.region ?? ""} className={field} placeholder="State or region (optional)" />
            </div>
            <datalist id="countries">
              {COUNTRIES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Question>

          <Question n={role ? 4 : 3} title="How should answers read?">
            <div className="inline-flex rounded-xl bg-muted p-1" role="radiogroup">
              {(
                [
                  ["concise", "Concise", "The bottom line and key reasons"],
                  ["detailed", "Detailed", "Full reasoning and alternatives"]
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={answerStyle === value}
                  onClick={() => setAnswerStyle(value)}
                  className={cn("cursor-pointer rounded-lg px-4 py-2 text-left transition-[background-color,box-shadow] duration-150", answerStyle === value ? "bg-card shadow-[0_1px_3px_rgb(0_0_0/10%)]" : "text-muted-foreground hover:text-foreground")}
                >
                  <span className="block font-medium text-sm">{label}</span>
                  <span className="block text-2xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
          </Question>

          {error && (
            <p role="alert" className="rounded-xl bg-error-surface px-3.5 py-2.5 text-error-foreground text-sm">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" size="lg" className="h-11 rounded-xl px-6" disabled={busy || !profession}>
              {busy && <Loader2 className="animate-spin" />}
              Start using Synod
            </Button>
            <span className="text-muted-foreground text-xs">Your answers are only used as context for your own cases.</span>
          </div>
        </form>
      </main>
    </div>
  );
}

function Question({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="fade-in">
      <p className="flex items-baseline gap-2.5">
        <span className="text-faint text-sm tabular-nums">{n}</span>
        <span className="font-semibold">{title}</span>
      </p>
      {hint && <p className="mt-0.5 pl-5 text-muted-foreground text-sm">{hint}</p>}
      <div className="mt-3 pl-5">{children}</div>
    </section>
  );
}

/** A sensible default from the browser's timezone; the user can change it. */
function guessCountry(): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz.startsWith("Europe/London")) return "United Kingdom";
  if (tz.startsWith("Asia/Kolkata") || tz.startsWith("Asia/Calcutta")) return "India";
  if (tz.startsWith("America/")) return "United States";
  if (tz.startsWith("Australia/")) return "Australia";
  if (tz.startsWith("Asia/Singapore")) return "Singapore";
  if (tz.startsWith("Asia/Dubai")) return "United Arab Emirates";
  return "";
}

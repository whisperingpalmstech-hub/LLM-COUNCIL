import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import type { SignupMode } from "@synod/contracts";
import { api } from "~/lib/api";
import { signedIn } from "~/lib/auth";
import { navigate } from "~/lib/router";
import { CouncilRing } from "./CouncilRing";
import { Logo } from "./Sidebar";
import { Button } from "./ui/button";

const field =
  "h-11 w-full rounded-xl border border-border-strong bg-card px-3.5 text-[0.9375rem] outline-none transition-shadow placeholder:text-faint focus:border-ring/50 focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [signup, setSignup] = useState<SignupMode | null>(null);
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(() => new URLSearchParams(location.search).get("error"));
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(location.search).get("next");

  useEffect(() => {
    api.authConfig().then(
      (c) => {
        setSignup(c.signup);
        setGoogle(c.google);
      },
      () => setSignup("closed")
    );
  }, []);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setBusy(true);
    try {
      const body = { email: String(form.get("email")), password: String(form.get("password")) };
      const { user } =
        mode === "login"
          ? await api.login(body)
          : await api.signup({ ...body, name: String(form.get("name") ?? ""), inviteCode: String(form.get("invite") ?? "") || undefined });
      signedIn(user);
      navigate(user.profile ? (next && next.startsWith("/") ? next : "/new") : "/welcome", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const canSignUp = signup !== null && signup !== "closed";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <a
          href="/"
          className="flex w-fit items-center gap-2 font-semibold tracking-tight"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <Logo />
          Synod
        </a>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="font-semibold text-2xl tracking-tight">{mode === "login" ? "Welcome back" : signup === "first-user" ? "Set up Synod" : "Create your account"}</h1>
          <p className="mt-1.5 text-muted-foreground text-sm">
            {mode === "login"
              ? "Sign in to your cases."
              : signup === "first-user"
                ? "You're the first person here, so this account will administer the council."
                : signup === "invite"
                  ? "Synod is invite-only while in testing. Enter the code you were given."
                  : "Your cases stay private to your account."}
          </p>

          {google && (
            <>
              <a
                href={`/api/auth/google/start?${new URLSearchParams({ ...(next ? { next } : {}), ...(invite ? { invite } : {}) })}`}
                aria-disabled={mode === "signup" && signup === "invite" && !invite}
                onClick={(e) => {
                  if (mode === "signup" && signup === "invite" && !invite) {
                    e.preventDefault();
                    setError("Enter your invite code below first, then continue with Google.");
                  }
                }}
                className="mt-8 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-border-strong bg-card font-medium text-[0.9375rem] shadow-[0_1px_2px_rgb(0_0_0/4%)] transition-[background-color,scale] duration-150 hover:bg-accent active:scale-[0.98]"
              >
                <GoogleMark />
                Continue with Google
              </a>
              <div className="my-6 flex items-center gap-3 text-faint text-xs">
                <span className="h-px flex-1 bg-border" />
                or with email
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form className={google ? "flex flex-col gap-3.5" : "mt-8 flex flex-col gap-3.5"} onSubmit={submit}>
            {mode === "signup" && (
              <Field label="Name">
                <input name="name" autoComplete="name" required className={field} placeholder="Dr Jane Smith" />
              </Field>
            )}
            <Field label="Email">
              <input name="email" type="email" autoComplete="email" spellCheck={false} required className={field} placeholder="you@clinic.org" />
            </Field>
            <Field label="Password" hint={mode === "signup" ? "At least 10 characters" : undefined}>
              <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 10 : undefined} required className={field} />
            </Field>
            {mode === "signup" && signup === "invite" && (
              <Field label="Invite code">
                <input name="invite" autoComplete="off" spellCheck={false} required className={field} value={invite} onChange={(e) => setInvite(e.target.value)} />
              </Field>
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-error-surface px-3.5 py-2.5 text-error-foreground text-sm">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="mt-2 h-11 w-full rounded-xl" disabled={busy || (mode === "signup" && !canSignUp)}>
              {busy && <Loader2 className="animate-spin" />}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-6 text-center text-muted-foreground text-sm">
            {mode === "login" ? (
              canSignUp ? (
                <>
                  New here? <AuthLink to="/signup">Create an account</AuthLink>
                </>
              ) : (
                "Need access? Ask your administrator for an account."
              )
            ) : (
              <>
                Already have an account? <AuthLink to="/login">Sign in</AuthLink>
              </>
            )}
          </p>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden border-l bg-sidebar lg:flex lg:flex-col lg:items-center lg:justify-center">
        <CouncilRing />
        <blockquote className="mt-10 max-w-sm px-6 text-center">
          <p className="font-serif text-xl leading-snug">Several independent models, reviewing each other blind, then one verdict you can act on.</p>
        </blockquote>
      </aside>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-faint text-xs">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function AuthLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a
      href={to + location.search}
      className="font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
      onClick={(e) => {
        e.preventDefault();
        navigate(to + location.search);
      }}
    >
      {children}
    </a>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.11A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.37-2.29V6.6H1.27a12 12 0 0 0 0 10.8l4-3.11z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.27 6.6l4 3.11C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
  );
}

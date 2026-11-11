// Before a debate starts, the moderator proposes a persona for each model.
// The user can edit any of them, ask for a different cast, or go without.
import { Check, Pencil, Play, RefreshCw, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { VOICES, type Persona } from "@synod/contracts";
import { api } from "~/lib/api";
import { useDraft } from "~/lib/store";
import { cn } from "~/lib/utils";
import { ModelLogo } from "../ModelLogo";
import { Button } from "../ui/button";
import { PersonaAvatar, type Seat } from "./PersonaAvatar";

const field = "w-full min-w-0 rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]";

export function CastReview({
  seats,
  casting,
  speech,
  onStart,
  onRecast
}: {
  seats: Seat[];
  /** The moderator is still choosing. */
  casting: boolean;
  speech: boolean;
  onStart: (personas: Persona[]) => Promise<void>;
  onRecast: (hint: string) => Promise<void>;
}) {
  const proposed = seats.flatMap((s) => (s.persona ? [s.persona] : []));
  const [personas, setPersonas] = useState<Persona[]>(proposed);
  const [editing, setEditing] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new proposal from the moderator replaces any local edits.
  const signature = proposed.map((p) => `${p.memberId}:${p.name}:${p.stance}`).join("|");
  useEffect(() => {
    setPersonas(proposed);
    setEditing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (memberId: string, change: Partial<Persona>) => setPersonas((list) => list.map((p) => (p.memberId === memberId ? { ...p, ...change } : p)));

  if (casting || !personas.length) return <Casting seats={seats} />;

  return (
    <div className="mt-6">
      <p className="font-medium">Meet the panel</p>
      <p className="mt-0.5 text-muted-foreground text-sm">The moderator cast these personas for your question. Edit anyone, ask for a different cast, or start.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {personas.map((p, i) => {
          const seat = seats.find((s) => s.member.id === p.memberId);
          if (!seat) return null;
          const open = editing === p.memberId;
          return (
            <div key={p.memberId} className="card-deal group relative rounded-3xl border bg-card p-4 shadow-[var(--shadow-raised)]" style={{ "--i": i, "--tilt": `${i % 2 ? 1.5 : -1.5}deg` } as CSSProperties}>
              <div className="flex gap-3">
                <PersonaAvatar seat={{ ...seat, persona: p }} size={56} />
                <div className="min-w-0 flex-1">
                  {open ? (
                    <div className="flex flex-col gap-1.5">
                      <input className={cn(field, "font-medium")} aria-label="Name" value={p.name} maxLength={60} onChange={(e) => patch(p.memberId, { name: e.target.value })} />
                      <input className={field} aria-label="Role" placeholder="Who they are" value={p.role} maxLength={80} onChange={(e) => patch(p.memberId, { role: e.target.value })} />
                    </div>
                  ) : (
                    <>
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="line-clamp-2 text-muted-foreground text-sm leading-snug">{p.role}</p>
                    </>
                  )}
                </div>
                <Button variant="ghost-muted" size="icon-sm" className={cn("shrink-0 transition-opacity", !open && "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100")} onClick={() => setEditing(open ? null : p.memberId)} aria-label={open ? "Done editing" : `Edit ${p.name}`}>
                  {open ? <Check /> : <Pencil />}
                </Button>
              </div>
              {open ? (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  <textarea className={cn(field, "min-h-16 resize-none")} aria-label="Position" placeholder="The position they argue from" value={p.stance} maxLength={280} onChange={(e) => patch(p.memberId, { stance: e.target.value })} />
                  <input className={field} aria-label="Speaking style" placeholder="How they talk" value={p.style} maxLength={120} onChange={(e) => patch(p.memberId, { style: e.target.value })} />
                </div>
              ) : (
                <>
                  <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed">“{p.stance}”</p>
                  {p.style && <p className="mt-1.5 text-muted-foreground text-xs">Speaks: {p.style}</p>}
                </>
              )}
              <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-muted-foreground text-xs">
                <ModelLogo member={seat.member} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">Played by {seat.member.label}</span>
                {speech && <VoicePicker voice={p.voice} editable={open} onChange={(voice) => patch(p.memberId, { voice })} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-48 flex-1 items-center gap-1 rounded-full border border-border-strong bg-card py-1 pr-1 pl-3.5">
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            placeholder="Want a different panel? e.g. add a patient advocate"
            value={hint}
            maxLength={300}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void run(() => onRecast(hint))}
          />
          <Button variant="ghost-muted" size="sm" className="rounded-full" disabled={busy} onClick={() => run(() => onRecast(hint))}>
            <RefreshCw /> Recast
          </Button>
        </div>
        <Button variant="ghost-muted" disabled={busy} onClick={() => run(() => onStart([]))} title="Debate as the models themselves, without personas">
          Skip personas
        </Button>
        <Button size="lg" className="rounded-full" disabled={busy || personas.some((p) => !p.name.trim())} onClick={() => run(() => onStart(personas))}>
          <Play className="fill-current" /> Start the debate
        </Button>
      </div>
      {error && <p className="mt-2 text-error-foreground text-xs">{error}</p>}
    </div>
  );
}

/** While the moderator is still writing: finished personas are dealt in, the rest are placeholders. */
function Casting({ seats }: { seats: Seat[] }) {
  const draft = useDraft("chat", "cast");
  let ready: Persona[] = [];
  try {
    ready = draft ? (JSON.parse(draft) as Persona[]) : [];
  } catch {
    // A partial update; keep showing placeholders.
  }
  return (
    <div className="mt-6">
      <p className="live-shine font-medium [--shine-base:var(--muted-foreground)] [--shine-highlight:var(--foreground)]">The moderator is casting the panel…</p>
      <p className="mt-0.5 text-muted-foreground text-sm">Choosing perspectives that will pull your question in different directions.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {seats.map((seat, i) => {
          const p = ready.find((x) => x.memberId === seat.member.id);
          return p ? (
            <div key={seat.member.id} className="card-deal rounded-3xl border bg-card p-4 shadow-[var(--shadow-raised)]" style={{ "--tilt": `${i % 2 ? 1.5 : -1.5}deg` } as CSSProperties}>
              <div className="flex gap-3">
                <PersonaAvatar seat={{ ...seat, persona: p }} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="line-clamp-2 text-muted-foreground text-sm leading-snug">{p.role}</p>
                </div>
              </div>
              <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed">“{p.stance}”</p>
            </div>
          ) : (
            <div key={seat.member.id} className="skeleton-pulse flex gap-3 rounded-3xl border bg-card p-4" style={{ "--i": i } as CSSProperties}>
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted">
                <ModelLogo member={seat.member} className="size-5 opacity-60" />
              </span>
              <span className="flex flex-1 flex-col gap-2 pt-1">
                <span className="h-3.5 w-2/5 rounded-full bg-muted" />
                <span className="h-3 w-3/5 rounded-full bg-muted" />
                <span className="mt-1 h-3 w-full rounded-full bg-muted" />
                <span className="h-3 w-4/5 rounded-full bg-muted" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoicePicker({ voice, editable, onChange }: { voice: Persona["voice"]; editable: boolean; onChange: (voice: Persona["voice"]) => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  const sample = (v: string) => {
    audio.current?.pause();
    const a = new Audio(api.voiceSampleUrl(v));
    audio.current = a;
    a.onended = a.onerror = () => setPlaying(false);
    setPlaying(true);
    void a.play().catch(() => setPlaying(false));
  };
  const label = VOICES.find((v) => v.id === voice)?.label ?? voice;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {editable ? (
        <select
          className="h-6 cursor-pointer rounded-md border border-border-strong bg-background px-1 text-xs outline-none"
          aria-label="Voice"
          value={voice}
          onChange={(e) => {
            onChange(e.target.value as Persona["voice"]);
            sample(e.target.value);
          }}
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label} ({v.tone})
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" onClick={() => sample(voice)} className={cn("flex h-6 cursor-pointer items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-accent hover:text-foreground", playing && "text-accent-brand")} title={`Hear ${label}'s voice`}>
        <Volume2 className="size-3.5" />
        {!editable && label}
      </button>
    </span>
  );
}

// Watching a debate instead of reading it: the Round Table (everyone seated, the floor passing
// around) and the Stage (one speaker at a time, like a slideshow). Both are driven by the debate player.
import { Hand, MessagesSquare, Pause, Play, SkipBack, SkipForward, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { ChatMessage, Conversation, ModeratorNote } from "@synod/contracts";
import { nextRate, plainText, type DebatePlayer } from "~/lib/player";
import { useDraft } from "~/lib/store";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { HUES, PersonaAvatar, seatName, type Seat } from "./PersonaAvatar";

export interface SpectatorProps {
  conversation: Conversation;
  seats: Seat[];
  layout: "table" | "stage";
  player: DebatePlayer;
  /** Members the moderator has called on who haven't spoken yet. */
  thinking: string[];
  speech: boolean;
  /** Ask to speak; with a seat, address that panellist. */
  onRaiseHand: (seat?: Seat) => void;
  onStop: () => void;
  /** Shown when the panel has finished and the floor is the user's. */
  ending: ReactNode;
}

export function SpectatorView(props: SpectatorProps) {
  const { conversation, seats, layout, player, thinking } = props;
  const current = player.current;
  const speaker = current?.author.kind === "model" ? seats.find((s) => s.member.id === (current.author as { memberId: string }).memberId) : undefined;
  const waitingFor = !current && player.status === "waiting" ? seats.find((s) => s.member.id === thinking[0]) : undefined;
  const note = useMemo(() => noteFor(conversation.notes, current?.at), [conversation.notes, current?.at]);
  // Who is still to come in this round, in order.
  const upNext = useMemo(() => {
    const later = player.items.slice(player.index + 1).flatMap((m) => (m.author.kind === "model" ? [m.author.memberId] : []));
    return [...later, ...thinking].find((id) => id !== speaker?.member.id);
  }, [player.items, player.index, thinking, speaker]);

  // Space, arrows, and M work like a media player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") player.toggle();
      else if (e.key === "ArrowRight") player.next();
      else if (e.key === "ArrowLeft") player.prev();
      else if (e.key.toLowerCase() === "m") player.setMuted(!player.muted);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scene = { ...props, current, speaker, waitingFor, note, upNext };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {layout === "table" ? <RoundTable {...scene} /> : <Stage {...scene} />}
        {player.status === "blocked" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-[3px]">
            <Button size="lg" className="stage-pop rounded-full" onClick={player.play}>
              <Volume2 /> Start listening
            </Button>
          </div>
        )}
      </div>
      <Controls {...props} note={note} />
    </div>
  );
}

interface SceneProps extends SpectatorProps {
  current: ChatMessage | undefined;
  speaker: Seat | undefined;
  waitingFor: Seat | undefined;
  note: ModeratorNote | undefined;
  upNext: string | undefined;
}

// ---- Round Table ----------------------------------------------------------------

function RoundTable({ seats, player, current, speaker, waitingFor, thinking, upNext, note, onRaiseHand, ending }: SceneProps) {
  // Seats spread around the table; the bottom-centre place is the user's.
  const places = seats.length + 1;
  const position = (i: number) => {
    const angle = Math.PI / 2 + ((i + 1) / places) * Math.PI * 2;
    return { x: 50 + Math.cos(angle) * 40, y: 50 + Math.sin(angle) * 39 };
  };
  const active = speaker ?? waitingFor;
  const activeAt = active ? position(seats.indexOf(active)) : current?.author.kind === "user" ? { x: 50, y: 89 } : null;
  const hue = active ? HUES[active.index % HUES.length] : 255;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-5 px-4 py-6">
      <div className="relative mx-auto aspect-[16/11] w-full max-w-[40rem]">
        {/* the table */}
        <div
          className="absolute top-1/2 left-1/2 h-[52%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border bg-card shadow-[var(--shadow-raised),inset_0_-10px_30px_rgb(0_0_0/4%)] transition-[box-shadow] duration-500"
          style={active ? { boxShadow: `0 0 0 1px oklch(0.6 0.14 ${hue} / 0.25), 0 18px 50px -18px oklch(0.6 0.16 ${hue} / 0.45), inset 0 -10px 30px rgb(0 0 0 / 4%)` } : undefined}
        >
          <div className="flex h-full flex-col items-center justify-center px-[14%] text-center">
            {note?.round ? (
              <p key={note.id} className="fade-in font-medium text-2xs text-muted-foreground tabular-nums">
                Round {note.round} of {note.of}
              </p>
            ) : null}
            <p key={`${note?.id}-reason`} className="fade-in mt-0.5 line-clamp-2 text-balance text-faint text-xs">
              {player.status === "ended" ? "The panel has spoken" : note?.reason || (player.status === "waiting" ? "The moderator is choosing who speaks" : "")}
            </p>
          </div>
        </div>
        {/* the floor: a beam from whoever is speaking to the table */}
        <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {activeAt && (
            <line
              key={`${activeAt.x}-${activeAt.y}`}
              x1={activeAt.x}
              y1={activeAt.y}
              x2={50 + (activeAt.x - 50) * 0.45}
              y2={50 + (activeAt.y - 50) * 0.45}
              className={cn("fade-in", speaker && player.status === "playing" && "beam-flow")}
              stroke={`oklch(0.62 0.16 ${hue})`}
              strokeWidth="0.5"
              strokeDasharray="1.2 1.6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 2 }}
            />
          )}
        </svg>
        {seats.map((seat, i) => {
          const { x, y } = position(i);
          const isSpeaker = seat === speaker;
          const isThinking = seat === waitingFor;
          return (
            <button
              key={seat.member.id}
              type="button"
              onClick={() => onRaiseHand(seat)}
              title={`Ask ${seatName(seat)} directly${seat.persona ? ` (${seat.persona.role}, played by ${seat.member.label})` : ""}`}
              className="reveal group absolute flex w-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-1 outline-none sm:w-28"
              style={{ left: `${x}%`, top: `${y}%`, "--i": i } as CSSProperties}
            >
              <span className={cn("relative transition-transform duration-500 ease-[var(--ease-out)] max-sm:scale-[0.8]", isSpeaker ? "scale-[1.22] max-sm:scale-100" : "group-hover:scale-105")}>
                <PersonaAvatar seat={seat} size={68} state={isSpeaker ? "speaking" : isThinking ? "thinking" : speaker ? "dim" : "idle"} />
                {isThinking && <ThinkingBubble />}
              </span>
              <span className={cn("max-w-full truncate rounded-full px-1.5 text-xs transition-colors duration-300", isSpeaker ? "font-semibold text-foreground" : "text-muted-foreground")}>{shortName(seat)}</span>
              {seat.member.id === upNext && !isSpeaker && !isThinking && <span className="fade-in -mt-1 text-2xs text-faint">up next</span>}
            </button>
          );
        })}
        {/* your seat */}
        <button
          type="button"
          onClick={() => onRaiseHand()}
          className="hand-wave group absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-1 outline-none"
          style={{ left: "50%", top: "89%" }}
          title="Raise your hand to speak"
        >
          <span className={cn("flex size-12 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-[var(--shadow-raised)] transition-[scale,color,border-color] duration-200 group-hover:scale-105 group-hover:text-foreground", current?.author.kind === "user" && "scale-110 border-accent-brand text-foreground")}>
            <Hand className="size-5" />
          </span>
          <span className="text-muted-foreground text-xs">You</span>
        </button>
      </div>

      <div className="mx-auto min-h-[9.5rem] w-full max-w-2xl">
        {current ? (
          <Speech key={current.id} message={current} seat={speaker} progress={player.progress} />
        ) : waitingFor ? (
          <Preparing key={waitingFor.member.id} seat={waitingFor} />
        ) : player.status === "waiting" ? (
          <p className="live-shine py-8 text-center text-sm [--shine-base:var(--muted-foreground)] [--shine-highlight:var(--foreground)]">The moderator is choosing who speaks…</p>
        ) : (
          <div className="fade-in flex flex-col items-center gap-3 py-4 text-center">
            <p className="font-medium">The floor is yours</p>
            {ending}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <span className="stage-pop absolute -top-2 -right-3 flex h-5 items-center gap-0.5 rounded-full rounded-bl-sm border bg-card px-1.5 shadow-sm" aria-label="thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 animate-bounce rounded-full bg-muted-foreground/70" style={{ animationDelay: `${i * 120}ms`, animationDuration: "900ms" }} />
      ))}
    </span>
  );
}

/** The current message as a caption card under the table. */
function Speech({ message, seat, progress }: { message: ChatMessage; seat?: Seat; progress: number }) {
  const user = message.author.kind === "user";
  return (
    <div className="fade-in rounded-3xl border bg-card px-5 py-4 shadow-[var(--shadow-raised)]">
      <div className="mb-1.5 flex items-baseline gap-2">
        <p className="font-semibold text-sm">{user ? "You" : seat ? seatName(seat) : message.author.kind === "model" ? message.author.persona || message.author.label : ""}</p>
        {seat?.persona && <p className="min-w-0 truncate text-muted-foreground text-xs">{seat.persona.role}</p>}
      </div>
      <Caption text={message.text} progress={user ? 1 : progress} className="max-h-[7.5rem] text-[0.9375rem] leading-relaxed" />
    </div>
  );
}

/** Someone has been called on and is still composing: show their words as they form. */
function Preparing({ seat, large }: { seat: Seat; large?: boolean }) {
  const draft = useDraft("chat", `chat:${seat.member.id}`);
  return (
    <div className={cn("fade-in", large ? "text-center" : "rounded-3xl border border-dashed px-5 py-4")}>
      <p className={cn("live-shine font-medium text-sm [--shine-base:var(--muted-foreground)] [--shine-highlight:var(--foreground)]", large && "mb-2")}>{seatName(seat)} is preparing a reply…</p>
      {draft && <p className={cn("mt-1 line-clamp-4 text-faint", large ? "mx-auto max-w-2xl font-serif text-lg leading-relaxed" : "text-[0.9375rem] leading-relaxed")}>{plainText(draft)}</p>}
    </div>
  );
}

/** Text whose words light up as they are spoken, keeping the current word in view. */
function Caption({ text, progress, className }: { text: string; progress: number; className?: string }) {
  const paragraphs = useMemo(() => plainText(text).split(/\n{2,}/).map((p) => p.split(/\s+/).filter(Boolean)), [text]);
  const total = paragraphs.reduce((n, p) => n + p.length, 0);
  const said = progress >= 0.995 ? total : Math.floor(progress * total);
  const box = useRef<HTMLDivElement>(null);
  const line = Math.floor(said / 6);
  useEffect(() => {
    const el = box.current;
    const word = el?.querySelector<HTMLElement>(`[data-w="${Math.min(total - 1, said)}"]`);
    if (el && word && el.scrollHeight > el.clientHeight) el.scrollTo({ top: word.offsetTop - el.offsetTop - el.clientHeight / 2 + word.offsetHeight, behavior: "smooth" });
    // Re-centre a few times per line, not on every word.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line]);
  let n = 0;
  return (
    <div ref={box} className={cn("relative overflow-y-auto [scrollbar-width:none]", className)}>
      {paragraphs.map((words, p) => (
        <p key={p} className={p ? "mt-2" : undefined}>
          {words.map((w) => {
            const i = n++;
            return (
              <span key={i} data-w={i} className={cn("caption-word", i < said && "is-said")}>
                {w}{" "}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}

// ---- Stage ----------------------------------------------------------------------

function Stage({ seats, player, current, speaker, waitingFor, upNext, thinking, note, ending, onRaiseHand }: SceneProps) {
  const lead = speaker ?? waitingFor;
  const hue = lead ? HUES[lead.index % HUES.length] : 255;
  const first = player.index === 0 && current?.author.kind === "user";
  return (
    <div className="relative flex min-h-full min-w-0 flex-col">
      <div
        className="pointer-events-none absolute inset-0 transition-[background] duration-700"
        style={{ background: `radial-gradient(ellipse 70% 55% at 50% 22%, oklch(0.7 0.14 ${hue} / ${lead ? 0.16 : 0.05}), transparent 70%)` }}
        aria-hidden
      />
      <div className="relative mx-auto flex w-full min-w-0 max-w-3xl flex-1 flex-col items-center justify-center px-5 py-8 text-center">
        {note?.round && current ? (
          <p key={note.id} className="fade-in mb-5 max-w-full truncate rounded-full border bg-card/70 px-3 py-1 text-2xs text-muted-foreground tabular-nums backdrop-blur">
            Round {note.round} of {note.of}
            {note.reason ? <span className="text-faint"> · {note.reason}</span> : null}
          </p>
        ) : null}

        {current && speaker ? (
          <div key={current.id} className="stage-enter flex w-full flex-col items-center">
            <PersonaAvatar seat={speaker} size={148} state="speaking" />
            <h2 className="mt-5 font-serif text-[1.75rem] leading-tight tracking-tight">{seatName(speaker)}</h2>
            {speaker.persona && (
              <p className="mt-1 text-muted-foreground text-sm">
                {speaker.persona.role} <span className="text-faint">· played by {speaker.member.label}</span>
              </p>
            )}
            <Caption text={current.text} progress={player.progress} className="mt-6 max-h-[13.5rem] w-full max-w-2xl font-serif text-[1.3125rem] leading-[1.6] sm:text-2xl sm:leading-[1.55]" />
          </div>
        ) : current ? (
          <div key={current.id} className="stage-enter flex w-full flex-col items-center">
            <span className="flex size-16 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-[var(--shadow-raised)]">{first ? <MessagesSquare className="size-6" /> : <Hand className="size-6" />}</span>
            <p className="mt-4 font-medium text-muted-foreground text-sm">{first ? "The question" : "You said"}</p>
            <p className="mt-3 line-clamp-[8] max-w-2xl whitespace-pre-wrap text-balance font-serif text-2xl leading-snug">{current.text}</p>
          </div>
        ) : waitingFor ? (
          <div key={`wait-${waitingFor.member.id}`} className="stage-enter flex w-full flex-col items-center">
            <PersonaAvatar seat={waitingFor} size={148} state="thinking" />
            <h2 className="mt-5 mb-3 font-serif text-[1.75rem] leading-tight tracking-tight">{seatName(waitingFor)}</h2>
            <Preparing seat={waitingFor} large />
          </div>
        ) : player.status === "waiting" ? (
          <p className="live-shine text-sm [--shine-base:var(--muted-foreground)] [--shine-highlight:var(--foreground)]">The moderator is choosing who speaks…</p>
        ) : (
          <div className="stage-enter flex flex-col items-center gap-4">
            <div className="flex -space-x-3">
              {seats.map((s) => (
                <PersonaAvatar key={s.member.id} seat={s} size={56} badge={false} className="ring-4 ring-background rounded-full" />
              ))}
            </div>
            <h2 className="font-serif text-[1.75rem] tracking-tight">The floor is yours</h2>
            {ending}
          </div>
        )}
      </div>

      {/* the cast, with whoever has the floor stepping forward */}
      <div className="relative mx-auto flex w-full max-w-3xl items-end justify-center gap-1 px-4 pb-4 sm:gap-5">
        {seats.map((seat) => {
          const on = seat === lead;
          return (
            <button key={seat.member.id} type="button" onClick={() => onRaiseHand(seat)} title={`Ask ${seatName(seat)} directly`} className="group flex w-16 min-w-0 shrink cursor-pointer flex-col items-center gap-1 outline-none sm:w-20">
              <span className={cn("transition-[transform,opacity] duration-500 ease-[var(--ease-out)]", on ? "-translate-y-1.5 scale-110" : "opacity-70 group-hover:opacity-100")}>
                <PersonaAvatar seat={seat} size={40} state={on ? (speaker ? "speaking" : "thinking") : "idle"} />
              </span>
              <span className={cn("max-w-full truncate text-2xs", on ? "font-medium text-foreground" : "text-faint")}>{seat.member.id === upNext && !on ? "up next" : shortName(seat)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Controls -------------------------------------------------------------------

function Controls({ conversation, player, speech, onRaiseHand, onStop, note }: SpectatorProps & { note: ModeratorNote | undefined }) {
  const playing = player.wanted && player.status !== "ended";
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-3">
      {/* one tick per message; the current one fills as it is spoken */}
      <div className="mb-2 flex h-3 items-center gap-[3px]" role="group" aria-label="Messages">
        {player.items.map((m, i) => (
          <button
            key={m.id}
            type="button"
            onClick={() => player.seek(i)}
            title={m.author.kind === "user" ? "You" : m.author.persona || m.author.label}
            aria-label={`Go to message ${i + 1}`}
            className={cn("group relative h-3 min-w-1 cursor-pointer", m.author.kind === "user" ? "w-2 flex-none" : "flex-1")}
          >
            <span className={cn("absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full transition-[height,background-color] duration-150 group-hover:h-1.5", i < player.index ? "bg-foreground/55" : "bg-foreground/12")}>
              {i === player.index && <span className="block h-full origin-left rounded-full bg-accent-brand" style={{ transform: `scaleX(${m.author.kind === "user" ? 1 : Math.max(0.04, player.progress)})` }} />}
            </span>
          </button>
        ))}
        {conversation.chatBusy && <span className="skeleton-pulse h-1 w-6 flex-none rounded-full bg-accent-brand/50" />}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost-muted" size="icon" onClick={player.prev} disabled={player.index === 0 && player.progress < 0.15} aria-label="Previous (left arrow)" title="Previous (←)">
          <SkipBack />
        </Button>
        <Button size="icon" className="size-10 rounded-full" onClick={player.toggle} aria-label={playing ? "Pause (space)" : "Play (space)"} title={playing ? "Pause (space)" : "Play (space)"}>
          {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
        </Button>
        <Button variant="ghost-muted" size="icon" onClick={player.next} disabled={!player.current} aria-label="Next (right arrow)" title="Next (→)">
          <SkipForward />
        </Button>
        <Button variant="ghost-muted" size="sm" className="w-11 tabular-nums" onClick={() => player.setRate(nextRate(player.rate))} title="Playback speed">
          {player.rate}×
        </Button>
        {speech && (
          <Button variant="ghost-muted" size="icon" onClick={() => player.setMuted(!player.muted)} aria-label={player.muted ? "Turn voices on (M)" : "Turn voices off (M)"} title={player.muted ? "Voices off (M)" : "Voices on (M)"}>
            {player.muted ? <VolumeX /> : <Volume2 />}
          </Button>
        )}
        <span className="ml-1 hidden min-w-0 truncate text-faint text-xs tabular-nums sm:block">
          {player.items.length ? `${Math.min(player.index + 1, player.items.length)} of ${player.items.length}` : ""}
          {note?.round ? ` · round ${note.round} of ${note.of}` : ""}
          {!speech ? " · voices need an OpenRouter key" : ""}
        </span>
        <span className="flex-1" />
        {conversation.chatBusy && (
          <Button variant="ghost-muted" size="sm" onClick={onStop} title="Stop the panel">
            <Square className="size-2.5 fill-current" /> Stop
          </Button>
        )}
        <Button variant="outline" className="hand-wave rounded-full" onClick={() => onRaiseHand()} title="Pause the panel and say something">
          <Hand /> <span className="max-[380px]:hidden">Raise hand</span>
        </Button>
      </div>
    </div>
  );
}

function shortName(seat: Seat): string {
  if (!seat.persona) return seat.member.label;
  const parts = seat.persona.name.split(" ").filter((p) => !/^(dr|prof|mr|mrs|ms|sir)\.?$/i.test(p));
  return parts[0] || seat.persona.name;
}

/** The moderator's note in force when a message was spoken. */
function noteFor(notes: ModeratorNote[], at?: string): ModeratorNote | undefined {
  if (!at) return notes.at(-1);
  let found: ModeratorNote | undefined;
  for (const n of notes) if (n.at <= at) found = n;
  return found;
}

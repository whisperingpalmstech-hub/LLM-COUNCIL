// Discuss mode: a moderated debate between the user and the council's models, in three views:
// the chat transcript, a round table, and a stage where each speaker steps forward in turn.
import { AtSign, BookOpen, FileCheck2, Menu, MessagesSquare, Mic2, Play, Square, Users, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_DISCUSSION, type ChatMessage, type Conversation, type CouncilMember, type DiscussionSettings, type ModeratorNote, type Persona, type ServerInfo, type Turn } from "@synod/contracts";
import { discussionCommands, memberMentions } from "~/lib/commands";
import { RoundsPicker } from "../DepthPicker";
import { api } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { useDebatePlayer } from "~/lib/player";
import { useDraft, useDraftRev } from "~/lib/store";
import { cn } from "~/lib/utils";
import { Composer } from "../Composer";
import { Markdown } from "../Markdown";
import { ModelLogo } from "../ModelLogo";
import { Button } from "../ui/button";
import { CastReview } from "./CastReview";
import { PersonaAvatar, seatName, type Seat } from "./PersonaAvatar";
import { SpectatorView } from "./SpectatorView";
import { TurnBlock } from "./TurnBlock";
import type { PanelTab } from "./CouncilPanel";

type Item = { at: string; key: string; node: ReactNode };
type View = "chat" | "table" | "stage";

const VIEWS: { id: View; label: string; hint: string; icon: typeof Users }[] = [
  { id: "chat", label: "Chat", hint: "Read the debate as a transcript", icon: MessagesSquare },
  { id: "table", label: "Table", hint: "Watch the panel around a table", icon: Users },
  { id: "stage", label: "Stage", hint: "One speaker at a time, spoken aloud", icon: Mic2 }
];

function savedView(): View {
  try {
    const v = localStorage.getItem("synod:debate-view");
    return v === "chat" || v === "stage" || v === "table" ? v : "table";
  } catch {
    return "table";
  }
}

export function DiscussionView({ conversation, info, onOpenSidebar, onOpenPanel }: { conversation: Conversation; info: ServerInfo | null; onOpenSidebar: () => void; onOpenPanel: (turnId: string, tab: PanelTab) => void }) {
  const id = conversation.id;
  const [draft, setDraft] = useState("");
  const [council, setCouncil] = useState<CouncilMember[]>([]);
  const [settings, setSettings] = useState<DiscussionSettings>(DEFAULT_DISCUSSION);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<number | null>(null);
  const [view, setViewState] = useState<View>(savedView);
  const [handUp, setHandUp] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const draftRev = useDraftRev();
  const mode = MODE_UI[conversation.mode];
  const ModeIcon = mode.icon;
  const wrapping = conversation.turns.at(-1)?.status === "running";
  const speech = Boolean(info?.speech?.available);
  const casting = conversation.personaStatus === "casting";
  const reviewing = casting || conversation.personaStatus === "proposed";
  const spectating = view !== "chat" && !reviewing && conversation.chat.length > 0;

  // The panel: the recommended members for this case type, or the user's own council.
  useEffect(() => {
    Promise.all([api.council(), api.recipes()])
      .then(([c, r]) => {
        setCouncil(c.auto && r.available ? r.recipes[conversation.mode].members : c.members);
        setSettings(c.discussion ?? DEFAULT_DISCUSSION);
      })
      .catch(() => undefined);
  }, [conversation.mode]);

  const seats = useMemo<Seat[]>(() => {
    // Anyone who has spoken keeps a seat even if the council has since changed.
    const members = [...council];
    for (const m of conversation.chat) {
      if (m.author.kind === "model" && !members.some((x) => x.id === (m.author as { memberId: string }).memberId)) members.push({ id: m.author.memberId, label: m.author.label, provider: m.author.provider, model: m.author.model });
    }
    return members.map((member, index) => ({ member, index, persona: conversation.personas.find((p) => p.memberId === member.id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [council, conversation.personas, conversation.chat.length]);
  const seatOf = (memberId: string) => seats.find((s) => s.member.id === memberId);

  const player = useDebatePlayer(conversation, { enabled: spectating, speech });

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [conversation.seq, draftRev, view]);

  const setView = (next: View) => {
    setViewState(next);
    setHandUp(false);
    try {
      localStorage.setItem("synod:debate-view", next);
    } catch {
      // The choice just won't be remembered.
    }
  };

  // One timeline: messages, moderator notes, and wrap-ups, in time order.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    conversation.chat.forEach((m, i) => out.push({ at: m.at, key: m.id, node: <Message conversationId={id} message={m} previous={conversation.chat[i - 1]} seat={m.author.kind === "model" ? seatOf(m.author.memberId) : undefined} speech={speech} /> }));
    conversation.notes.forEach((n) => out.push({ at: n.at, key: n.id, node: <Note note={n} nameOf={(mid) => (seatOf(mid) ? seatName(seatOf(mid)!) : "A panellist")} /> }));
    conversation.turns.forEach((t: Turn) =>
      out.push({ at: t.startedAt, key: t.id, node: <TurnBlock conversationId={id} turn={t} hermesConfigured={Boolean(info?.hermes.configured)} onOpenPanel={(tab) => onOpenPanel(t.id, tab)} /> })
    );
    return out.sort((a, b) => a.at.localeCompare(b.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.seq, seats, speech]);

  // Who's preparing: speakers the moderator picked who haven't posted since the note.
  const lastNote = conversation.notes.at(-1);
  const typing = conversation.chatBusy && lastNote ? lastNote.speakers.filter((s) => !conversation.chat.some((m) => m.at >= lastNote.at && m.author.kind === "model" && m.author.memberId === s)) : [];

  const fail = (e: unknown) => setError((e as Error).message);
  const length = rounds ?? settings.rounds;
  const actions = {
    continue: () => {
      if (spectating) player.skipToLive();
      void api.continueChat(id, length).catch(fail);
    },
    wrapUp: () => {
      setView("chat");
      void api.wrapUp(id).catch(fail);
    },
    stop: () => void api.stopChat(id).catch(fail)
  };
  const hasReplies = conversation.chat.some((m) => m.author.kind === "model");
  const canContinue = !conversation.chatBusy && !wrapping && hasReplies;

  const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("main textarea")?.focus());
  const raiseHand = (seat?: Seat) => {
    if (spectating) player.pause();
    setHandUp(true);
    if (seat) setDraft((d) => `${d.trimEnd()} @${seatName(seat)} `.trimStart());
    focusComposer();
  };

  const send = async () => {
    setError(null);
    await api.chat(id, draft, length);
    setDraft("");
    setHandUp(false);
    pinned.current = true;
    // The panel answers the user next; anything not yet heard stays in the transcript.
    if (spectating) player.skipToLive();
  };

  const mentionable = seats.map((s) => ({ ...s.member, label: seatName(s) }));
  const showComposer = !reviewing && (!spectating || handUp || player.status === "ended");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost-muted" size="icon-sm" className="md:hidden" onClick={onOpenSidebar} aria-label="Open sidebar">
          <Menu />
        </Button>
        <MessagesSquare className={cn("size-4 shrink-0 max-sm:hidden", mode.tint)} />
        <input
          key={conversation.title}
          defaultValue={conversation.title}
          aria-label="Discussion title"
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 font-medium text-sm outline-none hover:bg-accent focus:bg-accent"
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (title && title !== conversation.title) void api.updateConversation(id, { title });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span className="hidden items-center gap-1 text-muted-foreground text-xs lg:flex">
          <ModeIcon className="size-3.5" />
          {mode.label}
        </span>
        <div className="flex shrink-0 rounded-lg bg-muted p-0.5" role="tablist" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              title={v.hint}
              onClick={() => setView(v.id)}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-[background-color,color,box-shadow] duration-150",
                view === v.id ? "bg-card font-medium text-foreground shadow-[0_1px_3px_rgb(0_0_0/10%)]" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <v.icon className="size-3.5" />
              <span className="max-sm:hidden">{v.label}</span>
            </button>
          ))}
        </div>
        <Button size="sm" disabled={wrapping || conversation.chatBusy || !hasReplies} onClick={actions.wrapUp} title="Turn this discussion into a brief and a shareable document">
          <FileCheck2 /> <span className="max-sm:hidden">Wrap up</span>
        </Button>
      </header>

      {spectating ? (
        <SpectatorView
          conversation={conversation}
          seats={seats}
          layout={view === "stage" ? "stage" : "table"}
          player={player}
          thinking={typing}
          speech={speech}
          onRaiseHand={raiseHand}
          onStop={actions.stop}
          ending={
            <div className="flex flex-wrap justify-center gap-2">
              {canContinue && (
                <Button variant="outline" className="rounded-full" onClick={actions.continue}>
                  <Play className="size-3" /> Keep discussing
                </Button>
              )}
              {hasReplies && (
                <Button variant="outline" className="rounded-full" disabled={wrapping} onClick={actions.wrapUp}>
                  <FileCheck2 /> Wrap up
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 pt-8 pb-10">
            {!conversation.chat.length && <Intro seats={seats} personas={settings.personas} />}
            {items.map((i) => (
              <div key={i.key}>{i.node}</div>
            ))}
            {reviewing && (
              <CastReview
                seats={seats}
                casting={casting}
                speech={speech}
                onStart={(personas: Persona[]) => api.confirmPersonas(id, personas, length).then(() => undefined)}
                onRecast={(hint) => api.recast(id, hint).then(() => undefined)}
              />
            )}
            {!reviewing &&
              typing.map((memberId) => {
                const seat = seatOf(memberId);
                return seat ? <Typing key={memberId} seat={seat} /> : null;
              })}
          </div>
        </div>
      )}

      {showComposer && (
        <div className={cn("mx-auto w-full max-w-3xl px-4 pb-4", spectating && "fade-in")}>
          {seats.length > 0 && !spectating && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
              <AtSign className="size-3.5 text-faint" />
              {seats.map((s) => (
                <button
                  key={s.member.id}
                  type="button"
                  onClick={() => raiseHand(s)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border bg-card py-0.5 pr-2.5 pl-1 text-xs transition-[background-color,scale] duration-150 hover:bg-accent active:scale-[0.97]"
                  title={`Ask ${seatName(s)} directly${s.persona ? ` (${s.persona.role}, played by ${s.member.label})` : ""}`}
                >
                  {s.persona ? <PersonaAvatar seat={s} size={18} badge={false} /> : <ModelLogo member={s.member} className="mx-0.5 size-3.5" />}
                  {seatName(s)}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mb-2 px-1 text-error-foreground text-xs">{error}</p>}
          <Composer
            value={draft}
            onValueChange={setDraft}
            placeholder={handUp ? "You have the floor. Say something, or @mention a panellist…" : conversation.chat.length ? "Reply, @mention a panellist, or type / for commands…" : "What should the panel debate?"}
            files={[]}
            onAttach={() => setError("Attachments aren't supported in discussions yet. Start a council case to attach files, or add the file as a knowledge base in Settings.")}
            voice={Boolean(info?.voice.available)}
            mentions={memberMentions(mentionable)}
            commands={discussionCommands(actions)}
            footer={
              <>
                <RoundsPicker value={length} onChange={setRounds} />
                {spectating && handUp ? (
                  <Button variant="ghost-muted" size="sm" className="rounded-full" onClick={() => (setHandUp(false), player.play())} title="Go back to listening">
                    <X className="size-3" /> Lower hand
                  </Button>
                ) : conversation.chatBusy ? (
                  <Button variant="outline" size="sm" className="rounded-full" onClick={actions.stop} title="Stop the panel">
                    <Square className="size-2.5 fill-current" /> Stop
                  </Button>
                ) : canContinue && !spectating ? (
                  <Button variant="outline" size="sm" className="rounded-full" onClick={actions.continue} title="Let the panel keep discussing (/continue)">
                    <Play className="size-3" /> Keep discussing
                  </Button>
                ) : null}
              </>
            }
            onSend={send}
          />
        </div>
      )}
      {reviewing && error && <p className="mx-auto w-full max-w-3xl px-5 pb-3 text-error-foreground text-xs">{error}</p>}
    </div>
  );
}

function Intro({ seats, personas }: { seats: Seat[]; personas: boolean }) {
  return (
    <div className="py-16 text-center">
      <div className="flex justify-center -space-x-2">
        {seats.map((s, i) => (
          <span key={s.member.id} className="reveal flex size-10 items-center justify-center rounded-full border bg-card shadow-[var(--shadow-raised)] ring-4 ring-background" style={{ "--i": i } as React.CSSProperties}>
            <ModelLogo member={s.member} className="size-5" />
          </span>
        ))}
      </div>
      <p className="mt-5 font-medium">A debate with the panel</p>
      <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-sm">
        {personas ? "Ask your question. The moderator casts a persona for each model, you approve the panel, and they debate. " : "A moderator lets the right models answer, and they'll challenge each other. "}
        Watch at the table or on stage, raise your hand any time, and wrap up when you have what you need.
      </p>
    </div>
  );
}

/** Plays one message aloud from the transcript. */
let speaking: HTMLAudioElement | null = null;
function SpeakButton({ conversationId, messageId }: { conversationId: string; messageId: string }) {
  const [on, setOn] = useState(false);
  const mine = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => mine.current?.pause(), []);
  return (
    <button
      type="button"
      aria-label={on ? "Stop" : "Listen"}
      title={on ? "Stop" : "Listen"}
      onClick={() => {
        speaking?.pause();
        if (on) return setOn(false);
        const audio = new Audio(api.speechUrl(conversationId, messageId));
        mine.current = speaking = audio;
        audio.onended = audio.onerror = audio.onpause = () => setOn(false);
        setOn(true);
        void audio.play().catch(() => setOn(false));
      }}
      className={cn("flex size-6 cursor-pointer items-center justify-center rounded-md text-faint transition-[opacity,color,background-color] hover:bg-accent hover:text-foreground", on ? "text-accent-brand opacity-100" : "sm:opacity-0 sm:group-hover/message:opacity-100 sm:focus-visible:opacity-100")}
    >
      {on ? <Square className="size-2.5 fill-current" /> : <Volume2 className="size-3.5" />}
    </button>
  );
}

function Message({ conversationId, message, previous, seat, speech }: { conversationId: string; message: ChatMessage; previous?: ChatMessage; seat?: Seat; speech: boolean }) {
  if (message.author.kind === "user") {
    return (
      <div className="fade-in mt-4 ml-auto max-w-[80%] rounded-[1.25rem] rounded-br-md bg-message px-4 py-2.5">
        <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{message.text}</p>
      </div>
    );
  }
  const author = message.author;
  const grouped = previous?.author.kind === "model" && previous.author.memberId === author.memberId;
  const fallback: Seat = seat ?? { member: { id: author.memberId, label: author.label, provider: author.provider, model: author.model }, index: 0 };
  return (
    <div className={cn("group/message fade-in flex gap-3", grouped ? "mt-1" : "mt-4")}>
      <span className={cn("shrink-0", grouped && "invisible")}>
        {fallback.persona ? (
          <PersonaAvatar seat={fallback} size={32} badge={false} />
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full border bg-card">
            <ModelLogo member={author} className="size-4" />
          </span>
        )}
      </span>
      <div className="min-w-0 max-w-[85%]">
        {!grouped && (
          <p className="mb-0.5 flex items-center gap-1.5 text-xs">
            <span className="font-medium text-foreground/80">{author.persona || author.label}</span>
            {author.persona && (
              <span className="flex min-w-0 items-center gap-1 truncate text-faint">
                {fallback.persona?.role ? `${fallback.persona.role} · ` : ""}
                <ModelLogo member={author} className="size-3" />
                {author.label}
              </span>
            )}
          </p>
        )}
        <div className="flex items-end gap-1">
          <div className="min-w-0 rounded-[1.25rem] rounded-tl-md border bg-card px-4 py-2.5">
            {message.error ? <p className="text-error-foreground text-sm">Couldn't reply: {message.error}</p> : <Markdown text={message.text} className="text-[0.9375rem]" />}
          </div>
          {speech && !message.error && <SpeakButton conversationId={conversationId} messageId={message.id} />}
        </div>
      </div>
    </div>
  );
}

function Typing({ seat }: { seat: Seat }) {
  const text = useDraft("chat", `chat:${seat.member.id}`);
  return (
    <div className="mt-4 flex gap-3">
      {seat.persona ? (
        <PersonaAvatar seat={seat} size={32} badge={false} state="thinking" />
      ) : (
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-card">
          <span className="seat-ring" aria-hidden />
          <ModelLogo member={seat.member} className="size-4" />
        </span>
      )}
      <div className="min-w-0 max-w-[85%]">
        <p className="mb-0.5 font-medium text-muted-foreground text-xs">{seatName(seat)}</p>
        <div className="rounded-[1.25rem] rounded-tl-md border bg-card px-4 py-2.5">
          {text ? (
            <Markdown text={text} className="text-[0.9375rem]" />
          ) : (
            <span className="flex h-6 items-center gap-1" aria-label={`${seatName(seat)} is typing`}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 120}ms`, animationDuration: "900ms" }} />
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Note({ note, nameOf }: { note: ModeratorNote; nameOf: (memberId: string) => string }) {
  const names = note.speakers.map(nameOf);
  return (
    <div className="mt-5 text-center text-2xs text-faint">
      {note.round ? (
        <p className="mb-1 flex items-center gap-3 text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          Round {note.round} of {note.of}
          <span className="h-px flex-1 bg-border" />
        </p>
      ) : null}
      <p>
        Moderator called on {names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]}
        {note.reason ? ` · ${note.reason}` : ""}
      </p>
      {note.knowledge?.length ? (
        <p className="mt-0.5 flex items-center justify-center gap-1">
          <BookOpen className="size-3" /> Drawing on {note.knowledge.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

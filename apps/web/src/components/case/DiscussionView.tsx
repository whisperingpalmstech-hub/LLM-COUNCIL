// Discuss mode: a moderated group chat between the user and the council's models.
import { AtSign, FileCheck2, Menu, MessagesSquare, Play, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Conversation, CouncilMember, Depth, ModeratorNote, ServerInfo, Turn } from "@synod/contracts";
import { discussionCommands, memberMentions } from "~/lib/commands";
import { LengthPicker } from "../DepthPicker";
import { api } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { useDraft, useDraftRev } from "~/lib/store";
import { cn } from "~/lib/utils";
import { Composer } from "../Composer";
import { Markdown } from "../Markdown";
import { ModelLogo } from "../ModelLogo";
import { Button } from "../ui/button";
import { TurnBlock } from "./TurnBlock";
import type { PanelTab } from "./CouncilPanel";

type Item = { at: string; key: string; node: ReactNode };

export function DiscussionView({ conversation, info, onOpenSidebar, onOpenPanel }: { conversation: Conversation; info: ServerInfo | null; onOpenSidebar: () => void; onOpenPanel: (turnId: string, tab: PanelTab) => void }) {
  const id = conversation.id;
  const [draft, setDraft] = useState("");
  const [council, setCouncil] = useState<CouncilMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [length, setLength] = useState<Depth>("standard");
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const draftRev = useDraftRev();
  const mode = MODE_UI[conversation.mode];
  const ModeIcon = mode.icon;
  const wrapping = conversation.turns.at(-1)?.status === "running";

  // The panel: whoever has spoken, plus the recommended members for this case type.
  useEffect(() => {
    Promise.all([api.council(), api.recipes()])
      .then(([c, r]) => setCouncil(c.auto && r.available ? r.recipes[conversation.mode].members : c.members))
      .catch(() => undefined);
  }, [conversation.mode]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [conversation.seq, draftRev]);

  const memberLabel = (memberId: string) => council.find((m) => m.id === memberId)?.label ?? conversation.chat.find((m) => m.author.kind === "model" && m.author.memberId === memberId)?.author;

  // One timeline: messages, moderator notes, and wrap-ups, in time order.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    conversation.chat.forEach((m, i) => out.push({ at: m.at, key: m.id, node: <Message message={m} previous={conversation.chat[i - 1]} /> }));
    conversation.notes.forEach((n) => out.push({ at: n.at, key: n.id, node: <Note note={n} labelOf={(mid) => labelText(memberLabel(mid))} /> }));
    conversation.turns.forEach((t: Turn) =>
      out.push({ at: t.startedAt, key: t.id, node: <TurnBlock conversationId={id} turn={t} hermesConfigured={Boolean(info?.hermes.configured)} onOpenPanel={(tab) => onOpenPanel(t.id, tab)} /> })
    );
    return out.sort((a, b) => a.at.localeCompare(b.at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.seq, council.length]);

  // Who's "typing": speakers the moderator picked who haven't posted since the note.
  const lastNote = conversation.notes.at(-1);
  const typing = conversation.chatBusy && lastNote ? lastNote.speakers.filter((s) => !conversation.chat.some((m) => m.at >= lastNote.at && m.author.kind === "model" && m.author.memberId === s)) : [];

  const fail = (e: unknown) => setError((e as Error).message);
  const actions = {
    continue: () => void api.continueChat(id, length).catch(fail),
    wrapUp: () => void api.wrapUp(id).catch(fail),
    stop: () => void api.stopChat(id).catch(fail)
  };
  const canContinue = !conversation.chatBusy && !wrapping && conversation.chat.some((m) => m.author.kind === "model");

  const send = async () => {
    setError(null);
    await api.chat(id, draft, length);
    setDraft("");
    pinned.current = true;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button variant="ghost-muted" size="icon-sm" className="md:hidden" onClick={onOpenSidebar} aria-label="Open sidebar">
          <Menu />
        </Button>
        <MessagesSquare className={cn("size-4 shrink-0", mode.tint)} />
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
        <span className="hidden items-center gap-1 text-muted-foreground text-xs sm:flex">
          <ModeIcon className="size-3.5" />
          {mode.label}
        </span>
        <Button
          size="sm"
          disabled={wrapping || conversation.chatBusy || !conversation.chat.some((m) => m.author.kind === "model")}
          onClick={() => api.wrapUp(id).catch((e) => setError((e as Error).message))}
          title="Turn this discussion into a brief and a shareable document"
        >
          <FileCheck2 /> Wrap up
        </Button>
      </header>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 pt-8 pb-10">
          {!conversation.chat.length && <Intro council={council} />}
          {items.map((i) => (
            <div key={i.key}>{i.node}</div>
          ))}
          {typing.map((memberId) => {
            const member = council.find((m) => m.id === memberId);
            return member ? <Typing key={memberId} member={member} /> : null;
          })}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        {council.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
            <AtSign className="size-3.5 text-faint" />
            {council.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setDraft((d) => `${d.trimEnd()} @${m.label} `.trimStart());
                  // Return focus to the message box so typing doesn't re-press this chip.
                  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("main textarea")?.focus());
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border bg-card py-0.5 pr-2.5 pl-1.5 text-xs transition-[background-color,scale] duration-150 hover:bg-accent active:scale-[0.97]"
                title={`Ask ${m.label} directly`}
              >
                <ModelLogo member={m} className="size-3.5" />
                {m.label}
              </button>
            ))}
          </div>
        )}
        {error && <p className="mb-2 px-1 text-error-foreground text-xs">{error}</p>}
        <Composer
          value={draft}
          onValueChange={setDraft}
          placeholder={conversation.chat.length ? "Reply, @mention a model, or type / for commands…" : "Start the discussion…"}
          files={[]}
          onAttach={() => setError("Attachments aren't supported in discussions yet. Start a council case to attach files.")}
          voice={Boolean(info?.voice.available)}
          mentions={memberMentions(council)}
          commands={discussionCommands(actions)}
          footer={
            <>
              <LengthPicker value={length} onChange={setLength} />
              {conversation.chatBusy ? (
                <Button variant="outline" size="sm" className="rounded-full" onClick={actions.stop} title="Stop the panel">
                  <Square className="size-2.5 fill-current" /> Stop
                </Button>
              ) : canContinue ? (
                <Button variant="outline" size="sm" className="rounded-full" onClick={actions.continue} title="Let the panel keep discussing (/continue)">
                  <Play className="size-3" /> Keep discussing
                </Button>
              ) : null}
            </>
          }
          onSend={send}
        />
      </div>
    </div>
  );
}

function labelText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "label" in value) return String((value as { label: string }).label);
  return "A panellist";
}

function Intro({ council }: { council: CouncilMember[] }) {
  return (
    <div className="py-16 text-center">
      <div className="flex justify-center -space-x-2">
        {council.map((m) => (
          <span key={m.id} className="flex size-10 items-center justify-center rounded-full border bg-card shadow-[var(--shadow-raised)] ring-4 ring-background">
            <ModelLogo member={m} className="size-5" />
          </span>
        ))}
      </div>
      <p className="mt-5 font-medium">A group discussion with the panel</p>
      <p className="mx-auto mt-1 max-w-sm text-muted-foreground text-sm">A moderator lets the right models answer, and they'll challenge each other. Jump in any time; wrap up when you have what you need.</p>
    </div>
  );
}

function Message({ message, previous }: { message: ChatMessage; previous?: ChatMessage }) {
  if (message.author.kind === "user") {
    return (
      <div className="fade-in mt-4 ml-auto max-w-[80%] rounded-[1.25rem] rounded-br-md bg-message px-4 py-2.5">
        <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{message.text}</p>
      </div>
    );
  }
  const author = message.author;
  const grouped = previous?.author.kind === "model" && previous.author.memberId === author.memberId;
  return (
    <div className={cn("fade-in flex gap-3", grouped ? "mt-1" : "mt-4")}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border bg-card", grouped && "invisible")}>
        <ModelLogo member={author} className="size-4" />
      </span>
      <div className="min-w-0 max-w-[85%]">
        {!grouped && <p className="mb-0.5 font-medium text-muted-foreground text-xs">{author.label}</p>}
        <div className="rounded-[1.25rem] rounded-tl-md border bg-card px-4 py-2.5">
          {message.error ? <p className="text-error-foreground text-sm">Couldn't reply: {message.error}</p> : <Markdown text={message.text} className="text-[0.9375rem]" />}
        </div>
      </div>
    </div>
  );
}

function Typing({ member }: { member: CouncilMember }) {
  const text = useDraft("chat", `chat:${member.id}`);
  return (
    <div className="mt-4 flex gap-3">
      <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border bg-card">
        <span className="seat-ring" aria-hidden />
        <ModelLogo member={member} className="size-4" />
      </span>
      <div className="min-w-0 max-w-[85%]">
        <p className="mb-0.5 font-medium text-muted-foreground text-xs">{member.label}</p>
        <div className="rounded-[1.25rem] rounded-tl-md border bg-card px-4 py-2.5">
          {text ? (
            <Markdown text={text} className="text-[0.9375rem]" />
          ) : (
            <span className="flex h-6 items-center gap-1" aria-label={`${member.label} is typing`}>
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

function Note({ note, labelOf }: { note: ModeratorNote; labelOf: (memberId: string) => string }) {
  const names = note.speakers.map(labelOf);
  return (
    <p className="mt-4 text-center text-2xs text-faint">
      Moderator: {names.join(" and ")}
      {note.reason ? `, ${note.reason.charAt(0).toLowerCase()}${note.reason.slice(1)}` : ""}
    </p>
  );
}

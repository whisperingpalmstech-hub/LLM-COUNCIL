import { Menu, PanelRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ServerInfo } from "@synod/contracts";
import { api, fileToBase64 } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { useConversation, useDraftRev } from "~/lib/store";
import { cn } from "~/lib/utils";
import { Composer } from "../Composer";
import { Button } from "../ui/button";
import { CouncilPanel, type PanelTab } from "./CouncilPanel";
import { TurnBlock } from "./TurnBlock";

export function CaseView({ id, info, onOpenSidebar }: { id: string; info: ServerInfo | null; onOpenSidebar: () => void }) {
  const conversation = useConversation(id);
  const draftRev = useDraftRev();
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<{ turnId: string; tab: PanelTab; memberId?: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new content while the user is at the bottom (T3-style auto-follow).
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight });
  }, [conversation?.seq, draftRev]);

  if (!conversation) return <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">Loading case…</div>;

  const mode = MODE_UI[conversation.mode];
  const ModeIcon = mode.icon;
  const active = conversation.turns.at(-1);
  const busy = active?.status === "running" || active?.status === "awaiting_clarification";
  const panelTurn = panel ? conversation.turns.find((t) => t.id === panel.turnId) : undefined;

  const openPanel = (turnId: string, tab: PanelTab, memberId?: string) => setPanel({ turnId, tab, memberId });

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button variant="ghost-muted" size="icon-sm" className="md:hidden" onClick={onOpenSidebar} aria-label="Open sidebar">
            <Menu />
          </Button>
          <ModeIcon className={cn("size-4 shrink-0", mode.tint)} />
          <input
            key={conversation.title}
            defaultValue={conversation.title}
            aria-label="Case title"
            className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1 font-medium text-sm outline-none hover:bg-accent focus:bg-accent"
            onBlur={(e) => {
              const title = e.currentTarget.value.trim();
              if (title && title !== conversation.title) void api.updateConversation(id, { title });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          {active && (
            <Button variant={panel ? "secondary" : "ghost-muted"} size="sm" onClick={() => (panel ? setPanel(null) : openPanel(active.id, "opinions"))}>
              <PanelRight />
              <span className="hidden sm:inline">Council</span>
            </Button>
          )}
        </header>

        <div
          ref={scroller}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 pt-8 pb-10">
            {conversation.turns.map((turn) => (
              <TurnBlock key={turn.id} conversationId={id} turn={turn} hermesConfigured={Boolean(info?.hermes.configured)} onOpenPanel={(tab, memberId) => openPanel(turn.id, tab, memberId)} />
            ))}
            {!conversation.turns.length && <p className="py-20 text-center text-muted-foreground text-sm">Describe the case below to convene the council.</p>}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          <Composer
            value={draft}
            onValueChange={setDraft}
            placeholder={conversation.turns.length ? "Ask a follow-up or add new information…" : mode.placeholder}
            busy={busy}
            onStop={() => api.cancel(id)}
            files={conversation.pendingAttachments.map((a) => ({ id: a.id, name: a.name, readable: Boolean(a.excerpt) }))}
            onAttach={async (files) => {
              for (const f of files) await api.upload(id, { name: f.name, mimeType: f.type, data: await fileToBase64(f) });
            }}
            voice={Boolean(info?.voice.available)}
            phoneLink={() => api.uploadLink(id).then((r) => (r.url.startsWith("http") ? r.url : `${location.origin}${r.url}`))}
            onSend={async () => {
              await api.send(id, draft);
              setDraft("");
              pinned.current = true;
            }}
          />
        </div>
      </div>

      {panel && panelTurn && (
        <CouncilPanel
          turn={panelTurn}
          tab={panel.tab}
          memberId={panel.memberId}
          onTabChange={(tab) => setPanel({ ...panel, tab })}
          onMemberChange={(memberId) => setPanel({ ...panel, memberId })}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

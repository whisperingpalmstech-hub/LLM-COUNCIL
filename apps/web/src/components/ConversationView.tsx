import { useEffect, useRef } from "react";
import type { ServerInfo } from "@synod/contracts";
import { api } from "../lib/api";
import { useConversation } from "../lib/store";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";

export function ConversationView({ id, info }: { id: string; info: ServerInfo | null }) {
  const conversation = useConversation(id);
  const bottom = useRef<HTMLDivElement>(null);
  const lastSeq = conversation?.seq ?? 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation?.turns.length, lastSeq]);

  if (!conversation) return <div className="empty-state muted">Loading…</div>;
  const active = conversation.turns.at(-1);
  const busy = active?.status === "running" || active?.status === "awaiting_clarification";

  return (
    <div className="conversation">
      <header className="conversation-head">
        <input
          className="title-input"
          defaultValue={conversation.title}
          key={conversation.title}
          aria-label="Conversation title"
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (title && title !== conversation.title) void api.updateConversation(id, { title });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        {busy && (
          <button className="ghost small" onClick={() => api.cancel(id)}>
            Stop
          </button>
        )}
      </header>
      <div className="turns">
        {!conversation.turns.length && (
          <div className="hint muted">
            <p>Describe your question or decision. More context gives better answers: constraints, budget, timeline, what success looks like.</p>
          </div>
        )}
        {conversation.turns.map((turn) => (
          <TurnView key={turn.id} conversationId={id} turn={turn} info={info} />
        ))}
        <div ref={bottom} />
      </div>
      <Composer conversation={conversation} disabled={busy} info={info} />
    </div>
  );
}

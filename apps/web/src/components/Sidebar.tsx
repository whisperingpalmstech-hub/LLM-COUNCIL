import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { navigate } from "../lib/router";
import { store, useConnected, useSummaries } from "../lib/store";

export function Sidebar({ activeId, onNew, onSettings }: { activeId: string | null; onNew: () => void; onSettings: () => void }) {
  const summaries = useSummaries();
  const connected = useConnected();
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void store.refreshSummaries().catch(() => undefined);
  }, []);

  const visible = summaries.filter((s) => s.archived === showArchived);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          Synod
        </a>
        <span className={`dot ${connected ? "ok" : "off"}`} title={connected ? "Live" : "Reconnecting…"} />
      </div>
      <button className="primary wide" onClick={onNew}>
        + New conversation
      </button>
      <nav className="conversation-list">
        {visible.map((s) => (
          <div key={s.id} className={`conversation-item ${s.id === activeId ? "active" : ""}`}>
            <a
              href={`/c/${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(`/c/${s.id}`);
              }}
            >
              <span className="title">{s.title || "Untitled"}</span>
              <span className="meta">
                {s.turnCount} {s.turnCount === 1 ? "message" : "messages"}
                {s.status === "running" && " · working…"}
                {s.status === "awaiting_clarification" && " · needs your answer"}
              </span>
            </a>
            <button className="ghost small" title={s.archived ? "Restore" : "Archive"} onClick={() => api.updateConversation(s.id, { archived: !s.archived })}>
              {s.archived ? "↺" : "×"}
            </button>
          </div>
        ))}
        {!visible.length && <p className="muted pad">{showArchived ? "No archived conversations." : "No conversations yet."}</p>}
      </nav>
      <div className="sidebar-foot">
        <button className="ghost small" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "← Active" : "Archived"}
        </button>
        <button className="ghost small" onClick={onSettings}>
          Council settings
        </button>
      </div>
    </aside>
  );
}

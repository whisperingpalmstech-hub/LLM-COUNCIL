import { Archive, ArchiveRestore, PenSquare, Search, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConversationSummary } from "@synod/contracts";
import { api } from "~/lib/api";
import { MODE_UI } from "~/lib/modes";
import { navigate } from "~/lib/router";
import { store, useConnected, useSummaries } from "~/lib/store";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Kbd } from "./ui/misc";

export function Sidebar({
  activeId,
  open,
  onClose,
  onSettings,
  onSearch
}: {
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onSettings: () => void;
  onSearch: () => void;
}) {
  const summaries = useSummaries();
  const connected = useConnected();
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    void store.refreshSummaries().catch(() => undefined);
  }, []);

  const visible = summaries.filter((s) => s.archived === showArchived);
  const groups = groupByDay(visible);

  return (
    <>
      <div className={cn("fixed inset-0 z-30 bg-black/40 md:hidden", open ? "block" : "hidden")} onClick={onClose} />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r bg-sidebar transition-transform duration-300 ease-drawer md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-12 items-center justify-between px-3">
          <a
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <Logo />
            Synod
          </a>
          <div className="flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", connected ? "bg-success" : "animate-pulse bg-warning")} title={connected ? "Live" : "Reconnecting…"} />
            <Button variant="ghost-muted" size="icon-sm" className="md:hidden" onClick={onClose} aria-label="Close sidebar">
              <X />
            </Button>
          </div>
        </div>

        <div className="space-y-0.5 px-2">
          <SidebarAction icon={<PenSquare />} label="New case" hint={<Kbd>⇧⌘O</Kbd>} onClick={() => navigate("/")} />
          <SidebarAction icon={<Search />} label="Search" hint={<Kbd>⌘K</Kbd>} onClick={onSearch} />
        </div>

        <nav className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {groups.map(([label, items]) => (
            <div key={label} className="mb-3">
              <p className="px-2 pb-1 font-medium text-2xs text-muted-foreground">{label}</p>
              {items.map((s) => (
                <CaseRow key={s.id} summary={s} active={s.id === activeId} />
              ))}
            </div>
          ))}
          {!visible.length && <p className="px-2 py-6 text-center text-muted-foreground text-xs">{showArchived ? "No archived cases." : "No cases yet."}</p>}
        </nav>

        <div className="flex items-center justify-between border-t px-2 py-2">
          <Button variant="ghost-muted" size="sm" onClick={() => setShowArchived((v) => !v)}>
            <Archive />
            {showArchived ? "Active cases" : "Archived"}
          </Button>
          <Button variant="ghost-muted" size="icon-sm" onClick={onSettings} aria-label="Council settings" title="Council settings">
            <Settings2 />
          </Button>
        </div>
      </aside>
    </>
  );
}

function SidebarAction({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint?: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-muted-foreground text-sm transition-colors hover:bg-sidebar-row-hover hover:text-foreground [&_svg]:size-4"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      <span className="opacity-0 transition-opacity group-hover:opacity-100">{hint}</span>
    </button>
  );
}

function CaseRow({ summary: s, active }: { summary: ConversationSummary; active: boolean }) {
  const mode = MODE_UI[s.mode ?? "general"];
  const Icon = mode.icon;
  return (
    <div
      className={cn(
        "group relative flex items-center rounded-lg transition-colors",
        active ? "bg-sidebar-row-selected shadow-xs/5 ring-1 ring-border" : "hover:bg-sidebar-row-hover"
      )}
    >
      <a
        href={`/c/${s.id}`}
        onClick={(e) => {
          e.preventDefault();
          navigate(`/c/${s.id}`);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
      >
        <Icon className={cn("size-3.5 shrink-0", mode.tint)} />
        <span className="min-w-0 flex-1 truncate text-sm">{s.title || "Untitled case"}</span>
        <StatusDot status={s.status} />
      </a>
      <button
        type="button"
        className="absolute right-1 hidden size-6 cursor-pointer items-center justify-center rounded-md bg-sidebar-row-hover text-muted-foreground hover:text-foreground group-hover:flex"
        title={s.archived ? "Restore" : "Archive"}
        onClick={() => api.updateConversation(s.id, { archived: !s.archived })}
      >
        {s.archived ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
      </button>
    </div>
  );
}

function StatusDot({ status }: { status: ConversationSummary["status"] }) {
  if (status === "running") return <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-primary" /></span>;
  if (status === "awaiting_clarification") return <span className="size-2 rounded-full bg-warning" title="Needs your answer" />;
  if (status === "failed") return <span className="size-2 rounded-full bg-error" title="Failed" />;
  return null;
}

function groupByDay(items: ConversationSummary[]): [string, ConversationSummary[]][] {
  const groups = new Map<string, ConversationSummary[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  for (const s of items) {
    const d = new Date(s.updatedAt);
    const key = d.toDateString() === today ? "Today" : d.toDateString() === yesterday ? "Yesterday" : Date.now() - d.getTime() < 7 * 86_400_000 ? "This week" : "Older";
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()];
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeOpacity=".25" />
      <circle cx="12" cy="6.5" r="2.4" className="fill-primary" />
      <circle cx="7" cy="15" r="2.4" className="fill-primary" fillOpacity=".75" />
      <circle cx="17" cy="15" r="2.4" className="fill-primary" fillOpacity=".5" />
    </svg>
  );
}


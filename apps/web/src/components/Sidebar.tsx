import { Menu } from "@base-ui/react/menu";
import { Archive, ArchiveRestore, ChevronsUpDown, LogOut, MessagesSquare, Monitor, Moon, PenSquare, Search, Settings2, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConversationSummary } from "@synod/contracts";
import { api } from "~/lib/api";
import { signOut, useAuth } from "~/lib/auth";
import { MODE_UI } from "~/lib/modes";
import { navigate } from "~/lib/router";
import { store, useConnected, useSummaries } from "~/lib/store";
import { setTheme, useTheme, type ThemePreference } from "~/lib/theme";
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
  onSettings?: () => void;
  onSearch: () => void;
}) {
  const auth = useAuth();
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
            href="/new"
            className="flex items-center gap-2 font-semibold tracking-tight"
            onClick={(e) => {
              e.preventDefault();
              navigate("/new");
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
          <SidebarAction icon={<PenSquare />} label="New case" hint={<Kbd>⇧⌘O</Kbd>} onClick={() => navigate("/new")} />
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

        <div className="px-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-muted-foreground text-sm transition-colors hover:bg-sidebar-row-hover hover:text-foreground [&_svg]:size-4"
          >
            <Archive />
            {showArchived ? "Back to active cases" : "Archived cases"}
          </button>
        </div>
        {auth.status === "signed-in" && <AccountMenu name={auth.user.name} email={auth.user.email} onSettings={onSettings} />}
      </aside>
    </>
  );
}

function AccountMenu({ name, email, onSettings }: { name: string; email: string; onSettings?: () => void }) {
  const theme = useTheme();
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const item = "flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none data-[highlighted]:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground";
  return (
    <div className="border-t p-2">
      <Menu.Root>
        <Menu.Trigger className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-sidebar-row-hover data-[popup-open]:bg-sidebar-row-hover">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground font-semibold text-background text-xs">{initials || "?"}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-sm">{name}</span>
            <span className="block truncate text-2xs text-muted-foreground">{email}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-faint" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="top" align="start" sideOffset={6} className="z-50">
            <Menu.Popup className="w-60 origin-[var(--transform-origin)] rounded-2xl border bg-popover p-1.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
              <div className="px-2.5 pt-1.5 pb-2">
                <p className="text-2xs text-muted-foreground">Appearance</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Theme">
                  {(
                    [
                      ["system", Monitor, "System"],
                      ["light", Sun, "Light"],
                      ["dark", Moon, "Dark"]
                    ] as [ThemePreference, typeof Sun, string][]
                  ).map(([value, Icon, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={theme === value}
                      aria-label={label}
                      title={label}
                      onClick={() => setTheme(value)}
                      className={cn("flex h-7 cursor-pointer items-center justify-center rounded-md transition-colors", theme === value ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/8%)]" : "text-muted-foreground hover:text-foreground")}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  ))}
                </div>
              </div>
              {onSettings && (
                <Menu.Item className={item} onClick={onSettings}>
                  <Settings2 /> Settings
                </Menu.Item>
              )}
              <Menu.Item
                className={item}
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
              >
                <LogOut /> Sign out
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
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
  const Icon = s.kind === "chat" ? MessagesSquare : mode.icon;
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
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 group-hover:pr-9"
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


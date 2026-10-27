// "@" mentions and "/" commands in the composer, following T3 Code's composer trigger pattern:
// the token under the caret decides the menu; ↑/↓ move, Enter or Tab picks, Esc closes.
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "~/lib/utils";

export interface MentionItem {
  id: string;
  label: string;
  description?: string;
  icon: ReactNode;
}

export interface CommandItem {
  name: string;
  description: string;
  icon: LucideIcon;
  /** Runs immediately and clears the command text. */
  run?: () => void;
  /** Replaces the command with this text so the user can edit and send it. */
  insert?: string;
}

export type Trigger = { kind: "mention" | "command"; query: string; start: number; end: number };

/** The "@…" or "/…" token ending at the caret, if any. */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n")) + 1;
  const token = before.slice(start);
  if (token.startsWith("@") && !/\s/.test(token)) return { kind: "mention", query: token.slice(1).toLowerCase(), start, end: caret };
  // Commands only at the start of a word that begins the message, or after a space.
  if (token.startsWith("/") && /^\/[\w-]*$/.test(token)) return { kind: "command", query: token.slice(1).toLowerCase(), start, end: caret };
  return null;
}

export type MenuEntry = { key: string; label: string; description?: string; icon: ReactNode; pick: () => void };

export function filterEntries(trigger: Trigger, mentions: MentionItem[], commands: CommandItem[], apply: (replacement: string, run?: () => void) => void): MenuEntry[] {
  if (trigger.kind === "mention") {
    return mentions
      .filter((m) => !trigger.query || m.label.toLowerCase().replace(/\s+/g, "").includes(trigger.query.replace(/\s+/g, "")) || m.label.toLowerCase().includes(trigger.query))
      .map((m) => ({ key: m.id, label: m.label, description: m.description, icon: m.icon, pick: () => apply(`@${m.label} `) }));
  }
  return commands
    .filter((c) => !trigger.query || c.name.startsWith(trigger.query) || c.description.toLowerCase().includes(trigger.query))
    .map((c) => {
      const Icon = c.icon;
      return { key: c.name, label: `/${c.name}`, description: c.description, icon: <Icon className="size-4 text-muted-foreground" />, pick: () => (c.run ? apply("", c.run) : apply(c.insert ?? "")) };
    });
}

export function ComposerMenu({ entries, active, onHover, title }: { entries: MenuEntry[]; active: number; onHover: (i: number) => void; title: string }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!entries.length) return null;
  return (
    <div className="absolute inset-x-2 bottom-full z-30 mb-2 overflow-hidden rounded-2xl border bg-popover shadow-[0_16px_40px_-12px_rgb(0_0_0/0.3)]" role="listbox" aria-label={title}>
      <p className="px-3 pt-2.5 pb-1 text-2xs text-muted-foreground">{title}</p>
      <div ref={list} className="max-h-64 overflow-y-auto p-1.5 pt-0">
        {entries.map((e, i) => (
          <button
            key={e.key}
            type="button"
            role="option"
            data-index={i}
            aria-selected={i === active}
            // Keep focus in the textarea; pick on mousedown so the caret position survives.
            onMouseDown={(ev) => {
              ev.preventDefault();
              e.pick();
            }}
            onMouseMove={() => onHover(i)}
            className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left", i === active && "bg-accent")}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-card">{e.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sm">{e.label}</span>
              {e.description && <span className="block truncate text-muted-foreground text-xs">{e.description}</span>}
            </span>
            {i === active && <span className="shrink-0 text-2xs text-faint">Enter</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

import { Dialog as D } from "@base-ui/react/dialog";
import { CornerDownLeft, PenSquare, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MODE_UI } from "~/lib/modes";
import { navigate } from "~/lib/router";
import { useSummaries } from "~/lib/store";
import { cn, relativeTime } from "~/lib/utils";

interface Item {
  id: string;
  icon: ReactNode;
  label: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange, onSettings }: { open: boolean; onOpenChange: (open: boolean) => void; onSettings: () => void }) {
  const summaries = useSummaries();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const actions: Item[] = [
      { id: "new", icon: <PenSquare />, label: "New case", run: () => navigate("/") },
      { id: "settings", icon: <Settings2 />, label: "Council settings", run: onSettings }
    ];
    const cases: Item[] = summaries.map((s) => {
      const Icon = MODE_UI[s.mode ?? "general"].icon;
      return { id: s.id, icon: <Icon className={MODE_UI[s.mode ?? "general"].tint} />, label: s.title || "Untitled case", hint: relativeTime(s.updatedAt), run: () => navigate(`/c/${s.id}`) };
    });
    return [...actions, ...cases].filter((i) => !q || i.label.toLowerCase().includes(q));
  }, [query, summaries, onSettings]);

  const choose = (item?: Item) => {
    if (!item) return;
    onOpenChange(false);
    item.run();
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <D.Popup className="fixed top-[14vh] left-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover shadow-2xl outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0">
          <D.Title className="sr-only">Search</D.Title>
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(items.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(items[index]);
                }
              }}
              placeholder="Search cases or run a command…"
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(item)}
                className={cn("flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm [&_svg]:size-4", i === index ? "bg-accent" : "")}
              >
                <span className="text-muted-foreground">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="text-2xs text-muted-foreground">{item.hint}</span>}
                {i === index && <CornerDownLeft className="text-muted-foreground" />}
              </button>
            ))}
            {!items.length && <p className="px-3 py-8 text-center text-muted-foreground text-sm">No matches.</p>}
          </div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}

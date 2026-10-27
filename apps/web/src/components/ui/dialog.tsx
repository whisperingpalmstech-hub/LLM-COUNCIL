// Dialog styling follows T3 Code's dialog (MIT, T3 Tools Inc.), on Base UI primitives.
import { Dialog as D } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import { Button } from "./button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <D.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border bg-popover shadow-2xl outline-none transition-[scale,opacity] duration-200 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0",
            className
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
            <div>
              <D.Title className="font-semibold text-base">{title}</D.Title>
              {description && <D.Description className="mt-0.5 text-muted-foreground text-sm">{description}</D.Description>}
            </div>
            <D.Close render={<Button variant="ghost-muted" size="icon-sm" aria-label="Close" />}>
              <XIcon />
            </D.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}

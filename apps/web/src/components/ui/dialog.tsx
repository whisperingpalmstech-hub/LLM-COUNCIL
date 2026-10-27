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
        <D.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:opacity-0 dark:bg-black/60" />
        <D.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[88dvh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overscroll-contain rounded-3xl border bg-popover shadow-[0_24px_64px_-12px_rgb(0_0_0/0.25)] outline-none transition-[scale,opacity] duration-200 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-[0.96] data-starting-style:opacity-0",
            className
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <D.Title className="font-semibold text-[1.0625rem] tracking-tight">{title}</D.Title>
              {description && <D.Description className="mt-0.5 text-muted-foreground text-sm">{description}</D.Description>}
            </div>
            <D.Close render={<Button variant="ghost-muted" size="icon-sm" aria-label="Close" />}>
              <XIcon />
            </D.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-6 pt-2 pb-6">{children}</div>
        </D.Popup>
      </D.Portal>
    </D.Root>
  );
}

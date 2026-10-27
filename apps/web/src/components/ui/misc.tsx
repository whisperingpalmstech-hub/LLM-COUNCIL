import type { ComponentProps, ReactNode } from "react";
import { cn } from "~/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-2xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent", className)} />;
}

export function Badge({ className, tone = "neutral", children }: { className?: string; tone?: "neutral" | "success" | "warning" | "error" | "primary"; children: ReactNode }) {
  const tones = {
    neutral: "border-border bg-muted text-muted-foreground",
    success: "border-success/30 bg-success/10 text-success-foreground",
    warning: "border-warning/30 bg-warning-surface text-warning-foreground",
    error: "border-error/30 bg-error-surface text-error-foreground",
    primary: "border-primary/30 bg-primary/10 text-primary"
  };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-2xs", tones[tone], className)}>{children}</span>;
}

/** Small uppercase section label. */
export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn("font-semibold text-2xs text-muted-foreground uppercase tracking-[0.08em]", className)}>{children}</p>;
}

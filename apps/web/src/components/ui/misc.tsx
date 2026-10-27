import type { ComponentProps, ReactNode } from "react";
import { cn } from "~/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md border bg-card px-1 font-sans text-2xs text-muted-foreground", className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent [animation-duration:650ms]", className)} />;
}

export function Badge({ className, tone = "neutral", children }: { className?: string; tone?: "neutral" | "success" | "warning" | "error"; children: ReactNode }) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-success/12 text-success-foreground",
    warning: "bg-warning-surface text-warning-foreground",
    error: "bg-error-surface text-error-foreground"
  };
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-2xs", tones[tone], className)}>{children}</span>;
}

/** Section heading inside a card or panel. Sentence case, quiet, never all-caps. */
export function SectionTitle({ className, icon, children }: { className?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <h3 className={cn("flex items-center gap-1.5 font-semibold text-[0.8125rem] text-foreground [&_svg]:size-3.5 [&_svg]:text-muted-foreground", className)}>
      {icon}
      {children}
    </h3>
  );
}

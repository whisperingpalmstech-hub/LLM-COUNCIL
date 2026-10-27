import { Popover } from "@base-ui/react/popover";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import type { Turn } from "@synod/contracts";
import { api } from "~/lib/api";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

const EXPIRY = [
  [1, "24 hours"],
  [7, "7 days"],
  [30, "30 days"]
] as const;

/** Create, copy, and revoke read-only links to a turn's document. */
export function SharePopover({ conversationId, turn }: { conversationId: string; turn: Turn }) {
  const [days, setDays] = useState<1 | 7 | 30>(1);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = (turn.shares ?? []).filter((s) => !s.revoked && new Date(s.expiresAt).getTime() > Date.now());

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.share(conversationId, turn.id, days);
      setUrl(res.url);
      await navigator.clipboard.writeText(res.url).then(() => setCopied(true), () => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) {
          setUrl(null);
          setCopied(false);
        }
      }}
    >
      <Popover.Trigger render={<Button size="sm" />}>
        <Link2 /> Share
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="w-80 origin-[var(--transform-origin)] rounded-2xl border bg-popover p-4 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-200 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-150 data-starting-style:scale-[0.96] data-starting-style:opacity-0">
            <p className="font-medium text-sm">Share this opinion</p>
            <p className="mt-0.5 text-muted-foreground text-xs leading-snug">Anyone with the link can read the document, without signing in. They can't see the rest of the case or reply.</p>

            {url ? (
              <div className="mt-3 flex items-center gap-1.5 rounded-xl border bg-muted/60 py-1 pr-1 pl-3">
                <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">{url}</span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="text-success" /> : <Copy />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : (
              <>
                <p className="mt-3 text-2xs text-muted-foreground">Link expires after</p>
                <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup">
                  {EXPIRY.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={days === value}
                      onClick={() => setDays(value)}
                      className={cn("h-7 cursor-pointer rounded-lg text-xs transition-[background-color,box-shadow]", days === value ? "bg-card font-medium shadow-[0_1px_2px_rgb(0_0_0/10%)]" : "text-muted-foreground hover:text-foreground")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button className="mt-3 w-full" onClick={create} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Create link and copy
                </Button>
              </>
            )}
            {error && <p className="mt-2 text-error-foreground text-xs">{error}</p>}

            {active.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-2xs text-muted-foreground">Active links</p>
                <ul className="mt-1.5 space-y-1">
                  {active.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Expires {new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(s.expiresAt))}</span>
                      <Button size="xs" variant="ghost-muted" onClick={() => api.revokeShare(conversationId, turn.id, s.id)}>
                        Turn off
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-2xs text-faint leading-snug">Don't share identifiable patient or client details.</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

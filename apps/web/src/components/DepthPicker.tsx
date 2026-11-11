import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Gauge } from "lucide-react";
import { DEPTH_ROUNDS, DEPTHS, type Depth } from "@synod/contracts";
import { cn } from "~/lib/utils";

export const DEPTH_UI: Record<Depth, { label: string; detail: string; time: string }> = {
  quick: { label: "Quick", detail: "Answer, blind review, verdict", time: "about 1 min" },
  standard: { label: "Standard", detail: "Adds a round of revision after critique", time: "about 2 min" },
  thorough: { label: "Thorough", detail: "Two rounds of revision; for high-stakes calls", time: "about 3 min" }
};

/** How long the council deliberates. Stops early when the reviewers already agree. */
export function DepthPicker({ value, onChange }: { value: Depth; onChange: (depth: Depth) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent"
        title="How long the council deliberates"
      >
        <Gauge className="size-3.5" />
        {DEPTH_UI[value].label}
        <span className="text-faint">{DEPTH_ROUNDS[value]} rounds</span>
        <ChevronDown className="size-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="w-72 origin-[var(--transform-origin)] rounded-2xl border bg-popover p-1.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            <p className="px-2.5 pt-1.5 pb-1 text-2xs text-muted-foreground">Depth</p>
            {DEPTHS.map((d) => (
              <Menu.Item key={d} onClick={() => onChange(d)} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 outline-none data-[highlighted]:bg-accent">
                <Check className={cn("mt-0.5 size-3.5 shrink-0", d === value ? "text-foreground" : "invisible")} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-sm">{DEPTH_UI[d].label}</span>
                    <span className="text-2xs text-faint tabular-nums">
                      {DEPTH_ROUNDS[d]} rounds, {DEPTH_UI[d].time}
                    </span>
                  </span>
                  <span className="block text-muted-foreground text-xs">{DEPTH_UI[d].detail}</span>
                </span>
              </Menu.Item>
            ))}
            <p className="px-2.5 pt-1.5 pb-1 text-2xs text-faint leading-snug">The council stops early if the reviewers already agree.</p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Discuss mode: how many rounds the panel talks before handing back to you. */
export function RoundsPicker({ value, onChange }: { value: number; onChange: (rounds: number) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground data-[popup-open]:bg-accent" title="How many rounds the panel talks before handing back to you">
        <Gauge className="size-3.5" />
        {value} {value === 1 ? "round" : "rounds"}
        <ChevronDown className="size-3" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className="w-60 origin-[var(--transform-origin)] rounded-2xl border bg-popover p-1.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.25)] outline-none transition-[opacity,scale] duration-150 ease-[var(--ease-out)] data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            <p className="px-2.5 pt-1.5 pb-1 text-2xs text-muted-foreground">Rounds before it's your turn</p>
            <div className="grid grid-cols-6 gap-1 p-1">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <Menu.Item key={n} onClick={() => onChange(n)} className={cn("flex h-8 cursor-pointer items-center justify-center rounded-lg text-sm tabular-nums outline-none data-[highlighted]:bg-accent", n === value && "bg-primary text-primary-foreground data-[highlighted]:bg-primary")}>
                  {n}
                </Menu.Item>
              ))}
            </div>
            <p className="px-2.5 pt-1 pb-1.5 text-2xs text-faint leading-snug">The moderator ends early once the panel agrees. Speech length and speakers per round are in Settings.</p>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

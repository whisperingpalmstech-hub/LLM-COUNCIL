import { Crown, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CASE_MODES, DEPTH_ROUNDS, DEPTHS, PROVIDER_IDS, type CaseMode, type CouncilConfig, type CouncilMember, type ProviderId, type ServerInfo } from "@synod/contracts";
import { MODE_UI } from "~/lib/modes";
import { DEPTH_UI } from "./DepthPicker";
import { api } from "~/lib/api";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { ModelLogo } from "./ModelLogo";
import { SectionTitle } from "./ui/misc";

const PRESETS: { name: string; note: string; members: [string, string][]; chairman: string }[] = [
  {
    name: "Frontier",
    note: "Strongest models from each lab",
    members: [["GPT-6.1 Terra", "openai/gpt-6.1-terra"], ["Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5"], ["Gemini 4 Argon", "google/gemini-4-argon"], ["Grok 4.7", "x-ai/grok-4.7"]],
    chairman: "anthropic/claude-opus-5.5"
  },
  {
    name: "Fast & cheap",
    note: "About $0.02 per case",
    members: [["GPT-6 Luna", "openai/gpt-6-luna"], ["Claude Haiku 5.5", "anthropic/claude-haiku-5.5"], ["DeepSeek V4.1 Flash", "deepseek/deepseek-v4.1-flash"], ["GLM-5.3 Flash", "z-ai/glm-5.3-flash"]],
    chairman: "anthropic/claude-haiku-5.5"
  }
];

export function SettingsDialog({ open, onOpenChange, info }: { open: boolean; onOpenChange: (open: boolean) => void; info: ServerInfo | null }) {
  const [council, setCouncil] = useState<CouncilConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [recipes, setRecipes] = useState<Awaited<ReturnType<typeof api.recipes>> | null>(null);

  useEffect(() => {
    if (!open) return;
    api.council().then(setCouncil).catch((e) => setError(e.message));
    api.recipes().then(setRecipes, () => undefined);
  }, [open]);

  const configured = (p: ProviderId) => info?.providers.find((s) => s.provider === p)?.configured ?? false;
  const update = (patch: Partial<CouncilConfig>) => {
    setSaved(false);
    if (council) setCouncil({ ...council, ...patch });
  };

  const save = async () => {
    if (!council) return;
    setError(null);
    try {
      setCouncil(await api.saveCouncil(council));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Council settings" description="Synod picks strong models for you. Change them only if you want to.">
      {!council ? (
        <p className="text-muted-foreground text-sm">{error ?? "Loading…"}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <SectionTitle>Who sits on the council</SectionTitle>
            <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup">
              {(
                [
                  [true, "Recommended", "The best-performing models for each type of case, updated as models improve"],
                  [false, "Choose my own", "Pick the members and the chairman yourself"]
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={council.auto === value}
                  disabled={value && !recipes?.available}
                  onClick={() => update({ auto: value })}
                  className={cn(
                    "cursor-pointer rounded-2xl border p-3.5 text-left transition-[background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50",
                    council.auto === value ? "border-ring/50 shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_12%,transparent)]" : "hover:bg-accent"
                  )}
                >
                  <p className="font-medium text-sm">{label}</p>
                  <p className="mt-0.5 text-muted-foreground text-xs">{value && !recipes?.available ? "Needs an OpenRouter key on the server" : hint}</p>
                </button>
              ))}
            </div>
          </div>

          {council.auto && recipes?.available && (
            <div>
              <SectionTitle>What you'll get</SectionTitle>
              <ul className="mt-2 divide-y rounded-2xl border">
                {CASE_MODES.map((m: CaseMode) => {
                  const r = recipes.recipes[m];
                  const Icon = MODE_UI[m].icon;
                  return (
                    <li key={m} className="flex items-center gap-3 px-3.5 py-2.5">
                      <Icon className={cn("size-4 shrink-0", MODE_UI[m].tint)} />
                      <span className="w-20 shrink-0 font-medium text-sm">{MODE_UI[m].label}</span>
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                        {r.members.map((mem) => (
                          <span key={mem.id} className="flex items-center gap-1.5">
                            <ModelLogo member={mem} className="size-3.5" />
                            {mem.label}
                          </span>
                        ))}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs" title={`Chairman: ${r.chairman.label}`}>
                        <Crown className="size-3 text-amber-500" />
                        <ModelLogo member={r.chairman} className="size-3.5" />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-faint text-xs">Chosen from public benchmarks (Vals AI LegalBench and MedQA, Terminal-Bench, Artificial Analysis) and our own testing. Models from different labs make fewer of the same mistakes.</p>
            </div>
          )}

          <div>
            <SectionTitle>Default depth</SectionTitle>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup">
              {DEPTHS.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={council.depth === d}
                  onClick={() => update({ depth: d })}
                  className={cn("cursor-pointer rounded-lg px-3 py-2 text-left transition-[background-color,box-shadow] duration-150", council.depth === d ? "bg-card shadow-[0_1px_3px_rgb(0_0_0/10%)]" : "text-muted-foreground hover:text-foreground")}
                >
                  <span className="block font-medium text-sm">{DEPTH_UI[d].label}</span>
                  <span className="block text-2xs text-muted-foreground">
                    {DEPTH_ROUNDS[d]} rounds, {DEPTH_UI[d].time}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-faint text-xs">You can change the depth for any single case from the box where you type.</p>
          </div>

          {!council.auto && (
          <>
          {configured("openrouter") && (
            <div>
              <SectionTitle>Presets</SectionTitle>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="cursor-pointer rounded-2xl border p-3.5 text-left transition-[background-color,scale] duration-150 ease-out hover:bg-accent active:scale-[0.98]"
                    onClick={() =>
                      update({
                        members: p.members.map(([label, model]) => ({ id: model.replace(/[^\w.-]/g, "-"), label, provider: "openrouter", model })),
                        chairman: { id: "chairman", label: `Chairman (${p.members.find(([, m]) => m === p.chairman)?.[0] ?? p.chairman})`, provider: "openrouter", model: p.chairman }
                      })
                    }
                  >
                    <span className="flex -space-x-1">
                      {p.members.map(([label, model]) => (
                        <span key={model} className="flex size-6 items-center justify-center rounded-full border bg-background ring-2 ring-popover">
                          <ModelLogo member={{ label, model, provider: "openrouter" }} className="size-3.5" />
                        </span>
                      ))}
                    </span>
                    <p className="mt-2.5 font-medium text-sm">{p.name}</p>
                    <p className="text-muted-foreground text-xs">{p.note}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionTitle>Members</SectionTitle>
            <div className="mt-2 flex flex-col gap-1.5">
              {council.members.map((m, i) => (
                <MemberRow
                  key={i}
                  member={m}
                  configured={configured}
                  onChange={(patch) => update({ members: council.members.map((x, j) => (j === i ? { ...x, ...patch } : x)) })}
                  onRemove={council.members.length > 1 ? () => update({ members: council.members.filter((_, j) => j !== i) }) : undefined}
                />
              ))}
            </div>
            {council.members.length < 8 && (
              <Button
                variant="ghost-muted"
                size="sm"
                className="mt-1"
                onClick={() => update({ members: [...council.members, { id: `member-${Date.now().toString(36)}`, label: `Member ${council.members.length + 1}`, provider: configured("openrouter") ? "openrouter" : "mock", model: "" }] })}
              >
                <Plus /> Add member
              </Button>
            )}
          </div>

          <div>
            <SectionTitle icon={<Crown className="!text-amber-500" />}>Chairman</SectionTitle>
            <p className="mt-0.5 text-muted-foreground text-xs">Reads every opinion and review, then writes the verdict and the brief.</p>
            <div className="mt-2">
              <MemberRow member={council.chairman} configured={configured} onChange={(patch) => update({ chairman: { ...council.chairman, ...patch } })} />
            </div>
          </div>

          </>
          )}

          <div>
            <SectionTitle>Behaviour</SectionTitle>
            <div className="mt-2 flex flex-col gap-2">
              <Toggle checked={council.clarify} onChange={(v) => update({ clarify: v })} label="Ask one intake question when key details are missing" />
              <Toggle checked={council.brief} onChange={(v) => update({ brief: v })} label="Produce a structured second-opinion brief" />
              <Toggle
                checked={council.webSearch}
                disabled={!info?.search.configured}
                onChange={(v) => update({ webSearch: v })}
                label={`Web search${info?.search.configured ? ` (${info.search.provider})` : " (needs TAVILY_API_KEY or PERPLEXITY_API_KEY)"}`}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            {error && <p className="mr-auto text-error-foreground text-xs">{error}</p>}
            {saved && <p className="mr-auto text-success-foreground text-xs">Saved. New cases use this council.</p>}
            <Button variant="ghost-muted" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

const field = "h-9 min-w-0 rounded-xl border border-border-strong bg-card px-3 text-sm outline-none transition-shadow focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_12%,transparent)]";

function MemberRow({ member, configured, onChange, onRemove }: { member: CouncilMember; configured: (p: ProviderId) => boolean; onChange: (patch: Partial<CouncilMember>) => void; onRemove?: () => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-1.5 sm:grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1.3fr)_auto]">
      <div className="relative min-w-0">
        <ModelLogo member={member} className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input className={cn(field, "w-full pl-9")} aria-label="Name" value={member.label} onChange={(e) => onChange({ label: e.target.value })} />
      </div>
      <select className={cn(field, "order-3 sm:order-none")} aria-label="Provider" value={member.provider} onChange={(e) => onChange({ provider: e.target.value as ProviderId })}>
        {PROVIDER_IDS.map((p) => (
          <option key={p} value={p}>
            {p}
            {configured(p) ? "" : " ·off"}
          </option>
        ))}
      </select>
      <input className={cn(field, "order-4 font-mono text-xs sm:order-none")} aria-label="Model" placeholder="default model" value={member.model} onChange={(e) => onChange({ model: e.target.value })} />
      {onRemove ? (
        <Button variant="ghost-muted" size="icon" onClick={onRemove} aria-label="Remove member">
          <Trash2 />
        </Button>
      ) : (
        <span className="hidden sm:block sm:w-8" />
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 text-sm", disabled && "cursor-not-allowed opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors", checked ? "bg-primary" : "bg-input")}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-4")} />
      </button>
      {label}
    </label>
  );
}

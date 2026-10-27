// Live council activity as a compact work log, in the style of T3 Code's tool-call rows.
import { Check, ChevronDown, Crown, FileCheck2, Globe, Scale, Users, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { CouncilMember, Turn, TurnStage } from "@synod/contracts";
import { cn, formatDuration } from "~/lib/utils";
import { Spinner } from "../ui/misc";
import type { PanelTab } from "./CouncilPanel";

const ORDER: TurnStage[] = ["clarify", "research", "stage1", "stage2", "stage3", "brief"];

export function CouncilProgress({ turn, onOpenPanel }: { turn: Turn; onOpenPanel: (tab: PanelTab, memberId?: string) => void }) {
  const done = turn.status === "completed";
  const [open, setOpen] = useState(!done);
  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);

  const now = useNow(turn.status === "running");
  const reached = (stage: TurnStage) => turn.stage !== null && ORDER.indexOf(turn.stage) >= ORDER.indexOf(stage);
  const live = (stage: TurnStage) => turn.status === "running" && turn.stage === stage;
  const stageElapsed = turn.stageStartedAt ? now - new Date(turn.stageStartedAt).getTime() : 0;
  const total = (turn.completedAt ? new Date(turn.completedAt).getTime() : now) - new Date(turn.startedAt).getTime();

  const members = turn.council.members;
  const reviewers = members.filter((m) => turn.stage1.some((r) => r.memberId === m.id && !r.error));
  const showStage1 = turn.stage1.length > 0 || reached("stage1");
  const showStage2 = turn.stage2.length > 0 || reached("stage2");
  const showStage3 = Boolean(turn.synthesis) || reached("stage3");
  const showBrief = Boolean(turn.brief) || live("brief");
  if (!showStage1 && !live("clarify") && !live("research")) {
    return turn.status === "running" ? <Row icon={<Spinner />} label={<span className="live-shine">Convening the council…</span>} /> : null;
  }

  const summary = `${members.length} opinions · ${turn.stage2.filter((r) => !r.error).length} anonymous reviews · ${formatDuration(total)}`;

  return (
    <div className="rise-in rounded-xl border bg-card/60 px-3 py-2">
      <button type="button" className="flex w-full cursor-pointer items-center gap-2 py-1 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Users className="size-4 text-muted-foreground" />
        <span className={cn("flex-1 text-sm", turn.status === "running" ? "live-shine" : "text-muted-foreground")}>
          {turn.status === "running" ? stageTitle(turn.stage) : done ? `Council finished · ${summary}` : "Council"}
        </span>
        <span className="font-mono text-2xs text-muted-foreground tabular-nums">{formatDuration(total)}</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-1 flex flex-col pb-1">
          {turn.research.length > 0 || live("research") ? (
            <Row icon={live("research") ? <Spinner /> : <Globe className="size-3.5" />} label={live("research") ? <span className="live-shine">Searching the web…</span> : `Web research · ${turn.research.length} sources`} />
          ) : null}

          {showStage1 && (
            <Group title="Independent opinions" hint="Each model works the case alone">
              {members.map((m) => {
                const r = turn.stage1.find((x) => x.memberId === m.id);
                return (
                  <MemberRow
                    key={m.id}
                    member={m}
                    state={r ? (r.error ? "error" : "done") : live("stage1") ? "running" : "idle"}
                    trailing={r ? formatDuration(r.ms) : live("stage1") ? formatDuration(stageElapsed) : ""}
                    detail={r?.error}
                    onClick={r && !r.error ? () => onOpenPanel("opinions", m.id) : undefined}
                  />
                );
              })}
            </Group>
          )}

          {showStage2 && (
            <Group title="Anonymous peer review" hint="Each model ranks the answers without knowing who wrote them">
              {reviewers.map((m) => {
                const r = turn.stage2.find((x) => x.memberId === m.id);
                return (
                  <MemberRow
                    key={m.id}
                    member={m}
                    verb="reviewing"
                    state={r ? (r.error ? "error" : "done") : live("stage2") ? "running" : "idle"}
                    trailing={r && !r.error ? `ranked ${r.ranking.length}` : live("stage2") ? formatDuration(stageElapsed) : ""}
                    detail={r?.error}
                    onClick={r && !r.error ? () => onOpenPanel("reviews", m.id) : undefined}
                  />
                );
              })}
              {turn.aggregate && <Row icon={<Scale className="size-3.5" />} label="Rankings combined" onClick={() => onOpenPanel("agreement")} trailing="view agreement" />}
            </Group>
          )}

          {(showStage3 || showBrief) && (
            <Group title="Verdict">
              {showStage3 && (
                <Row
                  icon={live("stage3") ? <Spinner /> : <Crown className="size-3.5 text-amber-500" />}
                  label={live("stage3") ? <span className="live-shine">{turn.council.chairman.label} is weighing the opinions…</span> : `${turn.council.chairman.label} wrote the synthesis`}
                  trailing={live("stage3") ? formatDuration(stageElapsed) : ""}
                />
              )}
              {showBrief && (
                <Row
                  icon={live("brief") ? <Spinner /> : <FileCheck2 className="size-3.5 text-success" />}
                  label={live("brief") ? <span className="live-shine">Drafting the brief…</span> : "Brief ready"}
                  trailing={live("brief") ? formatDuration(stageElapsed) : ""}
                />
              )}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function stageTitle(stage: TurnStage | null): string {
  switch (stage) {
    case "clarify":
      return "Reviewing the case…";
    case "research":
      return "Researching…";
    case "stage1":
      return "Members are forming independent opinions…";
    case "stage2":
      return "Members are reviewing each other anonymously…";
    case "stage3":
      return "The chairman is weighing the opinions…";
    case "brief":
      return "Drafting the brief…";
    default:
      return "Working…";
  }
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-2">
      <p className="px-1 pb-0.5 font-medium text-2xs text-muted-foreground" title={hint}>
        {title}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function MemberRow({
  member,
  state,
  trailing,
  detail,
  verb = "thinking",
  onClick
}: {
  member: CouncilMember;
  state: "idle" | "running" | "done" | "error";
  trailing: string;
  detail?: string;
  verb?: string;
  onClick?: () => void;
}) {
  const icon =
    state === "running" ? <Spinner className="text-primary" /> : state === "done" ? <Check className="size-3.5 text-success" /> : state === "error" ? <X className="size-3.5 text-error" /> : <span className="size-1.5 rounded-full bg-muted-foreground/40" />;
  return (
    <Row
      icon={icon}
      label={
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn("truncate", state === "running" ? "live-shine" : "text-foreground")}>{member.label}</span>
          {state === "running" && <span className="shrink-0 text-muted-foreground">{verb}…</span>}
          {state === "error" && <span className="truncate text-error-foreground text-xs">{detail}</span>}
        </span>
      }
      trailing={trailing}
      onClick={onClick}
    />
  );
}

function Row({ icon, label, trailing, onClick }: { icon: ReactNode; label: ReactNode; trailing?: string; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("flex min-h-7 w-full items-center gap-2 rounded-md px-1 text-left text-sm", onClick && "cursor-pointer hover:bg-accent")}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
      {trailing && <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">{trailing}</span>}
    </Comp>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

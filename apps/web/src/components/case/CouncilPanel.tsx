import { createContext, useContext } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Crown, X } from "lucide-react";
import type { Turn } from "@synod/contracts";
import { useDraft } from "~/lib/store";
import { cn, formatDuration } from "~/lib/utils";
import { Markdown } from "../Markdown";
import { ModelLogo } from "../ModelLogo";
import { Button } from "../ui/button";
import { Badge } from "../ui/misc";

export type PanelTab = "opinions" | "reviews" | "agreement";

/** Right-hand panel (after T3 Code's right panel): the evidence behind the brief. */
const Seats = createContext<Turn["council"]["members"]>([]);

export function CouncilPanel({
  turn,
  tab,
  memberId,
  onTabChange,
  onMemberChange,
  onClose
}: {
  turn: Turn;
  tab: PanelTab;
  memberId?: string;
  onTabChange: (tab: PanelTab) => void;
  onMemberChange: (memberId: string) => void;
  onClose: () => void;
}) {
  return (
    <Seats.Provider value={[...turn.council.members, turn.council.chairman]}>
      <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-[min(520px,100vw)] flex-col border-l bg-background shadow-2xl lg:static lg:w-[440px] lg:shadow-none xl:w-[520px]">
        <Tabs.Root value={tab} onValueChange={(v) => onTabChange(v as PanelTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
            <Tabs.List className="relative flex flex-1 items-center gap-0.5">
              {(["opinions", "reviews", "agreement"] as const).map((t) => (
                <Tabs.Tab
                  key={t}
                  value={t}
                  className="h-7 cursor-pointer rounded-md px-2.5 font-medium text-muted-foreground text-sm capitalize transition-colors hover:text-foreground data-[selected]:bg-accent data-[selected]:text-foreground"
                >
                  {t}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            <Button variant="ghost-muted" size="icon-sm" onClick={onClose} aria-label="Close panel">
              <X />
            </Button>
          </div>
          <Tabs.Panel value="opinions" className="flex min-h-0 flex-1 flex-col">
            <Opinions turn={turn} memberId={memberId} onMemberChange={onMemberChange} />
          </Tabs.Panel>
          <Tabs.Panel value="reviews" className="flex min-h-0 flex-1 flex-col">
            <Reviews turn={turn} memberId={memberId} onMemberChange={onMemberChange} />
          </Tabs.Panel>
          <Tabs.Panel value="agreement" className="min-h-0 flex-1 overflow-y-auto">
            <Agreement turn={turn} />
          </Tabs.Panel>
        </Tabs.Root>
      </aside>
    </Seats.Provider>
  );
}

function MemberPicker({ items, selected, onSelect }: { items: { id: string; label: string; failed?: boolean; badge?: string }[]; selected?: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-2">
      {items.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onSelect(m.id)}
          className={cn(
            "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-1.5 text-xs transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97]",
            m.id === selected ? "border-border-strong bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/6%)]" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            m.failed && "text-error-foreground"
          )}
        >
          <Mark id={m.id} />
          {m.label}
          {m.badge && <span className="text-2xs text-faint tabular-nums">{m.badge}</span>}
        </button>
      ))}
    </div>
  );
}

function Opinions({ turn, memberId, onMemberChange }: { turn: Turn; memberId?: string; onMemberChange: (id: string) => void }) {
  const rank = new Map(turn.aggregate?.rankings.map((r, i) => [r.memberId, i + 1]));
  const members = turn.council.members;
  const selectedId = memberId && members.some((m) => m.id === memberId) ? memberId : members[0]?.id;
  const current = turn.stage1.find((r) => r.memberId === selectedId);
  const member = members.find((m) => m.id === selectedId);
  if (!member) return <Empty text="No council members." />;
  return (
    <>
      <MemberPicker
        items={members.map((m) => {
          const r = turn.stage1.find((x) => x.memberId === m.id);
          return { id: m.id, label: m.label, failed: Boolean(r?.error), badge: rank.get(m.id) ? `#${rank.get(m.id)}` : r ? undefined : "…" };
        })}
        selected={selectedId}
        onSelect={onMemberChange}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {current ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span className="font-mono">{current.model}</span>
              <span>· {formatDuration(current.ms)}</span>
              {rank.get(current.memberId) === 1 && <Badge tone="success">Top-ranked by peers</Badge>}
            </div>
            {current.error ? <p className="text-error-foreground text-sm">Failed: {current.error}</p> : <Markdown text={current.text} />}
          </>
        ) : (
          <LiveOpinion turnId={turn.id} memberId={member.id} running={turn.status === "running"} />
        )}
      </div>
    </>
  );
}

function LiveOpinion({ turnId, memberId, running }: { turnId: string; memberId: string; running: boolean }) {
  const text = useDraft(turnId, `stage1:${memberId}`);
  if (!text) return <Empty text={running ? "Thinking…" : "No answer."} />;
  return (
    <>
      <p className="live-shine mb-3 text-xs">Writing…</p>
      <Markdown text={text} />
    </>
  );
}

function Reviews({ turn, memberId, onMemberChange }: { turn: Turn; memberId?: string; onMemberChange: (id: string) => void }) {
  if (!turn.stage2.length) return <Empty text="Peer reviews appear here once members finish ranking each other." />;
  const current = turn.stage2.find((r) => r.memberId === memberId) ?? turn.stage2[0];
  const nameOf = (label: string) => turn.stage1.find((r) => r.memberId === turn.aggregate?.labelToMemberId[label])?.label ?? label;
  const revealed = turn.aggregate ? current.text.replace(/Response [A-Z]\d*\b/g, (l) => `**${nameOf(l)}**`) : current.text;
  return (
    <>
      <MemberPicker items={turn.stage2.map((r) => ({ id: r.memberId, label: r.label, failed: Boolean(r.error) }))} selected={current.memberId} onSelect={onMemberChange} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs">
          {current.label} reviewed the answers as "Response A, B, …" without knowing who wrote them. Names are filled in here afterwards.
        </p>
        {current.ranking.length > 0 && (
          <ol className="mb-4 flex flex-wrap gap-1.5">
            {current.ranking.map((l, i) => (
              <li key={l} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                <span className="font-semibold text-primary">{i + 1}</span> {nameOf(l)}
              </li>
            ))}
          </ol>
        )}
        {current.error ? <p className="text-error-foreground text-sm">Failed: {current.error}</p> : <Markdown text={revealed} />}
      </div>
    </>
  );
}

/** Visualization: who ranked whom, and where the council converged. */
function Agreement({ turn }: { turn: Turn }) {
  const agg = turn.aggregate;
  if (!agg) return <Empty text="The agreement map appears after the peer review." />;
  const authors = agg.rankings;
  const reviews = turn.stage2.filter((r) => !r.error);
  const n = authors.length;
  const memberLabel = new Map(turn.stage1.map((r) => [r.memberId, r.label]));
  const rankGiven = (reviewerRanking: string[], authorId: string) => {
    const label = Object.entries(agg.labelToMemberId).find(([, id]) => id === authorId)?.[0];
    const idx = label ? reviewerRanking.indexOf(label) : -1;
    return idx >= 0 ? idx + 1 : null;
  };
  const unanimousTop = reviews.length > 1 && reviews.every((r) => rankGiven(r.ranking, authors[0].memberId) === 1);

  return (
    <div className="flex flex-col gap-6 px-5 py-5">
      <div>
        <p className="font-medium text-sm">Peer ranking</p>
        <p className="mt-0.5 text-muted-foreground text-xs">Average position across anonymous reviews. Lower is better.</p>
        <div className="mt-3 flex flex-col gap-2">
          {authors.map((a, i) => {
            const strength = a.votes ? (n - a.averageRank + 1) / n : 0;
            return (
              <div key={a.memberId} className="flex items-center gap-3 text-sm">
                <span className="w-4 text-right font-mono text-muted-foreground text-xs">{i + 1}</span>
                <span className="flex w-40 items-center gap-2 truncate">
                  <Mark id={a.memberId} />
                  {a.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                  <div className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-primary/45")} style={{ width: `${Math.max(6, strength * 100)}%` }} />
                </div>
                <span className="w-10 text-right font-mono text-muted-foreground text-xs tabular-nums">{a.votes ? a.averageRank.toFixed(2) : "—"}</span>
              </div>
            );
          })}
        </div>
        {unanimousTop && <p className="mt-3 text-success-foreground text-xs">Every reviewer ranked {authors[0].label} first.</p>}
      </div>

      <div>
        <p className="font-medium text-sm">Who ranked whom</p>
        <p className="mt-0.5 text-muted-foreground text-xs">Rows are reviewers, columns are the answers they ranked. Outlined cells are a model rating its own answer.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th />
                {authors.map((a) => (
                  <th key={a.memberId} className="w-11 pb-1 align-bottom font-medium text-muted-foreground" title={a.label}>
                    <span className="flex justify-center">
                      <Mark id={a.memberId} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.memberId}>
                  <th className="max-w-32 pr-2 text-left font-medium text-muted-foreground">
                    <span className="flex items-center gap-1.5 truncate">
                      <Mark id={r.memberId} />
                      {memberLabel.get(r.memberId) ?? r.label}
                    </span>
                  </th>
                  {authors.map((a) => {
                    const rank = rankGiven(r.ranking, a.memberId);
                    const self = a.memberId === r.memberId;
                    const intensity = rank ? 1 - (rank - 1) / Math.max(1, n - 1) : 0;
                    return (
                      <td
                        key={a.memberId}
                        title={rank ? `${memberLabel.get(r.memberId)} ranked ${a.label} #${rank}${self ? " (own answer)" : ""}` : "Not ranked"}
                        className={cn("size-11 rounded-md text-center font-semibold tabular-nums", self && "ring-2 ring-warning/70 ring-inset")}
                        style={{ background: rank ? `color-mix(in oklch, var(--accent-brand) ${Math.round(12 + intensity * 70)}%, transparent)` : "var(--muted)", color: intensity > 0.55 ? "white" : undefined }}
                      >
                        {rank ?? "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-muted-foreground text-xs">
        <Crown className="mt-px size-3.5 shrink-0 text-amber-500" />
        <span>
          {turn.council.chairman.label} read every opinion and review to write the final synthesis and brief.
        </span>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-6 py-16 text-center text-muted-foreground text-sm">{text}</p>;
}

function Mark({ id }: { id: string }) {
  const member = useContext(Seats).find((m) => m.id === id);
  return member ? <ModelLogo member={member} className="size-3.5" /> : null;
}

import { useState } from "react";
import type { ServerInfo, Turn, TurnStage } from "@synod/contracts";
import { api } from "../lib/api";
import { Markdown } from "./Markdown";
import { PlanView } from "./PlanView";

const STAGE_LABEL: Record<TurnStage, string> = {
  clarify: "Checking whether a clarifying question is needed…",
  research: "Searching the web…",
  stage1: "Stage 1 — members are answering independently…",
  stage2: "Stage 2 — members are reviewing anonymized answers…",
  stage3: "Stage 3 — the chairman is writing the final answer…",
  plan: "Drafting the execution plan…"
};

export function TurnView({ conversationId, turn, info }: { conversationId: string; turn: Turn; info: ServerInfo | null }) {
  return (
    <section className="turn">
      <div className="user-message">
        <Markdown text={turn.prompt} />
        {turn.attachments.length > 0 && (
          <div className="chips">
            {turn.attachments.map((a) => (
              <a key={a.id} className="chip" href={a.url} target="_blank" rel="noreferrer">
                📎 {a.name}
              </a>
            ))}
          </div>
        )}
      </div>

      {turn.clarification && <Clarification conversationId={conversationId} turn={turn} />}

      {turn.research.length > 0 && (
        <details className="card subtle">
          <summary>Web research · {turn.research.length} sources</summary>
          <ol className="sources">
            {turn.research.map((r, i) => (
              <li key={i}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title || r.url}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}

      {turn.stage1.length > 0 && <Stage1 turn={turn} />}
      {turn.stage2.length > 0 && <Stage2 turn={turn} />}

      {turn.synthesis && (
        <div className="card final">
          <div className="card-head">
            <h3>Council answer</h3>
            <span className="muted">Chairman: {turn.synthesis.label}</span>
          </div>
          {turn.synthesis.error && <p className="warning">{turn.synthesis.error}</p>}
          <Markdown text={turn.synthesis.text} />
        </div>
      )}

      {turn.plan && <PlanView conversationId={conversationId} turn={turn} hermesConfigured={Boolean(info?.hermes.configured)} />}

      {turn.status === "running" && turn.stage && (
        <div className="progress" role="status">
          <span className="spinner" /> {STAGE_LABEL[turn.stage]}
        </div>
      )}
      {turn.status === "failed" && (
        <div className="card error">
          <p>{turn.error}</p>
          {turn.error !== "Cancelled." && (
            <button className="small" onClick={() => api.send(conversationId, turn.prompt)}>
              Retry
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Clarification({ conversationId, turn }: { conversationId: string; turn: Turn }) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const clarification = turn.clarification!;
  const waiting = turn.status === "awaiting_clarification";
  return (
    <div className={`card clarify ${waiting ? "waiting" : ""}`}>
      <p className="label">Clarifying question</p>
      <p>{clarification.question}</p>
      {clarification.answer ? (
        <p className="muted">↳ {clarification.answer}</p>
      ) : (
        waiting && (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              setSending(true);
              await api.answer(conversationId, answer).finally(() => setSending(false));
            }}
          >
            <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer…" />
            <button className="primary" disabled={sending}>
              Answer
            </button>
            <button type="button" className="ghost" disabled={sending} onClick={() => api.answer(conversationId, "")}>
              Skip
            </button>
          </form>
        )
      )}
    </div>
  );
}

function Stage1({ turn }: { turn: Turn }) {
  const [active, setActive] = useState(0);
  const response = turn.stage1[Math.min(active, turn.stage1.length - 1)];
  const pending = turn.council.members.length - turn.stage1.length;
  return (
    <details className="card" open={!turn.synthesis}>
      <summary>
        Stage 1 · Individual answers ({turn.stage1.length}/{turn.council.members.length})
      </summary>
      <div className="tabs" role="tablist">
        {turn.stage1.map((r, i) => (
          <button key={r.memberId} role="tab" aria-selected={i === active} className={`tab ${i === active ? "active" : ""} ${r.error ? "failed" : ""}`} onClick={() => setActive(i)}>
            {r.label}
          </button>
        ))}
        {pending > 0 && <span className="tab pending">+{pending} working…</span>}
      </div>
      <div className="tab-body">
        <p className="muted small">
          {response.model} · {(response.ms / 1000).toFixed(1)}s
        </p>
        {response.error ? <p className="warning">Failed: {response.error}</p> : <Markdown text={response.text} />}
      </div>
    </details>
  );
}

function Stage2({ turn }: { turn: Turn }) {
  const [active, setActive] = useState(0);
  const review = turn.stage2[Math.min(active, turn.stage2.length - 1)];
  const labelToMember = turn.aggregate?.labelToMemberId ?? {};
  const nameOf = (label: string) => {
    const memberId = labelToMember[label];
    return turn.stage1.find((r) => r.memberId === memberId)?.label ?? label;
  };
  // Show real names in reviews only after every review is in.
  const reveal = (text: string) => (turn.aggregate ? text.replace(/Response [A-Z]\d*\b/g, (label) => `**${nameOf(label)}**`) : text);

  return (
    <details className="card" open={!turn.synthesis}>
      <summary>Stage 2 · Peer review</summary>
      {turn.aggregate && (
        <table className="ranking">
          <thead>
            <tr>
              <th>#</th>
              <th>Member</th>
              <th>Average rank</th>
              <th>Votes</th>
            </tr>
          </thead>
          <tbody>
            {turn.aggregate.rankings.map((r, i) => (
              <tr key={r.memberId}>
                <td>{i + 1}</td>
                <td>{r.label}</td>
                <td>{r.votes ? r.averageRank.toFixed(2) : "—"}</td>
                <td>{r.votes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Each member ranked the answers without knowing who wrote them. Names are shown here only after every review was in.</p>
      <div className="tabs" role="tablist">
        {turn.stage2.map((r, i) => (
          <button key={r.memberId} role="tab" aria-selected={i === active} className={`tab ${i === active ? "active" : ""} ${r.error ? "failed" : ""}`} onClick={() => setActive(i)}>
            {r.label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {review.error ? (
          <p className="warning">Failed: {review.error}</p>
        ) : (
          <>
            <Markdown text={reveal(review.text)} />
            {review.ranking.length > 0 && <p className="muted small">Ranking as parsed: {review.ranking.map(nameOf).join(" › ")}</p>}
          </>
        )}
      </div>
    </details>
  );
}

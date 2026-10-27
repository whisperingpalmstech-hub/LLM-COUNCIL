import { useState } from "react";
import type { Turn } from "@synod/contracts";
import { api } from "../lib/api";

export function PlanView({ conversationId, turn, hermesConfigured }: { conversationId: string; turn: Turn; hermesConfigured: boolean }) {
  const plan = turn.plan!;
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="card plan">
      <div className="card-head">
        <h3>Execution plan</h3>
        <span className={`badge decision-${plan.decision.toLowerCase().replace(/\s+/g, "-")}`}>{plan.decision}</span>
        <span className="muted small">
          v{plan.version} · confidence {Math.round(plan.confidence * 100)}%
        </span>
      </div>
      {plan.summary && <p>{plan.summary}</p>}
      <ol className="phases">
        {plan.phases.map((phase) => (
          <li key={phase.order}>
            <div className="phase-head">
              <strong>{phase.name}</strong>
              <span className="muted small">
                {phase.owner} · {phase.duration}
              </span>
            </div>
            <p>{phase.objective}</p>
            <ul>
              {phase.tasks.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <p className="small">
              <span className="label">Done when:</span> {phase.acceptanceCriteria.join("; ")}
            </p>
            <p className="small">
              <span className="label">Gate:</span> {phase.decisionGate}
            </p>
          </li>
        ))}
      </ol>
      <div className="plan-grid">
        <List title="Risks" items={plan.risks} />
        <List title="Assumptions" items={plan.assumptions} />
        <List title="Success metrics" items={plan.successMetrics} />
        <List title="Open questions" items={plan.openQuestions} />
        <List title="Dissent" items={plan.dissent} />
      </div>
      <div className="row">
        <a className="button small" href={api.planUrl(conversationId, turn.id)} download>
          Download Markdown
        </a>
        {!confirming ? (
          <button className="small" onClick={() => setConfirming(true)} disabled={sending}>
            Hand off to Hermes{hermesConfigured ? "" : " (simulated)"}
          </button>
        ) : (
          <>
            <span className="small">This sends the plan to your executor and authorizes it to act. Continue?</span>
            <button
              className="primary small"
              disabled={sending}
              onClick={async () => {
                setSending(true);
                await api.handoff(conversationId, turn.id).finally(() => {
                  setSending(false);
                  setConfirming(false);
                });
              }}
            >
              Send
            </button>
            <button className="ghost small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        )}
        {turn.handoff && (
          <span className={`small ${turn.handoff.ok ? "ok-text" : "warning"}`}>
            {turn.handoff.ok ? (turn.handoff.simulated ? "Simulated hand-off recorded." : "Handed off.") : `Hand-off failed: ${turn.handoff.error}`}
          </span>
        )}
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="label">{title}</p>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

import { useEffect, useState } from "react";
import { PROVIDER_IDS, type CouncilConfig, type CouncilMember, type ProviderId, type ServerInfo } from "@synod/contracts";
import { api } from "../lib/api";

export function CouncilSettings({ info, onClose }: { info: ServerInfo | null; onClose: () => void }) {
  const [council, setCouncil] = useState<CouncilConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.council().then(setCouncil).catch((e) => setError(e.message));
  }, []);

  const configured = (p: ProviderId) => info?.providers.find((s) => s.provider === p)?.configured ?? false;

  if (!council) return <Modal onClose={onClose}>{error ?? "Loading…"}</Modal>;

  const update = (patch: Partial<CouncilConfig>) => {
    setSaved(false);
    setCouncil({ ...council, ...patch });
  };
  const updateMember = (index: number, patch: Partial<CouncilMember>) =>
    update({ members: council.members.map((m, i) => (i === index ? { ...m, ...patch } : m)) });

  const save = async () => {
    setError(null);
    try {
      setCouncil(await api.saveCouncil(council));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h2>Council</h2>
      <p className="muted small">Members answer and review each other. The chairman writes the final answer and the plan. Model names are passed to the provider as-is; leave one blank to use the provider's default. For AnythingLLM, enter the workspace slug.</p>

      <div className="members">
        {council.members.map((m, i) => (
          <MemberRow
            key={i}
            member={m}
            configured={configured}
            onChange={(patch) => updateMember(i, patch)}
            onRemove={council.members.length > 1 ? () => update({ members: council.members.filter((_, j) => j !== i) }) : undefined}
          />
        ))}
      </div>
      {council.members.length < 8 && (
        <button
          className="ghost small"
          onClick={() => update({ members: [...council.members, { id: `member-${Date.now().toString(36)}`, label: `Member ${council.members.length + 1}`, provider: "mock", model: "" }] })}
        >
          + Add member
        </button>
      )}

      <h3>Chairman</h3>
      <MemberRow member={council.chairman} configured={configured} onChange={(patch) => update({ chairman: { ...council.chairman, ...patch } })} />

      <h3>Options</h3>
      <label className="check">
        <input type="checkbox" checked={council.clarify} onChange={(e) => update({ clarify: e.target.checked })} /> Ask a clarifying question first when important context is missing
      </label>
      <label className="check">
        <input type="checkbox" checked={council.executionPlan} onChange={(e) => update({ executionPlan: e.target.checked })} /> Produce an execution plan
      </label>
      <label className="check">
        <input type="checkbox" checked={council.webSearch} disabled={!info?.search.configured} onChange={(e) => update({ webSearch: e.target.checked })} /> Web search{" "}
        {info?.search.configured ? `(${info.search.provider})` : "(set TAVILY_API_KEY or PERPLEXITY_API_KEY)"}
      </label>

      <h3>Integrations</h3>
      <ul className="muted small">
        <li>Voice input: {info?.voice.available ? info.voice.engine : "off (install whisper.cpp or set OPENAI_API_KEY)"}</li>
        <li>Obsidian vault: {info?.obsidian.enabled ? "writing each answer" : "off (set OBSIDIAN_VAULT_PATH)"}</li>
        <li>Hermes hand-off: {info?.hermes.configured ? "configured" : "simulated (set HERMES_WEBHOOK_URL)"}</li>
      </ul>

      {error && <p className="warning">{error}</p>}
      <div className="row end">
        {saved && <span className="ok-text small">Saved</span>}
        <button className="ghost" onClick={onClose}>
          Close
        </button>
        <button className="primary" onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function MemberRow({
  member,
  configured,
  onChange,
  onRemove
}: {
  member: CouncilMember;
  configured: (p: ProviderId) => boolean;
  onChange: (patch: Partial<CouncilMember>) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="member-row">
      <input aria-label="Label" value={member.label} onChange={(e) => onChange({ label: e.target.value })} />
      <select aria-label="Provider" value={member.provider} onChange={(e) => onChange({ provider: e.target.value as ProviderId })}>
        {PROVIDER_IDS.map((p) => (
          <option key={p} value={p}>
            {p}
            {configured(p) ? "" : " (not configured)"}
          </option>
        ))}
      </select>
      <input aria-label="Model" placeholder="default model" value={member.model} onChange={(e) => onChange({ model: e.target.value })} />
      {onRemove && (
        <button className="ghost small" title="Remove" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

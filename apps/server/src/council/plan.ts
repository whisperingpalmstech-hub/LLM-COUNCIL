import type { ExecutionPlan, PlanPhase } from "@synod/contracts";

const DECISIONS = ["GO", "NO-GO", "CONDITIONAL GO", "PIVOT", "CONTINUE INVESTIGATION"];

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Normalize whatever the model returned into a complete, safe ExecutionPlan. */
export function normalizePlan(raw: unknown, version: number): ExecutionPlan {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const decision = str(p.decision).toUpperCase();
  const phases = list(p.phases).map((item, i) => normalizePhase(item, i));
  return {
    version,
    decision: DECISIONS.includes(decision) ? decision : "CONTINUE INVESTIGATION",
    summary: str(p.summary),
    assumptions: strings(p.assumptions),
    risks: strings(p.risks),
    phases: phases.length
      ? phases
      : [normalizePhase({ name: "Validate", objective: "Define the smallest evidence-producing step and run it." }, 0)],
    successMetrics: strings(p.successMetrics),
    openQuestions: strings(p.openQuestions),
    dissent: strings(p.dissent),
    confidence: clamp01(p.confidence),
    executionAuthorized: false
  };
}

export function planMarkdown(plan: ExecutionPlan, title: string): string {
  const bullets = (items: string[]) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "- None");
  const phases = plan.phases
    .map(
      (ph) =>
        `### ${ph.order}. ${ph.name}\n${ph.objective}\n\n**Owner:** ${ph.owner} · **Duration:** ${ph.duration}\n\n**Tasks**\n${bullets(ph.tasks)}\n\n**Acceptance criteria**\n${bullets(ph.acceptanceCriteria)}\n\n**Decision gate:** ${ph.decisionGate}`
    )
    .join("\n\n");
  return `# ${title}\n\n**Decision:** ${plan.decision} · **Confidence:** ${Math.round(plan.confidence * 100)}% · Plan v${plan.version}\n\n${plan.summary}\n\n## Phases\n\n${phases}\n\n## Assumptions\n${bullets(plan.assumptions)}\n\n## Risks\n${bullets(plan.risks)}\n\n## Success metrics\n${bullets(plan.successMetrics)}\n\n## Open questions\n${bullets(plan.openQuestions)}\n\n## Dissent\n${bullets(plan.dissent)}\n`;
}

function normalizePhase(item: unknown, index: number): PlanPhase {
  const o = (item && typeof item === "object" ? item : { objective: String(item) }) as Record<string, unknown>;
  const tasks = strings(o.tasks);
  const acceptance = strings(o.acceptanceCriteria);
  return {
    order: index + 1,
    name: str(o.name) || `Phase ${index + 1}`,
    objective: str(o.objective),
    duration: str(o.duration) || "To be estimated",
    owner: str(o.owner) || "Unassigned",
    tasks: tasks.length ? tasks : [str(o.objective) || "Define tasks at kickoff"],
    acceptanceCriteria: acceptance.length ? acceptance : ["Owner confirms the objective was met against a measurable target"],
    decisionGate: str(o.decisionGate) || "Stop if acceptance criteria are not met; scale only on measured evidence."
  };
}

function str(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((x) => x != null && x !== "") : value ? [value] : [];
}

function strings(value: unknown): string[] {
  return list(value).map(str).filter(Boolean);
}

function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

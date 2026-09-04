import { id, now } from "../db/sqlite.js";

export function buildExecutionPlan(verdict, session) {
  const phases = normalizePhases(verdict.executionPhases?.length ? verdict.executionPhases : verdict.recommendedActions);
  const ownerInvolvement = normalizeOwnerInvolvement(verdict.ownerInvolvement, verdict.openQuestions);
  const readiness = readinessAssessment({ verdict, phases, ownerInvolvement });
  const plan = {
    schemaVersion: "1.0",
    decision: normalizeDecision(verdict.decision),
    executiveSummary: text(verdict.executiveSummary || verdict.summary),
    desiredOutcome: text(verdict.desiredOutcome || session.desired_outcome),
    currentState: text(verdict.currentState || `Decision based on the context supplied for: ${session.topic}`),
    rationale: text(verdict.rationale),
    strategy: text(verdict.strategy || verdict.rationale),
    evidence: array(verdict.evidence),
    assumptions: array(verdict.assumptions),
    alternatives: array(verdict.alternatives),
    risks: array(verdict.risks),
    phases,
    firstActions: array(verdict.firstActions).length ? array(verdict.firstActions) : phases.flatMap((phase) => phase.tasks).slice(0, 3),
    ownerInvolvement,
    successMetrics: array(verdict.successMetrics),
    guardrails: array(verdict.guardrails),
    unresolvedQuestions: array(verdict.openQuestions),
    dissent: array(verdict.disagreements),
    confidence: clamp(verdict.confidence),
    readiness
  };
  return { plan, handoff: executorHandoff(plan, session) };
}

export function persistExecutionPlan(db, session, verdict, revisionReason = null) {
  const { plan, handoff } = buildExecutionPlan(verdict, session);
  const previous = db.prepare("select id, version from execution_plans where conversation_id = ? order by version desc limit 1").get(session.conversation_id);
  const version = Number(previous?.version || 0) + 1;
  db.prepare("update execution_plans set status = 'SUPERSEDED' where conversation_id = ? and status = 'CURRENT'").run(session.conversation_id);
  const row = { id: id(), session_id: session.id, conversation_id: session.conversation_id, version, parent_plan_id: previous?.id || null, status: "CURRENT", plan_json: JSON.stringify(plan), executor_handoff_json: JSON.stringify(handoff), readiness_json: JSON.stringify(plan.readiness), revision_reason: revisionReason, created_at: now() };
  db.prepare(`insert into execution_plans(id,session_id,conversation_id,version,parent_plan_id,status,plan_json,executor_handoff_json,readiness_json,revision_reason,created_at) values(@id,@session_id,@conversation_id,@version,@parent_plan_id,@status,@plan_json,@executor_handoff_json,@readiness_json,@revision_reason,@created_at)`).run(row);
  return hydrate(row);
}

export function getExecutionPlan(db, sessionId) {
  const row = db.prepare("select * from execution_plans where session_id = ? order by version desc limit 1").get(sessionId);
  if (!row) throw Object.assign(new Error("Execution plan not found."), { status: 404 });
  return hydrate(row);
}

export function listPlanVersions(db, conversationId) {
  return db.prepare("select * from execution_plans where conversation_id = ? order by version desc").all(conversationId).map(hydrate);
}

export function planMarkdown(record) {
  const p = record.plan;
  const lines = [`# Execution Plan v${record.version}`, "", `**Decision:** ${p.decision}`, "", "## Executive summary", p.executiveSummary, "", "## Desired outcome", p.desiredOutcome, "", "## Strategy", p.strategy];
  if (p.assumptions.length) lines.push("", "## Assumptions", ...p.assumptions.map((x) => `- ${itemText(x)}`));
  if (p.risks.length) lines.push("", "## Risks", ...p.risks.map((x) => `- ${itemText(x)}`));
  lines.push("", "## Execution phases");
  for (const phase of p.phases) lines.push("", `### ${phase.name}`, phase.objective, "", `**Duration:** ${phase.duration}`, `**Owner:** ${phase.owner}`, "", "Tasks:", ...phase.tasks.map((x) => `- ${itemText(x)}`), "", "Acceptance criteria:", ...phase.acceptanceCriteria.map((x) => `- ${itemText(x)}`), "", `**Decision gate:** ${phase.decisionGate}`, `**Stop / continue / scale:** ${phase.stopContinueScaleCriteria}`);
  lines.push("", `## Execution readiness: ${p.readiness.overall}%`, ...p.readiness.dimensions.map((x) => `- ${x.name}: ${x.score}%`));
  return lines.join("\n");
}

function normalizePhases(value) {
  const source = array(value);
  if (!source.length) source.push("Define the smallest evidence-producing pilot", "Run the pilot and capture results", "Review the decision gate and scale or stop");
  return source.map((item, index) => {
    const object = typeof item === "object" && item ? item : { objective: String(item), tasks: [String(item)] };
    return {
      order: index + 1,
      name: text(object.name || object.phase || `Phase ${index + 1}`),
      objective: text(object.objective || object.summary || itemText(item)),
      duration: text(object.duration || object.estimatedDuration || "Estimate during phase kickoff"),
      preconditions: array(object.preconditions),
      tasks: array(object.tasks || object.actions || object.task || object.objective),
      owner: text(object.owner || object.suggestedOwner || "Decision owner to assign"),
      tools: array(object.tools || object.capabilitiesRequired),
      dependencies: array(object.dependencies).length ? array(object.dependencies) : (index ? [`Phase ${index} decision gate passed`] : []),
      deliverables: array(object.deliverables),
      acceptanceCriteria: array(object.acceptanceCriteria || object.acceptanceTests).length ? array(object.acceptanceCriteria || object.acceptanceTests) : ["Deliverable reviewed by the assigned owner against a measurable target"],
      budgetOrResources: array(object.budgetOrResources || object.resources).length ? array(object.budgetOrResources || object.resources) : ["Owner to confirm time and budget ceiling before kickoff"],
      risks: array(object.risks),
      decisionGate: text(object.decisionGate || "Review evidence against acceptance criteria"),
      stopContinueScaleCriteria: text(object.stopContinueScaleCriteria || object.stopOrScaleGate || "Stop if acceptance criteria are not met; scale only with measured evidence.")
    };
  });
}

function normalizeOwnerInvolvement(value, questions) {
  const result = { canBeDelegated: [], informationRequired: [], approvalRequired: [], externalDependencies: [] };
  if (value && typeof value === "object" && !Array.isArray(value)) for (const key of Object.keys(result)) result[key] = array(value[key]);
  if (!result.informationRequired.length) result.informationRequired = array(questions);
  return result;
}

function readinessAssessment({ verdict, phases, ownerInvolvement }) {
  const dimensions = [
    score("Strategy clarity", Boolean(verdict.strategy || verdict.rationale), 95, 45),
    score("Task clarity", phases.every((p) => p.tasks.length), 90, 40),
    score("Dependency clarity", phases.every((p) => p.dependencies.length || p.order === 1), 85, 55),
    score("Acceptance clarity", phases.every((p) => p.acceptanceCriteria.length), 90, 45),
    score("Evidence clarity", array(verdict.evidence).length > 0, 85, 50),
    score("Resource clarity", phases.every((p) => p.budgetOrResources.length), 85, 50)
  ];
  const overall = Math.round(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length);
  return { overall, label: "Operational completeness indicator—not a probability of success.", dimensions, ownerDecisionsRemaining: ownerInvolvement.approvalRequired.length + ownerInvolvement.informationRequired.length, externalDependencies: ownerInvolvement.externalDependencies.length };
}

function executorHandoff(plan, session) { return { schema_version: "1.0", objective: plan.desiredOutcome, context: { session_id: session.id, conversation_id: session.conversation_id, topic: session.topic, decision: plan.decision }, constraints: plan.guardrails, assumptions: plan.assumptions, phases: plan.phases, tasks: plan.phases.flatMap((phase) => phase.tasks.map((task) => ({ phase: phase.order, owner: phase.owner, task }))), dependencies: plan.phases.flatMap((phase) => phase.dependencies), required_tools: plan.phases.flatMap((phase) => phase.tools), required_credentials: [], human_approvals: plan.ownerInvolvement.approvalRequired, budgets: plan.phases.flatMap((phase) => phase.budgetOrResources), acceptance_tests: plan.phases.flatMap((phase) => phase.acceptanceCriteria), risks: plan.risks, stop_conditions: plan.phases.map((phase) => phase.stopContinueScaleCriteria), evidence_required: plan.unresolvedQuestions, execution_authorized: false }; }
function hydrate(row) { return { id: row.id, sessionId: row.session_id, conversationId: row.conversation_id, version: row.version, parentPlanId: row.parent_plan_id, status: row.status, plan: JSON.parse(row.plan_json), executorHandoff: JSON.parse(row.executor_handoff_json), readiness: JSON.parse(row.readiness_json), revisionReason: row.revision_reason, createdAt: row.created_at }; }
function normalizeDecision(value) { const v = text(value || "CONTINUE INVESTIGATION").toUpperCase(); return ["GO", "NO-GO", "PIVOT", "CONDITIONAL GO", "CONTINUE INVESTIGATION"].includes(v) ? v : text(value); }
function score(name, condition, pass, fail) { return { name, score: condition ? pass : fail }; }
function array(value) { return Array.isArray(value) ? value.filter((x) => x !== null && x !== "") : value ? [value] : []; }
function text(value) { return value == null ? "" : typeof value === "string" ? value.trim() : itemText(value); }
function itemText(value) { return typeof value === "string" ? value : JSON.stringify(value); }
function clamp(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 ? n / 100 : n)) : 0.5; }

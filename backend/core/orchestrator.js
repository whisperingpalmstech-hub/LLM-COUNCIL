import { id, now } from "../db/sqlite.js";
import { LlmAdapter } from "../adapters/llm.js";

const ROLE_TYPES = [
  "SYNTHESIST",
  "DOMAIN_EXPERT",
  "SKEPTIC",
  "WEB_RESEARCHER",
  "RISK_OFFICER",
  "ETHICIST",
  "PSYCHOLOGIST_MACHIAVELLI"
];

export class CouncilOrchestrator {
  constructor({ db, events }) {
    this.db = db;
    this.events = events;
    this.llm = new LlmAdapter();
  }

  createSession(input) {
    if (!input.topic || input.topic.length > 2000) throw Object.assign(new Error("Topic is required and must be <= 2000 chars."), { status: 400 });
    const sessionId = id();
    const council = input.councilId ? this.getCouncil(input.councilId) : null;
    const councilDefaults = council ? parse(council.default_config, {}) : {};
    const maxRounds = Number(input.maxRounds ?? councilDefaults.max_rounds ?? 4);
    if (maxRounds < 1 || maxRounds > 5) throw Object.assign(new Error("maxRounds must be 1-5."), { status: 400 });
    const timestamp = now();
    this.db.prepare(`insert into sessions(id, topic, status, mode, max_rounds, compact_internal, council_id, council_snapshot, created_at, updated_at)
      values(?,?,?,?,?,?,?,?,?,?)`).run(
      sessionId,
      input.topic,
      "CREATED",
      input.mode ?? "standard",
      maxRounds,
      input.compactInternalCommunication === false ? 0 : 1,
      council?.id ?? null,
      council ? JSON.stringify(council) : null,
      timestamp,
      timestamp
    );
    this.emit("SESSION_CREATED", { sessionId, topic: input.topic, status: "CREATED" });
    const roles = council ? this.spawnStaticRoles(sessionId, council) : this.spawnDynamicRoles(sessionId, input.topic, input);
    this.audit(sessionId, "session.created", { roles: roles.length, councilId: council?.id ?? null });
    if (input.autoStart !== false) setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);
    return this.getSession(sessionId);
  }

  spawnDynamicRoles(sessionId, topic, input = {}) {
    const needsWeb = input.allowWebSearch !== false;
    const needsRag = input.allowRag !== false;
    const plan = [
      role("SYNTHESIST", "Lead Synthesist", 1, needsWeb && needsRag ? "HYBRID" : needsRag ? "RAG" : "TRAINING"),
      role("DOMAIN_EXPERT", "Domain Expert", 2, needsRag ? "RAG" : "TRAINING", 1.1),
      role("SKEPTIC", "Skeptic", 3, "TRAINING"),
      ...(needsWeb ? [role("WEB_RESEARCHER", "Web Researcher", 4, "WEBSEARCH")] : []),
      ...(psychologistTrigger(topic) ? [role("PSYCHOLOGIST_MACHIAVELLI", "Psychologist / Machiavelli", 5, "TRAINING")] : []),
      role("RISK_OFFICER", "Risk Officer", 6, "HYBRID")
    ].slice(0, 6);
    return this.insertRoles(sessionId, plan);
  }

  spawnStaticRoles(sessionId, council) {
    const manifest = parse(council.role_manifest, []);
    const hierarchy = parse(council.hierarchy, {});
    const overrides = parse(council.model_overrides, {});
    const weights = hierarchy.confidence_weights ?? {};
    return this.insertRoles(sessionId, manifest.slice(0, 6).map((item, index) => ({
      role_type: item.role_type,
      display_name: item.display_name || item.displayName || title(item.role_type),
      priority: item.priority ?? index + 1,
      knowledge_source_type: item.knowledge_source_type ?? "TRAINING",
      workspace_id: item.workspace_id ?? null,
      confidence_weight: weights[item.role_type] ?? item.confidence_weight ?? 1,
      model_name: overrides[item.role_type] ?? null,
      veto_capable: (hierarchy.veto_roles ?? []).includes(item.role_type) ? 1 : 0
    })));
  }

  insertRoles(sessionId, roles) {
    const insert = this.db.prepare(`insert into roles(id, session_id, role_type, display_name, priority, knowledge_source_type, workspace_id, model_name, confidence_weight, veto_capable, status)
      values(@id,@session_id,@role_type,@display_name,@priority,@knowledge_source_type,@workspace_id,@model_name,@confidence_weight,@veto_capable,'ACTIVE')`);
    return roles.map((item) => {
      if (!ROLE_TYPES.includes(item.role_type)) throw Object.assign(new Error(`Invalid role: ${item.role_type}`), { status: 400 });
      const row = {
        id: id(),
        session_id: sessionId,
        role_type: item.role_type,
        display_name: item.display_name,
        priority: item.priority ?? 1,
        knowledge_source_type: item.knowledge_source_type ?? "TRAINING",
        workspace_id: item.workspace_id ?? null,
        model_name: item.model_name ?? selectModel(item),
        confidence_weight: item.confidence_weight ?? 1,
        veto_capable: item.veto_capable ?? 0
      };
      insert.run(row);
      this.emit("ROLE_ACTIVATED", { sessionId, roleId: row.id, roleType: row.role_type, modelName: row.model_name });
      return row;
    });
  }

  async runSession(sessionId) {
    this.updateSession(sessionId, { status: "DELIBERATING" });
    this.emit("TOPIC_ANALYSED", { sessionId, complexity: this.complexity(this.getSession(sessionId).topic) });
    let vetoTriggered = false;
    for (let round = 1; round <= this.getSession(sessionId).max_rounds; round++) {
      const session = this.getSession(sessionId);
      const compact = Boolean(session.compact_internal);
      this.updateSession(sessionId, { current_round: round });
      const roles = this.roles(sessionId).sort((a, b) => a.priority - b.priority);
      const priorMessages = this.messages(sessionId).map((message) => JSON.parse(message.payload));
      for (const activeRole of roles) {
        const result = await this.llm.complete({ role: activeRole, topic: session.topic, round, priorMessages, compact });
        if (result.warning) this.warning(sessionId, "PROVIDER_FALLBACK", result.warning);
        const payload = compactPayload(result.payload, sessionId, activeRole.id, round, compact);
        this.audit(sessionId, "llm.output_received", { roleId: activeRole.id, round, compact });
        this.db.prepare(`insert into messages(id, session_id, role_id, round_number, model_name, compact, payload, content, created_at) values(?,?,?,?,?,?,?,?,?)`)
          .run(id(), sessionId, activeRole.id, round, activeRole.model_name, compact ? 1 : 0, JSON.stringify(payload), humanize(payload), now());
        this.emit("ROLE_MESSAGE", { sessionId, roleId: activeRole.id, roundNumber: round, confidence: payload.confidence });
        vetoTriggered ||= payload.veto;
      }
      const consensus = this.consensus(sessionId, round);
      this.emit("ROUND_COMPLETE", { sessionId, roundNumber: round, consensusScore: consensus });
    }
    const verdict = await this.buildVerdict(sessionId);
    this.updateSession(sessionId, { status: "COMPLETED", verdict: JSON.stringify(verdict), consensus: verdict.confidence, completed_at: now() });
    this.emit("CONSENSUS_UPDATE", { sessionId, confidence: verdict.confidence });
    this.emit("SESSION_COMPLETE", { sessionId, transcriptAvailable: true });
    this.audit(sessionId, "session.completed", verdict);
  }

  async buildVerdict(sessionId) {
    const session = this.getSession(sessionId);
    const messages = this.messages(sessionId).map((message) => JSON.parse(message.payload));
    
    const roles = this.roles(sessionId);
    const lead = roles.find(r => r.role_type === "SYNTHESIST") || roles[0];
    const verdictRole = {
      ...(lead || {}),
      display_name: "Executive Verdict Generator",
      role_type: "VERDICT"
    };

    const priorSummaries = messages.map(m => m.shortSummary || m.summary).join("\\n");
    
    let response;
    try {
      response = await this.llm.complete({
        role: verdictRole,
        topic: `Final Verdict for: ${session.topic}`,
        round: "Final",
        priorMessages: priorSummaries,
        compact: false
      });
    } catch (err) {
      response = { payload: {} };
    }

    const dissents = messages.filter((message) => message.dissent).map((message) => message.shortSummary);
    const finalClaims = response.payload?.keyClaims?.length ? response.payload.keyClaims : messages.flatMap((message) => message.keyClaims ?? []).slice(-8);

    return {
      summary: response.payload?.shortSummary || "Consensus has been reached after deliberation.",
      majority: finalClaims.join(" "),
      dissents,
      unresolvedTensions: response.payload?.disagreements?.length ? response.payload.disagreements : [...new Set(messages.flatMap((message) => message.disagreements ?? []))],
      warnings: parse(session.warnings, []),
      confidence: response.payload?.confidence ?? this.consensus(sessionId, session.max_rounds)
    };
  }

  transcript(sessionId) {
    const session = this.getSession(sessionId);
    const verdict = session.verdict ? parse(session.verdict, {}) : null;
    const lines = [
      `# Synod Transcript`,
      ``,
      `Topic: ${session.topic}`,
      `Status: ${session.status}`,
      `Internal communication: ${session.compact_internal ? "compact structured JSON (REQ-M5-008)" : "verbose"}`,
      session.council_snapshot ? `Council used: ${parse(session.council_snapshot, {}).name}` : "Council used: dynamic",
      ``
    ];
    for (const message of this.messages(sessionId)) {
      const payload = parse(message.payload, {});
      lines.push(`## Round ${message.round_number} - ${message.model_name}`);
      lines.push(`Confidence: ${payload.confidence}`);
      lines.push(`Key claims:`);
      for (const claim of payload.keyClaims ?? []) lines.push(`- ${claim}`);
      if (payload.verifications?.length) lines.push(`Verifications: ${payload.verifications.map((item) => item.targetClaim ?? item).join("; ")}`);
      if (payload.fearAppeal) lines.push(`Strategic framing: ${payload.strategicFraming}`);
      lines.push("");
    }
    lines.push(`## Verdict`);
    lines.push(verdict ? verdict.summary : "> Warning: partial transcript; verdict not yet complete.");
    return lines.join("\n");
  }

  consensus(sessionId, round = null) {
    const roles = this.roles(sessionId);
    const byRole = new Map(roles.map((item) => [item.id, item]));
    const messages = this.messages(sessionId).filter((item) => !round || item.round_number === round).map((item) => parse(item.payload, {}));
    let weighted = 0;
    let total = 0;
    for (const message of messages) {
      const role = byRole.get(message.roleInstanceId);
      const weight = Number(role?.confidence_weight ?? 1);
      weighted += Number(message.confidence ?? 0.5) * weight;
      total += weight;
    }
    return total ? Number((weighted / total).toFixed(3)) : 0;
  }

  listSessions() {
    return this.db.prepare("select * from sessions order by created_at desc").all();
  }

  getSession(sessionId) {
    const row = this.db.prepare("select * from sessions where id = ?").get(sessionId);
    if (!row) throw Object.assign(new Error("Session not found"), { status: 404 });
    row.roles = this.roles(sessionId);
    row.warnings = parse(row.warnings, []);
    row.verdict = row.verdict ? parse(row.verdict, null) : null;
    return row;
  }

  roles(sessionId) {
    return this.db.prepare("select * from roles where session_id = ? order by priority").all(sessionId);
  }

  messages(sessionId) {
    return this.db.prepare("select * from messages where session_id = ? order by round_number, created_at").all(sessionId);
  }

  createCouncil(input) {
    const manifest = input.role_manifest ?? [];
    if (!input.name || !manifest.length || manifest.length > 6) throw Object.assign(new Error("Council requires name and 1-6 roles."), { status: 400 });
    const counts = manifest.reduce((acc, roleItem) => ({ ...acc, [roleItem.role_type]: (acc[roleItem.role_type] ?? 0) + 1 }), {});
    for (const roleItem of manifest) {
      if (!ROLE_TYPES.includes(roleItem.role_type)) throw Object.assign(new Error(`Invalid role type: ${roleItem.role_type}`), { status: 400 });
      if (counts[roleItem.role_type] > 1 && !roleItem.display_name) throw Object.assign(new Error("Duplicate role types require display_name."), { status: 400 });
    }
    const row = {
      id: id(),
      name: input.name,
      description: input.description ?? "",
      role_manifest: JSON.stringify(manifest),
      hierarchy: JSON.stringify(input.hierarchy ?? {}),
      model_overrides: JSON.stringify(input.model_overrides ?? {}),
      default_config: JSON.stringify(input.default_config ?? {}),
      created_at: now(),
      updated_at: now()
    };
    this.db.prepare(`insert into councils(id,name,description,role_manifest,hierarchy,model_overrides,default_config,created_at,updated_at) values(@id,@name,@description,@role_manifest,@hierarchy,@model_overrides,@default_config,@created_at,@updated_at)`).run(row);
    return this.getCouncil(row.id);
  }

  getCouncil(councilId) {
    const row = this.db.prepare("select * from councils where id = ? and is_active = 1").get(councilId);
    if (!row) throw Object.assign(new Error("Council not found"), { status: 404 });
    return row;
  }

  listCouncils() {
    return this.db.prepare("select * from councils where is_active = 1 order by created_at desc").all();
  }

  importCouncil(sessionId, name = null) {
    const session = this.getSession(sessionId);
    return this.createCouncil({
      name: name ?? `Imported ${session.topic.slice(0, 40)}`,
      description: "Imported from a prior Synod session.",
      role_manifest: this.roles(sessionId).map((item) => ({
        role_type: item.role_type,
        display_name: item.display_name,
        priority: item.priority,
        knowledge_source_type: item.knowledge_source_type,
        workspace_id: item.workspace_id,
        confidence_weight: item.confidence_weight
      })),
      hierarchy: { speaking_order: this.roles(sessionId).map((item) => item.role_type), veto_roles: this.roles(sessionId).filter((item) => item.veto_capable).map((item) => item.role_type) },
      model_overrides: Object.fromEntries(this.roles(sessionId).map((item) => [item.role_type, item.model_name]))
    });
  }

  updateSession(sessionId, patch) {
    const keys = Object.keys(patch);
    this.db.prepare(`update sessions set ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = ? where id = ?`).run(...keys.map((key) => patch[key]), now(), sessionId);
    if (patch.status) this.emit(patch.status === "COMPLETED" ? "SESSION_COMPLETE" : "SESSION_STATE_CHANGED", { sessionId, status: patch.status });
  }

  warning(sessionId, code, message) {
    const session = this.getSession(sessionId);
    const warnings = [...parse(session.warnings, []), { code, message, at: now() }];
    this.db.prepare("update sessions set warnings = ? where id = ?").run(JSON.stringify(warnings), sessionId);
  }

  audit(sessionId, eventType, payload) {
    this.db.prepare("insert into audit_logs(id, session_id, event_type, payload, created_at) values(?,?,?,?,?)").run(id(), sessionId, eventType, JSON.stringify(payload), now());
  }

  fail(sessionId, error) {
    this.updateSession(sessionId, { status: "FAILED" });
    this.warning(sessionId, "SESSION_ERROR", error.message);
    this.emit("SESSION_ERROR", { sessionId, message: error.message });
  }

  emit(eventType, payload) {
    this.events.emit(eventType, { eventId: id(), eventType, occurredAt: now(), ...payload });
  }

  complexity(topic) {
    return Math.min(10, Math.max(1, Math.ceil(topic.length / 120)));
  }
}

function role(role_type, display_name, priority, knowledge_source_type, confidence_weight = 1) {
  return { role_type, display_name, priority, knowledge_source_type, confidence_weight };
}

function selectModel(roleItem) {
  if (process.env.ANYTHINGLLM_API_KEY) return "anythingllm";
  if (process.env.PROVIDER_MODE && process.env.PROVIDER_MODE !== "mock") return process.env.PROVIDER_MODE;
  if (roleItem.knowledge_source_type === "WEBSEARCH") return "mock-fast";
  if (roleItem.role_type === "SYNTHESIST") return "mock-deep";
  return "mock-fast";
}

function compactPayload(payload, sessionId, roleId, round, compact) {
  return {
    sessionId,
    roundNumber: round,
    roleInstanceId: roleId,
    confidence: payload.confidence,
    shortSummary: payload.shortSummary,
    keyClaims: payload.keyClaims ?? [],
    knowledgeGaps: payload.knowledgeGaps ?? [],
    agreements: payload.agreements ?? [],
    disagreements: payload.disagreements ?? [],
    verifications: payload.verifications ?? [],
    falsifications: payload.falsifications ?? [],
    knowledgeSourcesUsed: payload.knowledgeSourcesUsed ?? [],
    flags: payload.flags ?? [],
    dissent: payload.dissent ?? false,
    veto: payload.veto ?? false,
    fearAppeal: payload.fearAppeal ?? null,
    greedAppeal: payload.greedAppeal ?? null,
    strategicFraming: payload.strategicFraming ?? null,
    compact
  };
}

function humanize(payload) {
  return `${payload.shortSummary}\nClaims:\n${payload.keyClaims.map((claim) => `- ${claim}`).join("\n")}`;
}

function psychologistTrigger(topic) {
  return /\b(negotiation|persuasion|persuade|fear|greed|influence|coercion|incentive|emotional conflict)\b/i.test(topic);
}

function parse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function title(value) {
  return String(value).toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

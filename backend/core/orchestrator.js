import { id, now } from "../db/sqlite.js";
import { LlmAdapter } from "../adapters/llm.js";
import { writeToVault, searchVault } from "../adapters/obsidian.js";
import { AnythingLlmClient } from "../adapters/anythingllm.js";
import { SearchClient } from "../adapters/search.js";
import { PromptRegistry } from "./prompt_registry.js";
import { getExecutionPlan, listPlanVersions, persistExecutionPlan, planMarkdown } from "./execution_plan.js";
import fs from "fs";
import path from "path";




const ROLE_TYPES = [
  "SYNTHESIST",
  "DOMAIN_EXPERT",
  "SKEPTIC",
  "WEB_RESEARCHER",
  "RISK_OFFICER",
  "MARKETING_SALES",
  "ETHICIST",
  "PSYCHOLOGIST_MACHIAVELLI",
  "DOOM_COUNCIL"
  ,"PRODUCT_STRATEGIST"
  ,"TECHNICAL_ARCHITECT"
  ,"FINANCIAL_ANALYST"
  ,"CUSTOMER_MARKET_ANALYST"
  ,"COMPLIANCE_REVIEWER"
  ,"EXECUTION_PLANNER"
];


export class CouncilOrchestrator {
  constructor({ db, events, env = process.env }) {
    this.db = db;
    this.events = events;
    this.env = env;
    this.llm = new LlmAdapter({ db: this.db, env: this.env });
    this.search = new SearchClient(this.env);
    this.prompts = new PromptRegistry(this.db);
    this.runningSessions = new Set();
  }

  setting(key, fallback = "") {
    try { return this.db.prepare("select value from system_settings where key = ?").get(key)?.value || fallback; }
    catch { return fallback; }
  }

  sessionPersonaBrief(value) {
    return String(value ?? this.setting("COMPANION_PERSONA_BRIEF", "")).trim().slice(0, 1200);
  }

  sessionOutcome(value) {
    return String(value ?? this.setting("COMPANION_DEFAULT_OUTCOME", "A clear, evidence-aware next step I can act on.")).trim().slice(0, 600);
  }

  customPrompt(role, fallbackKey, context) {
    try {
      const promptId = promptIdForRole(role.role_type, fallbackKey);
      const registryText = this.prompts.text(promptId);
      const roleKey = `PROMPT_${role.role_type}`;
      const row = this.db.prepare("select value from system_settings where key in (?, ?) and trim(value) <> '' order by case key when ? then 0 else 1 end limit 1")
        .get(roleKey, fallbackKey, roleKey);
      const template = registryText || row?.value;
      if (!template?.trim()) return undefined;

      const priorMessages = Array.isArray(context.priorMessages)
        ? context.priorMessages.map((message) => {
          const claims = (message.keyClaims ?? []).slice(0, 4).join("; ");
          const summary = message.model_name === "obsidian-memory"
            ? message.content
            : (message.shortSummary || message.summary || message.content || "");
          return `[${message.role_id || "context"} / ${message.model_name || "system"} / Round ${message.round_number ?? 0}] ${String(summary).slice(0, 700)}${claims ? ` Claims: ${claims}` : ""}`;
        }).join("\n\n").slice(-12000) || "None (First Round)"
        : String(context.priorMessages ?? "");
      const values = {
        role_display_name: role.display_name || role.role_type,
        role_type: role.role_type,
        topic: context.topic,
        round: context.round,
        stage: deliberationStage(context.round),
        riskThreshold: global.KELLY_PERCENT || 5,
        priorMessages,
        desiredOutcome: context.desiredOutcome || "A clear, evidence-aware next step I can act on.",
        personaBrief: context.personaBrief || ""
      };
      const rendered = Object.entries(values).reduce(
        (prompt, [key, value]) => prompt.split(`{{${key}}}`).join(String(value ?? "")),
        template
      );
      const roleGuidance = this.prompts.text(rolePromptId(role.role_type));
      const roundGuidance = this.prompts.text(roundPromptId(context.round));
      return `${this.prompts.text("companion.system")}\n\n${rendered}\n\n${roleGuidance}\n\n${roundGuidance}\n\n${trustedFriendGuidance(context.tone, context.desiredOutcome, context.personaBrief)}\n\n${decisionOutputContract(role.role_type)}`;
    } catch (_error) {
      return undefined;
    }
  }

  async createSession(input) {
    if (!input.topic || input.topic.length > 2000) throw Object.assign(new Error("Topic is required and must be <= 2000 chars."), { status: 400 });
    const inferred = inferOperatingMode(input.topic, input.mode);
    const isFastMode = inferred.mode === "fast";
    global.KELLY_PERCENT = parseInt(this.setting("KELLY_CIRCUIT_BREAKER_PERCENT", "5"), 10);

    const sessionId = id();
    const council = input.councilId ? this.getCouncil(input.councilId) : null;
    const councilDefaults = council ? parse(council.default_config, {}) : {};
    const maxRounds = Number(input.maxRounds ?? councilDefaults.max_rounds ?? inferred.maxRounds);
    if (maxRounds < 1 || maxRounds > 5) throw Object.assign(new Error("maxRounds must be 1-5."), { status: 400 });
    const timestamp = now();
    const personaBrief = this.sessionPersonaBrief(input.personaBrief);
    const desiredOutcome = this.sessionOutcome(input.desiredOutcome);
    const conversationId = this.ensureConversation(input, { personaBrief, desiredOutcome, timestamp });
    this.db.prepare(`insert into sessions(id, topic, status, mode, max_rounds, compact_internal, council_id, council_snapshot, tone, use_memory, desired_outcome, persona_brief, conversation_id, created_at, updated_at)
      values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sessionId,
      input.topic,
      "CREATED",
      inferred.mode,
      maxRounds,
      input.compactInternalCommunication === false ? 0 : 1,
      council?.id ?? null,
      council ? JSON.stringify(council) : null,
      normalizeTone(input.tone),
      input.useMemory === false ? 0 : 1,
      desiredOutcome,
      personaBrief,
      conversationId,
      timestamp,
      timestamp
    );
    this.emit("SESSION_CREATED", { sessionId, topic: input.topic, status: "CREATED" });
    await this.handleFileAttachment(sessionId, input);
    const roles = council ? this.spawnStaticRoles(sessionId, council) : await this.spawnDynamicRoles(sessionId, input.topic, { ...input, isFastMode });
    const costPlan = this.initializeCostPlan(sessionId, roles, maxRounds, input.budgetLimitUsd);
    if (input.followUpTo) this.attachConversationContext(sessionId, input.followUpTo);
    this.audit(sessionId, "session.created", { roles: roles.length, councilId: council?.id ?? null, conversationId, costPlan, operatingMode: inferred });
    if (input.autoStart !== false && !costPlan.requiresApproval) setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);

    return this.getSession(sessionId);
  }

  ensureConversation(input, { personaBrief, desiredOutcome, timestamp }) {
    if (input.conversationId) {
      const existing = this.db.prepare("select id from conversations where id = ?").get(input.conversationId);
      if (!existing) throw Object.assign(new Error("Conversation not found."), { status: 404 });
      this.db.prepare("update conversations set updated_at = ? where id = ?").run(timestamp, input.conversationId);
      return input.conversationId;
    }
    const conversationId = id();
    this.db.prepare(`insert into conversations(id, title, tone, use_memory, desired_outcome, persona_brief, created_at, updated_at)
      values(?,?,?,?,?,?,?,?)`).run(conversationId, String(input.topic).slice(0, 120), normalizeTone(input.tone), input.useMemory === false ? 0 : 1, desiredOutcome, personaBrief, timestamp, timestamp);
    return conversationId;
  }

  attachConversationContext(sessionId, previousSessionId) {
    const previous = this.getSession(previousSessionId);
    const session = this.getSession(sessionId);
    if (!previous.verdict || previous.conversation_id !== session.conversation_id) return;
    const summary = previous.verdict.summary || previous.verdict.decision || "Previous decision completed.";
    const content = `Conversation context from the previous Synod decision:\nTopic: ${previous.topic}\nDecision: ${previous.verdict.decision || summary}\nRationale: ${previous.verdict.rationale || summary}`;
    const payload = { shortSummary: summary, keyClaims: ["Use this previous decision as context; answer the user's new message directly."], confidence: 1, compact: true };
    this.db.prepare(`insert into messages(id, session_id, role_id, round_number, model_name, compact, payload, content, created_at) values(?,?,?,?,?,?,?,?,?)`)
      .run(id(), sessionId, null, 0, "conversation-context", 1, JSON.stringify(payload), content, now());
  }

  initializeCostPlan(sessionId, roles, maxRounds, requestedBudget) {
    const estimate = this.estimateSessionCost(roles, maxRounds);
    const multiplier = clampNumber(this.setting("COST_SAFETY_MULTIPLIER", "1.5"), 1, 3, 1.5);
    const requested = requestedBudget === undefined || requestedBudget === null || requestedBudget === "" ? null : Number(requestedBudget);
    if (requested !== null && (!Number.isFinite(requested) || requested <= 0)) throw Object.assign(new Error("Budget must be a positive USD amount."), { status: 400 });
    if (requested !== null && requested + 0.000001 < estimate.totalUsd) {
      throw Object.assign(new Error(`Budget of $${formatUsd(requested)} is below the estimated $${formatUsd(estimate.totalUsd)} required for this request.`), { status: 400 });
    }
    const budget = requested ?? Math.max(estimate.totalUsd * multiplier, clampNumber(this.setting("DEFAULT_CONVERSATION_BUDGET_USD", "1"), 0.01, 10000, 1));
    const requiresApproval = budget + 0.000001 < estimate.totalUsd;
    this.updateSession(sessionId, { estimated_cost_usd: estimate.totalUsd, budget_limit_usd: budget, spent_cost_usd: 0, budget_approval_required: requiresApproval ? 1 : 0, status: requiresApproval ? "AWAITING_BUDGET_APPROVAL" : "CREATED" });
    return { ...estimate, budgetLimitUsd: budget, requiresApproval };
  }

  estimateSessionCost(roles, maxRounds) {
    const calls = Math.max(1, roles.length * maxRounds + 1);
    const ratePer1k = roles.reduce((total, roleItem) => total + modelCostPer1k(roleItem.model_name, this.env), 0) / Math.max(1, roles.length);
    // Conservative blended call profile: 1,150 prompt + 750 completion tokens.
    const perCallUsd = Number(((1900 / 1000) * ratePer1k).toFixed(6));
    return { totalUsd: Number((perCallUsd * calls).toFixed(4)), perCallUsd, plannedCalls: calls, basis: "conservative token estimate" };
  }

  reserveBudget(sessionId, callType, metadata = {}) {
    const session = this.getSession(sessionId);
    const plan = this.estimateSessionCost(session.roles, session.max_rounds);
    const amount = plan.perCallUsd;
    const spent = Number(session.spent_cost_usd || 0);
    const limit = Number(session.budget_limit_usd || 0);
    if (spent + amount > limit + 0.000001) {
      this.updateSession(sessionId, { status: "AWAITING_BUDGET_APPROVAL", budget_approval_required: 1 });
      this.audit(sessionId, "budget.approval_required", { spentUsd: spent, nextCallUsd: amount, limitUsd: limit, callType });
      this.emit("BUDGET_APPROVAL_REQUIRED", { sessionId, spentUsd: spent, nextCallUsd: amount, limitUsd: limit });
      throw new BudgetApprovalError();
    }
    this.db.prepare("update sessions set spent_cost_usd = ?, updated_at = ? where id = ?").run(Number((spent + amount).toFixed(6)), now(), sessionId);
    this.db.prepare("insert into cost_events(id, session_id, call_type, estimated_cost_usd, metadata, created_at) values(?,?,?,?,?,?)")
      .run(id(), sessionId, callType, amount, JSON.stringify(metadata), now());
  }

  approveBudget(sessionId, budgetLimitUsd) {
    const amount = Number(budgetLimitUsd);
    const session = this.getSession(sessionId);
    if (!Number.isFinite(amount) || amount <= Number(session.spent_cost_usd || 0)) throw Object.assign(new Error("Approved budget must be higher than the estimated spend already reserved."), { status: 400 });
    this.updateSession(sessionId, { budget_limit_usd: amount, budget_approval_required: 0, status: "QUEUED" });
    this.audit(sessionId, "budget.approved", { budgetLimitUsd: amount });
    this.emit("BUDGET_APPROVED", { sessionId, budgetLimitUsd: amount });
    setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);
    return this.getSession(sessionId);
  }

  async startPipeline(input) {
    if (!input.topic || input.topic.length > 2000) throw Object.assign(new Error("Topic is required and must be <= 2000 chars."), { status: 400 });
    
    const settings = this.db.prepare("select key, value from system_settings").all().reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    const entropyThreshold = parseInt(settings.ENTROPY_THRESHOLD || '30', 10);
    global.KELLY_PERCENT = parseInt(settings.KELLY_CIRCUIT_BREAKER_PERCENT || '5', 10);

    const entropy = await this.llm.checkEntropy(input.topic);
    if (entropy.entropyScore < entropyThreshold) {
      throw Object.assign(new Error(`Prompt rejected (Entropy: ${entropy.entropyScore} < ${entropyThreshold}). ${entropy.feedback}`), { status: 400 });
    }

    const pipelineId = id();
    const tag = this.categorizeTopic(input.topic);
    
    const stages = [
      { name: "Core Idea", type: "dynamic" },
      { name: `${tag} Operational Review`, type: "static" },
      { name: "Execution Formatting", type: "execution" }
    ];
    this.db.prepare(`insert into pipelines(id, name, stages_json, created_at) values(?,?,?,?)`).run(
      pipelineId, "Superbrain Pipeline", JSON.stringify(stages), now()
    );
    const sessionId = id();
    const personaBrief = this.sessionPersonaBrief(input.personaBrief);
    const desiredOutcome = this.sessionOutcome(input.desiredOutcome);
    this.db.prepare(`insert into sessions(id, topic, status, mode, pipeline_id, stage_index, max_rounds, compact_internal, tone, use_memory, desired_outcome, persona_brief, created_at, updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      sessionId, input.topic, "INTERVIEW", "pipeline", pipelineId, 0, 4, 1, normalizeTone(input.tone), input.useMemory === false ? 0 : 1, desiredOutcome, personaBrief, now(), now()
    );
    this.emit("SESSION_CREATED", { sessionId, topic: input.topic, status: "INTERVIEW", pipelineId });
    await this.handleFileAttachment(sessionId, input);
    // Auto-fire the first interview question so the frontend receives it immediately
    setTimeout(() => this.processInterviewTurn(sessionId, "").catch(err => console.error("[Pipeline] First interview question failed:", err)), 50);
    return this.getSession(sessionId);


  }

  async processInterviewTurn(sessionId, userMessage, input = {}) {
    const session = this.getSession(sessionId);
    if (session.status !== "INTERVIEW") return session;
    const turnId = id();
    this.db.prepare(`insert into interviews(id, session_id, user_message, created_at) values(?,?,?,?)`).run(turnId, sessionId, userMessage, now());
    
    if (input.fileData) {
      await this.handleFileAttachment(sessionId, input);
    }
    
    const priorInterviews = this.db.prepare(`select * from interviews where session_id = ? order by created_at`).all(sessionId);
    const answeredInterviews = priorInterviews.filter((turn) => turn.user_message?.trim());
    const priorMessages = priorInterviews.map(i => `User: ${i.user_message}\nInterviewer: ${i.llm_response || ""}`).join("\n");
    
    const modelName = selectModel({ role_type: "SYNTHESIST" }, this.env);
    const role = { role_type: "INTERVIEWER", display_name: "Lead Synthesist (Interviewer)", model_name: modelName };
    const customPrompt = this.customPrompt(role, "PROMPT_INTERVIEWER", { topic: session.topic, round: "Interview", priorMessages, tone: session.tone, desiredOutcome: session.desired_outcome, personaBrief: session.persona_brief });
    const result = await this.llm.complete({ role, topic: session.topic, round: "Interview", priorMessages, compact: false, customPrompt });

    const payload = result.payload || {};
    
    this.db.prepare(`update interviews set llm_response = ?, is_satisfied = ?, refined_topic = ? where id = ?`).run(
      payload.question || decisionQuestion(session.topic, answeredInterviews), payload.isSatisfied ? 1 : 0, payload.refinedTopic || null, turnId
    );

    const question = payload.question || decisionQuestion(session.topic, answeredInterviews);
    this.emit("INTERVIEW_QUESTION", {
      sessionId,
      question,
      whyItMatters: payload.whyItMatters,
      suggestedAnswers: payload.suggestedAnswers,
      isSatisfied: payload.isSatisfied
    });

    if (payload.isSatisfied || answeredInterviews.length >= 3) {
      const finalTopic = payload.refinedTopic || session.topic;
      const roles = await this.spawnDynamicRoles(sessionId, finalTopic);
      this.updateSession(sessionId, { topic: finalTopic, status: "CREATED" });
      this.emit("SESSION_STATE_CHANGED", { sessionId, status: "CREATED" });
      setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);
    }

    return this.getSession(sessionId);
  }

  async spawnDynamicRoles(sessionId, topic, input = {}) {
    const isFastMode = input.isFastMode === true || input.mode === "fast";
    const needsWeb = input.allowWebSearch !== false;
    const needsRag = input.allowRag !== false;
    
    // Token Economist (Affordability Engine)
    const isLargeContext = topic.length > 5000;
    
    // Progres...[truncated]
    const complexityScore = this.complexity(topic);
    let tier = 1; // 1 = Single Expert
    if (complexityScore >= 2) tier = 2; // 2 = Expert + Skeptic
    if (complexityScore >= 3) tier = 3; // 3 = Full Council
    if (complexityScore >= 6) tier = 4; // 4 = Extinction/Simulation

    const baseRoles = [];
    
    if (isFastMode) {
      // Quick mode stays proportionate and avoids unnecessary machinery.
      baseRoles.push(role("SYNTHESIST", "Lead Synthesist", 1, "TRAINING"));
      baseRoles.push(role("DOMAIN_EXPERT", "Domain Expert", 2, "TRAINING"));
      if (materialRiskTrigger(topic)) baseRoles.push(role("RISK_OFFICER", "Risk Officer", 3, "TRAINING"));
      applyModelRouting(baseRoles, this.env);
      return this.insertRoles(sessionId, baseRoles);
    }

    if (isLargeContext) {
      baseRoles.push({
        role_type: "DOMAIN_EXPERT", 
        display_name: "Economist Reader (Condenser)", 
        priority: 0, 
        knowledge_source_type: "TRAINING",
        confidence_weight: 1.0,
        model_name: this.env.LOCAL_ROUTER_MODEL || this.env.GEMINI_MODEL || "gemini-2.5-flash"
      });
    }

    baseRoles.push(role("SYNTHESIST", "Lead Synthesist", 1, needsWeb && needsRag ? "HYBRID" : needsRag ? "RAG" : "TRAINING"));
    baseRoles.push(role("DOMAIN_EXPERT", "Domain Expert", 2, needsRag ? "RAG" : "TRAINING", 1.1));
    if (technicalTrigger(topic)) baseRoles.push(role("TECHNICAL_ARCHITECT", "Technical Architect", 3, "HYBRID"));
    if (commercialTrigger(topic)) baseRoles.push(role("PRODUCT_STRATEGIST", "Product Strategist", 4, "TRAINING"));
    if (financialTrigger(topic)) baseRoles.push(role("FINANCIAL_ANALYST", "Commercial & Financial Analyst", 5, "TRAINING"));
    
    if (tier >= 2) {
      baseRoles.push(role("SKEPTIC", "Skeptic", 6, "TRAINING"));
    }
    
    if (tier >= 3) {
      if (needsWeb) baseRoles.push(role("WEB_RESEARCHER", "Web Researcher", 4, "WEBSEARCH"));
      if (marketingTrigger(topic) || tier >= 3) baseRoles.push(role("MARKETING_SALES", "Growth & Marketing Strategist", 5, "HYBRID"));
      if (psychologistTrigger(topic)) baseRoles.push(role("PSYCHOLOGIST_MACHIAVELLI", "Psychologist / Machiavelli", 6, "TRAINING"));
      baseRoles.push(role("RISK_OFFICER", "Risk Officer", 7, "HYBRID"));
      if (complianceTrigger(topic)) baseRoles.push(role("COMPLIANCE_REVIEWER", "Compliance Reviewer", 8, "HYBRID"));
    }
    
    if (tier >= 4) {
      baseRoles.push(role("DOOM_COUNCIL", "Regulatory Assassin", 8, "TRAINING"));
    }

    const unique = [...new Map(baseRoles.map((item) => [item.role_type, item])).values()];
    const limit = tier >= 4 ? 10 : tier >= 3 ? 8 : 5;
    const plan = unique.slice(0, limit);
    if (complianceTrigger(topic) && !plan.some((item) => item.role_type === "COMPLIANCE_REVIEWER")) {
      plan[plan.length - 1] = unique.find((item) => item.role_type === "COMPLIANCE_REVIEWER");
    }
    if (tier >= 4 && !plan.some((item) => item.role_type === "DOOM_COUNCIL")) {
      plan[plan.length - 1] = unique.find((item) => item.role_type === "DOOM_COUNCIL");
    }

    // Deterministic policy routing avoids spending an extra LLM call merely to
    // choose a model. RouteLLM is opt-in and only used when its local service is configured.
    applyModelRouting(plan, this.env);

    return this.insertRoles(sessionId, plan);
  }

  categorizeTopic(topic) {
    const text = topic.toLowerCase();
    if (text.includes("software") || text.includes("app") || text.includes("code")) return "Tech";
    if (text.includes("invest") || text.includes("crypto") || text.includes("stock")) return "Finance";
    if (text.includes("law") || text.includes("sue") || text.includes("contract")) return "Legal";
    return "Business";
  }

  async handleFileAttachment(sessionId, input) {
    if (!input.fileData) return;
    try {
      const matches = input.fileData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const buffer = Buffer.from(matches[2], "base64");
        if (buffer.length > 8 * 1024 * 1024) throw new Error("Attached file exceeds the 8 MB upload limit.");
        const originalName = path.basename(String(input.fileName || "upload"));
        const safeName = `${id()}-${originalName.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120) || "upload"}`;
        const uploadDir = "./data/uploads";
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const filePath = path.join(uploadDir, safeName);
        fs.writeFileSync(filePath, buffer);
        const fileUrl = `/uploads/${safeName}`;
        
        const textContent = `Uploaded file: ${input.fileName || "document"} (${input.fileType || "unknown"})`;
        const payload = {
          shortSummary: textContent,
          keyClaims: [`Attached file: ${fileUrl}`],
          confidence: 1.0,
          fileUrl,
          fileType: input.fileType,
          compact: false
        };
        this.db.prepare(`insert into messages(id, session_id, role_id, round_number, model_name, compact, payload, content, created_at) values(?,?,?,?,?,?,?,?,?)`)
          .run(id(), sessionId, null, 0, "file-attachment", 0, JSON.stringify(payload), textContent, now());
        console.log(`[Memory Architect] Saved session dropped file to: ${filePath}`);

        // Vectorize in AnythingLLM
        try {
          const anythingLlm = new AnythingLlmClient(this.env, { db: this.db });
          const check = await anythingLlm.health();
          if (check.ok && check.mode === "real") {
            const wsName = `Synod Session ${sessionId.slice(0, 8)}`;
            console.log(`[AnythingLLM] Auto-creating workspace "${wsName}" for dynamic RAG...`);
            const ws = await anythingLlm.createWorkspace(wsName);
            if (ws && ws.slug) {
              await anythingLlm.uploadAndEmbedFile(ws.slug, input.fileName || "document", input.fileData, input.fileType);
              this.db.prepare("update sessions set workspace_id = ? where id = ?").run(ws.slug, sessionId);
              console.log(`[AnythingLLM] Vectorized document and bound workspace ${ws.slug} to session ${sessionId}`);
            }
          }
        } catch (embedError) {
          console.error("[AnythingLLM Setup] Embedding failure during file drop:", embedError.message);
        }
      }
    } catch (e) {
      console.error("Failed saving session dropped file:", e);
    }
  }

  spawnStaticRoles(sessionId, council) {

    const manifest = parse(council.role_manifest, []);
    const hierarchy = parse(council.hierarchy, {});
    const overrides = parse(council.model_overrides, {});
    const weights = hierarchy.confidence_weights ?? {};
    const plan = manifest.slice(0, 6).map((item, index) => ({
      role_type: item.role_type,
      display_name: item.display_name || item.displayName || title(item.role_type),
      priority: item.priority ?? index + 1,
      knowledge_source_type: item.knowledge_source_type ?? "TRAINING",
      workspace_id: item.workspace_id ?? null,
      confidence_weight: weights[item.role_type] ?? item.confidence_weight ?? 1,
      model_name: overrides[item.role_type] ?? null,
      veto_capable: (hierarchy.veto_roles ?? []).includes(item.role_type) ? 1 : 0
    }));
    applyModelRouting(plan, this.env);
    return this.insertRoles(sessionId, plan);
  }

  insertRoles(sessionId, roles) {
    const existing = this.roles(sessionId);
    if (existing.length) return existing;
    for (const item of roles) {
      if (!ROLE_TYPES.includes(item.role_type)) throw Object.assign(new Error(`Invalid role: ${item.role_type}`), { status: 400 });
    }
    const session = this.db.prepare("select workspace_id from sessions where id = ?").get(sessionId);
    const dynamicWorkspaceId = session?.workspace_id ?? null;

    const insert = this.db.prepare(`insert into roles(id, session_id, role_type, display_name, priority, knowledge_source_type, workspace_id, model_name, confidence_weight, veto_capable, status)
      values(@id,@session_id,@role_type,@display_name,@priority,@knowledge_source_type,@workspace_id,@model_name,@confidence_weight,@veto_capable,'ACTIVE')`);
    const rows = roles.map((item) => ({
        id: id(),
        session_id: sessionId,
        role_type: item.role_type,
        display_name: item.display_name,
        priority: item.priority ?? 1,
        knowledge_source_type: item.knowledge_source_type ?? "TRAINING",
        workspace_id: item.workspace_id ?? (["RAG", "HYBRID"].includes(item.knowledge_source_type) ? dynamicWorkspaceId : null),
        model_name: item.model_name ?? selectModel(item, this.env),
        confidence_weight: item.confidence_weight ?? 1,
        veto_capable: item.veto_capable ?? 0
      }));
    this.db.exec("BEGIN");
    try {
      for (const row of rows) insert.run(row);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    for (const row of rows) {
      this.emit("ROLE_ACTIVATED", { sessionId, roleId: row.id, roleType: row.role_type, modelName: row.model_name });
    }
    return rows;
  }

  startSession(sessionId) {
    const session = this.getSession(sessionId);
    if (["DELIBERATING", "COMPLETED"].includes(session.status)) return session;
    if (session.status === "AWAITING_BUDGET_APPROVAL") return session;
    if (session.status === "INTERVIEW") {
      throw Object.assign(new Error("Complete the pre-session interview before starting the council."), { status: 409 });
    }
    if (!session.roles.length) {
      throw Object.assign(new Error("The session has no council roles and cannot be started."), { status: 409 });
    }
    this.updateSession(sessionId, { status: "QUEUED" });
    setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);
    return this.getSession(sessionId);
  }


  async runSession(sessionId) {
    if (this.runningSessions.has(sessionId)) return this.getSession(sessionId);
    this.runningSessions.add(sessionId);
    try {
      return await this.executeSession(sessionId);
    } catch (error) {
      if (error instanceof BudgetApprovalError) return this.getSession(sessionId);
      throw error;
    } finally {
      this.runningSessions.delete(sessionId);
    }
  }

  recoverInterruptedSessions() {
    const interrupted = this.db.prepare("select id from sessions where status in ('QUEUED', 'DELIBERATING') order by created_at").all();
    for (const { id: sessionId } of interrupted) {
      setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 25);
    }
    return interrupted.length;
  }

  async executeSession(sessionId) {
    const existing = this.getSession(sessionId);
    if (existing.status === "AWAITING_BUDGET_APPROVAL") return existing;
    this.updateSession(sessionId, { status: "DELIBERATING" });
    const sessionForAnalysis = this.getSession(sessionId);
    this.emit("TOPIC_ANALYSED", { sessionId, complexity: this.complexity(sessionForAnalysis.topic) });

    // Obsidian memories are included only when the user enabled them for this decision.
    if (sessionForAnalysis.use_memory !== 0) try {
      const pastMemories = searchVault(sessionForAnalysis.topic, { vaultPath: this.env.OBSIDIAN_VAULT_PATH });
      const memoryAlreadyLoaded = this.messages(sessionId).some((message) => message.model_name === "obsidian-memory");
      if (!memoryAlreadyLoaded && pastMemories && pastMemories.length > 0) {
        const memoryContent = `Obsidian Memory Context:\n` + pastMemories.map(m => `### Past Verdict File: ${m.file}\n${m.content}`).join("\n\n");
        const payload = {
          shortSummary: `Retrieved ${pastMemories.length} relevant saved decision note${pastMemories.length === 1 ? "" : "s"} from the Obsidian vault.`,
          keyClaims: pastMemories.map(m => `Saved note: ${m.title}`),
          confidence: 1.0,
          compact: Boolean(sessionForAnalysis.compact_internal)
        };

        this.db.prepare(`insert into messages(id, session_id, role_id, round_number, model_name, compact, payload, content, created_at) values(?,?,?,?,?,?,?,?,?)`)
          .run(id(), sessionId, null, 0, "obsidian-memory", 0, JSON.stringify(payload), memoryContent, now());
        console.log(`[Memory Architect] Injected ${pastMemories.length} relevant memories into session.`);
      }
    } catch (e) {
      console.warn("[Memory Architect] Memory retrieval failed:", e);
    }

    let vetoTriggered = false;
    for (let round = 1; round <= this.getSession(sessionId).max_rounds; round++) {
      const session = this.getSession(sessionId);
      const compact = Boolean(session.compact_internal);
      this.updateSession(sessionId, { current_round: round });
      const roles = this.roles(sessionId).sort((a, b) => a.priority - b.priority);
      const persistedRoundMessages = this.messages(sessionId).filter((message) => message.round_number === round && message.role_id);
      if (persistedRoundMessages.length >= roles.length) continue;
      if (persistedRoundMessages.length) {
        this.db.prepare("delete from messages where session_id = ? and round_number = ? and role_id is not null").run(sessionId, round);
        this.audit(sessionId, "round.recovered", { round, discardedPartialMessages: persistedRoundMessages.length });
      }
      const priorMessages = this.messages(sessionId).map((message) => {
        const payload = JSON.parse(message.payload);
        return {
          ...payload,
          role_id: message.role_id,
          model_name: message.model_name,
          round_number: message.round_number,
          content: message.content
        };
      });
      if (round === 1 && roles.some((roleItem) => ["WEBSEARCH", "HYBRID"].includes(roleItem.knowledge_source_type))) {
        const evidence = await this.search.search(session.topic);
        if (evidence.length) {
          priorMessages.push({
            role_id: "verified-web-evidence",
            model_name: "web-search",
            round_number: 0,
            shortSummary: "Current web evidence retrieved for council verification.",
            keyClaims: evidence.map((item) => `${item.title}: ${item.snippet} (${item.url})`).slice(0, 5),
            content: evidence.map((item) => `${item.title}: ${item.snippet} (${item.url})`).join("\n")
          });
        }
      }
      // Run all roles in parallel — each role is independent within a round
      // Reserve the conservative estimated cost before dispatching a parallel
      // batch, so a budget cap cannot be exceeded by simultaneous calls.
      roles.forEach((activeRole) => this.reserveBudget(sessionId, "deliberation", { roleId: activeRole.id, round }));
      const roleResults = await Promise.all(roles.map(async (activeRole) => {
        const customPrompt = this.customPrompt(activeRole, "PROMPT_DELIBERATION", {
          topic: session.topic,
          round,
          priorMessages,
          tone: session.tone,
          desiredOutcome: session.desired_outcome,
          personaBrief: session.persona_brief
        });
        const result = await this.llm.complete({ role: activeRole, topic: session.topic, round, priorMessages, compact, customPrompt });
        return { activeRole, result };
      }));
      // Serialize DB writes and events after all parallel calls resolve
      for (const { activeRole, result } of roleResults) {
        if (result.warning) this.warning(sessionId, "PROVIDER_FALLBACK", result.warning);
        const payload = compactPayload(result.payload, sessionId, activeRole.id, round, compact);
        this.audit(sessionId, "llm.output_received", { roleId: activeRole.id, round, compact });
        this.db.prepare(`insert into messages(id, session_id, role_id, round_number, model_name, compact, payload, content, created_at) values(?,?,?,?,?,?,?,?,?)`)
          .run(id(), sessionId, activeRole.id, round, activeRole.model_name, compact ? 1 : 0, JSON.stringify(payload), humanize(payload), now());
        this.emit("ROLE_MESSAGE", { sessionId, roleId: activeRole.id, roundNumber: round, confidence: payload.confidence });
        vetoTriggered ||= payload.veto;
      }
      const completedRolePayloads = this.messages(sessionId)
        .filter((message) => message.round_number === round && message.role_id)
        .map((message) => JSON.parse(message.payload));
      if (completedRolePayloads.length && completedRolePayloads.every(isProviderFallbackPayload)) {
        throw new Error("Every model response failed before Synod could produce a reliable decision. Check the selected provider and retry.");
      }
      const consensus = this.consensus(sessionId, round);
      this.emit("ROUND_COMPLETE", { sessionId, roundNumber: round, consensusScore: consensus });
    }
    const verdict = await this.buildVerdict(sessionId);
    const finalSession = this.getSession(sessionId);
    const executionPlan = persistExecutionPlan(this.db, finalSession, verdict, sessionForAnalysis.current_round > 0 ? "Council decision completed" : null);
    verdict.executionPlan = executionPlan.plan;
    verdict.executorHandoffAvailable = true;
    verdict.planVersion = executionPlan.version;
    this.updateSession(sessionId, { status: "COMPLETED", verdict: JSON.stringify(verdict), consensus: verdict.confidence, completed_at: now() });
    
    // Save to Obsidian Vault
    try {
      writeToVault(sessionId, finalSession.topic, verdict, { vaultPath: this.env.OBSIDIAN_VAULT_PATH });
    } catch (e) {
      console.error("[Memory Architect] Failed to write to Obsidian vault:", e);
    }

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
    const customPrompt = this.customPrompt(verdictRole, "PROMPT_VERDICT", {
      topic: `Final Verdict for: ${session.topic}`,
      round: "Final",
      priorMessages: messages,
      tone: session.tone,
      desiredOutcome: session.desired_outcome,
      personaBrief: session.persona_brief
    });
    
    let response;
    try {
      this.reserveBudget(sessionId, "verdict", { roleId: lead?.id ?? null });
      response = await this.llm.complete({
        role: verdictRole,
        topic: `Final Verdict for: ${session.topic}`,
        round: "Final",
        priorMessages: messages,
        compact: false,
        customPrompt
      });
    } catch (err) {
      if (err instanceof BudgetApprovalError) throw err;
      response = { payload: {} };
    }

    let verdictPayload = response.payload || {};
    if (response.warning || !isSpecificDecision(verdictPayload.decision || verdictPayload.shortSummary)) {
      verdictPayload = synthesizeVerdictFromCouncil(messages, lead?.id, session.max_rounds, this.consensus(sessionId, session.max_rounds));
      this.audit(sessionId, "verdict.resilience_synthesis", { reason: response.warning || "verdict was not decision-specific" });
    }
    const dissents = messages.filter((message) => message.dissent).map((message) => message.shortSummary);
    const finalClaims = verdictPayload.keyClaims?.length ? verdictPayload.keyClaims : messages.flatMap((message) => message.keyClaims ?? []).slice(-8);

    if (session.pipeline_id) {
       this.emit("PIPELINE_STAGE_COMPLETE", { sessionId, nextStage: "Level 2: Execution Council" });
       
       // Cycle 3: Level 2 Execution Council
       // Dynamically identify required roles
       const requiredRolesPrompt = this.prompts.render("execution.role_selection", { decision: verdictPayload.shortSummary || verdictPayload.decision });
       const rolesRes = await this.llm.complete({ role: { role_type: "SYSTEM", display_name: "System" }, topic: requiredRolesPrompt, round: "Execution_Roles", priorMessages: [], compact: true, customPrompt: requiredRolesPrompt });
       const executionRoles = (rolesRes.payload?.shortSummary || "Deployment Engineer, Product Manager, Legal Advisor").split(",").map(r => r.trim());

       // Dynamically create and route AnythingLLM workspaces
       const anythingLlmClient = new AnythingLlmClient(this.env, { db: this.db });
       const agenticWorkspaces = [];
       for (const roleName of executionRoles) {
         if (!roleName) continue;
         const workspaceName = `synod-exec-${roleName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
         const ws = await anythingLlmClient.createWorkspace(workspaceName);
         agenticWorkspaces.push({ roleName, workspaceSlug: ws.slug });
       }

       // Agentic Orchestration Generation
       const execRole = { 
         role_type: "EXECUTION_PLANNER", 
         display_name: "Master Orchestrator", 
         model_name: "mock-deep" 
       };
       const orchestrationPrompt = `Translate the following consensus into a real-world, agentic execution plan. 
Output highly structured orchestration instructions suitable for external execution frameworks (e.g. Paperclip/Hermes).
Assigned workspaces: ${JSON.stringify(agenticWorkspaces)}
Consensus: ${verdictPayload.shortSummary || verdictPayload.decision}`;
       
       const execRes = await this.llm.complete({ role: execRole, topic: orchestrationPrompt, round: "Execution", priorMessages: priorSummaries, compact: false, customPrompt: `${this.prompts.text("execution.planner")}\n\n${orchestrationPrompt}` });
       const payload = execRes.payload || { agentic_instructions: "Run setup script", required_workspaces: agenticWorkspaces };
       
       this.updateSession(sessionId, { execution_payload: JSON.stringify(payload) });
       
       // This sprint prepares an executor-ready payload but deliberately does
       // not dispatch it. External execution requires a future explicit owner approval flow.
       this.updateSession(sessionId, { handoff_status: "PREPARED" });
       this.emit("EXECUTION_HANDOFF", { sessionId, status: "PREPARED", payload });
       this.emit("PIPELINE_STAGE_COMPLETE", { sessionId, nextStage: "Complete" });
    }

    return {
      summary: verdictPayload.executiveSummary || verdictPayload.shortSummary || "Consensus has been reached after deliberation.",
      decision: verdictPayload.decision || verdictPayload.shortSummary || "Proceed using the evidence-gated majority recommendation.",
      majority: finalClaims.join(" "),
      rationale: verdictPayload.rationale || finalClaims.slice(0, 4).join(" "),
      recommendedActions: verdictPayload.recommendedActions ?? verdictPayload.nextSteps ?? [],
      executionPhases: verdictPayload.executionPhases ?? verdictPayload.phases ?? [],
      desiredOutcome: verdictPayload.desiredOutcome ?? session.desired_outcome,
      currentState: verdictPayload.currentState ?? null,
      strategy: verdictPayload.strategy ?? null,
      ownerInvolvement: verdictPayload.ownerInvolvement ?? null,
      firstActions: verdictPayload.firstActions ?? [],
      executionReadiness: verdictPayload.executionReadiness ?? null,
      successMetrics: verdictPayload.successMetrics ?? [],
      guardrails: verdictPayload.guardrails ?? [],
      alternatives: verdictPayload.alternatives ?? [],
      risks: verdictPayload.risks ?? [],
      assumptions: verdictPayload.assumptions ?? [],
      openQuestions: verdictPayload.openQuestions ?? verdictPayload.knowledgeGaps ?? [],
      dissents,
      unresolvedTensions: verdictPayload.disagreements?.length ? verdictPayload.disagreements : [...new Set(messages.flatMap((message) => message.disagreements ?? []))],
      warnings: parse(session.warnings, []),
      confidence: verdictPayload.confidence ?? this.consensus(sessionId, session.max_rounds)
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

  listSessions({ state = "active" } = {}) {
    const filter = state === "all"
      ? ""
      : state === "archived"
        ? "where c.archived_at is not null"
        : "where c.archived_at is null";
    return this.db.prepare(`select s.*, c.archived_at as conversation_archived_at
      from sessions s left join conversations c on c.id = s.conversation_id
      ${filter} order by s.created_at desc`).all();
  }

  executionPlan(sessionId) { return getExecutionPlan(this.db, sessionId); }
  planVersions(conversationId) { return listPlanVersions(this.db, conversationId); }
  executionPlanMarkdown(sessionId) { return planMarkdown(this.executionPlan(sessionId)); }

  listConversations({ state = "active" } = {}) {
    const filter = state === "all"
      ? ""
      : state === "archived"
        ? "where c.archived_at is not null"
        : "where c.archived_at is null";
    return this.db.prepare(`select c.*, count(s.id) as session_count, max(s.updated_at) as last_activity_at,
      (select latest.id from sessions latest where latest.conversation_id = c.id order by latest.created_at desc limit 1) as latest_session_id
      from conversations c left join sessions s on s.conversation_id = c.id
      ${filter}
      group by c.id order by coalesce(last_activity_at, c.updated_at) desc`).all();
  }

  archiveConversation(conversationId) {
    const conversation = this.getConversation(conversationId);
    const timestamp = conversation.archived_at || now();
    this.db.prepare("update conversations set archived_at = ?, updated_at = ? where id = ?").run(timestamp, now(), conversationId);
    return this.getConversation(conversationId);
  }

  restoreConversation(conversationId) {
    this.getConversation(conversationId);
    this.db.prepare("update conversations set archived_at = null, updated_at = ? where id = ?").run(now(), conversationId);
    return this.getConversation(conversationId);
  }

  renameConversation(conversationId, title) {
    this.getConversation(conversationId);
    const cleanTitle = String(title || "").replace(/\s+/g, " ").trim();
    if (!cleanTitle || cleanTitle.length > 120) throw Object.assign(new Error("Conversation title must be between 1 and 120 characters."), { status: 400 });
    this.db.prepare("update conversations set title = ?, updated_at = ? where id = ?").run(cleanTitle, now(), conversationId);
    return this.getConversation(conversationId);
  }

  deleteConversation(conversationId) {
    const conversation = this.getConversation(conversationId);
    this.db.prepare("delete from sessions where conversation_id = ?").run(conversationId);
    this.db.prepare("delete from conversations where id = ?").run(conversationId);
    return { deleted: true, id: conversationId, title: conversation.title };
  }

  getConversation(conversationId) {
    const conversation = this.db.prepare("select * from conversations where id = ?").get(conversationId);
    if (!conversation) throw Object.assign(new Error("Conversation not found."), { status: 404 });
    conversation.sessions = this.db.prepare("select * from sessions where conversation_id = ? order by created_at").all(conversationId);
    return conversation;
  }

  costEvents(sessionId) {
    this.getSession(sessionId);
    return this.db.prepare("select * from cost_events where session_id = ? order by created_at").all(sessionId).map((event) => ({ ...event, metadata: parse(event.metadata, {}) }));
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

  interviews(sessionId) {
    return this.db.prepare("select * from interviews where session_id = ? order by created_at").all(sessionId);
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

  async processExecutionOutcome(sessionId, outcomeData) {
    const { status, metrics, logs } = outcomeData; // status: "SUCCESS" or "FAILED"
    const outcomeId = id();
    
    this.db.prepare(`insert into execution_results(id, session_id, status, metrics_json, logs, created_at) values(?,?,?,?,?,?)`)
      .run(outcomeId, sessionId, status, JSON.stringify(metrics || {}), logs || "", now());

    // Recalibrate persona weights based on this outcome
    // Find all messages in the final round of the deliberation for this session
    const messages = this.db.prepare(`select m.role_id, m.payload, r.role_type from messages m join roles r on m.role_id = r.id where m.session_id = ? order by m.round_number desc limit 10`).all(sessionId);
    
    for (const msg of messages) {
      try {
        const payload = JSON.parse(msg.payload);
        const confidence = typeof payload.confidenceScore === 'number' ? payload.confidenceScore : 50;
        
        // Upsert into persona_stats
        this.db.prepare(`insert into persona_stats (role_type, total_predictions, successful_predictions, average_confidence, accuracy_weight, updated_at) 
          values (?, 1, ?, ?, 1.0, ?) 
          on conflict(role_type) do update set 
          total_predictions = total_predictions + 1,
          successful_predictions = successful_predictions + excluded.successful_predictions,
          average_confidence = (average_confidence * total_predictions + excluded.average_confidence) / (total_predictions + 1),
          accuracy_weight = cast(successful_predictions as real) / (total_predictions + 1),
          updated_at = excluded.updated_at`).run(
            msg.role_type, 
            status === "SUCCESS" ? 1 : 0, 
            confidence, 
            now()
          );
      } catch (e) {
        // Ignore parsing errors for recalibration
      }
    }
    
    this.emit("EXECUTION_FEEDBACK", { sessionId, status, metrics });
    return { success: true, outcomeId };
  }

  fail(sessionId, error) {
    if (error instanceof BudgetApprovalError) return;
    this.updateSession(sessionId, { status: "FAILED" });
    this.warning(sessionId, "SESSION_ERROR", error.message);
    this.emit("SESSION_ERROR", { sessionId, message: error.message });
  }

  emit(eventType, payload) {
    this.events.emit(eventType, { eventId: id(), eventType, occurredAt: now(), ...payload });
  }

  complexity(topic) {
    return Math.min(10, Math.max(1, Math.ceil(topic.length / 30)));
  }
}


function role(role_type, display_name, priority, knowledge_source_type, confidence_weight = 1) {
  return { role_type, display_name, priority, knowledge_source_type, confidence_weight };
}

function promptIdForRole(roleType, fallbackKey) {
  if (roleType === "INTERVIEWER") return "interview.material_clarification";
  if (roleType === "VERDICT") return "verdict.executive";
  if (roleType === "EXECUTION_PLANNER") return "execution.planner";
  return fallbackKey === "PROMPT_INTERVIEWER" ? "interview.material_clarification" : fallbackKey === "PROMPT_VERDICT" ? "verdict.executive" : "council.member";
}

function rolePromptId(roleType) {
  return ({ SYNTHESIST: "role.synthesist", DOMAIN_EXPERT: "role.domain_expert", SKEPTIC: "role.skeptic", RISK_OFFICER: "role.risk_officer", MARKETING_SALES: "role.growth", ETHICIST: "role.policy", WEB_RESEARCHER: "role.researcher", DOOM_COUNCIL: "role.doom" })[roleType] || "";
}

function roundPromptId(round) {
  const number = Number(round);
  if (number === 1) return "round.independent";
  if (number === 2) return "round.challenge";
  return Number.isFinite(number) ? "round.synthesis" : "";
}

function deliberationStage(round) {
  const number = Number(round);
  if (number === 1) return "Independent assessment";
  if (number === 2) return "Challenge";
  if (Number.isFinite(number)) return "Synthesis";
  return String(round || "Analysis");
}

function selectModel(roleItem, env = process.env) {
  if (env.PROVIDER_MODE && env.PROVIDER_MODE !== "mock") return env.PROVIDER_MODE;
  if (env.ANYTHINGLLM_API_KEY) return "anythingllm";
  if (roleItem.knowledge_source_type === "WEBSEARCH") return "mock-fast";
  if (roleItem.role_type === "SYNTHESIST") return "mock-deep";
  return "mock-fast";
}

function applyModelRouting(plan, env = process.env) {
  const routeLlmEnabled = String(env.ROUTELLM_ENABLED || "").toLowerCase() === "true" && Boolean(env.ROUTELLM_BASE_URL);
  const threshold = clampNumber(env.ROUTELLM_THRESHOLD, 0.01, 0.99, 0.55);
  for (const roleItem of plan) {
    if (routeLlmEnabled) {
      roleItem.model_name = `router-mf-${threshold}`;
      continue;
    }
    roleItem.model_name ||= selectModel(roleItem, env);
  }
}

function modelCostPer1k(modelName, env = process.env) {
  const model = String(modelName || env.PROVIDER_MODE || "").toLowerCase();
  if (model === "mock" || model.startsWith("mock-") || model === "anythingllm") return 0;
  if (model.includes("router-mf")) return clampNumber(env.ROUTELLM_ESTIMATED_COST_PER_1K, 0.0001, 1, 0.003);
  if (model.includes("haiku")) return 0.0015;
  if (model.includes("sonnet") || model.includes("claude")) return 0.009;
  if (model.includes("deepseek")) return 0.0012;
  if (model.includes("gemini") || model.includes("flash")) return 0.001;
  if (model.includes("gpt") || model.includes("openai")) return 0.004;
  if (model.includes("qwen") || model.includes("siliconflow")) return 0.0012;
  return 0.003;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function formatUsd(value) {
  return Number(value || 0).toFixed(4);
}

class BudgetApprovalError extends Error {
  constructor() {
    super("Estimated conversation budget reached. Approve a higher budget to continue.");
    this.name = "BudgetApprovalError";
  }
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
    decision: payload.decision ?? null,
    rationale: payload.rationale ?? null,
    decisionCriteria: payload.decisionCriteria ?? [],
    evidence: payload.evidence ?? [],
    assumptions: payload.assumptions ?? [],
    risks: payload.risks ?? [],
    alternatives: payload.alternatives ?? [],
    recommendedActions: payload.recommendedActions ?? payload.nextSteps ?? [],
    successMetrics: payload.successMetrics ?? [],
    guardrails: payload.guardrails ?? [],
    openQuestions: payload.openQuestions ?? [],
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

function marketingTrigger(topic) {
  return /\b(market|marketing|sales|pricing|price|revenue|customer|acquisition|growth|launch|campaign|product|business|strategy|monetization|gated)\b/i.test(topic);
}

function inferOperatingMode(topic, requested) {
  const explicit = String(requested || "").toLowerCase();
  if (["fast", "quick"].includes(explicit) || /\b(just (?:give|tell)|quick view|brief answer|no full analysis)\b/i.test(topic)) return { mode: "fast", label: "QUICK", maxRounds: 1, reason: "Narrow or explicitly proportionate request" };
  if (explicit === "deep") return { mode: "deep", label: "DEEP", maxRounds: 3, reason: "User selected deep review" };
  const consequential = /\b(health|medical|patient|regulated|regulation|legal|law|finance|invest|launch|country|jurisdiction|security|privacy|million|enterprise|production|contract|hire|fire|acquire|sell|moneti[sz]e)\b/i.test(topic);
  const complex = topic.length > 280 || (topic.match(/[?.!,;]/g) || []).length > 4;
  if (consequential || complex) return { mode: "deep", label: "DEEP", maxRounds: 3, reason: consequential ? "Material commercial, safety, regulatory, or irreversible implications" : "Multiple constraints or high uncertainty" };
  return { mode: "standard", label: "STANDARD", maxRounds: 2, reason: "Meaningful decision with manageable uncertainty" };
}

function technicalTrigger(topic) { return /\b(software|app|website|repository|code|api|architecture|database|cloud|deploy|ai|automation|security)\b/i.test(topic); }
function commercialTrigger(topic) { return /\b(product|business|startup|launch|market|customer|website|service|moneti[sz]e|pricing|revenue|sales)\b/i.test(topic); }
function financialTrigger(topic) { return /\b(budget|cost|price|pricing|revenue|margin|cash|fund|invest|capital|£|\$|₹|€)\b/i.test(topic); }
function complianceTrigger(topic) { return /\b(health|medical|patient|legal|law|regulated|compliance|privacy|data protection|gdpr|india|uk|europe|financial)\b/i.test(topic); }
function materialRiskTrigger(topic) { return /\b(cost|budget|risk|health|legal|security|invest|production|launch|irreversible)\b/i.test(topic); }


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

function decisionQuestion(topic, answeredInterviews) {
  const asked = answeredInterviews.length;
  if (asked === 0) return `What outcome would make this decision successful, and by when, for “${topic.slice(0, 120)}”?`;
  if (asked === 1) return "Which constraints are non-negotiable—budget, timeline, compliance, team capacity, or risk tolerance?";
  return "What alternatives are already under consideration, and what evidence would cause you to reject the leading option?";
}

function isSpecificDecision(value) {
  const text = String(value || "").trim();
  if (text.length < 24) return false;
  return !/^(proceed with a bounded|advance only if|consensus has been reached|.+ completed (?:its|the))/i.test(text);
}

function normalizeTone(value) {
  return ["trusted", "focused", "formal"].includes(value) ? value : "trusted";
}

function trustedFriendGuidance(tone, desiredOutcome, personaBrief) {
  const style = {
    trusted: "Write like a sharp, loyal trusted friend: warm, candid, occasionally dry, and never performative. Be lightly witty only when the subject is low-stakes.",
    focused: "Write with direct, calm precision. Skip banter and lead with the useful answer.",
    formal: "Write in a polished, neutral, professional voice without banter."
  }[normalizeTone(tone)];
  return `Conversation contract:
- ${style}
- You are an AI assistant. Do not claim human memories, feelings, a body, or lived experience.
- Saved Obsidian notes are user-provided context, not current verified facts. Use them only when relevant; name them as saved notes rather than claiming to remember.
- For health, legal, financial, safety, grief, or other sensitive subjects: be respectful and do not use sarcasm or teasing.
- Do not ask follow-up questions when the user has requested a direct answer. State material assumptions briefly instead.
- Council roles are analytical perspectives, not conscious people.
- Working outcome: ${String(desiredOutcome || "A clear, evidence-aware next step I can act on.").slice(0, 600)}
${personaBrief ? `- User's companion brief: ${String(personaBrief).slice(0, 1200)}` : ""}`;
}

function isProviderFallbackPayload(payload) {
  return Array.isArray(payload?.flags)
    && payload.flags.some((flag) => /^(?:PROVIDER|ANYTHINGLLM)_FALLBACK$/i.test(String(flag)));
}

function synthesizeVerdictFromCouncil(messages, leadRoleId, finalRound, confidence) {
  const finalMessages = messages.filter((message) => Number(message.roundNumber) === Number(finalRound));
  const candidates = finalMessages.filter((message) => isSpecificDecision(message.decision || message.shortSummary));
  const anchor = candidates.find((message) => message.roleInstanceId === leadRoleId)
    || candidates.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0]
    || finalMessages[0]
    || messages.at(-1)
    || {};
  const ordered = [anchor, ...candidates.filter((message) => message !== anchor)];
  return {
    decision: anchor.decision || anchor.shortSummary || "Use the strongest evidence-supported council recommendation.",
    shortSummary: anchor.shortSummary || anchor.decision || "The council reached a resilient evidence-based recommendation.",
    executiveSummary: anchor.shortSummary || anchor.decision || null,
    rationale: anchor.rationale || uniqueValues(ordered.flatMap((message) => message.keyClaims || [])).slice(0, 4).join(" "),
    keyClaims: uniqueValues(ordered.flatMap((message) => message.keyClaims || [])).slice(0, 8),
    recommendedActions: uniqueValues(ordered.flatMap((message) => message.recommendedActions || [])).slice(0, 8),
    successMetrics: uniqueValues(ordered.flatMap((message) => message.successMetrics || [])).slice(0, 6),
    guardrails: uniqueValues(ordered.flatMap((message) => message.guardrails || [])).slice(0, 6),
    alternatives: uniqueValues(ordered.flatMap((message) => message.alternatives || [])).slice(0, 6),
    risks: uniqueValues(ordered.flatMap((message) => message.risks || [])).slice(0, 6),
    assumptions: uniqueValues(ordered.flatMap((message) => message.assumptions || [])).slice(0, 6),
    openQuestions: uniqueValues(ordered.flatMap((message) => message.openQuestions || message.knowledgeGaps || [])).slice(0, 6),
    disagreements: uniqueValues(ordered.flatMap((message) => message.disagreements || [])).slice(0, 8),
    confidence
  };
}

function uniqueValues(values) {
  const seen = new Set();
  return values.filter((value) => {
    if (value == null || value === "") return false;
    const key = typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decisionOutputContract(roleType) {
  if (roleType === "INTERVIEWER") {
    return `Decision-quality requirements:
- Infer what is already known; never ask a generic "tell me more" question.
- Ask only the single highest-information question that materially changes the recommendation.
- Make the question specific to the user's topic and explain why it matters.
- Offer 2-4 concise suggested answers when useful.
Return strict JSON with: question, whyItMatters, suggestedAnswers, isSatisfied, refinedTopic, confidenceScore.`;
  }
  if (roleType === "VERDICT") {
    return `Produce an executive decision brief, not a generic summary. Reconcile contradictions and distinguish facts from assumptions.
Return strict JSON with: decision, executiveSummary, rationale, keyClaims, recommendedActions, successMetrics, guardrails, alternatives, risks, assumptions, openQuestions, disagreements, confidence.
Actions must be specific and sequenced. Risks should include likelihood, impact, and mitigation where possible. Confidence must reflect evidence quality.`;
  }
  return `Produce decision-grade analysis. Be specific to the topic, quantify where evidence permits, and state uncertainty explicitly.
Return strict JSON with: shortSummary, decision, rationale, keyClaims, decisionCriteria, evidence, assumptions, risks, alternatives, recommendedActions, knowledgeGaps, agreements, disagreements, confidenceScore.
Do not repeat prior messages. Challenge unsupported claims and identify what evidence would change your recommendation.`;
}

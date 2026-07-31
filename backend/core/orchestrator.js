import { id, now } from "../db/sqlite.js";
import { LlmAdapter, callHermesWebhook } from "../adapters/llm.js";
import { writeToVault, searchVault } from "../adapters/obsidian.js";
import { AnythingLlmClient } from "../adapters/anythingllm.js";
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
  "PSYCHOLOGIST_MACHIAVELLI"
];


export class CouncilOrchestrator {
  constructor({ db, events, env = process.env }) {
    this.db = db;
    this.events = events;
    this.env = env;
    this.llm = new LlmAdapter({ db: this.db, env: this.env });
  }

  customPrompt(role, fallbackKey, context) {
    try {
      const roleKey = `PROMPT_${role.role_type}`;
      const row = this.db.prepare("select value from system_settings where key in (?, ?) and trim(value) <> '' order by case key when ? then 0 else 1 end limit 1")
        .get(roleKey, fallbackKey, roleKey);
      if (!row?.value?.trim()) return undefined;

      const priorMessages = Array.isArray(context.priorMessages)
        ? context.priorMessages.map((message) => `[${message.role_id} / ${message.model_name} (Round ${message.round_number})]: ${message.content}`).join("\n\n") || "None (First Round)"
        : String(context.priorMessages ?? "");
      const values = {
        role_display_name: role.display_name || role.role_type,
        role_type: role.role_type,
        topic: context.topic,
        round: context.round,
        priorMessages
      };
      return Object.entries(values).reduce(
        (prompt, [key, value]) => prompt.split(`{{${key}}}`).join(String(value ?? "")),
        row.value
      );
    } catch (_error) {
      return undefined;
    }
  }

  async createSession(input) {
    if (!input.topic || input.topic.length > 2000) throw Object.assign(new Error("Topic is required and must be <= 2000 chars."), { status: 400 });
    
    // Qualification Gate (Entropy Check)
    const settings = this.db.prepare("select key, value from system_settings").all().reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
    const entropyThreshold = parseInt(settings.ENTROPY_THRESHOLD || '30', 10);
    global.KELLY_PERCENT = parseInt(settings.KELLY_CIRCUIT_BREAKER_PERCENT || '5', 10);
    
    const entropy = await this.llm.checkEntropy(input.topic);
    if (entropy.entropyScore < entropyThreshold) {
      throw Object.assign(new Error(`Prompt rejected (Entropy: ${entropy.entropyScore} < ${entropyThreshold}). ${entropy.feedback}`), { status: 400 });
    }

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
    await this.handleFileAttachment(sessionId, input);
    const roles = council ? this.spawnStaticRoles(sessionId, council) : await this.spawnDynamicRoles(sessionId, input.topic, input);
    this.audit(sessionId, "session.created", { roles: roles.length, councilId: council?.id ?? null });
    if (input.autoStart !== false) setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);

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
    this.db.prepare(`insert into sessions(id, topic, status, mode, pipeline_id, stage_index, max_rounds, compact_internal, created_at, updated_at) values(?,?,?,?,?,?,?,?,?,?)`).run(
      sessionId, input.topic, "INTERVIEW", "pipeline", pipelineId, 0, 4, 1, now(), now()
    );
    this.emit("SESSION_CREATED", { sessionId, topic: input.topic, status: "INTERVIEW", pipelineId });
    await this.handleFileAttachment(sessionId, input);
    // Auto-fire the first interview question so the frontend receives it immediately
    setTimeout(() => this.processInterviewTurn(sessionId, "").catch(err => console.error("[Pipeline] First interview question failed:", err)), 50);
    return this.getSession(sessionId);


  }

  async processInterviewTurn(sessionId, userMessage, input = {}) {
    const session = this.getSession(sessionId);
    const turnId = id();
    this.db.prepare(`insert into interviews(id, session_id, user_message, created_at) values(?,?,?,?)`).run(turnId, sessionId, userMessage, now());
    
    if (input.fileData) {
      await this.handleFileAttachment(sessionId, input);
    }
    
    const priorInterviews = this.db.prepare(`select * from interviews where session_id = ? order by created_at`).all(sessionId);
    const priorMessages = priorInterviews.map(i => `User: ${i.user_message}\nInterviewer: ${i.llm_response || ""}`).join("\n");
    
    const modelName = selectModel({ role_type: "SYNTHESIST" }, this.env);
    const role = { role_type: "INTERVIEWER", display_name: "Lead Synthesist (Interviewer)", model_name: modelName };
    const customPrompt = this.customPrompt(role, "PROMPT_INTERVIEWER", { topic: session.topic, round: "Interview", priorMessages });
    const result = await this.llm.complete({ role, topic: session.topic, round: "Interview", priorMessages, compact: false, customPrompt });

    const payload = result.payload || {};
    
    this.db.prepare(`update interviews set llm_response = ?, is_satisfied = ?, refined_topic = ? where id = ?`).run(
      payload.question || "I understand.", payload.isSatisfied ? 1 : 0, payload.refinedTopic || null, turnId
    );

    this.emit("INTERVIEW_QUESTION", { sessionId, question: payload.question, isSatisfied: payload.isSatisfied });

    if (payload.isSatisfied) {
      this.updateSession(sessionId, { topic: payload.refinedTopic || session.topic, status: "CREATED" });
      const roles = await this.spawnDynamicRoles(sessionId, session.topic);
      this.emit("SESSION_STATE_CHANGED", { sessionId, status: "CREATED" });
      setTimeout(() => this.runSession(sessionId).catch((error) => this.fail(sessionId, error)), 10);
    }
  }

  async spawnDynamicRoles(sessionId, topic, input = {}) {
    const needsWeb = input.allowWebSearch !== false;
    const needsRag = input.allowRag !== false;
    
    // Token Economist (Affordability Engine)
    const isLargeContext = topic.length > 5000;
    
    // Progressive Deliberation (Tiered Routing)
    const complexityScore = this.complexity(topic);
    let tier = 1; // 1 = Single Expert
    if (complexityScore >= 2) tier = 2; // 2 = Expert + Skeptic
    if (complexityScore >= 3) tier = 3; // 3 = Full Council
    if (complexityScore >= 6) tier = 4; // 4 = Extinction/Simulation

    const baseRoles = [];
    
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
    
    if (tier >= 2) {
      baseRoles.push(role("SKEPTIC", "Skeptic", 3, "TRAINING"));
    }
    
    if (tier >= 3) {
      if (needsWeb) baseRoles.push(role("WEB_RESEARCHER", "Web Researcher", 4, "WEBSEARCH"));
      if (marketingTrigger(topic) || tier >= 3) baseRoles.push(role("MARKETING_SALES", "Growth & Marketing Strategist", 5, "HYBRID"));
      if (psychologistTrigger(topic)) baseRoles.push(role("PSYCHOLOGIST_MACHIAVELLI", "Psychologist / Machiavelli", 6, "TRAINING"));
      baseRoles.push(role("RISK_OFFICER", "Risk Officer", 7, "HYBRID"));
    }
    
    if (tier >= 4) {
      baseRoles.push(role("DOOM_COUNCIL", "Regulatory Assassin", 8, "TRAINING"));
    }

    const plan = baseRoles.slice(0, 8);

    // Router LLM Logic: Dynamically assign models to each role
    if (this.env.PROVIDER_MODE !== "mock") {
      try {
        const routerRole = { role_type: "ROUTER", display_name: "Router", model_name: this.env.LOCAL_ROUTER_MODEL || this.env.OPENAI_MODEL || "gpt-4o-mini" };
        const requiredRolesList = plan.map(r => r.role_type);
        const customPrompt = `You are the resource router for Synod Council. Assign the most optimal, cost-effective LLM model for each of the following roles based on their complexity.
The topic is: "${topic}".
The available models to choose from are: [gpt-4o, claude-3-5-sonnet, gemini-1.5-pro, qwen2.5-72b-instruct, llama-3-8b].
The roles are: ${JSON.stringify(requiredRolesList)}.
You must respond strictly with a JSON object where keys are role_types and values are model_names. (e.g. {"SYNTHESIST": "gpt-4o", "SKEPTIC": "llama-3-8b"}).
Do not output anything else.`;

        const routerResponse = await this.llm.complete({
          role: routerRole,
          topic: customPrompt,
          round: "Routing",
          priorMessages: [],
          compact: true,
          customPrompt
        });

        if (routerResponse && routerResponse.payload) {
          let routingMap = null;
          // Check if it got stuffed into shortSummary by the parser
          if (routerResponse.payload.shortSummary) {
            try {
              routingMap = JSON.parse(routerResponse.payload.shortSummary);
            } catch(e) {}
          }
          // If not, maybe the payload is the object directly
          if (!routingMap) {
            routingMap = routerResponse.payload;
          }
          
          if (routingMap) {
            for (const p of plan) {
              if (routingMap[p.role_type]) {
                p.model_name = routingMap[p.role_type];
              }
            }
            console.log("[Router LLM] Assigned models:", plan.map(p => `${p.role_type}=${p.model_name}`).join(", "));
          }
        }
      } catch (e) {
        console.warn("[Router LLM] Routing failed, falling back to defaults.", e.message);
      }
    }

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
        const safeName = `${id()}-${input.fileName || "upload"}`;
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
          const anythingLlm = new AnythingLlmClient();
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
    const session = this.db.prepare("select workspace_id from sessions where id = ?").get(sessionId);
    const dynamicWorkspaceId = session?.workspace_id ?? null;

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
        workspace_id: item.workspace_id ?? (["RAG", "HYBRID"].includes(item.knowledge_source_type) ? dynamicWorkspaceId : null),
        model_name: item.model_name ?? selectModel(item, this.env),
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
    const sessionForAnalysis = this.getSession(sessionId);
    this.emit("TOPIC_ANALYSED", { sessionId, complexity: this.complexity(sessionForAnalysis.topic) });

    // Memory Retrieval (Obsidian Search)
    try {
      const pastMemories = searchVault(sessionForAnalysis.topic);
      if (pastMemories && pastMemories.length > 0) {
        const memoryContent = `Obsidian Memory Context:\n` + pastMemories.map(m => `### Past Verdict File: ${m.file}\n${m.content}`).join("\n\n");
        const payload = {
          shortSummary: "Retrieved past relevant deliberations from Obsidian vault memory.",
          keyClaims: pastMemories.map(m => `Found relevant memory: ${m.file}`),
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
      for (const activeRole of roles) {
        const customPrompt = this.customPrompt(activeRole, "PROMPT_DELIBERATION", { topic: session.topic, round, priorMessages });
        const result = await this.llm.complete({ role: activeRole, topic: session.topic, round, priorMessages, compact, customPrompt });
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
    const finalSession = this.getSession(sessionId);
    this.updateSession(sessionId, { status: "COMPLETED", verdict: JSON.stringify(verdict), consensus: verdict.confidence, completed_at: now() });
    
    // Save to Obsidian Vault
    try {
      writeToVault(sessionId, finalSession.topic, verdict);
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
      priorMessages: priorSummaries
    });
    
    let response;
    try {
      response = await this.llm.complete({
        role: verdictRole,
        topic: `Final Verdict for: ${session.topic}`,
        round: "Final",
        priorMessages: priorSummaries,
        compact: false,
        customPrompt
      });
    } catch (err) {
      response = { payload: {} };
    }

    const dissents = messages.filter((message) => message.dissent).map((message) => message.shortSummary);
    const finalClaims = response.payload?.keyClaims?.length ? response.payload.keyClaims : messages.flatMap((message) => message.keyClaims ?? []).slice(-8);

    if (session.pipeline_id) {
       this.emit("PIPELINE_STAGE_COMPLETE", { sessionId, nextStage: "Level 2: Execution Council" });
       
       // Cycle 3: Level 2 Execution Council
       // Dynamically identify required roles
       const requiredRolesPrompt = `Based on the final verdict: "${response.payload?.shortSummary}", identify 3 highly specialized real-world execution roles needed to implement this (e.g. 'Indian Commercial Law Expert', 'Marketing Director'). Output as a comma separated list.`;
       const rolesRes = await this.llm.complete({ role: { role_type: "SYSTEM", display_name: "System" }, topic: requiredRolesPrompt, round: "Execution_Roles", priorMessages: [], compact: true });
       const executionRoles = (rolesRes.payload?.shortSummary || "Deployment Engineer, Product Manager, Legal Advisor").split(",").map(r => r.trim());

       // Dynamically create and route AnythingLLM workspaces
       const anythingLlmClient = new AnythingLlmClient();
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
Consensus: ${response.payload?.shortSummary}`;
       
       const execRes = await this.llm.complete({ role: execRole, topic: orchestrationPrompt, round: "Execution", priorMessages: priorSummaries, compact: false });
       const payload = execRes.payload || { agentic_instructions: "Run setup script", required_workspaces: agenticWorkspaces };
       
       this.updateSession(sessionId, { execution_payload: JSON.stringify(payload) });
       
       const handoff = await callHermesWebhook(payload);
       this.updateSession(sessionId, { handoff_status: handoff.success ? "SUCCESS" : "FAILED" });
       this.emit("EXECUTION_HANDOFF", { sessionId, status: handoff.success ? "SUCCESS" : "FAILED", payload });
       this.emit("PIPELINE_STAGE_COMPLETE", { sessionId, nextStage: "Complete" });
    }

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

function selectModel(roleItem, env = process.env) {
  if (env.ANYTHINGLLM_API_KEY) return "anythingllm";
  if (env.PROVIDER_MODE && env.PROVIDER_MODE !== "mock") return env.PROVIDER_MODE;
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

function marketingTrigger(topic) {
  return /\b(market|marketing|sales|pricing|price|revenue|customer|acquisition|growth|launch|campaign|product|business|strategy|monetization|gated)\b/i.test(topic);
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

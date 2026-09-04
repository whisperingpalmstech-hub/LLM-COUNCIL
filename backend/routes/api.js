import express from "express";
import { AnythingLlmClient } from "../adapters/anythingllm.js";
import { SearchClient } from "../adapters/search.js";
import { getVaultStatus } from "../adapters/obsidian.js";
import { LlmResearcher } from "../core/llm_researcher.js";
import { LocalWhisperTranscriber } from "../adapters/transcription.js";
import crypto from "crypto";

export function createApiRouter({ db, events, orchestrator }) {
  const router = express.Router();
  const researcher = new LlmResearcher({ db });
  const transcriber = new LocalWhisperTranscriber({ env: orchestrator.env });


  router.get("/health", (_req, res) => res.json({ status: "ok", app: "Synod", mode: orchestrator.env.PROVIDER_MODE ?? "mock" }));

  router.get("/voice/status", (_req, res) => res.json(transcriber.status()));
  router.post("/voice/probe", async (_req, res, next) => {
    try { res.json(await transcriber.probe()); } catch (error) { next(error); }
  });
  router.post("/voice/transcribe", express.raw({ type: "audio/*", limit: "16mb" }), async (req, res, next) => {
    const controller = new AbortController();
    const abortTranscription = () => {
      if (!res.writableEnded) controller.abort("client-disconnected");
    };
    req.on("aborted", abortTranscription);
    res.on("close", abortTranscription);
    try {
      const binaryAudio = Buffer.isBuffer(req.body);
      res.json(await transcriber.transcribe(binaryAudio ? {
        audioBuffer: req.body,
        mimeType: req.get("content-type"),
        language: req.get("x-synod-language") || "auto",
        quality: req.get("x-synod-quality") || "standard",
        signal: controller.signal
      } : { ...(req.body || {}), quality: req.get("x-synod-quality") || req.body?.quality || "standard", signal: controller.signal }));
    } catch (error) { next(error); }
  });

  router.post("/brain/think", async (req, res, next) => {
    try {
      const { topic, idea, mode, maxRounds, tone, useMemory, desiredOutcome, personaBrief } = req.body;
      const targetTopic = topic || idea;
      if (!targetTopic) {
        return res.status(400).json({ error: "topic or idea is required" });
      }

      const session = await orchestrator.createSession({
        topic: targetTopic,
        mode: mode || "standard",
        maxRounds: maxRounds || 3,
        tone,
        useMemory,
        desiredOutcome,
        personaBrief,
        autoStart: false
      });

      await orchestrator.runSession(session.id);
      const completedSession = orchestrator.getSession(session.id);
      
      res.json({
        sessionId: completedSession.id,
        topic: completedSession.topic,
        status: completedSession.status,
        verdict: completedSession.verdict,
        executionPayload: completedSession.execution_payload ? JSON.parse(completedSession.execution_payload) : null,
        consensus: completedSession.consensus
      });
    } catch (error) {
      next(error);
    }
  });


  router.post("/sessions", async (req, res, next) => {
    try {
      const session = await orchestrator.createSession(req.body);
      res.status(201).json(session);
    } catch (error) {
      next(error);
    }
  });

  router.post("/pipelines", async (req, res, next) => {
    try {
      const pipeline = await orchestrator.startPipeline(req.body);
      res.status(201).json(pipeline);
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:id/interview", async (req, res, next) => {
    try {
      const result = await orchestrator.processInterviewTurn(req.params.id, req.body.message, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:id/start", (req, res, next) => {
    try {
      res.json(orchestrator.startSession(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:id/budget-approval", (req, res, next) => {
    try { res.json(orchestrator.approveBudget(req.params.id, req.body?.budgetLimitUsd)); } catch (error) { next(error); }
  });

  router.post("/sessions/:id/outcome", async (req, res, next) => {
    try {
      const result = await orchestrator.processExecutionOutcome(req.params.id, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", (req, res, next) => {
    try {
      const rows = db.prepare("select key, value from system_settings").all();
      const settings = {};
      rows.forEach((row) => {
        settings[row.key] = isSensitiveSetting(row.key) && row.value ? "__CONFIGURED__" : row.value;
      });
      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  router.post("/settings", async (req, res, next) => {
    try {
      const stmt = db.prepare("insert or replace into system_settings (key, value) values (?, ?)");
      for (const [key, value] of Object.entries(req.body)) {
        if (key !== "AVATAR_VIDEO_DATA" && !(isSensitiveSetting(key) && (!String(value).trim() || value === "__CONFIGURED__"))) {
          stmt.run(key, String(value));
        }
      }
      
      if (req.body.AVATAR_VIDEO_DATA) {
        const matches = req.body.AVATAR_VIDEO_DATA.match(/^data:video\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const buffer = Buffer.from(matches[2], "base64");
          if (buffer.length > 8 * 1024 * 1024) {
            throw Object.assign(new Error("Avatar video must be 8 MB or smaller."), { status: 413 });
          }
          const fs = await import("node:fs");
          const uploadDir = "./data/uploads";
          if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
          fs.writeFileSync("./data/uploads/custom_avatar.mp4", buffer);
          stmt.run("AVATAR_VIDEO_URL", "/uploads/custom_avatar.mp4");
        } else {
          throw Object.assign(new Error("Avatar video must be a valid video data URL."), { status: 400 });
        }
      }
      
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions", (req, res) => res.json({ sessions: orchestrator.listSessions({ state: req.query.state }) }));
  router.get("/conversations", (req, res) => res.json({ conversations: orchestrator.listConversations({ state: req.query.state }) }));
  router.get("/conversations/:id", (req, res, next) => {
    try { res.json(orchestrator.getConversation(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/conversations/:id/archive", (req, res, next) => {
    try { res.json(orchestrator.archiveConversation(req.params.id)); } catch (error) { next(error); }
  });
  router.post("/conversations/:id/restore", (req, res, next) => {
    try { res.json(orchestrator.restoreConversation(req.params.id)); } catch (error) { next(error); }
  });
  router.patch("/conversations/:id", (req, res, next) => {
    try { res.json(orchestrator.renameConversation(req.params.id, req.body?.title)); } catch (error) { next(error); }
  });
  router.get("/conversations/:id/export", (req, res, next) => {
    try {
      const conversation = orchestrator.getConversation(req.params.id);
      res.setHeader("Content-Disposition", `attachment; filename="synod-conversation-${req.params.id}.json"`);
      res.json({ exportedAt: new Date().toISOString(), conversation });
    } catch (error) { next(error); }
  });
  router.delete("/conversations/:id", (req, res, next) => {
    try { res.json(orchestrator.deleteConversation(req.params.id)); } catch (error) { next(error); }
  });
  router.get("/sessions/:id", (req, res, next) => {
    try { res.json(orchestrator.getSession(req.params.id)); } catch (error) { next(error); }
  });
  router.get("/sessions/:id/messages", (req, res, next) => {
    try { res.json({ messages: orchestrator.messages(req.params.id) }); } catch (error) { next(error); }
  });
  router.get("/sessions/:id/cost", (req, res, next) => {
    try {
      const session = orchestrator.getSession(req.params.id);
      res.json({ estimatedCostUsd: session.estimated_cost_usd || 0, spentCostUsd: session.spent_cost_usd || 0, budgetLimitUsd: session.budget_limit_usd || 0, approvalRequired: Boolean(session.budget_approval_required), events: orchestrator.costEvents(req.params.id) });
    } catch (error) { next(error); }
  });
  router.get("/sessions/:id/interviews", (req, res, next) => {
    try { res.json({ interviews: orchestrator.interviews(req.params.id) }); } catch (error) { next(error); }
  });

  router.get("/sessions/:id/roles", (req, res, next) => {
    try { res.json({ roles: orchestrator.roles(req.params.id) }); } catch (error) { next(error); }
  });
  router.get("/sessions/:id/verdict", (req, res, next) => {
    try { res.json(orchestrator.getSession(req.params.id).verdict ?? {}); } catch (error) { next(error); }
  });
  router.get("/sessions/:id/transcript", (req, res, next) => {
    try { res.type("text/markdown").send(orchestrator.transcript(req.params.id)); } catch (error) { next(error); }
  });
  router.get("/sessions/:id/events", (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (event) => {
      if (event.sessionId !== req.params.id) return;
      res.write(`event: ${event.eventType}\nid: ${event.eventId}\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const names = ["SESSION_CREATED", "TOPIC_ANALYSED", "ROLE_ACTIVATED", "SEARCH_QUERY_ISSUED", "AMBIGUITY_DETECTED", "ROLE_MESSAGE", "CLARIFICATION_NEEDED", "CLARIFICATION_ANSWERED", "VETO_TRIGGERED", "DISSENSUS_BUDGET_EXCEEDED", "ARBITRATION_REQUESTED", "SESSION_PAUSED", "SESSION_RESUMED", "SESSION_STATE_CHANGED", "ROUND_COMPLETE", "CONSENSUS_UPDATE", "SESSION_COMPLETE", "SESSION_ERROR", "INTERVIEW_QUESTION", "PIPELINE_STAGE_COMPLETE", "EXECUTION_HANDOFF"];
    names.forEach((name) => events.on(name, send));
    req.on("close", () => names.forEach((name) => events.off(name, send)));
  });

  router.get("/councils", (_req, res) => res.json({ councils: orchestrator.listCouncils() }));
  router.post("/councils", (req, res, next) => {
    try { const council = orchestrator.createCouncil(req.body); res.status(201).json({ council_id: council.id, council }); } catch (error) { next(error); }
  });
  router.post("/councils/from-session/:id", (req, res, next) => {
    try { const council = orchestrator.importCouncil(req.params.id, req.body?.name); res.status(201).json({ council_id: council.id, council }); } catch (error) { next(error); }
  });

  router.get("/models", (_req, res) => res.json({ models: db.prepare("select * from models where active = 1").all() }));
  router.get("/workspaces", (_req, res) => res.json({ workspaces: db.prepare("select * from workspaces").all() }));
  router.get("/memory/status", (_req, res, next) => {
    try { res.json(getVaultStatus({ vaultPath: orchestrator.env.OBSIDIAN_VAULT_PATH })); } catch (error) { next(error); }
  });
  router.get("/settings/health", async (_req, res) => {
    const [llm, anythingllm, search] = await Promise.all([
      orchestrator.llm.health(),
      new AnythingLlmClient(orchestrator.env, { db }).health(),
      new SearchClient(orchestrator.env).health()
    ]);
    res.json({ ok: llm.ok, llm, anythingllm, search });
  });

  router.get("/research", (req, res, next) => {
    try {
      const recommendationsRow = db.prepare("select value from system_settings where key = 'LATEST_LLM_RECOMMENDATIONS'").get();
      const lastResearchTimeRow = db.prepare("select value from system_settings where key = 'LATEST_LLM_RESEARCH_TIME'").get();
      res.json({
        recommendations: recommendationsRow ? JSON.parse(recommendationsRow.value) : [],
        lastResearchTime: lastResearchTimeRow ? lastResearchTimeRow.value : null
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/research/run", async (req, res, next) => {
    try {
      const recommendations = await researcher.researchLatestModels();
      res.json({ success: true, recommendations });
    } catch (error) {
      next(error);
    }
  });

  router.post("/research/install", async (req, res, next) => {
    try {
      const { model_name, provider, type, reasoning_score } = req.body;
      if (!model_name || !provider) {
        return res.status(400).json({ error: "model_name and provider are required" });
      }

      if (provider === "ollama") {
        console.log(`[LLM Researcher] Triggering Ollama pull for model: ${model_name}`);
        const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
        fetch(`${ollamaUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model_name, stream: false })
        }).then(res => {
          if (!res.ok) console.error(`Ollama pull failed for ${model_name} with status ${res.status}`);
          else console.log(`[LLM Researcher] Successfully pulled model: ${model_name}`);
        }).catch(err => {
          console.error(`Ollama pull failed for ${model_name}:`, err.message);
        });
      }

      const existing = db.prepare("select id from models where model_name = ?").get(model_name);
      if (existing) {
        db.prepare("update models set provider = ?, reasoning_score = ?, active = 1 where model_name = ?")
          .run(provider, reasoning_score || 7, model_name);
      } else {
        const idStr = crypto.randomUUID();
        db.prepare(`insert into models (id, provider, model_name, display_name, supports_web, supports_rag, reasoning_score, cost_per_1k, active)
          values (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
          .run(idStr, provider, model_name, `${provider.toUpperCase()} ${model_name}`, 1, 1, reasoning_score || 7, provider === "ollama" ? 0 : 0.015);
      }

      res.json({ success: true, message: `Model ${model_name} installation triggered/registered.` });
    } catch (error) {
      next(error);
    }
  });


  router.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { message: error.message } }));
  return router;
}

function isSensitiveSetting(key) {
  return /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(key);
}

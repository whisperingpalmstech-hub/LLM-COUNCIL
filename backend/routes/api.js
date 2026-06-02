import express from "express";
import { AnythingLlmClient } from "../adapters/anythingllm.js";
import { SearchClient } from "../adapters/search.js";

export function createApiRouter({ db, events, orchestrator }) {
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ status: "ok", app: "Synod", mode: process.env.PROVIDER_MODE ?? "mock" }));

  router.post("/sessions", (req, res, next) => {
    try {
      res.status(201).json(orchestrator.createSession(req.body));
    } catch (error) {
      next(error);
    }
  });

  router.get("/sessions", (_req, res) => res.json({ sessions: orchestrator.listSessions() }));
  router.get("/sessions/:id", (req, res, next) => {
    try { res.json(orchestrator.getSession(req.params.id)); } catch (error) { next(error); }
  });
  router.get("/sessions/:id/messages", (req, res, next) => {
    try { res.json({ messages: orchestrator.messages(req.params.id) }); } catch (error) { next(error); }
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
    const names = ["SESSION_CREATED", "TOPIC_ANALYSED", "ROLE_ACTIVATED", "SEARCH_QUERY_ISSUED", "AMBIGUITY_DETECTED", "ROLE_MESSAGE", "CLARIFICATION_NEEDED", "CLARIFICATION_ANSWERED", "VETO_TRIGGERED", "DISSENSUS_BUDGET_EXCEEDED", "ARBITRATION_REQUESTED", "SESSION_PAUSED", "SESSION_RESUMED", "SESSION_STATE_CHANGED", "ROUND_COMPLETE", "CONSENSUS_UPDATE", "SESSION_COMPLETE", "SESSION_ERROR"];
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
  router.get("/settings/health", async (_req, res) => {
    const anything = await new AnythingLlmClient().health();
    const search = await new SearchClient().health();
    res.json({ llm: { ok: true, mode: process.env.PROVIDER_MODE ?? "mock" }, anythingllm: anything, search });
  });

  router.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: { message: error.message } }));
  return router;
}

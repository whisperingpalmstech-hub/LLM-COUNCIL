import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { openDatabase, migrate } from "../../backend/db/sqlite.js";
import { CouncilOrchestrator } from "../../backend/core/orchestrator.js";

const mockEnv = { ...process.env, PROVIDER_MODE: "mock", ANYTHINGLLM_API_KEY: "" };

function createOrchestrator(db) {
  return new CouncilOrchestrator({ db, events: new EventEmitter(), env: mockEnv });
}

test("compact internal communication payloads omit verbose reasoning", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = createOrchestrator(db);
  const session = await orchestrator.createSession({
    topic: "Should compact JSON be used?",
    maxRounds: 1,
    compactInternalCommunication: true,
    allowWebSearch: false,
    autoStart: false
  });
  await orchestrator.runSession(session.id);
  const messages = orchestrator.messages(session.id);
  assert.ok(messages.length >= 2);
  const payload = JSON.parse(messages[0].payload);
  assert.equal(payload.compact, true);
  assert.ok(Array.isArray(payload.keyClaims));
  assert.equal(payload.fullReasoning, undefined);
});

test("static council duplicate roles require display names", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = createOrchestrator(db);
  assert.throws(() => orchestrator.createCouncil({
    name: "Duplicate experts",
    role_manifest: [
      { role_type: "DOMAIN_EXPERT", priority: 1 },
      { role_type: "DOMAIN_EXPERT", priority: 2 }
    ]
  }), /display_name/);
});

test("psychologist role triggers for negotiation and persuasion topics", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = createOrchestrator(db);
  const session = await orchestrator.createSession({
    topic: "Negotiation and persuasion strategy without fear or greed manipulation",
    allowWebSearch: false,
    allowRag: false,
    maxRounds: 1,
    autoStart: false
  });
  await orchestrator.runSession(session.id);
  assert.ok(orchestrator.roles(session.id).some((role) => role.role_type === "PSYCHOLOGIST_MACHIAVELLI"));
  const payloads = orchestrator.messages(session.id).map((message) => JSON.parse(message.payload));
  assert.ok(payloads.some((payload) => payload.strategicFraming));
});

test("static council can chain an AnythingLLM workspace as a role model", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = createOrchestrator(db);
  const council = orchestrator.createCouncil({
    name: "Workspace Chain",
    role_manifest: [
      { role_type: "SYNTHESIST", display_name: "Lead", priority: 1, knowledge_source_type: "TRAINING", confidence_weight: 1 },
      { role_type: "DOMAIN_EXPERT", display_name: "Product Workspace Agent", priority: 2, knowledge_source_type: "RAG", workspace_id: "product", confidence_weight: 1.2 }
    ],
    model_overrides: { DOMAIN_EXPERT: "anythingllm" }
  });
  const session = await orchestrator.createSession({
    topic: "Should this council chain AnythingLLM workspaces?",
    councilId: council.id,
    maxRounds: 1,
    autoStart: false
  });
  await orchestrator.runSession(session.id);
  const workspaceRole = orchestrator.roles(session.id).find((role) => role.display_name === "Product Workspace Agent");
  assert.equal(workspaceRole.model_name, "anythingllm");
  const payloads = orchestrator.messages(session.id).map((message) => JSON.parse(message.payload));
  assert.ok(payloads.some((payload) => payload.knowledgeSourcesUsed?.some((source) => source.type === "ANYTHINGLLM_WORKSPACE" && source.workspaceId === "product")));
});

test("LlmResearcher researches latest models and writes them to settings", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const { LlmResearcher } = await import("../../backend/core/llm_researcher.js");
  const researcher = new LlmResearcher({ db });
  const recommendations = await researcher.researchLatestModels();
  assert.ok(recommendations.length > 0);
  assert.ok(recommendations[0].model_name);
  const stored = db.prepare("select value from system_settings where key = 'LATEST_LLM_RECOMMENDATIONS'").get();
  assert.ok(stored);
  const parsed = JSON.parse(stored.value);
  assert.equal(parsed.length, recommendations.length);
});


import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, migrate } from "../../backend/db/sqlite.js";
import { CouncilOrchestrator } from "../../backend/core/orchestrator.js";

const mockEnv = {
  ...process.env,
  PROVIDER_MODE: "mock",
  ANYTHINGLLM_API_KEY: "",
  OBSIDIAN_VAULT_PATH: mkdtempSync(path.join(os.tmpdir(), "synod-unit-vault-"))
};

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

test("conversation follow-ups retain the prior decision as scoped context", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = createOrchestrator(db);
  const first = await orchestrator.createSession({ topic: "Choose a first career step.", mode: "fast", maxRounds: 1, autoStart: false });
  await orchestrator.runSession(first.id);
  const completed = orchestrator.getSession(first.id);
  const followUp = await orchestrator.createSession({
    topic: "What should I do in the next 30 days?",
    mode: "fast",
    maxRounds: 1,
    conversationId: completed.conversation_id,
    followUpTo: completed.id,
    autoStart: false
  });
  assert.equal(followUp.conversation_id, completed.conversation_id);
  assert.ok(orchestrator.messages(followUp.id).some((message) => message.model_name === "conversation-context"));
});

test("conversation archive and restore are non-destructive and idempotent", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = createOrchestrator(db);
  const session = await orchestrator.createSession({ topic: "Preserve this decision trail.", mode: "fast", maxRounds: 1, autoStart: false });

  const archived = orchestrator.archiveConversation(session.conversation_id);
  assert.ok(archived.archived_at);
  assert.equal(orchestrator.archiveConversation(session.conversation_id).archived_at, archived.archived_at);
  assert.equal(orchestrator.listConversations({ state: "active" }).length, 0);
  assert.equal(orchestrator.listConversations({ state: "archived" }).length, 1);
  assert.equal(orchestrator.listSessions({ state: "archived" })[0].id, session.id);
  assert.equal(orchestrator.getSession(session.id).topic, session.topic);

  const restored = orchestrator.restoreConversation(session.conversation_id);
  assert.equal(restored.archived_at, null);
  assert.equal(orchestrator.restoreConversation(session.conversation_id).archived_at, null);
  assert.equal(orchestrator.listConversations({ state: "active" }).length, 1);
  assert.equal(orchestrator.listSessions({ state: "active" })[0].id, session.id);
});

test("budget caps pause deliberation for explicit approval instead of failing", async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  const orchestrator = new CouncilOrchestrator({ db, events: new EventEmitter(), env: { ...mockEnv, PROVIDER_MODE: "deepseek" } });
  const session = await orchestrator.createSession({ topic: "Assess a product launch risk profile.", mode: "fast", maxRounds: 2, autoStart: false });
  db.prepare("update sessions set budget_limit_usd = ? where id = ?").run(0.007, session.id);
  await orchestrator.runSession(session.id);
  const paused = orchestrator.getSession(session.id);
  assert.equal(paused.status, "AWAITING_BUDGET_APPROVAL");
  assert.equal(paused.budget_approval_required, 1);
  assert.ok(paused.spent_cost_usd > 0);
});

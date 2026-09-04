import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../../backend/app.js";
import { openDatabase } from "../../backend/db/sqlite.js";

const mockEnv = {
  ...process.env,
  PROVIDER_MODE: "mock",
  // Keep the integration suite independent of a developer's local deployment
  // credentials; the dedicated auth test below opts in explicitly.
  SYNOD_ACCESS_USERNAME: "",
  SYNOD_ACCESS_PASSWORD: "",
  ANYTHINGLLM_API_KEY: "",
  OBSIDIAN_VAULT_PATH: mkdtempSync(path.join(os.tmpdir(), "synod-test-vault-"))
};

test("full four-round Synod session completes with mock providers", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const created = await request(app)
    .post("/api/v1/sessions")
    .send({
      topic: "Should we adopt a multi-region deployment for the new product launch?",
      maxRounds: 4,
      compactInternalCommunication: true,
      autoStart: true
    })
    .expect(201);

  const id = created.body.id;
  let detail;
  for (let i = 0; i < 50; i += 1) {
    detail = (await request(app).get(`/api/v1/sessions/${id}`).expect(200)).body;
    if (detail.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(detail.status, "COMPLETED");
  assert.ok(detail.verdict.summary);
  assert.ok(detail.roles.length >= 4);
  const transcript = await request(app).get(`/api/v1/sessions/${id}/transcript`).expect(200);
  assert.match(transcript.text, /compact structured JSON/);
});

test("council create and import endpoints work", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const council = await request(app)
    .post("/api/v1/councils")
    .send({
      name: "Launch Board",
      role_manifest: [
        { role_type: "SYNTHESIST", display_name: "Lead Synthesist", priority: 1, knowledge_source_type: "TRAINING", confidence_weight: 1 },
        { role_type: "ETHICIST", display_name: "Ethics Reviewer", priority: 2, knowledge_source_type: "TRAINING", confidence_weight: 1 }
      ],
      hierarchy: { speaking_order: ["SYNTHESIST", "ETHICIST"], veto_roles: ["ETHICIST"] }
    })
    .expect(201);
  assert.ok(council.body.council_id);

  const session = await request(app).post("/api/v1/sessions").send({ topic: "Veto escalation topic", councilId: council.body.council_id, autoStart: false }).expect(201);
  const imported = await request(app).post(`/api/v1/councils/from-session/${session.body.id}`).send({ name: "Imported Board" }).expect(201);
  assert.ok(imported.body.council_id);
});

test("headless thinking endpoint /brain/think completes synchronously", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const response = await request(app)
    .post("/api/v1/brain/think")
    .send({
      idea: "Evaluate whether to use Svelte or React for a lightweight dashboard app",
      mode: "fast",
      maxRounds: 1
    })
    .expect(200);

  assert.equal(response.body.status, "COMPLETED");
  assert.ok(response.body.sessionId);
  assert.ok(response.body.verdict.summary);
});

test("prompt registry retrieves, edits, versions, and restores every model prompt", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const list = await request(app).get("/api/v1/prompts").expect(200);
  assert.ok(list.body.prompts.length >= 20);
  const target = list.body.prompts.find((prompt) => prompt.id === "role.risk_officer");
  assert.ok(target);
  const changed = await request(app).put(`/api/v1/prompts/${target.id}`).send({ promptText: `${target.promptText}\nCustom test rule.` }).expect(200);
  assert.equal(changed.body.version, target.version + 1);
  assert.equal(changed.body.customized, true);
  const restored = await request(app).post(`/api/v1/prompts/${target.id}/reset`).expect(200);
  assert.equal(restored.body.customized, false);
  assert.equal(restored.body.promptText, restored.body.defaultText);
});

test("automatic depth stays proportionate and completed decisions persist executor-ready plans", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const quick = await app.locals.orchestrator.createSession({ topic: "Just give me your view: tea or coffee?", autoStart: false });
  assert.equal(quick.mode, "fast");
  assert.equal(quick.max_rounds, 1);
  assert.ok(quick.roles.length <= 3);

  const deep = await app.locals.orchestrator.createSession({ topic: "Launch a regulated healthcare application in India and the UK with a £1,500 validation budget.", autoStart: false });
  assert.equal(deep.mode, "deep");
  assert.equal(deep.max_rounds, 3);
  assert.ok(deep.roles.some((role) => role.role_type === "COMPLIANCE_REVIEWER"));
  await app.locals.orchestrator.runSession(deep.id);
  const record = await request(app).get(`/api/v1/sessions/${deep.id}/execution-plan`).expect(200);
  assert.ok(record.body.plan.phases.length >= 2);
  assert.ok(record.body.plan.phases.every((phase) => phase.tasks.length && phase.acceptanceCriteria.length));
  assert.equal(record.body.executorHandoff.execution_authorized, false);
  assert.ok(Array.isArray(record.body.executorHandoff.human_approvals));
  assert.ok(record.body.readiness.overall > 0);
  await request(app).get(`/api/v1/sessions/${deep.id}/execution-plan.md`).expect(200).expect("Content-Type", /markdown/);
});

test("sessions snapshot companion context and let users disable Obsidian memory retrieval", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const session = await app.locals.orchestrator.createSession({
    topic: "Choose an unfamiliar launch strategy with no prior decision context.",
    mode: "fast",
    maxRounds: 1,
    tone: "focused",
    useMemory: false,
    desiredOutcome: "Choose one practical next step for the next 30 days.",
    personaBrief: "Challenge my assumptions without being dismissive.",
    autoStart: false
  });
  assert.equal(session.tone, "focused");
  assert.equal(session.use_memory, 0);
  assert.equal(session.desired_outcome, "Choose one practical next step for the next 30 days.");
  assert.equal(session.persona_brief, "Challenge my assumptions without being dismissive.");
  const prompt = app.locals.orchestrator.customPrompt(
    { role_type: "SYNTHESIST", display_name: "Lead Synthesist" },
    "PROMPT_DELIBERATION",
    {
      topic: session.topic,
      round: 1,
      priorMessages: [],
      tone: session.tone,
      desiredOutcome: session.desired_outcome,
      personaBrief: session.persona_brief
    }
  );
  assert.match(prompt, /Conversation contract/);
  assert.match(prompt, /direct, calm precision/i);
  assert.match(prompt, /Working outcome: Choose one practical next step for the next 30 days/);
  assert.match(prompt, /User's companion brief: Challenge my assumptions without being dismissive/);
  await app.locals.orchestrator.runSession(session.id);
  const messages = app.locals.orchestrator.messages(session.id);
  assert.equal(messages.some((message) => message.model_name === "obsidian-memory"), false);
});

test("settings never disclose or accidentally erase configured secrets", async () => {
  const db = openDatabase(":memory:");
  const app = await createApp({ db, env: mockEnv });
  db.prepare("insert into system_settings(key, value) values (?, ?)").run("DEEPSEEK_API_KEY", "private-test-key");

  const settings = await request(app).get("/api/v1/settings").expect(200);
  assert.equal(settings.body.DEEPSEEK_API_KEY, "__CONFIGURED__");
  assert.equal(settings.headers["x-content-type-options"], "nosniff");
  assert.equal(settings.headers["x-frame-options"], "DENY");

  await request(app).post("/api/v1/settings").send({
    DEEPSEEK_API_KEY: "__CONFIGURED__",
    DEEPSEEK_MODEL: "deepseek-chat"
  }).expect(200);
  assert.equal(db.prepare("select value from system_settings where key = ?").get("DEEPSEEK_API_KEY").value, "private-test-key");
  assert.equal(db.prepare("select value from system_settings where key = ?").get("DEEPSEEK_MODEL").value, "deepseek-chat");
});

test("Scout rejects non-canonical and command-like GitHub URLs before cloning", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  await request(app).post("/api/v1/scout/analyze").send({ url: "https://example.com/owner/repo" }).expect(400);
  await request(app).post("/api/v1/scout/analyze").send({ url: "https://github.com/owner/repo;touch-pwned" }).expect(400);
  await request(app).post("/api/v1/scout/analyze").send({ url: "https://github.com/owner/repo/issues" }).expect(400);
});

test("optional deployment authentication protects the UI and API but leaves health checks available", async () => {
  const app = await createApp({
    db: openDatabase(":memory:"),
    env: { ...mockEnv, SYNOD_ACCESS_USERNAME: "operator", SYNOD_ACCESS_PASSWORD: "secret-pass" }
  });
  await request(app).get("/api/v1/health").expect(200);
  await request(app).get("/").expect(401).expect("www-authenticate", /Basic/);
  await request(app).get("/api/v1/sessions").auth("operator", "wrong").expect(401);
  await request(app).get("/api/v1/sessions").auth("operator", "secret-pass").expect(200);
  await request(app).get("/api/v1/voice/status").expect(401);
  await request(app).get("/api/v1/voice/status").auth("operator", "secret-pass").expect(200);
});

test("conversation lifecycle API archives and restores without deleting evidence", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const created = await request(app).post("/api/v1/sessions").send({ topic: "Archive this evidence trail.", mode: "fast", maxRounds: 1, autoStart: false }).expect(201);
  const conversationId = created.body.conversation_id;

  await request(app).post(`/api/v1/conversations/${conversationId}/archive`).expect(200).expect((response) => assert.ok(response.body.archived_at));
  const active = await request(app).get("/api/v1/conversations?state=active").expect(200);
  const archived = await request(app).get("/api/v1/conversations?state=archived").expect(200);
  assert.equal(active.body.conversations.some((item) => item.id === conversationId), false);
  assert.equal(archived.body.conversations.some((item) => item.id === conversationId), true);
  await request(app).get(`/api/v1/sessions/${created.body.id}`).expect(200);

  await request(app).post(`/api/v1/conversations/${conversationId}/restore`).expect(200).expect((response) => assert.equal(response.body.archived_at, null));
  const restored = await request(app).get("/api/v1/conversations?state=active").expect(200);
  assert.equal(restored.body.conversations.some((item) => item.id === conversationId), true);
});

test("conversation lifecycle supports rename, export, and explicit permanent deletion", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const created = await request(app).post("/api/v1/sessions").send({ topic: "Lifecycle controls", mode: "fast", maxRounds: 1, autoStart: false }).expect(201);
  const conversationId = created.body.conversation_id;
  await request(app).patch(`/api/v1/conversations/${conversationId}`).send({ title: "Renamed decision" }).expect(200).expect((response) => assert.equal(response.body.title, "Renamed decision"));
  await request(app).get(`/api/v1/conversations/${conversationId}/export`).expect("Content-Type", /json/).expect(200).expect((response) => assert.equal(response.body.conversation.title, "Renamed decision"));
  await request(app).delete(`/api/v1/conversations/${conversationId}`).expect(200).expect((response) => assert.equal(response.body.deleted, true));
  await request(app).get(`/api/v1/conversations/${conversationId}`).expect(404);
});

test("high-complexity pipeline interview activates the catastrophe role without a partial transition", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const pipeline = await app.locals.orchestrator.startPipeline({
    topic: "Decide whether to build a regulated enterprise AI platform while protecting revenue, privacy, security, compliance, cash flow, customer trust, market position, and operational resilience."
  });
  await app.locals.orchestrator.processInterviewTurn(pipeline.id, "Success means validated demand and protected cash flow.");
  await app.locals.orchestrator.processInterviewTurn(pipeline.id, "Budget and privacy compliance are non-negotiable.");
  const transitioned = await app.locals.orchestrator.processInterviewTurn(pipeline.id, "We will compare a pilot, consulting growth, and deferral.");

  assert.notEqual(transitioned.status, "INTERVIEW");
  assert.ok(transitioned.roles.some((role) => role.role_type === "DOOM_COUNCIL"));
  assert.equal(new Set(transitioned.roles.map((role) => role.role_type)).size, transitioned.roles.length);
});

test("an interrupted deliberation resumes automatically without duplicating completed rounds", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const orchestrator = app.locals.orchestrator;
  const session = await orchestrator.createSession({
    topic: "Choose a reversible customer discovery pilot for a new workflow product.",
    mode: "fast",
    maxRounds: 1,
    autoStart: false
  });
  orchestrator.updateSession(session.id, { status: "DELIBERATING", current_round: 1 });
  assert.equal(orchestrator.recoverInterruptedSessions(), 1);

  let recovered;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    recovered = orchestrator.getSession(session.id);
    if (recovered.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(recovered.status, "COMPLETED");
  const roleMessages = orchestrator.messages(session.id).filter((message) => message.round_number === 1 && message.role_id);
  assert.equal(roleMessages.length, recovered.roles.length);
});

test("verdict provider failure synthesizes a specific decision from final council evidence", async () => {
  const app = await createApp({ db: openDatabase(":memory:"), env: mockEnv });
  const orchestrator = app.locals.orchestrator;
  orchestrator.llm.complete = async ({ role }) => {
    if (role.role_type === "VERDICT") {
      return {
        payload: { shortSummary: "Proceed with a bounded, measurable pilot before making an irreversible commitment.", decision: "Proceed with a bounded, measurable pilot before making an irreversible commitment.", confidence: 0.4 },
        warning: "Provider fallback: request timed out"
      };
    }
    return {
      payload: {
        confidence: 0.86,
        shortSummary: "Retention improvement is the highest-value near-term decision.",
        decision: "Improve retention in India and defer geographic expansion for 90 days.",
        rationale: "Reducing churn addresses negative net growth with lower cost and faster feedback.",
        keyClaims: ["Retention directly protects recurring revenue."],
        recommendedActions: ["Interview churned customers", "Fix the highest-frequency churn driver"],
        successMetrics: ["Monthly churn falls below 4%"],
        risks: ["Retention work may not change product-market fit"]
      }
    };
  };
  const session = await orchestrator.createSession({ topic: "Retention or expansion decision", mode: "fast", maxRounds: 1, autoStart: false });
  await orchestrator.runSession(session.id);
  const completed = orchestrator.getSession(session.id);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.verdict.decision, "Improve retention in India and defer geographic expansion for 90 days.");
  assert.deepEqual(completed.verdict.recommendedActions.slice(0, 2), ["Interview churned customers", "Fix the highest-frequency churn driver"]);
  assert.doesNotMatch(completed.verdict.decision, /bounded, measurable pilot/i);
});

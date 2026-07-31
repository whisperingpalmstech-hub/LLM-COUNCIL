import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../backend/app.js";
import { openDatabase } from "../../backend/db/sqlite.js";

const mockEnv = { ...process.env, PROVIDER_MODE: "mock", ANYTHINGLLM_API_KEY: "" };

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

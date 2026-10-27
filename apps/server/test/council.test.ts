import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CouncilConfig } from "@synod/contracts";
import { CouncilEngine } from "../src/council/engine.ts";
import { normalizePlan, extractJson } from "../src/council/plan.ts";
import { aggregateRankings, assignLabels, parseRanking } from "../src/council/ranking.ts";
import { openDatabase, Settings } from "../src/db/database.ts";
import { EventStore } from "../src/events/store.ts";
import { WebSearch } from "../src/integrations/search.ts";
import { MockProvider } from "../src/providers/mock.ts";
import { ProviderRegistry } from "../src/providers/registry.ts";
import { ProviderError, type CompletionRequest, type Provider } from "../src/providers/types.ts";

class FailingProvider implements Provider {
  readonly id = "openai" as const;
  calls = 0;
  configured() {
    return true;
  }
  defaultModel() {
    return "broken";
  }
  async complete(_r: CompletionRequest): Promise<string> {
    this.calls++;
    throw new ProviderError("openai HTTP 401: bad key", { status: 401 });
  }
}

function setup(options: { dbPath?: string; providers?: Provider[] } = {}) {
  const db = openDatabase(options.dbPath ?? ":memory:");
  const store = new EventStore(db);
  const providers = new ProviderRegistry(options.providers ?? [new MockProvider()], { maxRetries: 0 });
  const engine = new CouncilEngine({ store, providers, settings: new Settings(db), search: new WebSearch({}), obsidianVaultPath: null });
  return { db, store, engine };
}

const council = (overrides: Partial<CouncilConfig> = {}): CouncilConfig => ({
  members: [
    { id: "a", label: "Alpha", provider: "mock", model: "alpha" },
    { id: "b", label: "Beta", provider: "mock", model: "beta" },
    { id: "c", label: "Gamma", provider: "mock", model: "gamma" }
  ],
  chairman: { id: "chair", label: "Chair", provider: "mock", model: "chair" },
  clarify: false,
  executionPlan: true,
  webSearch: false,
  ...overrides
});

test("parseRanking reads the FINAL RANKING section and ignores invalid or duplicate labels", () => {
  const text = "Response A mentions Response C...\n\nFINAL RANKING:\n1. Response C\n2. **Response A**\n3. Response A\n4. Response Q";
  assert.deepEqual(parseRanking(text, ["Response A", "Response B", "Response C"]), ["Response C", "Response A"]);
});

test("aggregateRankings averages positions and sorts best first", () => {
  const responses = ["x", "y"].map((id) => ({ memberId: id, label: id.toUpperCase(), model: "m", text: "t", ms: 1 }));
  const labelled = assignLabels(responses);
  const result = aggregateRankings(
    [
      { memberId: "x", label: "X", text: "", ranking: ["Response B", "Response A"] },
      { memberId: "y", label: "Y", text: "", ranking: ["Response B", "Response A"] }
    ],
    labelled
  );
  assert.equal(result.rankings[0].memberId, "y");
  assert.equal(result.rankings[0].averageRank, 1);
  assert.deepEqual(result.labelToMemberId, { "Response A": "x", "Response B": "y" });
});

test("normalizePlan fills gaps and never authorizes execution", () => {
  const plan = normalizePlan(extractJson('Sure!\n```json\n{"decision":"go","phases":["Pilot it"],"confidence":80}\n```'), 3);
  assert.equal(plan.decision, "GO");
  assert.equal(plan.confidence, 0.8);
  assert.equal(plan.phases[0].tasks[0], "Pilot it");
  assert.equal(plan.version, 3);
  assert.equal(plan.executionAuthorized, false);
});

test("a full turn runs all three stages and a plan, recorded as events", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation();
  engine.sendMessage(id, "Should we migrate our monolith to services this year given a team of six engineers?");
  await engine.idle();

  const conversation = store.require(id);
  const turn = conversation.turns[0];
  assert.equal(turn.status, "completed", turn.error);
  assert.match(conversation.title, /^Should we migrate our monolith.*…$/);
  assert.ok(conversation.title.length <= 80);
  assert.equal(turn.stage1.length, 3);
  assert.equal(turn.stage2.length, 3);
  assert.ok(turn.stage2.every((r) => r.ranking.length === 3));
  assert.equal(turn.aggregate?.rankings.length, 3);
  assert.match(turn.synthesis?.text ?? "", /synthesis/i);
  assert.equal(turn.plan?.version, 1);
  assert.equal(turn.plan?.decision, "CONDITIONAL GO");
});

test("clarify pauses the turn until the user answers, and the answer reaches the council", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ clarify: true }));
  const id = engine.createConversation();
  engine.sendMessage(id, "Should I hire?");
  await engine.idle();
  let turn = store.require(id).turns[0];
  assert.equal(turn.status, "awaiting_clarification");
  assert.ok(turn.clarification?.question);
  assert.throws(() => engine.sendMessage(id, "another"), /still working/);

  engine.answerClarification(id, "Success means shipping v2 by March with a team of four.");
  await engine.idle();
  turn = store.require(id).turns[0];
  assert.equal(turn.status, "completed", turn.error);
  assert.equal(turn.clarification?.answer, "Success means shipping v2 by March with a team of four.");
});

test("a failing member is reported but does not sink the turn", async () => {
  const failing = new FailingProvider();
  const { engine, store } = setup({ providers: [new MockProvider(), failing] });
  engine.saveCouncil(
    council({
      members: [
        { id: "ok1", label: "OK 1", provider: "mock", model: "one" },
        { id: "ok2", label: "OK 2", provider: "mock", model: "two" },
        { id: "bad", label: "Broken", provider: "openai", model: "" }
      ]
    })
  );
  const id = engine.createConversation();
  engine.sendMessage(id, "A sufficiently detailed question about pricing strategy for a B2B SaaS product launch.");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.status, "completed", turn.error);
  assert.match(turn.stage1.find((r) => r.memberId === "bad")?.error ?? "", /401/);
  assert.equal(turn.stage2.length, 2, "only members that answered review");
  assert.equal(failing.calls, 1, "non-retryable errors are not retried");
});

test("when every member fails the turn fails with the reasons", async () => {
  const { engine, store } = setup({ providers: [new MockProvider(), new FailingProvider()] });
  engine.saveCouncil(council({ members: [{ id: "bad", label: "Broken", provider: "openai", model: "" }] }));
  const id = engine.createConversation();
  engine.sendMessage(id, "Anything at all, long enough to skip clarification by the mock provider.");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.status, "failed");
  assert.match(turn.error ?? "", /Broken: openai HTTP 401/);
});

test("the projection rebuilt from the database matches the live one; interrupted turns are closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synod-test-"));
  const dbPath = path.join(dir, "synod.sqlite");
  const first = setup({ dbPath });
  first.engine.saveCouncil(council());
  const id = first.engine.createConversation("Replay");
  first.engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
  await first.engine.idle();
  first.store.append({ type: "turn.started", conversationId: id, turnId: "stuck", prompt: "stuck", council: council() });
  const live = first.store.require(id);
  first.db.close();

  const second = setup({ dbPath });
  assert.deepEqual(second.store.require(id), live);
  assert.equal(second.engine.recoverInterrupted(), 1);
  assert.equal(second.store.require(id).turns[1].status, "failed");
  second.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cancel stops a running turn", async () => {
  const db = openDatabase(":memory:");
  const store = new EventStore(db);
  const engine = new CouncilEngine({
    store,
    providers: new ProviderRegistry([new MockProvider({ delayMs: 200 })]),
    settings: new Settings(db),
    search: new WebSearch({}),
    obsidianVaultPath: null
  });
  engine.saveCouncil(council());
  const id = engine.createConversation();
  engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
  engine.cancel(id);
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.status, "failed");
  assert.equal(turn.error, "Cancelled.");
  assert.equal(turn.stage1.length, 0);
});

test("invalid council configurations are rejected", () => {
  const { engine } = setup();
  assert.throws(() => engine.saveCouncil(council({ members: [] })), /at least one member/);
  assert.throws(() => engine.saveCouncil(council({ members: [{ id: "x", label: "X", provider: "nope" as never, model: "" }] })), /Unknown provider/);
});

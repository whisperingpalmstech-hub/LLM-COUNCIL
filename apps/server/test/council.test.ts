import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { CouncilConfig } from "@synod/contracts";
import { CouncilEngine } from "../src/council/engine.ts";
import { extractJson, normalizeBrief } from "../src/council/brief.ts";
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
  auto: false,
  depth: "quick",
  members: [
    { id: "a", label: "Alpha", provider: "mock", model: "alpha" },
    { id: "b", label: "Beta", provider: "mock", model: "beta" },
    { id: "c", label: "Gamma", provider: "mock", model: "gamma" }
  ],
  chairman: { id: "chair", label: "Chair", provider: "mock", model: "chair" },
  clarify: false,
  brief: true,
  webSearch: false,
  discussion: { personas: false, rounds: 3, speakersPerRound: 3, speechLength: "short", voice: "natural" },
  ...overrides
});

test("parseRanking reads the FINAL RANKING section and ignores invalid or duplicate labels", () => {
  const text = "Response A mentions Response C...\n\nFINAL RANKING:\n1. Response C\n2. **Response A**\n3. Response A\n4. Response Q";
  assert.deepEqual(parseRanking(text, ["Response A", "Response B", "Response C"]), ["Response C", "Response A"]);
});

test("aggregateRankings ignores each reviewer's vote for itself and measures agreement", () => {
  const responses = ["x", "y", "z"].map((id) => ({ round: 1, memberId: id, label: id.toUpperCase(), model: "m", text: "t", ms: 1 }));
  const labelled = assignLabels(responses); // A=x, B=y, C=z
  const result = aggregateRankings(
    [
      { round: 1, memberId: "x", label: "X", text: "", ranking: ["Response A", "Response B", "Response C"] }, // self first, then y
      { round: 1, memberId: "y", label: "Y", text: "", ranking: ["Response B", "Response A", "Response C"] }, // self first, then x
      { round: 1, memberId: "z", label: "Z", text: "", ranking: ["Response C", "Response B", "Response A"] } // self first, then y
    ],
    labelled,
    2
  );
  assert.equal(result.round, 2);
  assert.equal(result.selfPreferred, 3);
  assert.equal(result.rankings[0].memberId, "y", "y is the best answer once self-votes are removed");
  assert.equal(result.rankings[0].averageRank, 1);
  assert.equal(result.agreement, 1, "both reviewers who could vote for y did");
});

test("normalizeBrief keeps the mode's sections in order and drops empty ones", () => {
  const brief = normalizeBrief(
    extractJson('Sure!\n```json\n{"verdict":"Likely pneumonia","confidence":80,"sections":[{"title":"Recommended workup","items":["Chest X-ray"]},{"title":"Differential diagnosis","items":[{"text":"CAP","level":"HIGH"}]}],"nextSteps":["Start antibiotics"]}\n```'),
    "medical",
    3
  );
  assert.equal(brief.confidence, 0.8);
  assert.deepEqual(brief.sections.map((s) => s.title), ["Differential diagnosis", "Recommended workup"]);
  assert.equal(brief.sections[0].items[0].level, "high");
  assert.equal(brief.nextSteps[0].urgency, "soon");
  assert.match(brief.caveats[0], /clinical judgment/);
  assert.equal(brief.version, 3);
});

test("a full turn runs all three stages and a plan, recorded as events", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation();
  await engine.sendMessage(id, "Should we migrate our monolith to services this year given a team of six engineers?");
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
  assert.equal(turn.brief?.version, 1);
  assert.equal(turn.brief?.mode, "general");
  assert.deepEqual(turn.brief?.sections.map((s) => s.title), ["Options considered", "Key risks"]);
});

test("clarify pauses the turn until the user answers, and the answer reaches the council", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ clarify: true }));
  const id = engine.createConversation();
  await engine.sendMessage(id, "Should I hire?");
  await engine.idle();
  let turn = store.require(id).turns[0];
  assert.equal(turn.status, "awaiting_clarification");
  assert.ok(turn.clarification?.question);
  await assert.rejects(() => engine.sendMessage(id, "another"), /still working/);

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
  await engine.sendMessage(id, "A sufficiently detailed question about pricing strategy for a B2B SaaS product launch.");
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
  await engine.sendMessage(id, "Anything at all, long enough to skip clarification by the mock provider.");
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
  await first.engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
  await first.engine.idle();
  first.store.append({ type: "turn.started", conversationId: id, turnId: "stuck", prompt: "stuck", mode: "general", council: council() });
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
  await engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
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

class SlowProvider implements Provider {
  readonly id = "gemini" as const;
  configured() {
    return true;
  }
  defaultModel() {
    return "slow";
  }
  complete(request: CompletionRequest): Promise<string> {
    return new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
    });
  }
}

test("a straggler is cut off once the rest of the council has answered", async () => {
  const db = openDatabase(":memory:");
  const store = new EventStore(db);
  const engine = new CouncilEngine({
    store,
    providers: new ProviderRegistry([new MockProvider(), new SlowProvider()], { maxRetries: 0 }),
    settings: new Settings(db),
    search: new WebSearch({}),
    obsidianVaultPath: null,
    stragglerGraceMs: 50
  });
  engine.saveCouncil(council({ members: [...council().members, { id: "slow", label: "Slow", provider: "gemini", model: "" }] }));
  const id = engine.createConversation();
  const started = Date.now();
  await engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.status, "completed", turn.error);
  assert.match(turn.stage1.find((r) => r.memberId === "slow")?.error ?? "", /Too slow/);
  assert.equal(turn.stage2.length, 3);
  assert.ok(Date.now() - started < 2000);
});

test("follow-up turns see earlier clarifying answers", async () => {
  const { buildContext } = await import("../src/council/prompts.ts");
  const { engine, store } = setup();
  engine.saveCouncil(council({ clarify: true }));
  const id = engine.createConversation();
  await engine.sendMessage(id, "Should I hire?");
  await engine.idle();
  engine.answerClarification(id, "We are a 12-person B2B SaaS company.");
  await engine.idle();
  await engine.sendMessage(id, "And what about contractors versus full-time employees for this?");
  await engine.idle();
  const turns = store.require(id).turns;
  assert.match(buildContext(turns[1], turns.slice(0, 1)).history, /12-person B2B SaaS/);
});

test("a medical case uses the medical council and brief sections", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "medical");
  await engine.sendMessage(id, "58M, 3 days of fever, productive cough, right basal crackles, SpO2 93% on air. CRP 140.");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.mode, "medical");
  assert.deepEqual(turn.brief?.sections.map((s) => s.title), ["Differential diagnosis", "Can't-miss diagnoses", "Recommended workup"]);
});

test("answers and the synthesis stream as drafts; the brief is built alongside the synthesis", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const keys = new Set<string>();
  store.subscribeDrafts((d) => keys.add(d.key));
  const id = engine.createConversation(undefined, "code");
  await engine.sendMessage(id, "Is it safe to run UPDATE orders SET status='paid' WHERE payment_id IS NOT NULL on a 40M row table?");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.status, "completed", turn.error);
  assert.ok(keys.has("stage1:a") && keys.has("stage1:c") && keys.has("synthesis"), [...keys].join(","));
  assert.deepEqual(turn.brief?.sections.map((s) => s.title), ["Bugs & risks", "Recommended changes", "Alternatives"]);
});

/** Records every request so tests can inspect prompts and images. */
class RecordingProvider extends MockProvider {
  requests: CompletionRequest[] = [];
  override async complete(request: CompletionRequest): Promise<string> {
    this.requests.push(request);
    return super.complete(request);
  }
}

test("standard depth runs answer, review, revise, review, verdict (5 rounds)", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ depth: "standard" }));
  const id = engine.createConversation();
  await engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.status, "completed", turn.error);
  assert.equal(turn.rounds, 5);
  assert.notEqual(turn.convergedEarly, true, "standard always does its one revision round");
  assert.deepEqual([...new Set(turn.stage1.map((r) => r.round))], [1, 2]);
  assert.deepEqual([...new Set(turn.stage2.map((r) => r.round))], [1, 2]);
  assert.equal(turn.aggregate?.round, 2);
});

test("thorough depth stops early when reviewers already agree", async () => {
  // Every mock reviewer ranks identically when the model names are equal, so the council converges.
  const { engine, store } = setup();
  engine.saveCouncil(
    council({
      depth: "thorough",
      members: [
        { id: "a", label: "A", provider: "mock", model: "same" },
        { id: "b", label: "B", provider: "mock", model: "same" },
        { id: "c", label: "C", provider: "mock", model: "same" }
      ]
    })
  );
  const id = engine.createConversation();
  await engine.sendMessage(id, "A long enough question to be answered straight away by the mock council.");
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.rounds, 7);
  assert.equal(turn.convergedEarly, true);
  assert.equal(Math.max(...turn.stage1.map((r) => r.round)), 2, "always revises once, then stops instead of a second revision");
  assert.ok(turn.brief);
});

test("every prompt carries today's date and the user's profile; images reach the models", async () => {
  const recorder = new RecordingProvider();
  const db = openDatabase(":memory:");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synod-img-"));
  fs.writeFileSync(path.join(dir, "scan.png"), Buffer.from("fake-png"));
  const store = new EventStore(db);
  const engine = new CouncilEngine({ store, providers: new ProviderRegistry([recorder], { maxRetries: 0 }), settings: new Settings(db), search: new WebSearch({}), obsidianVaultPath: null, uploadsDir: dir });
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "medical");
  store.append({ type: "attachment.added", conversationId: id, attachment: { id: "f", name: "scan.png", mimeType: "image/png", size: 8, url: "/uploads/scan.png", source: "upload", kind: "image" } });
  await engine.sendMessage(id, "What does this chest film show? 61M smoker, 6 weeks of cough.", {
    timezone: "Europe/London",
    profile: { profession: "clinician", specialty: "radiology", country: "United Kingdom", answerStyle: "concise" }
  });
  await engine.idle();
  const answer = recorder.requests.find((r) => r.purpose === "answer")!;
  assert.match(answer.messages[0].content, /Today is \w+day,? \d+ \w+ \d{4} \(Europe\/London\)/);
  assert.match(answer.messages[0].content, /clinician \(radiology\).*United Kingdom.*guidelines/s);
  assert.equal(answer.messages[0].images?.[0].data, Buffer.from("fake-png").toString("base64"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an auto case is routed to the right mode from its first message", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "auto");
  await engine.sendMessage(id, "The other party breached clause 7 of our supply contract. Can we sue for lost profits?");
  await engine.idle();
  assert.equal(store.require(id).mode, "legal");
  assert.equal(store.require(id).turns[0].mode, "legal");
});

async function discussionIdle(engine: CouncilEngine, store: EventStore, id: string) {
  for (let i = 0; i < 200 && store.require(id).chatBusy; i++) await new Promise((r) => setTimeout(r, 10));
  await engine.idle();
}

test("Discuss: the moderator picks who replies, models see each other, then the panel stops for the user", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "general", undefined, "chat");
  await engine.chat(id, "Should we hire a head of sales before product-market fit?");
  await discussionIdle(engine, store, id);
  const c = store.require(id);
  assert.equal(c.kind, "chat");
  assert.equal(c.chatBusy, false);
  assert.deepEqual(c.chat.map((m) => (m.author.kind === "user" ? "user" : m.author.memberId)), ["user", "a", "b"]);
  assert.match(c.chat[2].text, /Building on Alpha/, "the second speaker sees the first");
  assert.equal(c.notes[0].reason, "Two different angles");
  assert.equal(c.title, "Should we hire a head of sales before product-market fit?");
});

test("Discuss: @mentions go straight to that panellist", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "general", undefined, "chat");
  await engine.chat(id, "@Gamma what's the strongest counter-argument?");
  await discussionIdle(engine, store, id);
  const models = store.require(id).chat.filter((m) => m.author.kind === "model");
  assert.equal(models[0].author.kind === "model" && models[0].author.memberId, "c");
  assert.equal(store.require(id).notes[0].reason, "You asked them directly");
});

test("Discuss: wrap up turns the discussion into a brief", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "code", undefined, "chat");
  await assert.rejects(() => engine.wrapUp(id), /Discuss something first/);
  await engine.chat(id, "Monorepo or polyrepo for 4 teams?");
  await discussionIdle(engine, store, id);
  await engine.wrapUp(id);
  await engine.idle();
  const turn = store.require(id).turns[0];
  assert.equal(turn.wrapUp, true);
  assert.equal(turn.status, "completed", turn.error);
  assert.ok(turn.synthesis?.text);
  assert.ok(turn.brief);
  await assert.rejects(() => engine.chat(engine.createConversation(), "hi"), /isn't a discussion/);
});

test("@mentions resolve to the most specific panellist", async () => {
  const { mentioned } = await import("../src/council/discussion.ts");
  const members = [
    { id: "s", label: "Claude Sonnet 5.5", provider: "openrouter" as const, model: "" },
    { id: "o", label: "Claude Opus 5.5", provider: "openrouter" as const, model: "" },
    { id: "g", label: "Gemini 4 Argon", provider: "openrouter" as const, model: "" }
  ];
  assert.deepEqual(mentioned("@Claude Sonnet 5.5 is this right?", members).map((m) => m.id), ["s"]);
  assert.deepEqual(mentioned("@Gemini and @Claude Opus, thoughts?", members).map((m) => m.id), ["o", "g"]);
  assert.deepEqual(mentioned("@Claude what do you think?", members).map((m) => m.id), [], "ambiguous first name matches nobody");
  assert.deepEqual(mentioned("email me at x@gemini.com", members).map((m) => m.id), [], "not a mention");
});

test("Discuss: @everyone brings in the whole panel, and 'keep discussing' resumes without a user message", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council());
  const id = engine.createConversation(undefined, "general", undefined, "chat");
  await engine.chat(id, "@everyone one-line position and confidence, please.");
  await discussionIdle(engine, store, id);
  assert.deepEqual(store.require(id).chat.filter((m) => m.author.kind === "model").map((m) => m.author.kind === "model" && m.author.memberId), ["a", "b", "c"]);
  const before = store.require(id).chat.length;
  engine.continueDiscussion(id);
  await discussionIdle(engine, store, id);
  const after = store.require(id).chat;
  assert.equal(after.length, before + 1);
  assert.equal(after.at(-1)?.author.kind === "model" && after.at(-1)?.author.kind === "model" ? (after.at(-1)!.author as { memberId: string }).memberId : null, "c");
  assert.equal(store.require(id).notes.at(-1)?.reason, "Pushes the discussion forward");
});

test("intake asks up to 3 multiple-choice questions", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ clarify: true }));
  const id = engine.createConversation();
  await engine.sendMessage(id, "Should I hire?");
  await engine.idle();
  const c = store.require(id).turns[0].clarification!;
  assert.equal(c.questions?.length, 2);
  assert.deepEqual(c.questions?.[0], { id: "q1", question: "What would make this a success?", options: ["Lower cost", "Faster delivery", "Less risk"], multiple: true });
  assert.equal(c.questions?.[1].multiple, undefined);
  assert.match(c.question, /success.*decide/);
});

const withPersonas = { personas: true, rounds: 2, speakersPerRound: 2, speechLength: "medium", voice: "natural" } as const;

test("Discuss: the moderator casts personas, waits for approval, and the panel then speaks in character", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ discussion: withPersonas }));
  const id = engine.createConversation(undefined, "general", undefined, "chat");
  await engine.chat(id, "Should we hire a head of sales before product-market fit?");
  await discussionIdle(engine, store, id);
  let c = store.require(id);
  assert.equal(c.personaStatus, "proposed");
  assert.deepEqual(c.personas.map((p) => p.memberId), ["a", "b", "c"]);
  assert.equal(new Set(c.personas.map((p) => p.voice)).size, 3, "each persona gets its own voice");
  assert.equal(c.chat.length, 1, "nobody speaks before the cast is approved");
  assert.throws(() => engine.confirmPersonas(engine.createConversation(undefined, "general", undefined, "chat"), []), /no proposed panel/);

  // The user renames one persona, then starts the debate.
  engine.confirmPersonas(id, c.personas.map((p) => (p.memberId === "a" ? { ...p, name: "Priya Raman", stance: "x".repeat(900) } : p)));
  await discussionIdle(engine, store, id);
  c = store.require(id);
  assert.equal(c.personaStatus, "confirmed");
  assert.equal(c.personas[0].stance.length, 280, "edited text is length-limited");
  const first = c.chat[1];
  assert.equal(first.author.kind === "model" && first.author.persona, "Priya Raman");
  assert.match(c.chat[2].text, /Building on Priya Raman/, "the transcript uses persona names");
  assert.deepEqual([c.notes[0].round, c.notes[0].of], [1, 2]);

  // Panellists can be addressed by persona name.
  await engine.chat(id, "@Ines what's the downside?");
  await discussionIdle(engine, store, id);
  const last = store.require(id).chat.at(-1)!;
  assert.equal(last.author.kind === "model" && last.author.memberId, "c");
});

test("Discuss: recasting replaces the proposed panel; an empty confirmation runs without personas", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ discussion: withPersonas }));
  const id = engine.createConversation(undefined, "general", undefined, "chat");
  await engine.chat(id, "Monorepo or polyrepo?");
  await discussionIdle(engine, store, id);
  engine.recast(id, "make them engineers");
  await discussionIdle(engine, store, id);
  assert.equal(store.require(id).personaStatus, "proposed");
  engine.confirmPersonas(id, []);
  await discussionIdle(engine, store, id);
  const c = store.require(id);
  assert.deepEqual(c.personas, []);
  assert.match(c.chat[2].text, /Building on Alpha/);
  assert.throws(() => engine.recast(id, ""), /before the debate starts/);
});

test("Discuss: rounds and speakers per round bound how long the panel talks", async () => {
  const { engine, store } = setup();
  engine.saveCouncil(council({ discussion: { ...withPersonas, personas: false, rounds: 2, speakersPerRound: 1 } }));
  const id = engine.createConversation(undefined, "general", undefined, "chat");
  await engine.chat(id, "MOCK_SECOND_ROUND should we expand to Europe?");
  await discussionIdle(engine, store, id);
  const c = store.require(id);
  assert.deepEqual(c.chat.map((m) => (m.author.kind === "user" ? "user" : m.author.memberId)), ["user", "a", "c"], "one speaker per round, two rounds");
  assert.deepEqual(c.notes.map((n) => n.round), [1, 2]);
});

test("Knowledge bases: files are searched by relevance, small sources are given whole, and they reach the council", async () => {
  const { KnowledgeStore, htmlToText, parseWorkspaceLink, split } = await import("../src/integrations/knowledge.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synod-kb-"));
  const db = openDatabase(":memory:");
  const settings = new Settings(db);
  const knowledge = new KnowledgeStore(settings, dir);
  const user = { id: "u1", admin: false };
  const filler = Array.from({ length: 40 }, (_, i) => `Section ${i}. General onboarding notes about office hours, parking, and the canteen menu for week ${i}.`).join("\n\n");
  const handbook = `${filler}\n\nRefund policy: enterprise customers may cancel within 45 days for a full refund, approved by the finance director.\n\n${filler}`;
  const big = await knowledge.add(user, { kind: "file", fileName: "handbook.md", mimeType: "text/markdown", data: Buffer.from(handbook).toString("base64") });
  const small = await knowledge.add(user, { kind: "file", name: "House style", fileName: "style.txt", mimeType: "text/plain", data: Buffer.from("Always answer in British English.").toString("base64") });
  assert.equal(big.kind, "file");
  assert.equal(knowledge.list("someone-else").length, 0, "knowledge bases are private to their owner");

  const hits = await knowledge.search("u1", "What is the refund window for enterprise customers?");
  assert.equal(hits[0].title, "House style", "small sources are always included");
  assert.match(hits[1].snippet, /45 days/);
  assert.equal(hits[1].source, "knowledge");

  knowledge.update("u1", small.id, { enabled: false });
  assert.ok(!(await knowledge.search("u1", "refund")).some((h) => h.title === "House style"), "disabled sources are skipped");
  await assert.rejects(() => knowledge.add(user, { kind: "link", url: "http://127.0.0.1:9/secret" }), /private network/);
  await assert.rejects(() => knowledge.add(user, { kind: "link", url: "file:///etc/passwd" }), /valid link|private|find that address/);
  await knowledge.remove("u1", big.id);
  assert.equal(knowledge.list("u1").length, 1);

  assert.deepEqual(parseWorkspaceLink("http://localhost:3001/workspace/my-notes/t/abc"), { baseUrl: "http://localhost:3001", workspace: "my-notes" });
  assert.deepEqual(parseWorkspaceLink("kb.example.com", "Research"), { baseUrl: "http://kb.example.com", workspace: "Research" });
  assert.deepEqual(htmlToText("<html><title>Hi &amp; bye</title><script>x()</script><p>One</p><p>Two&nbsp;three</p></html>"), { title: "Hi & bye", text: "One\nTwo three" });
  assert.ok(split("a".repeat(5000)).every((c) => c.length <= 1200));

  // In a discussion, the panel is given the passages and the moderator's note says so.
  const store = new EventStore(db);
  const kb2 = new KnowledgeStore(settings, dir);
  await kb2.add(user, { kind: "file", name: "Pricing memo", fileName: "p.txt", mimeType: "text/plain", data: Buffer.from("Our floor price is 40 dollars per seat.").toString("base64") });
  const seen: string[] = [];
  class Spy extends MockProvider {
    override async complete(r: CompletionRequest) {
      if (r.purpose === "chat" || r.purpose === "answer") seen.push(r.messages.at(-1)!.content);
      return super.complete(r);
    }
  }
  const engine = new CouncilEngine({ store, providers: new ProviderRegistry([new Spy()], { maxRetries: 0 }), settings, search: new WebSearch({}), knowledge: kb2, obsidianVaultPath: null });
  engine.saveCouncil(council(), "u1");
  const id = engine.createConversation(undefined, "general", "u1", "chat");
  await engine.chat(id, "What discount can we offer?", { userId: "u1" });
  await discussionIdle(engine, store, id);
  assert.deepEqual(store.require(id).notes[0].knowledge, ["Pricing memo"]);
  assert.match(seen[0], /floor price is 40 dollars/);

  const caseId = engine.createConversation(undefined, "general", "u1");
  await engine.sendMessage(caseId, "What discount can we offer on a 200-seat deal next quarter?", { userId: "u1" });
  await engine.idle();
  assert.equal(store.require(caseId).turns[0].research[0].title, "Pricing memo");
  assert.match(seen.at(-1)!, /Pricing memo \(knowledge base\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

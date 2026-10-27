import crypto from "node:crypto";
import { CASE_MODES, PROVIDER_IDS, type CaseMode, type CouncilConfig, type CouncilMember, type Stage1Response, type Stage2Review, type Turn } from "@synod/contracts";
import type { Settings } from "../db/database.ts";
import type { EventStore } from "../events/store.ts";
import { writeTurnToVault } from "../integrations/obsidian.ts";
import type { WebSearch } from "../integrations/search.ts";
import { errorMessage } from "../providers/http.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import { extractJson, normalizeBrief } from "./brief.ts";
import { answerSystem, briefPrompt, buildContext, clarifyPrompt, questionBlock, reviewPrompt, synthesisPrompt, type TurnContext } from "./prompts.ts";
import { aggregateRankings, assignLabels, parseRanking } from "./ranking.ts";

const COUNCIL_SETTING = "council";

export interface EngineDeps {
  store: EventStore;
  providers: ProviderRegistry;
  settings: Settings;
  search: WebSearch;
  obsidianVaultPath: string | null;
  env?: Record<string, string | undefined>;
  /** Minimum time the last straggler gets after everyone else has finished a stage. */
  stragglerGraceMs?: number;
}

/**
 * The orchestration layer. Commands come in (send, answer, cancel); the engine
 * runs the council pipeline and records every step as an event:
 *
 *   clarify? → research? → stage 1 (independent answers, parallel)
 *            → stage 2 (anonymized peer ranking, parallel) → stage 3 (chairman synthesis)
 *            → execution plan?
 *
 * The engine holds no conversation state of its own; it reads projections from the store.
 */
export class CouncilEngine {
  private readonly deps: EngineDeps;
  private readonly running = new Map<string, AbortController>();

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  // ---- council configuration -------------------------------------------------

  council(): CouncilConfig {
    const saved = this.deps.settings.get<CouncilConfig>(COUNCIL_SETTING);
    // Re-validate so councils saved by older versions pick up new defaults.
    if (saved?.members?.length) return validateCouncil(saved);
    const { members, chairman } = this.deps.providers.defaultCouncil(this.deps.env);
    return { members, chairman, clarify: true, brief: true, webSearch: Boolean(this.deps.search.provider()) };
  }

  saveCouncil(input: CouncilConfig): CouncilConfig {
    const config = validateCouncil(input);
    this.deps.settings.set(COUNCIL_SETTING, config);
    return config;
  }

  // ---- commands --------------------------------------------------------------

  createConversation(title?: string, mode: CaseMode = "general"): string {
    const conversationId = crypto.randomUUID();
    this.deps.store.append({ type: "conversation.created", conversationId, title: cleanTitle(title) || "New conversation", mode: validMode(mode) });
    return conversationId;
  }

  setMode(conversationId: string, mode: CaseMode): void {
    const conversation = this.deps.store.require(conversationId);
    const next = validMode(mode);
    if (next !== conversation.mode) this.deps.store.append({ type: "conversation.mode_changed", conversationId, mode: next });
  }

  sendMessage(conversationId: string, prompt: string, override?: Partial<CouncilConfig>): string {
    const conversation = this.deps.store.require(conversationId);
    const text = prompt.trim();
    if (!text) throw badRequest("Message is required.");
    if (text.length > 20_000) throw badRequest("Message must be 20,000 characters or fewer.");
    const active = conversation.turns.at(-1);
    if (active && (active.status === "running" || active.status === "awaiting_clarification")) {
      throw Object.assign(new Error("The council is still working on the previous message."), { status: 409 });
    }
    const council = override ? validateCouncil({ ...this.council(), ...override }) : this.council();
    const turnId = crypto.randomUUID();
    if (!conversation.turns.length && conversation.title === "New conversation") {
      this.deps.store.append({ type: "conversation.renamed", conversationId, title: cleanTitle(text) });
    }
    this.deps.store.append({ type: "turn.started", conversationId, turnId, prompt: text, mode: conversation.mode, council });
    this.launch(conversationId, turnId);
    return turnId;
  }

  answerClarification(conversationId: string, answer: string): void {
    const turn = this.deps.store.require(conversationId).turns.at(-1);
    if (!turn || turn.status !== "awaiting_clarification") throw Object.assign(new Error("No clarifying question is waiting."), { status: 409 });
    this.deps.store.append({ type: "turn.clarification_answered", conversationId, turnId: turn.id, answer: answer.trim() || "(no answer — proceed with reasonable assumptions)" });
    this.launch(conversationId, turn.id);
  }

  cancel(conversationId: string): void {
    const turn = this.deps.store.require(conversationId).turns.at(-1);
    if (!turn || (turn.status !== "running" && turn.status !== "awaiting_clarification")) return;
    this.running.get(turn.id)?.abort();
    this.running.delete(turn.id);
    this.deps.store.append({ type: "turn.failed", conversationId, turnId: turn.id, error: "Cancelled." });
  }

  /** Turns that were mid-flight when the process died can't be resumed safely; close them out. */
  recoverInterrupted(): number {
    let count = 0;
    for (const conversation of this.deps.store.all()) {
      const turn = conversation.turns.at(-1);
      if (turn?.status === "running" && !this.running.has(turn.id)) {
        this.deps.store.append({ type: "turn.failed", conversationId: conversation.id, turnId: turn.id, error: "Interrupted by a server restart. Send the message again to retry." });
        count++;
      }
    }
    return count;
  }

  /** Resolves when no turn is running (tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running.size) await new Promise((r) => setTimeout(r, 10));
  }

  // ---- pipeline --------------------------------------------------------------

  private launch(conversationId: string, turnId: string): void {
    const controller = new AbortController();
    this.running.set(turnId, controller);
    void this.run(conversationId, turnId, controller.signal)
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error(`[council] turn ${turnId} failed`, error);
        this.deps.store.append({ type: "turn.failed", conversationId, turnId, error: errorMessage(error) });
      })
      .finally(() => {
        if (this.running.get(turnId) === controller) this.running.delete(turnId);
      });
  }

  private turn(conversationId: string, turnId: string): Turn {
    const turn = this.deps.store.require(conversationId).turns.find((t) => t.id === turnId);
    if (!turn) throw new Error(`Turn ${turnId} not found.`);
    return turn;
  }

  private async run(conversationId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const { store, providers, search } = this.deps;
    const emit = store.append.bind(store);
    const stage = (s: Turn["stage"] & string) => emit({ type: "turn.stage_started", conversationId, turnId, stage: s });
    const context = (): TurnContext => {
      const conversation = store.require(conversationId);
      const index = conversation.turns.findIndex((t) => t.id === turnId);
      return buildContext(conversation.turns[index], conversation.turns.slice(0, index));
    };
    let turn = this.turn(conversationId, turnId);
    const { members, chairman } = turn.council;
    const mode = turn.mode;

    // 0. Clarify — pause the turn and wait for the user if one question is essential.
    if (turn.council.clarify && !turn.clarification) {
      stage("clarify");
      const question = await this.clarifyingQuestion(chairman, context(), mode, signal);
      if (signal.aborted) return;
      if (question) {
        emit({ type: "turn.clarification_requested", conversationId, turnId, question });
        return;
      }
    }

    // Optional web research shared by every member.
    if (turn.council.webSearch && search.provider() && !turn.research.length) {
      stage("research");
      try {
        const results = await search.search(turn.prompt, signal);
        emit({ type: "turn.research_completed", conversationId, turnId, results });
      } catch (error) {
        console.warn("[council] web search failed:", errorMessage(error));
      }
    }
    if (signal.aborted) return;

    // 1. Independent answers.
    stage("stage1");
    const question = questionBlock(context());
    const draft = (key: string) => throttle((text: string) => store.publishDraft({ type: "draft", conversationId, turnId, key, text }), 120);
    await withStragglerCutoff(
      members,
      signal,
      this.deps.stragglerGraceMs,
      async (member, memberSignal) => {
        const started = Date.now();
        let response: Stage1Response;
        try {
          const text = await providers.complete(member, { purpose: "answer", system: answerSystem(mode), messages: [{ role: "user", content: question }], signal: memberSignal, onText: draft(`stage1:${member.id}`) });
          response = { memberId: member.id, label: member.label, model: modelName(member), text, ms: Date.now() - started };
        } catch (error) {
          response = { memberId: member.id, label: member.label, model: modelName(member), text: "", error: memberError(error, memberSignal), ms: Date.now() - started };
        }
        if (!signal.aborted) emit({ type: "turn.stage1_response", conversationId, turnId, response });
      }
    );
    if (signal.aborted) return;
    turn = this.turn(conversationId, turnId);
    const answered = turn.stage1.filter((r) => !r.error);
    if (!answered.length) throw new Error(`No council member could answer: ${turn.stage1.map((r) => `${r.label}: ${r.error}`).join("; ")}`);

    // 2. Anonymized peer review. Skipped when only one member answered.
    const labelled = assignLabels(answered);
    if (labelled.length > 1) {
      stage("stage2");
      const prompt = reviewPrompt(context(), labelled.map((l) => ({ label: l.label, text: l.response.text })));
      const validLabels = labelled.map((l) => l.label);
      const reviewers = members.filter((m) => answered.some((r) => r.memberId === m.id));
      await withStragglerCutoff(
        reviewers,
        signal,
        this.deps.stragglerGraceMs,
        async (member, memberSignal) => {
          let review: Stage2Review;
          try {
            const text = await providers.complete(member, { purpose: "review", messages: [{ role: "user", content: prompt }], signal: memberSignal });
            review = { memberId: member.id, label: member.label, text, ranking: parseRanking(text, validLabels) };
          } catch (error) {
            review = { memberId: member.id, label: member.label, text: "", ranking: [], error: memberError(error, memberSignal) };
          }
          if (!signal.aborted) emit({ type: "turn.stage2_review", conversationId, turnId, review });
        }
      );
      if (signal.aborted) return;
      turn = this.turn(conversationId, turnId);
      emit({ type: "turn.stage2_aggregated", conversationId, turnId, aggregate: aggregateRankings(turn.stage2.filter((r) => !r.error), labelled) });
    }

    // 3. Chairman synthesis and the structured brief, in parallel: both read the
    //    same answers and critiques, so neither has to wait for the other.
    stage("stage3");
    turn = this.turn(conversationId, turnId);
    const reviews = turn.stage2.filter((r) => !r.error);
    const ranking = (turn.aggregate?.rankings ?? []).map((r) => r.label).join(" > ");

    const synthesis = (async () => {
      try {
        const text = await providers.complete(chairman, {
          purpose: "synthesis",
          messages: [{ role: "user", content: synthesisPrompt(context(), answered, reviews) }],
          signal,
          onText: draft("synthesis")
        });
        if (!signal.aborted) emit({ type: "turn.synthesis_completed", conversationId, turnId, synthesis: { memberId: chairman.id, label: chairman.label, model: modelName(chairman), text } });
      } catch (error) {
        if (signal.aborted) return;
        // Degrade to the top-ranked answer rather than losing the turn.
        const best = turn.aggregate?.rankings[0]?.memberId;
        const fallback = answered.find((r) => r.memberId === best) ?? answered[0];
        emit({
          type: "turn.synthesis_completed",
          conversationId,
          turnId,
          synthesis: { memberId: fallback.memberId, label: fallback.label, model: fallback.model, text: fallback.text, error: `Chairman failed (${errorMessage(error)}); showing the top-ranked answer instead.` }
        });
      }
    })();

    const brief = (async () => {
      if (!turn.council.brief) return;
      try {
        const reply = await providers.complete(chairman, { purpose: "brief", json: true, messages: [{ role: "user", content: briefPrompt(context(), mode, answered, reviews, ranking) }], signal });
        const version = store.require(conversationId).turns.filter((t) => t.brief).length + 1;
        if (!signal.aborted) emit({ type: "turn.brief_generated", conversationId, turnId, brief: normalizeBrief(extractJson(reply), mode, version) });
      } catch (error) {
        if (!signal.aborted) console.warn("[council] brief generation failed:", errorMessage(error));
      }
    })();

    await Promise.all([synthesis, brief]);
    if (signal.aborted) return;

    emit({ type: "turn.completed", conversationId, turnId });

    if (this.deps.obsidianVaultPath) {
      const conversation = store.require(conversationId);
      writeTurnToVault(this.deps.obsidianVaultPath, conversation, this.turn(conversationId, turnId)).catch((error) =>
        console.warn("[obsidian] write failed:", errorMessage(error))
      );
    }
  }

  private async clarifyingQuestion(chairman: CouncilMember, ctx: TurnContext, mode: CaseMode, signal: AbortSignal): Promise<string | null> {
    try {
      const reply = await this.deps.providers.complete(chairman, { purpose: "clarify", json: true, messages: [{ role: "user", content: clarifyPrompt(ctx, mode) }], signal });
      const parsed = extractJson(reply) as { needed?: unknown; question?: unknown };
      const question = typeof parsed.question === "string" ? parsed.question.trim() : "";
      return parsed.needed === true && question ? question.slice(0, 500) : null;
    } catch (error) {
      // Clarification is a nicety; never block the council on it.
      if (!signal.aborted) console.warn("[council] clarify step skipped:", errorMessage(error));
      return null;
    }
  }
}

/** Call `fn` at most every `ms`, always delivering the latest value. */
function throttle(fn: (text: string) => void, ms: number): (text: string) => void {
  let last = 0;
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (text) => {
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn(text);
      return;
    }
    pending = text;
    timer ??= setTimeout(() => {
      timer = undefined;
      last = Date.now();
      if (pending !== null) fn(pending);
      pending = null;
    }, wait);
  };
}

/**
 * Run one task per member in parallel. Once all but one have finished, the last
 * straggler gets a grace period (half the elapsed time, at least 20 s) and is then
 * cancelled, so one slow model can't hold the whole council hostage.
 */
async function withStragglerCutoff<T extends { id: string }>(
  items: T[],
  signal: AbortSignal,
  minGraceMs = 20_000,
  task: (item: T, memberSignal: AbortSignal) => Promise<void>
): Promise<void> {
  const started = Date.now();
  const controllers = items.map(() => new AbortController());
  let done = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.all(
    items.map(async (item, i) => {
      await task(item, AbortSignal.any([signal, controllers[i].signal]));
      done++;
      if (items.length > 2 && done === items.length - 1) {
        const grace = Math.max(minGraceMs, (Date.now() - started) / 2);
        timer = setTimeout(() => controllers.forEach((c) => c.abort(new StragglerCutoff(grace))), grace);
      }
    })
  );
  clearTimeout(timer);
}

class StragglerCutoff extends Error {
  constructor(graceMs: number) {
    super(`Too slow: the council moved on ${Math.round(graceMs / 1000)}s after the others finished.`);
  }
}

function memberError(error: unknown, memberSignal: AbortSignal): string {
  return memberSignal.reason instanceof StragglerCutoff ? memberSignal.reason.message : errorMessage(error);
}

function validateCouncil(input: CouncilConfig): CouncilConfig {
  const members = Array.isArray(input.members) ? input.members.map(validateMember) : [];
  if (!members.length) throw badRequest("A council needs at least one member.");
  if (members.length > 8) throw badRequest("A council can have at most 8 members.");
  if (new Set(members.map((m) => m.id)).size !== members.length) throw badRequest("Council member ids must be unique.");
  if (!input.chairman) throw badRequest("A chairman is required.");
  return {
    members,
    chairman: validateMember(input.chairman),
    clarify: Boolean(input.clarify),
    brief: input.brief !== false,
    webSearch: Boolean(input.webSearch)
  };
}

function validateMember(m: CouncilMember): CouncilMember {
  if (!m || typeof m !== "object") throw badRequest("Invalid council member.");
  const id = String(m.id ?? "").trim().slice(0, 64);
  const label = String(m.label ?? "").trim().slice(0, 64);
  if (!id || !label) throw badRequest("Each council member needs an id and a label.");
  if (!PROVIDER_IDS.includes(m.provider)) throw badRequest(`Unknown provider: ${String(m.provider)}`);
  return { id, label, provider: m.provider, model: String(m.model ?? "").trim().slice(0, 200) };
}

function validMode(mode: unknown): CaseMode {
  return CASE_MODES.includes(mode as CaseMode) ? (mode as CaseMode) : "general";
}

function modelName(member: CouncilMember): string {
  return member.model ? `${member.provider}/${member.model}` : member.provider;
}

function cleanTitle(value?: string): string {
  const line = String(value ?? "").trim().split("\n")[0];
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

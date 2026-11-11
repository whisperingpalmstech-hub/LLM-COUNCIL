import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CASE_MODES,
  DEPTH_ROUNDS,
  DEPTHS,
  DEFAULT_DISCUSSION,
  PROVIDER_IDS,
  SPEECH_LENGTHS,
  depthCycles,
  type CaseContext,
  type CaseMode,
  type CouncilConfig,
  type ChatMessage,
  type CouncilMember,
  type IntakeQuestion,
  type Depth,
  type DiscussionSettings,
  type Persona,
  type SearchResult,
  type Stage1Response,
  type Stage2Review,
  type Turn,
  type UserProfile
} from "@synod/contracts";
import type { Settings } from "../db/database.ts";
import type { EventStore } from "../events/store.ts";
import { writeTurnToVault } from "../integrations/obsidian.ts";
import type { KnowledgeStore } from "../integrations/knowledge.ts";
import type { WebSearch } from "../integrations/search.ts";
import { errorMessage } from "../providers/http.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import type { ImageInput } from "../providers/types.ts";
import { extractJson, normalizeBrief } from "./brief.ts";
import { castingPrompt, chatSystem, chatTurnPrompt, mentioned, moderatorPrompt, nameOf, normalizePersonas, wrapUpPrompt } from "./discussion.ts";
import { aboutBlock, answerSystem, briefPrompt, buildContext, clarifyPrompt, classifyPrompt, questionBlock, revisePrompt, reviewPrompt, synthesisPrompt, type TurnContext } from "./prompts.ts";
import { aggregateRankings, assignLabels, parseRanking } from "./ranking.ts";
import { CLASSIFIER, RECIPES } from "./recipes.ts";

const COUNCIL_SETTING = "council";
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface EngineDeps {
  store: EventStore;
  providers: ProviderRegistry;
  settings: Settings;
  search: WebSearch;
  /** The user's knowledge bases, searched for every case and discussion. */
  knowledge?: KnowledgeStore;
  obsidianVaultPath: string | null;
  /** Where attachments live, so images can be shown to the models. */
  uploadsDir?: string;
  env?: Record<string, string | undefined>;
  /** Minimum time the last straggler gets after everyone else has finished a stage. */
  stragglerGraceMs?: number;
}

export interface SendOptions {
  override?: Partial<CouncilConfig>;
  depth?: Depth;
  /** Discuss mode: rounds for this exchange (defaults to the user's setting). */
  rounds?: number;
  timezone?: string;
  profile?: UserProfile | null;
  userId?: string;
}

/**
 * The orchestration layer. Commands come in (send, answer, cancel); the engine runs
 * the council and records every step as an event:
 *
 *   classify? → clarify? → research?
 *   → round 1: independent answers → round 2: anonymous peer review
 *   → [round 3: revise after critique → round 4: review again]×(depth)   (stops early on consensus)
 *   → final round: chairman verdict (synthesis + brief, in parallel)
 *
 * The engine holds no conversation state of its own; it reads projections from the store.
 */
export class CouncilEngine {
  private readonly deps: EngineDeps;
  private readonly running = new Map<string, AbortController>();
  /** Discussions in progress, by conversation. */
  private readonly discussions = new Map<string, AbortController>();

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  // ---- council configuration -------------------------------------------------

  /** A user's council settings, falling back to the server default. */
  council(userId?: string): CouncilConfig {
    const saved = (userId && this.deps.settings.get<CouncilConfig>(`${COUNCIL_SETTING}:${userId}`)) || this.deps.settings.get<CouncilConfig>(COUNCIL_SETTING);
    // Re-validate so councils saved by older versions pick up new defaults.
    if (saved?.members?.length) return validateCouncil(saved);
    const { members, chairman } = this.deps.providers.defaultCouncil(this.deps.env);
    return { auto: this.autoAvailable(), depth: "standard", members, chairman, clarify: true, brief: true, webSearch: Boolean(this.deps.search.provider()), discussion: DEFAULT_DISCUSSION };
  }

  saveCouncil(input: CouncilConfig, userId?: string): CouncilConfig {
    const config = validateCouncil(input);
    this.deps.settings.set(userId ? `${COUNCIL_SETTING}:${userId}` : COUNCIL_SETTING, config);
    return config;
  }

  /** Recommended councils need OpenRouter, which reaches every lab with one key. */
  autoAvailable(): boolean {
    try {
      return this.deps.providers.get("openrouter").configured();
    } catch {
      return false;
    }
  }

  /** The concrete members and chairman for a case type. */
  resolve(config: CouncilConfig, mode: CaseMode): CouncilConfig {
    if (!config.auto || !this.autoAvailable()) return config;
    return { ...config, ...RECIPES[mode] };
  }

  // ---- commands --------------------------------------------------------------

  createConversation(title?: string, mode: CaseMode | "auto" = "general", ownerId?: string, kind: "council" | "chat" = "council"): string {
    const conversationId = crypto.randomUUID();
    const auto = mode === "auto";
    this.deps.store.append({
      type: "conversation.created",
      conversationId,
      title: cleanTitle(title) || "New conversation",
      mode: auto ? "general" : validMode(mode),
      ...(auto ? { autoMode: true } : {}),
      ...(kind === "chat" ? { kind } : {}),
      ...(ownerId ? { ownerId } : {})
    });
    return conversationId;
  }

  setMode(conversationId: string, mode: CaseMode): void {
    const conversation = this.deps.store.require(conversationId);
    const next = validMode(mode);
    if (next !== conversation.mode) this.deps.store.append({ type: "conversation.mode_changed", conversationId, mode: next });
  }

  async sendMessage(conversationId: string, prompt: string, options: SendOptions = {}): Promise<string> {
    let conversation = this.deps.store.require(conversationId);
    const text = prompt.trim();
    if (!text) throw badRequest("Message is required.");
    if (text.length > 40_000) throw badRequest("Message must be 40,000 characters or fewer.");
    const active = conversation.turns.at(-1);
    if (active && (active.status === "running" || active.status === "awaiting_clarification")) {
      throw Object.assign(new Error("The council is still working on the previous message."), { status: 409 });
    }
    // Route an "auto" case to the right mode from its first message.
    if (conversation.autoMode && !conversation.turns.length) {
      const mode = await this.classify(text);
      this.setMode(conversationId, mode);
      conversation = this.deps.store.require(conversationId);
    }
    const base = this.council(options.userId);
    const merged = options.override ? validateCouncil({ ...base, ...options.override }) : base;
    const depth = options.depth && DEPTHS.includes(options.depth) ? options.depth : merged.depth;
    const council = { ...this.resolve(merged, conversation.mode), depth };
    const context: CaseContext = { date: todayIn(options.timezone), ...(options.timezone ? { timezone: options.timezone } : {}), ...(options.profile ? { profile: options.profile } : {}) };
    const turnId = crypto.randomUUID();
    if (!conversation.turns.length && conversation.title === "New conversation") {
      this.deps.store.append({ type: "conversation.renamed", conversationId, title: cleanTitle(text) });
    }
    this.deps.store.append({ type: "turn.started", conversationId, turnId, prompt: text, mode: conversation.mode, council, rounds: DEPTH_ROUNDS[depth], context });
    this.launch(conversationId, turnId);
    return turnId;
  }

  // ---- Discuss mode -----------------------------------------------------------

  /** Let the panel keep talking without a new user message. */
  continueDiscussion(conversationId: string, options: SendOptions = {}): void {
    const conversation = this.deps.store.require(conversationId);
    if (conversation.kind !== "chat") throw badRequest("This case isn't a discussion.");
    if (!conversation.chat.length) throw badRequest("Start the discussion first.");
    if (!this.discussions.has(conversationId)) this.startDiscussion(conversationId, options, true);
  }

  /** Post a user message to a group discussion; starts the moderated replies if none are running. */
  async chat(conversationId: string, text: string, options: SendOptions = {}): Promise<void> {
    let conversation = this.deps.store.require(conversationId);
    if (conversation.kind !== "chat") throw badRequest("This case isn't a discussion.");
    const body = text.trim();
    if (!body) throw badRequest("Message is required.");
    if (body.length > 20_000) throw badRequest("Message must be 20,000 characters or fewer.");
    if (conversation.autoMode && !conversation.chat.length) {
      this.setMode(conversationId, await this.classify(body));
      conversation = this.deps.store.require(conversationId);
    }
    if (!conversation.chat.length && conversation.title === "New conversation") {
      this.deps.store.append({ type: "conversation.renamed", conversationId, title: cleanTitle(body) });
    }
    const message: ChatMessage = { id: crypto.randomUUID(), author: { kind: "user" }, text: body, at: new Date().toISOString() };
    const first = !conversation.chat.length;
    this.deps.store.append({ type: "chat.message", conversationId, message });
    // The cast is being chosen or is waiting for approval: the debate starts once the user confirms it.
    if (conversation.personaStatus === "casting" || conversation.personaStatus === "proposed") return;
    // Already discussing: the running loop sees the new message and lets the panel respond to it.
    if (this.discussions.has(conversationId)) return;
    if (first && !conversation.personaStatus && this.council(options.userId).discussion.personas) this.startCasting(conversationId, options);
    else this.startDiscussion(conversationId, options);
  }

  /** Ask the moderator for a different cast (optionally steered by a hint) while the first one awaits approval. */
  recast(conversationId: string, hint: string, options: SendOptions = {}): void {
    const conversation = this.deps.store.require(conversationId);
    if (conversation.kind !== "chat") throw badRequest("This case isn't a discussion.");
    if (conversation.personaStatus !== "proposed") throw badRequest("The panel can only be recast before the debate starts.");
    this.startCasting(conversationId, options, hint);
  }

  /** The user approved (and maybe edited) the cast: start the debate. An empty list means no personas. */
  confirmPersonas(conversationId: string, personas: unknown, options: SendOptions = {}): void {
    const conversation = this.deps.store.require(conversationId);
    if (conversation.kind !== "chat") throw badRequest("This case isn't a discussion.");
    if (conversation.personaStatus !== "proposed") throw badRequest("There is no proposed panel to confirm.");
    const members = this.resolve(this.council(options.userId), conversation.mode).members;
    const confirmed = Array.isArray(personas) && personas.length ? normalizePersonas(personas, members) : [];
    this.deps.store.append({ type: "chat.personas_confirmed", conversationId, personas: confirmed });
    if (!this.discussions.has(conversationId)) this.startDiscussion(conversationId, options);
  }

  private startCasting(conversationId: string, options: SendOptions, hint = ""): void {
    const { store, providers } = this.deps;
    const controller = new AbortController();
    this.discussions.set(conversationId, controller);
    store.append({ type: "chat.casting", conversationId });
    store.append({ type: "chat.busy", conversationId, busy: true });
    void (async () => {
      const conversation = store.require(conversationId);
      const council = this.resolve(this.council(options.userId), conversation.mode);
      const about = aboutBlock({ date: todayIn(options.timezone), ...(options.timezone ? { timezone: options.timezone } : {}), ...(options.profile ? { profile: options.profile } : {}) });
      const question = conversation.chat.filter((m) => m.author.kind === "user").map((m) => m.text).join("\n\n");
      let personas: Persona[] = [];
      try {
        // A fast model: the user is waiting to see the cast.
        const caster = this.autoAvailable() ? CLASSIFIER : council.chairman;
        // Each persona is shown as soon as the moderator has finished writing it.
        let sent = 0;
        const onText = (text: string) => {
          const done = partialPersonas(text);
          if (done.length === sent) return;
          sent = done.length;
          store.publishDraft({ type: "draft", conversationId, turnId: "chat", key: "cast", text: JSON.stringify(normalizePersonas(done, council.members.slice(0, done.length))) });
        };
        const reply = await providers.complete(caster, { purpose: "cast", effort: "none", json: true, messages: [{ role: "user", content: castingPrompt(about, question, council.members, conversation.mode, hint) }], signal: controller.signal, onText });
        personas = normalizePersonas((extractJson(reply) as { personas?: unknown }).personas, council.members);
      } catch (error) {
        if (!controller.signal.aborted) console.warn("[discuss] casting failed:", errorMessage(error));
      }
      this.discussions.delete(conversationId);
      // Stopped, or the moderator couldn't cast everyone: carry on without personas rather than block the user.
      if (controller.signal.aborted || personas.length !== council.members.length) {
        store.append({ type: "chat.personas_confirmed", conversationId, personas: [] });
        if (controller.signal.aborted) store.append({ type: "chat.busy", conversationId, busy: false });
        else this.startDiscussion(conversationId, options);
        return;
      }
      store.append({ type: "chat.personas_proposed", conversationId, personas });
      store.append({ type: "chat.busy", conversationId, busy: false });
    })();
  }

  stopDiscussion(conversationId: string): void {
    this.discussions.get(conversationId)?.abort();
  }

  /** Turn a discussion into the usual synthesis + brief + document. */
  async wrapUp(conversationId: string, options: SendOptions = {}): Promise<string> {
    const conversation = this.deps.store.require(conversationId);
    if (conversation.kind !== "chat") throw badRequest("Only a discussion can be wrapped up.");
    if (!conversation.chat.some((m) => m.author.kind === "model")) throw badRequest("Discuss something first, then wrap up.");
    if (this.discussions.has(conversationId) || conversation.turns.at(-1)?.status === "running") {
      throw Object.assign(new Error("Wait for the panel to finish, then wrap up."), { status: 409 });
    }
    const council = { ...this.resolve(this.council(options.userId), conversation.mode), depth: "quick" as const };
    const context: CaseContext = { date: todayIn(options.timezone), ...(options.timezone ? { timezone: options.timezone } : {}), ...(options.profile ? { profile: options.profile } : {}) };
    const turnId = crypto.randomUUID();
    this.deps.store.append({ type: "turn.started", conversationId, turnId, prompt: "Wrap up the discussion", mode: conversation.mode, council, rounds: 1, context, wrapUp: true });
    this.launch(conversationId, turnId);
    return turnId;
  }

  private startDiscussion(conversationId: string, options: SendOptions, resumed = false): void {
    const controller = new AbortController();
    this.discussions.set(conversationId, controller);
    this.deps.store.append({ type: "chat.busy", conversationId, busy: true });
    void this.discuss(conversationId, options, controller.signal, resumed)
      .catch((error) => {
        if (!controller.signal.aborted) console.error(`[discuss] ${conversationId} failed`, error);
      })
      .finally(() => {
        this.discussions.delete(conversationId);
        this.deps.store.append({ type: "chat.busy", conversationId, busy: false });
      });
  }

  private async discuss(conversationId: string, options: SendOptions, signal: AbortSignal, resumed = false): Promise<void> {
    const { store, providers } = this.deps;
    const conversation = store.require(conversationId);
    const council = this.resolve(this.council(options.userId), conversation.mode);
    const members = council.members;
    const settings = council.discussion;
    const personas = conversation.personas.filter((p) => members.some((m) => m.id === p.memberId));
    const rounds = clampInt(options.rounds ?? settings.rounds, 1, 6, DEFAULT_DISCUSSION.rounds);
    const perRound = Math.min(settings.speakersPerRound, members.length);
    const about = aboutBlock({ date: todayIn(options.timezone), ...(options.timezone ? { timezone: options.timezone } : {}), ...(options.profile ? { profile: options.profile } : {}) });
    const moderator = this.autoAvailable() ? CLASSIFIER : council.chairman;
    const userMessages = () => store.require(conversationId).chat.filter((m) => m.author.kind === "user");
    let seenUsers = userMessages().length;
    let round = 1;
    let knowledge: SearchResult[] | null = null;

    while (!signal.aborted && round <= rounds) {
      const chat = store.require(conversationId).chat;
      const last = chat.at(-1);
      // Who speaks: explicit @mentions win; otherwise the moderator decides.
      const tagged = last?.author.kind === "user" ? mentioned(last.text, members, personas) : [];
      const picking = tagged.length
        ? Promise.resolve({ speakers: tagged, reason: "You asked them directly" })
        : this.pickSpeakers(moderator, moderatorPrompt(about, members, personas, chat, { round, of: rounds, speakers: perRound, resumed: resumed && round === 1 }), members, perRound, round === 1, signal);
      // Knowledge is looked up once per user message, while the moderator is choosing.
      const lookup: Promise<SearchResult[]> = knowledge
        ? Promise.resolve(knowledge)
        : (this.deps.knowledge?.search(conversation.ownerId ?? options.userId, userMessages().slice(-2).map((m) => m.text).join("\n"), signal).catch((error) => (console.warn("[discuss] knowledge lookup failed:", errorMessage(error)), [])) ?? Promise.resolve([]));
      const [{ speakers, reason }, found] = await Promise.all([picking, lookup]);
      if (signal.aborted) return;
      const fresh = knowledge === null;
      knowledge = found;
      if (!speakers.length) break;
      store.append({
        type: "chat.moderated",
        conversationId,
        note: { id: crypto.randomUUID(), speakers: speakers.map((s) => s.id), reason, at: new Date().toISOString(), round, of: rounds, ...(fresh && found.length ? { knowledge: [...new Set(found.map((k) => k.title.split(": ")[0]))] } : {}) }
      });

      for (const speaker of speakers) {
        if (signal.aborted) return;
        const draft = throttle((text: string) => store.publishDraft({ type: "draft", conversationId, turnId: "chat", key: `chat:${speaker.id}`, text }), 80);
        const latest = store.require(conversationId).chat;
        const persona = personas.find((p) => p.memberId === speaker.id);
        const author = { kind: "model" as const, memberId: speaker.id, label: speaker.label, provider: speaker.provider, model: speaker.model, ...(persona ? { persona: persona.name } : {}) };
        let message: ChatMessage;
        try {
          const text = await providers.complete(speaker, {
            purpose: "chat",
            // A live conversation: answer promptly. The wrap-up and council cases still think at full depth.
            effort: "low",
            system: chatSystem(speaker, members.filter((m) => m.id !== speaker.id).map((m) => nameOf(m, personas)), conversation.mode, about, { persona, speechLength: settings.speechLength }),
            messages: [{ role: "user", content: chatTurnPrompt(latest, nameOf(speaker, personas), knowledge) }],
            signal,
            onText: draft
          });
          // Models sometimes copy the transcript format and open with their own name.
          const own = nameOf(speaker, personas).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          message = { id: crypto.randomUUID(), author, text: text.replace(new RegExp(`^\\s*\\**${own}\\**\\s*:\\s*`, "i"), ""), at: new Date().toISOString() };
        } catch (error) {
          if (signal.aborted) return;
          message = { id: crypto.randomUUID(), author, text: "", error: errorMessage(error), at: new Date().toISOString() };
        }
        store.append({ type: "chat.message", conversationId, message });
      }
      // The user jumped in while the panel was talking: start a fresh exchange for their message.
      if (userMessages().length > seenUsers) {
        seenUsers = userMessages().length;
        round = 1;
        resumed = false;
        knowledge = null;
        continue;
      }
      round++;
    }
  }

  private async pickSpeakers(moderator: CouncilMember, prompt: string, members: CouncilMember[], limit: number, opening: boolean, signal: AbortSignal): Promise<{ speakers: CouncilMember[]; reason: string }> {
    try {
      const reply = await this.deps.providers.complete(moderator, { purpose: "moderate", effort: "none", json: true, messages: [{ role: "user", content: prompt }], signal });
      const parsed = extractJson(reply) as { speakers?: unknown; reason?: unknown };
      const ids = Array.isArray(parsed.speakers) ? parsed.speakers.map(String) : [];
      const speakers = [...new Set(ids.map((id) => members.find((m) => m.id === id)).filter((m): m is CouncilMember => Boolean(m)))].slice(0, Math.max(1, limit));
      return { speakers, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 120) : "" };
    } catch (error) {
      if (!signal.aborted) console.warn("[discuss] moderator failed:", errorMessage(error));
      // Without a moderator, let the first panellists answer the user, then stop.
      return { speakers: opening && !signal.aborted ? members.slice(0, Math.max(1, Math.min(2, limit))) : [], reason: "" };
    }
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
      // A cast that was being chosen is lost with the process; let the discussion carry on without one.
      if (conversation.personaStatus === "casting" && !this.discussions.has(conversation.id)) {
        this.deps.store.append({ type: "chat.personas_confirmed", conversationId: conversation.id, personas: [] });
      }
      if (conversation.chatBusy && !this.discussions.has(conversation.id)) this.deps.store.append({ type: "chat.busy", conversationId: conversation.id, busy: false });
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
    const stage = (s: Turn["stage"] & string, cycle?: number) => emit({ type: "turn.stage_started", conversationId, turnId, stage: s, ...(cycle ? { cycle } : {}) });
    const context = (): TurnContext => {
      const conversation = store.require(conversationId);
      const index = conversation.turns.findIndex((t) => t.id === turnId);
      return buildContext(conversation.turns[index], conversation.turns.slice(0, index));
    };
    const draft = (key: string) => throttle((text: string) => store.publishDraft({ type: "draft", conversationId, turnId, key, text }), 120);
    let turn = this.turn(conversationId, turnId);
    if (turn.wrapUp) return this.runWrapUp(conversationId, turnId, signal);
    const { members, chairman } = turn.council;
    const mode = turn.mode;
    const images = await this.images(turn);

    // Clarify: pause the turn and wait for the user if one question is essential.
    if (turn.council.clarify && !turn.clarification) {
      stage("clarify");
      const intake = await this.clarifyingQuestions(chairman, context(), mode, signal, images);
      if (signal.aborted) return;
      if (intake) {
        emit({ type: "turn.clarification_requested", conversationId, turnId, question: intake.map((q) => q.question).join(" "), questions: intake });
        return;
      }
    }

    // Optional web research shared by every member.
    if (!turn.research.length) {
      const web = turn.council.webSearch && search.provider() ? search.search(turn.prompt, signal).catch((error) => (console.warn("[council] web search failed:", errorMessage(error)), [] as SearchResult[])) : null;
      const owner = store.require(conversationId).ownerId;
      const kb = this.deps.knowledge && owner ? this.deps.knowledge.search(owner, turn.prompt, signal).catch((error) => (console.warn("[council] knowledge lookup failed:", errorMessage(error)), [] as SearchResult[])) : null;
      if (web) stage("research");
      const results = [...((await kb) ?? []), ...((await web) ?? [])];
      if (results.length) emit({ type: "turn.research_completed", conversationId, turnId, results });
    }
    if (signal.aborted) return;

    const cycles = Math.max(1, (turn.rounds - 1) / 2);
    let seated = members;
    for (let cycle = 1; cycle <= cycles; cycle++) {
      // Answer (cycle 1) or revise after critique (later cycles).
      stage(cycle === 1 ? "stage1" : "revise", cycle);
      const ctx = context();
      const previous = this.turn(conversationId, turnId);
      const prevAnswers = previous.stage1.filter((r) => r.round === cycle - 1 && !r.error);
      const prevLabelled = assignLabels(prevAnswers);
      const prevReviews = previous.stage2.filter((r) => r.round === cycle - 1 && !r.error);
      await withStragglerCutoff(seated, signal, this.deps.stragglerGraceMs, async (member, memberSignal) => {
        const started = Date.now();
        let response: Stage1Response;
        try {
          const content =
            cycle === 1
              ? questionBlock(ctx)
              : revisePrompt(
                  ctx,
                  prevLabelled.map((l) => ({ label: l.label, text: l.response.text })),
                  prevLabelled.find((l) => l.response.memberId === member.id)?.label ?? "",
                  prevReviews
                );
          const text = await providers.complete(member, {
            purpose: "answer",
            system: answerSystem(mode),
            messages: [{ role: "user", content, images }],
            signal: memberSignal,
            onText: draft(`stage1:${member.id}`)
          });
          response = { round: cycle, memberId: member.id, label: member.label, model: modelName(member), text, ms: Date.now() - started };
        } catch (error) {
          response = { round: cycle, memberId: member.id, label: member.label, model: modelName(member), text: "", error: memberError(error, memberSignal), ms: Date.now() - started };
        }
        if (!signal.aborted) emit({ type: "turn.stage1_response", conversationId, turnId, response });
      });
      if (signal.aborted) return;

      turn = this.turn(conversationId, turnId);
      const answered = turn.stage1.filter((r) => r.round === cycle && !r.error);
      if (!answered.length) {
        if (cycle === 1) throw new Error(`No council member could answer: ${turn.stage1.map((r) => `${r.label}: ${r.error}`).join("; ")}`);
        break; // Keep the previous round's answers for the verdict.
      }
      seated = seated.filter((m) => answered.some((r) => r.memberId === m.id));

      // Anonymous peer review. Skipped when only one member answered.
      const labelled = assignLabels(answered);
      if (labelled.length < 2) break;
      stage("stage2", cycle);
      const prompt = reviewPrompt(context(), labelled.map((l) => ({ label: l.label, text: l.response.text })));
      const validLabels = labelled.map((l) => l.label);
      await withStragglerCutoff(seated, signal, this.deps.stragglerGraceMs, async (member, memberSignal) => {
        let review: Stage2Review;
        try {
          const text = await providers.complete(member, { purpose: "review", messages: [{ role: "user", content: prompt }], signal: memberSignal });
          review = { round: cycle, memberId: member.id, label: member.label, text, ranking: parseRanking(text, validLabels) };
        } catch (error) {
          review = { round: cycle, memberId: member.id, label: member.label, text: "", ranking: [], error: memberError(error, memberSignal) };
        }
        if (!signal.aborted) emit({ type: "turn.stage2_review", conversationId, turnId, review });
      });
      if (signal.aborted) return;
      turn = this.turn(conversationId, turnId);
      const aggregate = aggregateRankings(turn.stage2.filter((r) => r.round === cycle && !r.error), labelled, cycle);
      emit({ type: "turn.stage2_aggregated", conversationId, turnId, aggregate });

      // Consensus: every reviewer independently picked the same best answer. Always do at least one
      // revision after critique (agreeing on the best answer doesn't mean its errors were fixed),
      // then stop early once the revised answers are unanimously ranked.
      if (cycle >= 2 && cycle < cycles && aggregate.agreement === 1 && aggregate.rankings.length > 1) {
        emit({ type: "turn.converged", conversationId, turnId, cycle });
        break;
      }
    }

    // Final round: the chairman's verdict, from the latest answers and reviews.
    stage("stage3");
    turn = this.turn(conversationId, turnId);
    const lastRound = Math.max(...turn.stage1.filter((r) => !r.error).map((r) => r.round));
    const answered = turn.stage1.filter((r) => r.round === lastRound && !r.error);
    const reviews = turn.stage2.filter((r) => r.round === lastRound && !r.error);
    const aggregate = turn.aggregate?.round === lastRound ? turn.aggregate : undefined;
    const ranking = (aggregate?.rankings ?? []).map((r) => r.label).join(" > ");

    const synthesis = (async () => {
      try {
        const text = await providers.complete(chairman, {
          purpose: "synthesis",
          messages: [{ role: "user", content: synthesisPrompt(context(), answered, reviews), images }],
          signal,
          onText: draft("synthesis")
        });
        if (!signal.aborted) emit({ type: "turn.synthesis_completed", conversationId, turnId, synthesis: { memberId: chairman.id, label: chairman.label, model: modelName(chairman), text } });
      } catch (error) {
        if (signal.aborted) return;
        // Degrade to the top-ranked answer rather than losing the turn.
        const best = aggregate?.rankings[0]?.memberId;
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
        const reply = await providers.complete(chairman, { purpose: "brief", json: true, messages: [{ role: "user", content: briefPrompt(context(), mode, answered, reviews, ranking), images }], signal });
        const version = store.require(conversationId).turns.filter((t) => t.brief).length + 1;
        if (!signal.aborted) emit({ type: "turn.brief_generated", conversationId, turnId, brief: normalizeBrief(extractJson(reply), mode, version, aggregate ? aggregate.agreement : null) });
      } catch (error) {
        if (signal.aborted) return;
        console.warn("[council] brief generation failed:", errorMessage(error));
        emit({ type: "turn.brief_failed", conversationId, turnId, error: friendlyProviderError(error) });
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

  /** Wrap up a discussion: the chairman's conclusion and a brief, from the chat transcript. */
  private async runWrapUp(conversationId: string, turnId: string, signal: AbortSignal): Promise<void> {
    const { store, providers } = this.deps;
    const emit = store.append.bind(store);
    const turn = this.turn(conversationId, turnId);
    const conversation = store.require(conversationId);
    const { chairman, members } = turn.council;
    const about = aboutBlock(turn.context);
    emit({ type: "turn.stage_started", conversationId, turnId, stage: "stage3" });
    // Each panellist's contributions, as the "answers" the brief is built from.
    const answers: Stage1Response[] = members
      .map((m) => ({ m, text: conversation.chat.filter((c) => c.author.kind === "model" && c.author.memberId === m.id && !c.error).map((c) => c.text).join("\n\n") }))
      .filter((x) => x.text)
      // The brief names people the way the debate did: by persona when there was a cast.
      .map((x) => ({ round: 1, memberId: x.m.id, label: nameOf(x.m, conversation.personas), model: modelName(x.m), text: x.text, ms: 0 }));
    const ctx = { ...buildContext(turn, []), prompt: `Group discussion (user messages included):\n${conversation.chat.map((c) => `${c.author.kind === "user" ? "User" : c.author.persona || c.author.label}: ${c.text}`).join("\n\n").slice(-30_000)}` };
    const draft = throttle((text: string) => store.publishDraft({ type: "draft", conversationId, turnId, key: "synthesis", text }), 120);

    const synthesis = (async () => {
      try {
        const text = await providers.complete(chairman, { purpose: "synthesis", messages: [{ role: "user", content: wrapUpPrompt(about, conversation.chat) }], signal, onText: draft });
        if (!signal.aborted) emit({ type: "turn.synthesis_completed", conversationId, turnId, synthesis: { memberId: chairman.id, label: chairman.label, model: modelName(chairman), text } });
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    })();
    const brief = (async () => {
      try {
        const reply = await providers.complete(chairman, { purpose: "brief", json: true, messages: [{ role: "user", content: briefPrompt(ctx, turn.mode, answers, [], "") }], signal });
        const version = store.require(conversationId).turns.filter((t) => t.brief).length + 1;
        if (!signal.aborted) emit({ type: "turn.brief_generated", conversationId, turnId, brief: normalizeBrief(extractJson(reply), turn.mode, version, null) });
      } catch (error) {
        if (signal.aborted) return;
        emit({ type: "turn.brief_failed", conversationId, turnId, error: friendlyProviderError(error) });
      }
    })();
    await Promise.all([synthesis, brief]);
    if (!signal.aborted) emit({ type: "turn.completed", conversationId, turnId });
  }

  /** Image attachments, read once per turn and passed to models that can see them. */
  private async images(turn: Turn): Promise<ImageInput[] | undefined> {
    if (!this.deps.uploadsDir) return undefined;
    const out: ImageInput[] = [];
    for (const a of turn.attachments.filter((a) => a.kind === "image" || a.mimeType.startsWith("image/")).slice(0, MAX_IMAGES)) {
      if (a.size > MAX_IMAGE_BYTES) continue;
      try {
        const file = path.join(this.deps.uploadsDir, path.basename(decodeURIComponent(a.url.replace(/^\/uploads\//, ""))));
        out.push({ mimeType: a.mimeType, data: (await fs.readFile(file)).toString("base64") });
      } catch (error) {
        console.warn("[council] could not read image", a.name, errorMessage(error));
      }
    }
    return out.length ? out : undefined;
  }

  /** Pick the case type from the first message, using a small fast model. */
  private async classify(text: string): Promise<CaseMode> {
    try {
      const member = this.autoAvailable() ? CLASSIFIER : this.council().chairman;
      const reply = await this.deps.providers.complete(member, { purpose: "clarify", json: true, messages: [{ role: "user", content: classifyPrompt(text) }], signal: AbortSignal.timeout(15_000) });
      const mode = (extractJson(reply) as { mode?: unknown }).mode;
      return validMode(mode);
    } catch (error) {
      console.warn("[council] classification failed, using general:", errorMessage(error));
      return "general";
    }
  }

  private async clarifyingQuestions(chairman: CouncilMember, ctx: TurnContext, mode: CaseMode, signal: AbortSignal, images?: ImageInput[]): Promise<IntakeQuestion[] | null> {
    try {
      const reply = await this.deps.providers.complete(chairman, { purpose: "clarify", json: true, messages: [{ role: "user", content: clarifyPrompt(ctx, mode), images }], signal });
      const parsed = extractJson(reply) as { needed?: unknown; question?: unknown; questions?: unknown };
      if (parsed.needed !== true) return null;
      const raw = Array.isArray(parsed.questions) ? parsed.questions : typeof parsed.question === "string" ? [{ question: parsed.question, options: [] }] : [];
      const questions = raw
        .slice(0, 3)
        .map((q, i): IntakeQuestion => {
          const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
          const options = Array.isArray(o.options) ? [...new Set(o.options.map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 5) : [];
          return { id: `q${i + 1}`, question: String(o.question ?? "").trim().slice(0, 240), options: options.length >= 2 ? options : [], ...(o.multiple === true && options.length >= 2 ? { multiple: true } : {}) };
        })
        .filter((q) => q.question);
      return questions.length ? questions : null;
    } catch (error) {
      // Clarification is a nicety; never block the council on it.
      if (!signal.aborted) console.warn("[council] clarify step skipped:", errorMessage(error));
      return null;
    }
  }
}

/** Turn provider failures into something a user can act on. */
function friendlyProviderError(error: unknown): string {
  const message = errorMessage(error);
  if (/\b402\b|credits/i.test(message)) return "The model provider account is out of credit. Top up OpenRouter, then ask again.";
  if (/\b429\b|rate/i.test(message)) return "The model provider is rate-limiting requests. Try again in a minute.";
  return "The chairman couldn't produce the structured brief this time. The full opinion below is complete.";
}

/** Today's date in the user's timezone, e.g. "Tuesday 27 October 2026". */
function todayIn(timezone?: string): string {
  const format = (tz?: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(new Date());
  try {
    return format(timezone);
  } catch {
    return format();
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
    auto: input.auto === true,
    depth: DEPTHS.includes(input.depth) ? input.depth : "standard",
    members,
    chairman: validateMember(input.chairman),
    clarify: Boolean(input.clarify),
    brief: input.brief !== false,
    webSearch: Boolean(input.webSearch),
    discussion: validateDiscussion(input.discussion)
  };
}

/** Complete persona objects in a JSON reply that is still being written. */
function partialPersonas(text: string): unknown[] {
  const out: unknown[] = [];
  for (const match of text.slice(text.indexOf("[") + 1).matchAll(/\{[^{}]*\}/g)) {
    try {
      out.push(JSON.parse(match[0]));
    } catch {
      break;
    }
  }
  return out;
}

function validateDiscussion(input: Partial<DiscussionSettings> | undefined): DiscussionSettings {
  const d = input && typeof input === "object" ? input : {};
  return {
    personas: d.personas === undefined ? DEFAULT_DISCUSSION.personas : Boolean(d.personas),
    rounds: clampInt(d.rounds, 1, 6, DEFAULT_DISCUSSION.rounds),
    speakersPerRound: clampInt(d.speakersPerRound, 1, 8, DEFAULT_DISCUSSION.speakersPerRound),
    speechLength: SPEECH_LENGTHS.includes(d.speechLength as never) ? d.speechLength! : DEFAULT_DISCUSSION.speechLength,
    voice: d.voice === "economy" ? "economy" : "natural"
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
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

export { depthCycles };

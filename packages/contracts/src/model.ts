// Domain model shared by the server and the web client.

export const PROVIDER_IDS = [
  "mock",
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "openrouter",
  "siliconflow",
  "ollama",
  "routellm",
  "anythingllm"
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const CASE_MODES = ["medical", "legal", "code", "general"] as const;
/** Shapes how the council reasons and what the brief contains. */
export type CaseMode = (typeof CASE_MODES)[number];

/** One seat on the council. For `anythingllm`, `model` is the workspace slug. */
export interface CouncilMember {
  id: string;
  label: string;
  provider: ProviderId;
  model: string;
}

/**
 * How long the council deliberates. Rounds: answer → review → [revise → review]* → verdict.
 * quick = 3 rounds, standard = 5, thorough = 7.
 */
export const DEPTHS = ["quick", "standard", "thorough"] as const;
export type Depth = (typeof DEPTHS)[number];
export const DEPTH_ROUNDS: Record<Depth, number> = { quick: 3, standard: 5, thorough: 7 };
/** Answer/review cycles implied by a depth: quick 1, standard 2, thorough 3. */
export function depthCycles(depth: Depth): number {
  return (DEPTH_ROUNDS[depth] - 1) / 2;
}

/** How long each panellist speaks in a discussion. */
export const SPEECH_LENGTHS = ["short", "medium", "long"] as const;
export type SpeechLength = (typeof SPEECH_LENGTHS)[number];
/** Rough word budget per speech, also used to estimate reading time. */
export const SPEECH_WORDS: Record<SpeechLength, number> = { short: 50, medium: 110, long: 220 };

/** Voices a persona can speak with. Synod maps each to a voice of the configured speech model. */
export const VOICES = [
  { id: "george", label: "George", tone: "warm, measured man" },
  { id: "sarah", label: "Sarah", tone: "clear, confident woman" },
  { id: "brian", label: "Brian", tone: "deep, steady man" },
  { id: "alice", label: "Alice", tone: "crisp, precise woman" },
  { id: "charlie", label: "Charlie", tone: "relaxed, friendly man" },
  { id: "matilda", label: "Matilda", tone: "warm, thoughtful woman" },
  { id: "daniel", label: "Daniel", tone: "authoritative man" },
  { id: "jessica", label: "Jessica", tone: "lively, expressive woman" }
] as const;
export type VoiceId = (typeof VOICES)[number]["id"];

/** The character a model plays in a discussion, cast by the moderator and approved by the user. */
export interface Persona {
  memberId: string;
  /** e.g. "Dr. Maya Okafor" */
  name: string;
  /** e.g. "Sceptical epidemiologist" */
  role: string;
  /** The position this persona argues from, in one sentence. */
  stance: string;
  /** How they talk, e.g. "blunt, numbers first". */
  style: string;
  voice: VoiceId;
}

export interface DiscussionSettings {
  /** The moderator casts a persona for each model before the debate starts. */
  personas: boolean;
  /** Rounds the panel talks before handing back to the user (1-6). */
  rounds: number;
  /** How many panellists speak in each round (1-8). */
  speakersPerRound: number;
  speechLength: SpeechLength;
  /** Spoken voices: "natural" costs more per speech than "economy". */
  voice: "natural" | "economy";
}

export const DEFAULT_DISCUSSION: DiscussionSettings = { personas: true, rounds: 3, speakersPerRound: 3, speechLength: "medium", voice: "natural" };

/** A source the council can draw on. Content stays on the server; this is what the UI sees. */
export interface KnowledgeBase {
  id: string;
  name: string;
  kind: "file" | "link" | "anythingllm";
  /** File name, URL, or "workspace on host". */
  detail: string;
  /** Used by new cases and discussions. */
  enabled: boolean;
  /** Characters of text held (files and links). */
  chars?: number;
  error?: string;
  createdAt: string;
}

export interface CouncilConfig {
  /** Pick the best council for each case type automatically (members and chairman below are ignored). */
  auto: boolean;
  depth: Depth;
  members: CouncilMember[];
  /** Member that writes the final synthesis and the execution plan. May or may not also sit on the council. */
  chairman: CouncilMember;
  /** Ask one clarifying question before deliberating when material context is missing. */
  clarify: boolean;
  /** Produce a structured second-opinion brief after the synthesis. */
  brief: boolean;
  /** Pull web search results into the prompt when a search key is configured. */
  webSearch: boolean;
  /** Discuss mode: personas, rounds, and speech length. */
  discussion: DiscussionSettings;
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  source: "upload" | "mobile";
  /** Text content made available to the council (text, PDF, and Word files; truncated). */
  excerpt?: string;
  /** Images are shown to the models directly. */
  kind?: "text" | "document" | "image" | "other";
}

export interface SearchResult {
  title: string;
  /** Empty for knowledge-base passages without a link. */
  url: string;
  snippet: string;
  /** Where it came from; absent means web search. */
  source?: "web" | "knowledge";
}

export interface Stage1Response {
  /** 1 for the first answer; 2+ for revisions after peer review. */
  round: number;
  memberId: string;
  label: string;
  model: string;
  text: string;
  error?: string;
  ms: number;
}

export interface Stage2Review {
  /** Which answer round this review ranked. */
  round: number;
  memberId: string;
  label: string;
  text: string;
  /** Anonymous labels ("Response A", ...) best-first, parsed from the review. */
  ranking: string[];
  error?: string;
}

export interface AggregateRank {
  memberId: string;
  label: string;
  averageRank: number;
  votes: number;
}

export interface Stage2Aggregate {
  round: number;
  /** Anonymous label -> member id. Revealed only after every review is in. */
  labelToMemberId: Record<string, string>;
  /** Averages exclude each reviewer's vote for its own answer. */
  rankings: AggregateRank[];
  /** Share of reviewers whose top pick (excluding themselves) matches the overall winner, 0-1. */
  agreement: number;
  /** Reviews that put their own answer first (ignored in the averages). */
  selfPreferred: number;
}

export interface Synthesis {
  memberId: string;
  label: string;
  model: string;
  text: string;
  error?: string;
}

export interface BriefItem {
  text: string;
  detail?: string;
  /** Likelihood, severity, or strength depending on the section. */
  level?: "high" | "medium" | "low";
}

export interface BriefSection {
  title: string;
  items: BriefItem[];
}

export interface NextStep {
  action: string;
  why: string;
  urgency: "now" | "soon" | "later";
}

export type Level = "high" | "medium" | "low";

/**
 * Visuals the chairman can choose for the shareable document. The model only supplies
 * data in these shapes; Synod renders them (no model-written HTML).
 */
export type Visual =
  | { kind: "ranked"; title: string; scale: "likelihood" | "strength" | "severity" | "priority"; items: { label: string; value: number; note?: string }[] }
  | { kind: "timeline"; title: string; events: { when: string; label: string; detail?: string; urgent?: boolean }[] }
  | { kind: "decision"; title: string; branches: { condition: string; action: string }[]; otherwise?: string }
  | { kind: "comparison"; title: string; options: string[]; rows: { criterion: string; cells: string[] }[]; recommended?: number }
  | { kind: "risk"; title: string; items: { label: string; likelihood: Level; impact: Level }[] };

export const VISUAL_KINDS = ["ranked", "timeline", "decision", "comparison", "risk"] as const;

/** A read-only link to one turn's document. The secret part of the URL is never stored in events. */
export interface ShareLink {
  id: string;
  createdAt: string;
  expiresAt: string;
  revoked?: boolean;
}

/** The structured second opinion distilled from the council's work. */
export interface Brief {
  version: number;
  mode: CaseMode;
  /** One or two sentences: the answer. */
  bottomLine: string;
  /** Short label, e.g. "Likely community-acquired pneumonia", "Strong claim", "Do not merge". */
  verdict: string;
  /** The chairman's own estimate, 0-1. */
  confidence: number;
  /** Measured agreement among peer reviewers, 0-1 (null when there was no review). */
  agreement: number | null;
  consensus: string[];
  disagreements: { point: string; positions: string[] }[];
  redFlags: string[];
  /** Mode-specific sections (differential, legal issues, bugs & risks, ...). */
  sections: BriefSection[];
  nextSteps: NextStep[];
  openQuestions: string[];
  caveats: string[];
  /** 0-3 visuals for the shareable document, chosen to fit the case. */
  visuals?: Visual[];
}

export interface HandoffResult {
  ok: boolean;
  simulated: boolean;
  error?: string;
  at: string;
}

export type TurnStage = "clarify" | "research" | "stage1" | "stage2" | "revise" | "stage3" | "brief";

export const PROFESSIONS = ["clinician", "lawyer", "engineer", "executive", "other"] as const;
export type Profession = (typeof PROFESSIONS)[number];

/** What the user told us at onboarding; added to every case as context. */
export interface UserProfile {
  profession: Profession;
  specialty: string;
  country: string;
  region?: string;
  setting?: string;
  answerStyle: "concise" | "detailed";
}

/** Snapshot of the context a turn was decided with (kept for audit). */
export interface CaseContext {
  date: string;
  timezone?: string;
  profile?: UserProfile;
}

/** One intake question: pick from options, or write your own. */
export interface IntakeQuestion {
  id: string;
  question: string;
  /** 2-5 short options; empty means a free-text answer. */
  options: string[];
  /** Several options may apply. */
  multiple?: boolean;
}

export type TurnStatus = "running" | "awaiting_clarification" | "completed" | "failed";

export interface Turn {
  id: string;
  prompt: string;
  mode: CaseMode;
  attachments: Attachment[];
  status: TurnStatus;
  stage: TurnStage | null;
  /** When the current stage started (drives live timers). */
  stageStartedAt?: string;
  council: CouncilConfig;
  /** Planned rounds (3, 5, or 7) and the revise/review cycle currently running. */
  rounds: number;
  cycle: number;
  /** Stopped before the planned rounds because reviewers already agreed. */
  convergedEarly?: boolean;
  context?: CaseContext;
  /** Produced by "Wrap up" from a group discussion rather than a council run. */
  wrapUp?: boolean;
  /** Intake before the council starts. `question` is the readable summary; `questions` the structured form. */
  clarification?: { question: string; questions?: IntakeQuestion[]; answer?: string };
  research: SearchResult[];
  stage1: Stage1Response[];
  stage2: Stage2Review[];
  /** Latest review round's combined ranking. */
  aggregate?: Stage2Aggregate;
  synthesis?: Synthesis;
  brief?: Brief;
  /** Why the brief is missing, when the chairman couldn't produce it. */
  briefError?: string;
  shares?: ShareLink[];
  handoff?: HandoffResult;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  /** Null until onboarding is complete. */
  profile: UserProfile | null;
}

/** How new accounts can be created on this server. */
export type SignupMode = "first-user" | "invite" | "open" | "closed";

/** One message in a Discuss (group chat) conversation. */
export interface ChatMessage {
  id: string;
  /** `persona` is the character's name when the model spoke in role. */
  author: { kind: "user" } | { kind: "model"; memberId: string; label: string; provider: ProviderId; model: string; persona?: string };
  text: string;
  at: string;
  error?: string;
}

/** The moderator's call on who speaks next, shown as a quiet note in the chat. */
export interface ModeratorNote {
  id: string;
  speakers: string[];
  reason: string;
  at: string;
  /** Which round of the current exchange this opens, e.g. 2 of 3. */
  round?: number;
  of?: number;
  /** Knowledge-base passages the panel was given for this round. */
  knowledge?: string[];
}

export interface Conversation {
  id: string;
  /** "council" gives a structured second opinion; "chat" is a moderated group discussion. */
  kind: "council" | "chat";
  /** Discuss mode: the group chat, in order. */
  chat: ChatMessage[];
  notes: ModeratorNote[];
  /** A model is replying (or about to). */
  chatBusy: boolean;
  /** Discuss mode: the cast. "proposed" waits for the user to approve or edit before the debate starts. */
  personas: Persona[];
  personaStatus?: "casting" | "proposed" | "confirmed";
  /** Owning user. Absent on cases created before accounts existed (visible to admins). */
  ownerId?: string;
  title: string;
  mode: CaseMode;
  /** The mode is picked automatically from the first message. */
  autoMode?: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Attachments added since the last turn; consumed by the next turn. */
  pendingAttachments: Attachment[];
  turns: Turn[];
  /** Sequence number of the last applied event. */
  seq: number;
}

export interface ConversationSummary {
  id: string;
  kind: "council" | "chat";
  title: string;
  mode: CaseMode;
  archived: boolean;
  updatedAt: string;
  turnCount: number;
  status: TurnStatus | "idle";
}

export interface ProviderStatus {
  provider: ProviderId;
  configured: boolean;
}

export interface ServerInfo {
  version: string;
  providers: ProviderStatus[];
  search: { configured: boolean; provider: string | null };
  voice: { available: boolean; engine: string | null };
  /** Text-to-speech for the round table and stage views. */
  speech: { available: boolean };
  obsidian: { enabled: boolean };
  hermes: { configured: boolean };
  publicBaseUrl: string | null;
}

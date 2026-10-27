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
  url: string;
  snippet: string;
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
  clarification?: { question: string; answer?: string };
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

export interface Conversation {
  id: string;
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
  obsidian: { enabled: boolean };
  hermes: { configured: boolean };
  publicBaseUrl: string | null;
}

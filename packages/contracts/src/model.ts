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

export interface CouncilConfig {
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
  /** Text content made available to the council (text-like files only, truncated). */
  excerpt?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface Stage1Response {
  memberId: string;
  label: string;
  model: string;
  text: string;
  error?: string;
  ms: number;
}

export interface Stage2Review {
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
  /** Anonymous label -> member id. Revealed only after every review is in. */
  labelToMemberId: Record<string, string>;
  rankings: AggregateRank[];
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

/** The structured second opinion distilled from the council's work. */
export interface Brief {
  version: number;
  mode: CaseMode;
  /** One or two sentences: the answer. */
  bottomLine: string;
  /** Short label, e.g. "Likely community-acquired pneumonia", "Strong claim", "Do not merge". */
  verdict: string;
  confidence: number;
  consensus: string[];
  disagreements: { point: string; positions: string[] }[];
  redFlags: string[];
  /** Mode-specific sections (differential, legal issues, bugs & risks, ...). */
  sections: BriefSection[];
  nextSteps: NextStep[];
  openQuestions: string[];
  caveats: string[];
}

export interface HandoffResult {
  ok: boolean;
  simulated: boolean;
  error?: string;
  at: string;
}

export type TurnStage = "clarify" | "research" | "stage1" | "stage2" | "stage3" | "brief";

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
  clarification?: { question: string; answer?: string };
  research: SearchResult[];
  stage1: Stage1Response[];
  stage2: Stage2Review[];
  aggregate?: Stage2Aggregate;
  synthesis?: Synthesis;
  brief?: Brief;
  handoff?: HandoffResult;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface Conversation {
  id: string;
  title: string;
  mode: CaseMode;
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

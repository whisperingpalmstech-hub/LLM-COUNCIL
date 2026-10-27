import type { ProviderId } from "@synod/contracts";

export type CompletionPurpose = "clarify" | "answer" | "review" | "synthesis" | "brief";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  /** Ask the provider for a JSON object when it supports a JSON mode. */
  json?: boolean;
  purpose: CompletionPurpose;
  signal?: AbortSignal;
}

export interface Provider {
  readonly id: ProviderId;
  /** True when credentials (or a reachable local endpoint) are configured. */
  configured(): boolean;
  /** Model used when a council member leaves `model` blank. */
  defaultModel(): string;
  complete(request: CompletionRequest): Promise<string>;
}

export class ProviderError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, options: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

import { fetchJson, stripThinking } from "./http.ts";
import type { CompletionRequest, Provider } from "./types.ts";

/**
 * AnythingLLM workspace chat. The council member's `model` is the workspace slug;
 * the workspace owns its own model and RAG documents.
 */
export class AnythingLlmProvider implements Provider {
  readonly id = "anythingllm" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly defaultWorkspace: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; apiKey?: string; defaultWorkspace: string; timeoutMs: number }) {
    const base = options.baseUrl.replace(/\/+$/, "");
    this.baseUrl = base.endsWith("/api/v1") ? base : `${base}/api/v1`;
    this.apiKey = options.apiKey;
    this.defaultWorkspace = options.defaultWorkspace;
    this.timeoutMs = options.timeoutMs;
  }

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  defaultModel(): string {
    return this.defaultWorkspace;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const slug = encodeURIComponent(request.model || this.defaultWorkspace);
    // Workspace chat takes a single message, so fold system + history into it.
    const message = [
      request.system,
      ...request.messages.map((m) => (request.messages.length > 1 ? `${m.role.toUpperCase()}: ${m.content}` : m.content)),
      request.json ? "Respond with exactly one valid JSON object and nothing else." : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    const data = await fetchJson(`${this.baseUrl}/workspace/${slug}/chat`, {
      label: "anythingllm",
      timeoutMs: this.timeoutMs,
      signal: request.signal,
      headers: { Authorization: `Bearer ${this.apiKey ?? ""}` },
      body: { message, mode: "chat" }
    });
    return stripThinking(String(data.textResponse ?? ""));
  }
}

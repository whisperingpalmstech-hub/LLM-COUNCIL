import { fetchJson, fetchSse } from "./http.ts";
import type { CompletionRequest, Provider } from "./types.ts";

export class AnthropicProvider implements Provider {
  readonly id = "anthropic" as const;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; model: string; maxTokens: number; timeoutMs: number }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.maxTokens = options.maxTokens;
    this.timeoutMs = options.timeoutMs;
  }

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  defaultModel(): string {
    return this.model;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const system = [request.system, request.json ? "Respond with exactly one valid JSON object and nothing else." : ""]
      .filter(Boolean)
      .join("\n\n");
    const options = {
      label: "anthropic",
      timeoutMs: this.timeoutMs,
      signal: request.signal,
      headers: { "x-api-key": this.apiKey ?? "", "anthropic-version": "2023-06-01" },
      body: {
        model: request.model || this.model,
        max_tokens: this.maxTokens,
        ...(system ? { system } : {}),
        messages: request.messages,
        ...(request.onText ? { stream: true } : {})
      }
    };
    if (request.onText) {
      let text = "";
      await fetchSse("https://api.anthropic.com/v1/messages", options, (event) => {
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          text += event.delta.text;
          request.onText?.(text);
        }
      });
      return text.trim();
    }
    const data = await fetchJson("https://api.anthropic.com/v1/messages", options);
    return (data.content ?? [])
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("\n")
      .trim();
  }
}

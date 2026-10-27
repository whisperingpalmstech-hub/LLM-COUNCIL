import type { ProviderId } from "@synod/contracts";
import { fetchJson, stripThinking } from "./http.ts";
import type { CompletionRequest, Provider } from "./types.ts";

export interface OpenAiCompatibleOptions {
  id: ProviderId;
  baseUrl: string;
  apiKey?: string;
  defaultModel: string;
  /** Local endpoints (Ollama, RouteLLM) need no key; `enabled` decides whether they are offered. */
  requiresKey?: boolean;
  enabled?: boolean;
  supportsJsonMode?: boolean;
  extraHeaders?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  timeoutMs: number;
}

/**
 * One client for every provider that speaks the OpenAI chat-completions dialect:
 * OpenAI, DeepSeek, OpenRouter, SiliconFlow, Ollama (/v1), and RouteLLM.
 */
export class OpenAiCompatibleProvider implements Provider {
  readonly id: ProviderId;
  private readonly options: OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.id = options.id;
    this.options = options;
  }

  configured(): boolean {
    if (this.options.enabled === false) return false;
    return this.options.requiresKey === false || Boolean(this.options.apiKey);
  }

  defaultModel(): string {
    return this.options.defaultModel;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const { baseUrl, apiKey, extraHeaders, extraBody, supportsJsonMode = true, timeoutMs } = this.options;
    const messages = [
      ...(request.system ? [{ role: "system", content: request.system }] : []),
      ...request.messages
    ];
    const data = await fetchJson(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      label: this.id,
      timeoutMs,
      signal: request.signal,
      headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders },
      body: {
        model: request.model || this.options.defaultModel,
        messages,
        ...(request.json && supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
        ...extraBody
      }
    });
    return stripThinking(String(data.choices?.[0]?.message?.content ?? ""));
  }
}

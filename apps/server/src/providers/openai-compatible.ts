import type { ProviderId } from "@synod/contracts";
import { fetchJson, fetchSse, stripThinking } from "./http.ts";
import { ProviderError, type CompletionRequest, type Provider } from "./types.ts";

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
      ...request.messages.map((m) =>
        m.images?.length
          ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((img) => ({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } }))] }
          : { role: m.role, content: m.content }
      )
    ];
    const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const options = {
      label: this.id,
      timeoutMs,
      signal: request.signal,
      headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders },
      body: {
        model: request.model || this.options.defaultModel,
        messages,
        ...(request.json && supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(request.onText ? { stream: true } : {}),
        // OpenRouter's unified reasoning control; other OpenAI-compatible servers may reject the field.
        ...(request.effort && this.id === "openrouter" ? { reasoning: request.effort === "none" ? { enabled: false } : { effort: request.effort } } : {}),
        ...extraBody
      }
    };
    if (request.onText) {
      let text = "";
      await fetchSse(url, options, (data) => {
        // OpenRouter reports upstream failures inside the stream.
        if (data.error) throw new ProviderError(`${this.id}: ${data.error.message ?? "stream error"}`, { status: Number(data.error.code) || null, retryable: true });
        const delta = data.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) {
          text += delta;
          request.onText?.(stripThinking(text));
        }
      });
      return stripThinking(text);
    }
    const data = await fetchJson(url, options);
    return stripThinking(String(data.choices?.[0]?.message?.content ?? ""));
  }
}

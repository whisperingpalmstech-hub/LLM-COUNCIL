import { fetchJson } from "./http.ts";
import type { CompletionRequest, Provider } from "./types.ts";

export class GeminiProvider implements Provider {
  readonly id = "gemini" as const;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; model: string; timeoutMs: number }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
  }

  configured(): boolean {
    return Boolean(this.apiKey);
  }

  defaultModel(): string {
    return this.model;
  }

  async complete(request: CompletionRequest): Promise<string> {
    const model = encodeURIComponent(request.model || this.model);
    const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      label: "gemini",
      timeoutMs: this.timeoutMs,
      signal: request.signal,
      headers: { "x-goog-api-key": this.apiKey ?? "" },
      body: {
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: request.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        ...(request.json ? { generationConfig: { responseMimeType: "application/json" } } : {})
      }
    });
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();
  }
}

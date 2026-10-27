import { fetchJson, fetchSse } from "./http.ts";
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
    const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
    const options = {
      label: "gemini",
      timeoutMs: this.timeoutMs,
      signal: request.signal,
      headers: { "x-goog-api-key": this.apiKey ?? "" },
      body: {
        ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
        contents: request.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [...(m.images ?? []).map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.data } })), { text: m.content }]
        })),
        ...(request.json ? { generationConfig: { responseMimeType: "application/json" } } : {})
      }
    };
    const partsText = (data: any) => (data.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? "").join("");
    if (request.onText) {
      let text = "";
      await fetchSse(`${base}:streamGenerateContent?alt=sse`, options, (data) => {
        text += partsText(data);
        request.onText?.(text);
      });
      return text.trim();
    }
    const data = await fetchJson(`${base}:generateContent`, options);
    return partsText(data).trim();
  }
}

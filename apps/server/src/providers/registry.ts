import type { CouncilMember, ProviderId, ProviderStatus } from "@synod/contracts";
import type { Config } from "../config.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { AnythingLlmProvider } from "./anythingllm.ts";
import { GeminiProvider } from "./gemini.ts";
import { MockProvider } from "./mock.ts";
import { OpenAiCompatibleProvider } from "./openai-compatible.ts";
import { ProviderError, type CompletionRequest, type Provider } from "./types.ts";

export class ProviderRegistry {
  private readonly providers: Map<ProviderId, Provider>;
  private readonly maxRetries: number;

  constructor(providers: Provider[], options: { maxRetries?: number } = {}) {
    this.providers = new Map(providers.map((p) => [p.id, p]));
    this.maxRetries = options.maxRetries ?? 1;
  }

  static fromConfig(config: Config): ProviderRegistry {
    const env = config.env;
    const timeoutMs = config.requestTimeoutMs;
    return new ProviderRegistry(
      [
        new MockProvider({ delayMs: Number(env.MOCK_DELAY_MS) || 0 }),
        new OpenAiCompatibleProvider({ id: "openai", baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1", apiKey: env.OPENAI_API_KEY, defaultModel: env.OPENAI_MODEL || "gpt-4.1-mini", timeoutMs }),
        new OpenAiCompatibleProvider({ id: "deepseek", baseUrl: "https://api.deepseek.com", apiKey: env.DEEPSEEK_API_KEY, defaultModel: env.DEEPSEEK_MODEL || "deepseek-chat", timeoutMs }),
        new OpenAiCompatibleProvider({
          id: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: env.OPENROUTER_API_KEY,
          defaultModel: env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
          extraHeaders: { "HTTP-Referer": config.publicBaseUrl || "http://localhost", "X-Title": "Synod" },
          timeoutMs
        }),
        new OpenAiCompatibleProvider({ id: "siliconflow", baseUrl: env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1", apiKey: env.SILICONFLOW_API_KEY, defaultModel: env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-72B-Instruct", timeoutMs }),
        new OpenAiCompatibleProvider({
          id: "ollama",
          baseUrl: `${(env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "")}/v1`,
          requiresKey: false,
          enabled: Boolean(env.OLLAMA_BASE_URL),
          defaultModel: env.OLLAMA_MODEL || env.LOCAL_ROUTER_MODEL || "llama3.1:8b",
          timeoutMs
        }),
        new OpenAiCompatibleProvider({
          id: "routellm",
          baseUrl: `${(env.ROUTELLM_BASE_URL || "http://127.0.0.1:6060").replace(/\/+$/, "")}/v1`,
          apiKey: env.ROUTELLM_API_KEY,
          requiresKey: false,
          enabled: String(env.ROUTELLM_ENABLED).toLowerCase() === "true",
          supportsJsonMode: false,
          defaultModel: env.ROUTELLM_MODEL || `router-mf-${env.ROUTELLM_THRESHOLD || "0.11593"}`,
          timeoutMs
        }),
        new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || "claude-sonnet-5-5", maxTokens: Number(env.ANTHROPIC_MAX_TOKENS) || 4096, timeoutMs }),
        new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-2.5-flash", timeoutMs }),
        new AnythingLlmProvider({ baseUrl: env.ANYTHINGLLM_BASE_URL || "http://localhost:3001", apiKey: env.ANYTHINGLLM_API_KEY, defaultWorkspace: env.ANYTHINGLLM_WORKSPACE_DEFAULT || "synod", timeoutMs })
      ],
      { maxRetries: config.maxRetries }
    );
  }

  get(id: ProviderId): Provider {
    const provider = this.providers.get(id);
    if (!provider) throw new ProviderError(`Unknown provider: ${id}`);
    return provider;
  }

  status(): ProviderStatus[] {
    return [...this.providers.values()].map((p) => ({ provider: p.id, configured: p.configured() }));
  }

  /** Call a council member's model, retrying transient failures. */
  async complete(member: CouncilMember, request: Omit<CompletionRequest, "model">): Promise<string> {
    const provider = this.get(member.provider);
    if (!provider.configured()) throw new ProviderError(`${member.provider} is not configured.`);
    for (let attempt = 0; ; attempt++) {
      try {
        const text = await provider.complete({ ...request, model: member.model || provider.defaultModel() });
        if (!text.trim()) throw new ProviderError(`${member.provider} returned an empty response.`, { retryable: true });
        return text;
      } catch (error) {
        const retryable = error instanceof ProviderError && error.retryable;
        if (!retryable || attempt >= this.maxRetries || request.signal?.aborted) throw error;
        await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
      }
    }
  }

  /** A sensible starting council from whatever is configured; falls back to mock seats. */
  defaultMembers(): CouncilMember[] {
    const preferred: ProviderId[] = ["openai", "anthropic", "gemini", "deepseek", "openrouter", "siliconflow", "ollama", "anythingllm"];
    const members = preferred
      .map((id) => this.providers.get(id))
      .filter((p): p is Provider => Boolean(p?.configured()))
      .map((p): CouncilMember => ({ id: p.id, label: label(p.id), provider: p.id, model: p.defaultModel() }));
    if (members.length >= 2) return members.slice(0, 4);
    const mocks: CouncilMember[] = [
      { id: "mock-a", label: "Mock Analyst", provider: "mock", model: "mock-analyst" },
      { id: "mock-b", label: "Mock Skeptic", provider: "mock", model: "mock-skeptic" },
      { id: "mock-c", label: "Mock Strategist", provider: "mock", model: "mock-strategist" }
    ];
    return [...members, ...mocks].slice(0, 3);
  }
}

function label(id: ProviderId): string {
  return { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini", deepseek: "DeepSeek", openrouter: "OpenRouter", siliconflow: "SiliconFlow", ollama: "Ollama", routellm: "RouteLLM", anythingllm: "AnythingLLM", mock: "Mock" }[id];
}

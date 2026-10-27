import type { SearchResult } from "@synod/contracts";
import type { Env } from "../config.ts";
import { fetchJson } from "../providers/http.ts";

/** Optional web search (Tavily preferred, Perplexity fallback). */
export class WebSearch {
  private readonly env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  provider(): "tavily" | "perplexity" | null {
    return this.env.TAVILY_API_KEY ? "tavily" : this.env.PERPLEXITY_API_KEY ? "perplexity" : null;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const q = query.slice(0, 400);
    if (this.env.TAVILY_API_KEY) {
      const data = await fetchJson("https://api.tavily.com/search", {
        label: "tavily",
        timeoutMs: 15_000,
        signal,
        headers: { Authorization: `Bearer ${this.env.TAVILY_API_KEY}` },
        body: { query: q, search_depth: "basic", max_results: 5 }
      });
      return (data.results ?? []).map((r: any) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: String(r.content ?? "") }));
    }
    if (this.env.PERPLEXITY_API_KEY) {
      const data = await fetchJson("https://api.perplexity.ai/chat/completions", {
        label: "perplexity",
        timeoutMs: 30_000,
        signal,
        headers: { Authorization: `Bearer ${this.env.PERPLEXITY_API_KEY}` },
        body: { model: this.env.PERPLEXITY_MODEL || "sonar", messages: [{ role: "user", content: `Research concisely with sources: ${q}` }], max_tokens: 500 }
      });
      const answer = String(data.choices?.[0]?.message?.content ?? "");
      const citations: string[] = Array.isArray(data.citations) ? data.citations : [];
      return [{ title: "Perplexity summary", url: citations[0] ?? "https://www.perplexity.ai/", snippet: answer }, ...citations.slice(1, 5).map((url, i) => ({ title: `Source ${i + 2}`, url, snippet: "" }))];
    }
    return [];
  }
}

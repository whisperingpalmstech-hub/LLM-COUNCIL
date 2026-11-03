import type { SearchResult } from "@synod/contracts";
import type { Env } from "../config.ts";
import { fetchJson } from "../providers/http.ts";

/** Optional web search via Exa. */
export class WebSearch {
  private readonly env: Env;
  constructor(env: Env) {
    this.env = env;
  }

  provider(): "exa" | null {
    return this.env.EXA_API_KEY ? "exa" : null;
  }

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    if (!this.env.EXA_API_KEY) return [];
    const data = await fetchJson("https://api.exa.ai/search", {
      label: "exa",
      timeoutMs: 15_000,
      signal,
      headers: { "x-api-key": this.env.EXA_API_KEY },
      body: { query: query.slice(0, 400), numResults: 5, contents: { highlights: { numSentences: 3, highlightsPerUrl: 2 } } }
    });
    return (data.results ?? []).map((r: any) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), snippet: (r.highlights ?? []).join(" … ") || String(r.text ?? "").slice(0, 600) }));
  }
}

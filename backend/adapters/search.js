export class SearchClient {
  constructor(env = process.env) {
    this.env = env;
  }

  async health() {
    if (this.env.TAVILY_API_KEY) return { ok: true, provider: "tavily", mode: "real-ready" };
    if (this.env.PERPLEXITY_API_KEY) return { ok: true, provider: "perplexity", mode: "real-ready" };
    return { ok: true, provider: "mock", mode: "mock" };
  }

  async search(query) {
    if (this.env.TAVILY_API_KEY) return tavily(this.env.TAVILY_API_KEY, query);
    return [
      { title: "Mock source A", url: "https://example.com/a", snippet: `Current evidence about ${query} is mixed but actionable with caveats.`, relevance: 0.72 },
      { title: "Mock source B", url: "https://example.com/b", snippet: "Use trusted sources and record ambiguity where results conflict.", relevance: 0.68 }
    ];
  }
}

async function tavily(key, query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, search_depth: "basic", max_results: 5 })
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((item) => ({ title: item.title, url: item.url, snippet: item.content, relevance: item.score ?? 0.5 }));
}

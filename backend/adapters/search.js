export class SearchClient {
  constructor(env = process.env) {
    this.env = env;
  }

  async health() {
    const provider = this.env.TAVILY_API_KEY ? "tavily" : this.env.PERPLEXITY_API_KEY ? "perplexity" : null;
    if (!provider) return { ok: false, configured: false, provider: null, mode: "disabled", message: "TAVILY_API_KEY or PERPLEXITY_API_KEY is required." };
    try {
      const results = await this.search("renewable energy");
      return { ok: results.length > 0, configured: true, provider, mode: "real", resultCount: results.length };
    } catch (error) {
      return { ok: false, configured: true, provider, mode: "real", error: error?.name === "AbortError" ? "Search health check timed out." : error.message };
    }
  }

  async search(query) {
    if (this.env.TAVILY_API_KEY) return tavily(this.env.TAVILY_API_KEY, query);
    if (this.env.PERPLEXITY_API_KEY) return perplexity(this.env.PERPLEXITY_API_KEY, query, this.env.PERPLEXITY_MODEL);
    return [];
  }
}

async function tavily(key, query) {
  const res = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, search_depth: "basic", max_results: 5 })
  }, 12000);
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).map((item) => ({ title: item.title, url: item.url, snippet: item.content, relevance: item.score ?? 0.5 }));
}

async function perplexity(key, query, model = "sonar") {
  const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: `Research this query and answer concisely with factual sources: ${query}` }],
      max_tokens: 300
    })
  }, 15000);
  if (!res.ok) throw new Error(`Perplexity ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  const citations = Array.isArray(data.citations) ? data.citations : [];
  if (!citations.length) {
    return [{ title: "Perplexity answer", url: "https://www.perplexity.ai/", snippet: content, relevance: 0.7 }];
  }
  return citations.map((url, index) => ({
    title: `Perplexity source ${index + 1}`,
    url,
    snippet: content,
    relevance: Math.max(0.5, 0.9 - index * 0.05)
  }));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

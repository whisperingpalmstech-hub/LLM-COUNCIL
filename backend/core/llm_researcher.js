import { SearchClient } from "../adapters/search.js";
import { LlmAdapter } from "../adapters/llm.js";
import { PromptRegistry } from "./prompt_registry.js";

export class LlmResearcher {
  constructor({ db }) {
    this.db = db;
    this.searchClient = new SearchClient();
    this.llm = new LlmAdapter({ db });
    this.prompts = new PromptRegistry(db);
  }

  async researchLatestModels() {
    console.log("[LLM Researcher] Executing weekly benchmark search...");
    const query = "latest LLM models benchmarks 2026 open source local API";
    let searchResults = [];
    try {
      searchResults = await this.searchClient.search(query);
    } catch (e) {
      console.warn("[LLM Researcher] Web search failed, using fallback:", e.message);
    }

    const context = searchResults.map(r => `Source: ${r.title} (${r.url})\nSnippet: ${r.snippet}`).join("\n\n");
    const role = {
      role_type: "SYNTHESIST",
      display_name: "Meta Strategist",
      model_name: process.env.LOCAL_ROUTER_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash"
    };

    const prompt = `${this.prompts.text("research.model_recommendation")}\n\nResearch context:\n${context || "Live research unavailable; do not present current claims as verified."}\n\nReturn a strict JSON array. Each item requires model_name, provider, type, reasoning_score, and description.`;

    let recommendations = [];
    try {
      if ((process.env.PROVIDER_MODE ?? "mock") !== "mock") {
        const result = await this.llm.complete({
          role,
          topic: "Research latest LLM models",
          round: "Research",
          priorMessages: [],
          compact: false,
          customPrompt: prompt
        });
        const text = result.content || "";
        const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        recommendations = JSON.parse(cleaned);
      } else {
        // Mock recommendations
        recommendations = [
          {
            model_name: "llama3.2:latest",
            provider: "ollama",
            type: "local",
            reasoning_score: 7,
            description: "Llama 3.2 is highly optimized for resource-constrained devices, offering great speed locally."
          },
          {
            model_name: "gemini-2.5-flash",
            provider: "gemini",
            type: "api",
            reasoning_score: 8,
            description: "High speed API with massive context and multimodal capabilities, very cost-efficient."
          },
          {
            model_name: "claude-3-5-sonnet",
            provider: "anthropic",
            type: "api",
            reasoning_score: 10,
            description: "Industry gold standard for complex coding and strategic multi-agent reasoning tasks."
          }
        ];
      }
    } catch (e) {
      console.error("[LLM Researcher] Failed parsing recommendations:", e);
      // Fallback
      recommendations = [
        { model_name: "llama3:8b", provider: "ollama", type: "local", reasoning_score: 7, description: "Solid local benchmark performer." }
      ];
    }

    // Save report to settings
    this.db.prepare("insert or replace into system_settings (key, value) values (?, ?)")
      .run("LATEST_LLM_RECOMMENDATIONS", JSON.stringify(recommendations));
    
    this.db.prepare("insert or replace into system_settings (key, value) values (?, ?)")
      .run("LATEST_LLM_RESEARCH_TIME", new Date().toISOString());

    console.log(`[LLM Researcher] Successfully researched and saved ${recommendations.length} recommendations.`);
    return recommendations;
  }
}

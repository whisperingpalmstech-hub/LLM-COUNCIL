export class AnythingLlmClient {
  constructor(env = process.env) {
    this.baseUrl = env.ANYTHINGLLM_BASE_URL;
    this.apiKey = env.ANYTHINGLLM_API_KEY;
  }

  async health() {
    if (!this.baseUrl || !this.apiKey) return { ok: true, mode: "mock", message: "AnythingLLM mock is active." };
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/workspaces`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      return { ok: res.ok, mode: "real", status: res.status };
    } catch (error) {
      return { ok: false, mode: "real", error: error.message };
    }
  }

  async retrieve({ topic, workspaceId }) {
    if (!this.baseUrl || !this.apiKey || !workspaceId) {
      return [{ title: "Mock workspace note", snippet: `Mock RAG context for ${topic}: use staged rollout and explicit provenance.` }];
    }
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/workspace/${workspaceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ message: topic, mode: "query" })
      });
      if (!res.ok) throw new Error(`AnythingLLM ${res.status}`);
      const data = await res.json();
      return [{ title: `AnythingLLM ${workspaceId}`, snippet: data.textResponse ?? JSON.stringify(data).slice(0, 500) }];
    } catch (error) {
      return [{ title: "AnythingLLM fallback", snippet: `Fallback after ${error.message}` }];
    }
  }

  async chat({ workspaceId, prompt, mode = "chat" }) {
    if (!workspaceId) throw new Error("AnythingLLM workspace_id is required for workspace-chain execution.");
    if (!this.baseUrl || !this.apiKey) {
      return {
        mode: "mock",
        textResponse: JSON.stringify({
          confidence: 0.72,
          shortSummary: `Mock AnythingLLM workspace ${workspaceId} responded as a council agent.`,
          keyClaims: [
            `Workspace ${workspaceId} can act as an isolated council agent.`,
            "Synod should validate and render compact structured responses."
          ],
          knowledgeGaps: ["Connect a real AnythingLLM instance to replace this mock response."],
          agreements: [],
          disagreements: [],
          verifications: [],
          falsifications: [],
          knowledgeSourcesUsed: [{ type: "ANYTHINGLLM_WORKSPACE", workspaceId, mode: "mock" }],
          flags: ["MOCK_ANYTHINGLLM"]
        })
      };
    }
    const res = await fetch(`${this.baseUrl}/api/v1/workspace/${workspaceId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ message: prompt, mode })
    });
    if (!res.ok) throw new Error(`AnythingLLM workspace chat failed with HTTP ${res.status}`);
    return { mode: "real", ...(await res.json()) };
  }
}

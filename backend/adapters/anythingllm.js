import { openDatabase } from "../db/sqlite.js";

export class AnythingLlmClient {
  constructor(env = process.env, options = {}) {
    this.env = env;
    const resolve = (raw) => {
      if (!raw) return raw;
      // Normalise: ensure the base URL includes /api/v1 (bare host -> host/api/v1)
      return raw.endsWith("/api/v1") ? raw : raw.replace(/\/$/, "") + "/api/v1";
    };
    try {
      const db = options.db ?? openDatabase();
      const settings = db.prepare("select key, value from system_settings").all().reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});
      this.baseUrl = resolve(settings.ANYTHINGLLM_BASE_URL || settings.ANYTHING_LLM_URL || env.ANYTHINGLLM_BASE_URL) || "http://localhost:3001/api/v1";
      this.apiKey = settings.ANYTHINGLLM_API_KEY || settings.ANYTHING_LLM_API_KEY || env.ANYTHINGLLM_API_KEY;
    } catch(e) {
      this.baseUrl = resolve(env.ANYTHINGLLM_BASE_URL) || "http://localhost:3001/api/v1";
      this.apiKey = env.ANYTHINGLLM_API_KEY;
    }
  }

  async health() {
    if (!this.baseUrl || !this.apiKey) return { ok: false, configured: false, mode: "disabled", message: "AnythingLLM is not configured." };
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/auth`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      }, 10000);
      return { ok: res.ok, configured: true, mode: "real", status: res.status };
    } catch (error) {
      return { ok: false, mode: "real", error: error.message };
    }
  }

  async retrieve({ topic, workspaceId }) {
    if (!this.baseUrl || !this.apiKey || !workspaceId) {
      return [{ title: "Mock workspace note", snippet: `Mock RAG context for ${topic}: use staged rollout and explicit provenance.` }];
    }
    try {
      const res = await fetch(`${this.baseUrl}/workspace/${workspaceId}/chat`, {
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
      throw new Error("AnythingLLM is not configured.");
    }
    const res = await fetchWithTimeout(`${this.baseUrl}/workspace/${encodeURIComponent(workspaceId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ message: prompt, mode })
    }, anythingRequestTimeoutMs(this.env));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const detail = body.error || body.message;
      throw new Error(`AnythingLLM workspace chat failed with HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return { mode: "real", ...(await res.json()) };
  }

  async createWorkspace(name) {
    if (!this.baseUrl || !this.apiKey) return { slug: name.toLowerCase().replace(/[^a-z0-9]/g, "-") };
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/workspaces/new`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ name })
      }, anythingRequestTimeoutMs(this.env));
      if (!res.ok) throw new Error(`Failed to create workspace: ${res.status}`);
      const data = await res.json();
      return data.workspace; // returns { id, name, slug }
    } catch (err) {
      console.error("[AnythingLLM Client] createWorkspace error:", err.message);
      return { slug: name.toLowerCase().replace(/[^a-z0-9]/g, "-") };
    }
  }

  async uploadAndEmbedFile(workspaceSlug, fileName, fileDataUrl, fileMime) {
    if (!this.baseUrl || !this.apiKey) return true;
    try {
      const matches = fileDataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches) throw new Error("Invalid base64 data url");
      const buffer = Buffer.from(matches[2], "base64");
      
      const formData = new FormData();
      const blob = new Blob([buffer], { type: fileMime });
      formData.append("file", blob, fileName);

      const uploadRes = await fetchWithTimeout(`${this.baseUrl}/document/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        body: formData
      }, anythingRequestTimeoutMs(this.env));
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      const uploadData = await uploadRes.json();
      
      const docLocation = uploadData.documents?.[0]?.location;
      if (!docLocation) throw new Error("No document location returned from upload");

      const embedRes = await fetchWithTimeout(`${this.baseUrl}/workspace/${encodeURIComponent(workspaceSlug)}/update-embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          adds: [docLocation],
          deletes: []
        })
      }, anythingRequestTimeoutMs(this.env));
      if (!embedRes.ok) throw new Error(`Embedding update failed: ${embedRes.status}`);
      console.log(`[AnythingLLM Client] Vectorized document ${fileName} into workspace ${workspaceSlug}`);
      return true;
    } catch (err) {
      console.error("[AnythingLLM Client] uploadAndEmbedFile error:", err.message);
      return false;
    }
  }
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

function anythingRequestTimeoutMs(env) {
  // AnythingLLM is an optional workspace/memory integration. Keep it bounded
  // independently from a primary model request so an offline Docker service
  // never makes a council turn appear frozen.
  const configured = Number(env.ANYTHINGLLM_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 5000 && configured <= 60000 ? configured : 15000;
}

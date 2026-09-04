import "dotenv/config";
import { openDatabase } from "../backend/db/sqlite.js";

let savedSettings = {};
try {
  savedSettings = Object.fromEntries(
    openDatabase().prepare("select key, value from system_settings").all().map(({ key, value }) => [key, value])
  );
} catch {
  // A fresh install may not have a migrated database yet; environment values
  // remain the bootstrap source in that case.
}

const rawUrl = savedSettings.ANYTHINGLLM_BASE_URL || savedSettings.ANYTHING_LLM_URL || process.env.ANYTHINGLLM_BASE_URL || "http://localhost:3001/api/v1";
const baseUrl = rawUrl.endsWith("/api/v1") ? rawUrl : rawUrl.replace(/\/+$/, "") + "/api/v1";
const apiKey = savedSettings.ANYTHINGLLM_API_KEY || savedSettings.ANYTHING_LLM_API_KEY || process.env.ANYTHINGLLM_API_KEY || "";

const workspaces = [
  { name: "LLM Council Lead Synthesist", slug: "llm-council-lead-synthesist" },
  { name: "LLM Council Domain Expert", slug: "llm-council-domain-expert" },
  { name: "LLM Council Marketing Sales", slug: "llm-council-marketing-sales" },
  { name: "LLM Council Policy Reviewer", slug: "llm-council-policy-reviewer" },
  { name: "LLM Council Risk Officer", slug: "llm-council-risk-officer" }
];


async function setupWorkspaces() {
  console.log(`[AnythingLLM Setup] Connecting to ${baseUrl}...`);
  
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const listResponse = await fetch(`${baseUrl}/workspaces`, { headers });
    if (!listResponse.ok) throw new Error(`Workspace listing failed with HTTP ${listResponse.status}`);
    const existing = new Map((await listResponse.json()).workspaces.map((workspace) => [workspace.slug, workspace]));

    for (const ws of workspaces) {
      if (existing.has(ws.slug)) {
        console.log(`[AnythingLLM Setup] Workspace ready: ${ws.slug}`);
        continue;
      }
      const res = await fetch(`${baseUrl}/workspace/new`, {
        method: "POST",
        headers,
        // Using the desired slug as the name makes creation deterministic and
        // avoids AnythingLLM adding random suffixes to title-cased duplicates.
        body: JSON.stringify({ name: ws.slug })
      });

      if (res.ok) {
        const created = (await res.json()).workspace;
        if (created?.slug !== ws.slug) throw new Error(`Expected workspace slug ${ws.slug}, received ${created?.slug || "unknown"}`);
        console.log(`[AnythingLLM Setup] Created workspace: ${ws.slug}`);
      } else {
        const text = await res.text();
        throw new Error(`Workspace ${ws.slug} failed with HTTP ${res.status}: ${text}`);
      }
    }

    console.log("[AnythingLLM Setup] Workspace setup completed successfully!");
  } catch (err) {
    console.error("[AnythingLLM Setup] Failed to connect to AnythingLLM:", err.message);
    console.log("Ensure AnythingLLM is running on port 3001 first.");
    process.exitCode = 1;
  }
}

setupWorkspaces();

import "dotenv/config";

const baseUrl = process.env.ANYTHINGLLM_BASE_URL || "http://localhost:3001/api/v1";
const apiKey = process.env.ANYTHINGLLM_API_KEY || "";

const workspaces = [
  { name: "LLM Council Lead Synthesist", slug: "llm-council-lead-synthesist" },
  { name: "LLM Council Domain Expert", slug: "llm-council-domain-expert" },
  { name: "LLM Council Growth & Marketing", slug: "llm-council-marketing-sales" },
  { name: "LLM Council Policy Reviewer", slug: "llm-council-policy-reviewer" },
  { name: "LLM Council Risk Officer", slug: "llm-council-risk-officer" }
];


async function setupWorkspaces() {
  console.log(`[AnythingLLM Setup] Connecting to ${baseUrl}...`);
  
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    for (const ws of workspaces) {
      const res = await fetch(`${baseUrl}/workspace/new`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: ws.name })
      });

      if (res.ok) {
        console.log(`[AnythingLLM Setup] Created workspace: ${ws.name} (${ws.slug})`);
      } else {
        const text = await res.text();
        console.log(`[AnythingLLM Setup] Workspace ${ws.name} response: ${res.status} - ${text}`);
      }
    }

    console.log("[AnythingLLM Setup] Workspace setup completed successfully!");
  } catch (err) {
    console.error("[AnythingLLM Setup] Failed to connect to AnythingLLM:", err.message);
    console.log("Ensure AnythingLLM is running on port 3001 first.");
  }
}

setupWorkspaces();

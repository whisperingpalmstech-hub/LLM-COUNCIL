import { AnythingLlmClient } from "./anythingllm.js";

export class LlmAdapter {
  constructor(options = {}) {
    if (options && !options.db && !options.env && typeof options.hasOwnProperty === 'function') {
      this.env = options;
      this.db = undefined;
    } else {
      this.env = options.env ?? process.env;
      this.db = options.db;
    }
    this.anything = new AnythingLlmClient(this.env);
  }

  async complete({ role, topic, round, priorMessages = [], compact = true, customPrompt }) {
    // If model_name is explicitly anythingllm, use workspace chat
    if (isAnythingLlmRole(role)) {
      return await this.callAnythingLlmWorkspace({ role, topic, round, priorMessages, compact, customPrompt });
    }
    // Primary provider: AnythingLLM — route all roles through workspace slugs
    if ((this.env.PROVIDER_MODE ?? "mock") === "anythingllm") {
      return await this.callAnythingLlmByRoleType({ role, topic, round, priorMessages, compact, customPrompt });
    }
    if ((this.env.PROVIDER_MODE ?? "mock") !== "mock") {
      const real = await this.tryRealProvider({ role, topic, round, priorMessages, compact, customPrompt });
      if (real) return real;
    }
    return mockCompletion({ role, topic, round, compact });
  }

  async callAnythingLlmByRoleType({ role, topic, round, priorMessages, compact, customPrompt }) {
    const roleType = role.role_type?.toUpperCase() ?? "DEFAULT";
    const slugKey = `ANYTHINGLLM_WORKSPACE_${roleType}`;
    const slug = this.env[slugKey] || this.env.ANYTHINGLLM_WORKSPACE_DEFAULT || "llm-council-lead-synthesist";
    const baseUrl = (this.env.ANYTHINGLLM_BASE_URL || "http://localhost:3001").replace(/\/$/, "") + "/api/v1";
    const apiKey = this.env.ANYTHINGLLM_API_KEY;

    const prompt = providerPrompt({ role, topic, round, priorMessages, compact, customPrompt }, this.db);
    try {
      const res = await fetch(`${baseUrl}/workspace/${slug}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ message: prompt, mode: "chat" })
      });
      if (!res.ok) throw new Error(`AnythingLLM ${res.status}`);
      const data = await res.json();
      let text = data.textResponse ?? "";
      // Strip <think>...</think> reasoning blocks from DeepSeek etc.
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const parsed = parseProviderJson(text, { role, topic, round });
      parsed.payload.knowledgeSourcesUsed = [
        ...asArray(parsed.payload.knowledgeSourcesUsed),
        { type: "ANYTHINGLLM_WORKSPACE", workspace: slug, model: data.metrics?.model ?? "unknown" }
      ];
      return parsed;
    } catch (err) {
      console.warn(`[AnythingLLM] Workspace ${slug} failed for role ${roleType}: ${err.message}. Using mock.`);
      return mockCompletion({ role, topic, round, compact });
    }
  }



  async checkEntropy(topic) {
    const prompt = `Evaluate the following user topic for clarity, logical coherence, and feasibility.
Topic: ${topic}
Return ONLY strict JSON with two fields:
- entropyScore: A number from 0 to 100, where 100 is perfectly clear and highly actionable, and 0 is gibberish or extremely vague.
- feedback: A short 1-sentence explanation of why it received this score, and what details are missing if the score is low.`;

    if ((this.env.PROVIDER_MODE ?? "mock") === "anythingllm") {
      try {
        const slug = this.env.ANYTHINGLLM_WORKSPACE_DEFAULT || "llm-council-lead-synthesist";
        const baseUrl = (this.env.ANYTHINGLLM_BASE_URL || "http://localhost:3001").replace(/\/$/, "") + "/api/v1";
        const res = await fetch(`${baseUrl}/workspace/${slug}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.ANYTHINGLLM_API_KEY}` },
          body: JSON.stringify({ message: prompt, mode: "chat" })
        });
        if (res.ok) {
          const data = await res.json();
          let text = (data.textResponse ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
          const json = JSON.parse(text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1));
          if (typeof json.entropyScore === "number") return json;
        }
      } catch (err) {
        console.warn("[AnythingLLM] Entropy check failed, using mock:", err.message);
      }
    }

    if ((this.env.PROVIDER_MODE ?? "mock") !== "mock" && (this.env.PROVIDER_MODE ?? "mock") !== "anythingllm") {
      try {
        const role = { role_type: "ENTROPY_CHECKER", display_name: "Entropy Checker", model_name: this.env.LOCAL_ROUTER_MODEL || this.env.OPENAI_MODEL || "gpt-4.1-mini" };
        let result = await this.tryRealProvider({ role, topic, round: "Entropy", priorMessages: [], compact: false, customPrompt: prompt });
        if (result && result.payload) return result.payload;
      } catch (err) {
        console.warn("Real provider failed entropy check, using mock.");
      }
    }
    
    // Mock logic: length and some keywords determine score
    const score = Math.min(100, Math.max(0, topic.length > 50 ? 80 : topic.length * 1.5));
    return {
      entropyScore: score,
      feedback: score > 30 ? "Topic is sufficiently clear." : "Topic is too vague or brief. Please provide more context or specific goals."
    };
  }

  async callAnythingLlmWorkspace(input) {
    // If no specific workspace is assigned yet, use role-type-based routing
    if (!input.role.workspace_id) {
      return await this.callAnythingLlmByRoleType(input);
    }
    try {
      const response = await this.anything.chat({
        workspaceId: input.role.workspace_id,
        prompt: providerPrompt(input, this.db),
        mode: "chat"
      });
      let text = response.textResponse ?? response.response ?? response.message ?? JSON.stringify(response);
      // Strip <think>...</think> reasoning blocks
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      const parsed = parseProviderJson(text, input);
      parsed.payload.knowledgeSourcesUsed = [
        ...asArray(parsed.payload.knowledgeSourcesUsed),
        { type: "ANYTHINGLLM_WORKSPACE", workspaceId: input.role.workspace_id, mode: response.mode ?? "real" }
      ];
      parsed.content = parsed.content || parsed.payload.shortSummary;
      return parsed;
    } catch (error) {
      const fallback = mockCompletion(input);
      fallback.payload.flags = [...asArray(fallback.payload.flags), "ANYTHINGLLM_FALLBACK"];
      fallback.payload.knowledgeSourcesUsed = [
        ...asArray(fallback.payload.knowledgeSourcesUsed),
        { type: "ANYTHINGLLM_WORKSPACE", workspaceId: input.role.workspace_id ?? null, mode: "fallback", error: error.message }
      ];
      return {
        payload: fallback.payload,
        content: `AnythingLLM workspace fallback was used: ${error.message}`,
        warning: `AnythingLLM fallback: ${error.message}`
      };
    }
  }

  async tryRealProvider(input) {
    try {
      const model = input.role.model_name ?? "";
      if (this.env.SILICONFLOW_API_KEY && (model.includes("siliconflow") || /qwen|deepseek/i.test(model))) {
        return await callSiliconFlow(this.env, input, this.db);
      }
      if (this.env.OLLAMA_BASE_URL && (model.includes("llama") || model.includes("mistral") || model.includes("ollama"))) {
        return await callOllama(this.env, input, this.db);
      }
      if (this.env.OPENAI_API_KEY && /openai|gpt/i.test(model)) {
        return await callOpenAI(this.env, input, this.db);
      }
      if (this.env.ANTHROPIC_API_KEY && /claude|anthropic/i.test(model)) {
        return await callAnthropic(this.env, input, this.db);
      }
      if (this.env.GEMINI_API_KEY && /gemini/i.test(model)) {
        return await callGemini(this.env, input, this.db);
      }
    } catch (error) {
      return {
        payload: mockCompletion(input).payload,
        content: `Provider failed and mock fallback was used: ${error.message}`,
        warning: `Provider fallback: ${error.message}`
      };
    }
    return null;
  }
}


async function callSiliconFlow(env, input, db) {
  const model = input.role.model_name && !["anythingllm", "mock-fast", "mock-deep", "siliconflow"].includes(input.role.model_name)
                ? input.role.model_name : (env.SILICONFLOW_MODEL || "Qwen/Qwen2.5-72B-Instruct");
  const baseUrl = env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";
  
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${env.SILICONFLOW_API_KEY}` 
    },
    body: JSON.stringify({
      model: model,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: providerPrompt(input, db) }]
    })
  });
  if (!res.ok) throw new Error(`SiliconFlow ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.choices?.[0]?.message?.content, input);
}

async function callOpenAI(env, input, db) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: providerPrompt(input, db) }]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.choices?.[0]?.message?.content, input);
}


async function callAnthropic(env, input, db) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4",
      max_tokens: 800,
      messages: [{ role: "user", content: providerPrompt(input, db) }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.content?.[0]?.text, input);
}

async function callGemini(env, input, db) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: providerPrompt(input, db) }] }] })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.candidates?.[0]?.content?.parts?.[0]?.text, input);
}

async function callOllama(env, input, db) {
  const model = env.LOCAL_ROUTER_MODEL || "llama3.1:8b";
  const targetModel = (input.role.model_name && !["anythingllm", "mock-fast", "mock-deep"].includes(input.role.model_name)) 
                      ? input.role.model_name : model;
                      
  const baseUrl = env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: targetModel,
      messages: [{ role: "user", content: providerPrompt(input, db) }],
      stream: false,
      format: "json"
    })
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.message?.content, input);
}

function providerPrompt({ role, topic, round, priorMessages, compact, customPrompt }, db) {
  if (customPrompt) return customPrompt;

  const getSetting = (key, fallback) => {
    if (!db) return fallback;
    try {
      const row = db.prepare("select value from system_settings where key = ?").get(key);
      return row ? row.value : fallback;
    } catch (e) {
      return fallback;
    }
  };
  
  if (role.role_type === "VERDICT") {
    const tpl = getSetting("PROMPT_VERDICT", `You MUST return strict JSON for the Final Executive Verdict of the deliberation. Do NOT output any conversational text outside the JSON.
Topic: {{topic}}
Prior deliberations: {{priorMessages}}
You must synthesize the prior deliberations into a final executive verdict.
Required JSON fields: 
- shortSummary: A 1-2 sentence high-level executive summary of the final verdict.
- keyClaims: An array of the final agreed upon points and recommendations.
- disagreements: An array of any remaining unresolved tensions.
- confidence: A number between 0.0 and 1.0 representing the final confidence level.`);
    return tpl
      .replace("{{topic}}", topic)
      .replace("{{priorMessages}}", JSON.stringify(priorMessages).slice(0, 8000));
  }
  if (role.role_type === "INTERVIEWER") {
    const tpl = getSetting("PROMPT_INTERVIEWER", `You MUST return strict JSON for the Pre-Session Interview. Do NOT output any conversational text outside the JSON.
Your goal is to interview the user to clarify their intent and desired outcomes for the following topic:
Topic: {{topic}}
Prior conversation: {{priorMessages}}
Ask exactly ONE clarifying question, or if you feel the intention is fully clear, set isSatisfied to true and provide the refined topic.
Required JSON fields:
- question: The next question to ask the user.
- isSatisfied: boolean, true if no more questions are needed.
- refinedTopic: The fully clarified, detailed topic/prompt (required if isSatisfied is true).
- confidenceScore: An integer from 0 to 100 representing how confident you are that the user's intent is understood.`);
    return tpl
      .replace("{{topic}}", topic)
      .replace("{{priorMessages}}", JSON.stringify(priorMessages).slice(0, 8000));
  }

  if (role.role_type === "DOOM_COUNCIL") {
    return `You are the DOOM COUNCIL (Catastrophe Analyst / Regulatory Assassin).
Your ONLY job is to figure out how this plan completely fails and results in total destruction or bankruptcy.
Topic: ${topic}
Current Round: ${round}

Prior Council Messages:
${priorMessages.map((m) => `[${m.role_id} / ${m.model_name} (Round ${m.round_number})]: ${m.content}`).join("\n\n") || "None (First Round)"}

You MUST respond strictly in the following JSON format. Do not output conversational text.
{
  "shortSummary": "A 1-sentence summary of the biggest extinction-level threat.",
  "confidenceScore": <integer 0-100>,
  "extinctionEvents": ["threat 1", "threat 2"],
  "blackSwans": ["black swan 1"]
}`;
  }

  if (role.role_type === "RISK_OFFICER") {
    // We should pass the DB connection to the providerPrompt or fetch settings earlier.
    // Instead of passing it, let's inject a placeholder or pass it through.
    // Since providerPrompt is pure-ish, let's just use 5% or read from env for now if DB isn't passed,
    // actually we can just pass settings from the adapter.
    return `You are the Risk Officer.
Your job is to calculate Expected Value (EV) and apply the Kelly Criterion.
Topic: ${topic}
Current Round: ${round}

Prior Council Messages:
${priorMessages.map((m) => `[${m.role_id} / ${m.model_name} (Round ${m.round_number})]: ${m.content}`).join("\n\n") || "None (First Round)"}

Evaluate the probability of success and expected upside. Apply the Kelly Criterion to recommend a max bet size as a percentage of total capital.
CRITICAL CIRCUIT BREAKER: If your recommended Kelly bet size is > ${global.KELLY_PERCENT || 5}%, you MUST issue a Hard Veto.

You MUST respond strictly in the following JSON format. Do not output conversational text.
{
  "shortSummary": "A 1-sentence summary of risk.",
  "confidenceScore": <integer 0-100>,
  "estimatedWinProbability": <0.0-1.0>,
  "recommendedBetPercentage": <0.0-1.0>,
  "hardVeto": <boolean, true if bet > ${global.KELLY_PERCENT ? global.KELLY_PERCENT/100 : 0.05}>,
  "vetoReason": "Reason if vetoed"
}`;
  }

  if (role.role_type === "MARKETING_SALES") {
    return `You are the Growth & Marketing Strategist.
Your job is to analyze market demand, competitive positioning, customer acquisition strategies, pricing models, and Go-To-Market (GTM) tactics for the proposed decision.
Topic: ${topic}
Current Round: ${round}

Prior Council Messages:
${priorMessages.map((m) => `[${m.role_id} / ${m.model_name} (Round ${m.round_number})]: ${m.content}`).join("\n\n") || "None (First Round)"}

Evaluate target customer segments, pricing elasticity, acquisition channels, and GTM execution.

You MUST respond strictly in the following JSON format. Do not output conversational text.
{
  "shortSummary": "A 1-2 sentence high-level GTM and marketing strategy stance.",
  "confidenceScore": <integer 0-100 representing market feasibility and demand confidence>,
  "keyClaims": ["GTM claim 1", "Pricing recommendation 2"],
  "agreements": ["agreement 1"],
  "disagreements": ["disagreement 1"],
  "knowledgeGaps": ["gap 1"]
}`;
  }

  if (role.role_type === "EXECUTION_PLANNER") {

    return `You MUST return strict JSON for the Execution Plan. Do NOT output any conversational text outside the JSON.
This is the Polyglot Formatter. You must format the tasks according to the target engine.
Topic: ${topic}
Council Verdict: ${JSON.stringify(priorMessages).slice(0, 8000)}
Required JSON fields:
- summary: A brief summary of the execution plan.
- format: The specific data format (e.g., "REST_JSON", "KUBERNETES_YAML", "BASH_SCRIPT").
- rawPayload: The exact raw payload string formatted perfectly in the requested format.
- render_type: A string suggesting how the UI should render this layout, e.g. "kanban" (for task boards/project plans) or "code" (for plain JSON/YAML/scripts).
- confidenceScore: An integer from 0 to 100 representing how confident you are in the plan's feasibility.`;
  }

  const dpl = getSetting("PROMPT_DELIBERATION", `You are a critical component of an AI deliberation council.
Role Name: {{role_display_name}}
Topic: {{topic}}
Current Round: {{round}}

Prior Council Messages:
{{priorMessages}}

Your task is to analyze the topic and prior messages exclusively from your unique perspective. 
Identify key claims, express agreements/disagreements with prior points, and pose knowledge gaps.

You MUST respond strictly in the following JSON format. Do not output any conversational text outside the JSON block.
{
  "shortSummary": "A 1-2 sentence summary of your stance",
  "confidenceScore": 85,
  "keyClaims": ["claim 1"],
  "agreements": ["agreement 1"],
  "disagreements": ["disagreement 1"],
  "knowledgeGaps": ["gap 1"]
}`);

  return dpl
    .replace("{{role_display_name}}", role.display_name || role.role_type)
    .replace("{{role_type}}", role.role_type)
    .replace("{{topic}}", topic)
    .replace("{{round}}", round)
    .replace("{{priorMessages}}", priorMessages.map((m) => `[${m.role_id} / ${m.model_name} (Round ${m.round_number})]: ${m.content}`).join("\n\n") || "None (First Round)");
}

function parseProviderJson(text, input) {
  const fallback = mockCompletion(input);
  try {
    let cleaned = String(text ?? "")
      .replace(/[“”]/g, '"') // Fix smart quotes
      .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, "") // Remove reasoning blocks
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();
      
    // Strip markdown formatting if present
    cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();

    // Extract JSON block using braces
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    const payload = JSON.parse(cleaned);
    return { payload: normalizePayload(payload, input), content: payload.shortSummary || fallback.content };
  } catch (e) {
    return {
      payload: {
        confidence: 0.5,
        keyClaims: [],
        knowledgeGaps: [],
        agreements: [],
        disagreements: [],
        flags: ["JSON_PARSE_FAILED"]
      },
      content: text || fallback.content,
      warning: "LLM failed to output valid JSON. Raw text displayed."
    };
  }
}

function mockCompletion({ role, topic, round }) {
  const base = `${role.display_name} reviewed "${topic}".`;
  const psychologist = role.role_type === "PSYCHOLOGIST_MACHIAVELLI";
  const payload = normalizePayload({
    confidence: Math.min(0.9, 0.66 + round * 0.04 + Number(role.confidence_weight ?? 1) * 0.02),
    shortSummary: `${role.display_name}: ${roundLabel(round)}.`,
    keyClaims: [
      base,
      "A reversible, evidence-gated recommendation is safer than an unconditional decision."
    ],
    knowledgeGaps: round < 3 ? ["Confirm constraints, source freshness, and cost limits."] : [],
    agreements: round > 1 ? ["Readiness gates and provenance should remain explicit."] : [],
    disagreements: role.role_type === "SKEPTIC" ? ["Benefits may not yet justify the operational cost."] : [],
    verifications: round >= 2 ? [{ targetClaim: "Evidence gates reduce decision risk", result: "supported", rationale: "Multiple roles converge on staged execution." }] : [],
    falsifications: round >= 2 ? [{ targetClaim: "All live evidence is authoritative", result: "contradicted", rationale: "Ambiguity handling requires warnings or clarification." }] : [],
    knowledgeSourcesUsed: [],
    flags: role.veto_capable && /veto|arbitration|escalate/i.test(topic) && round >= 3 ? ["VETO"] : [],
    dissent: round >= 4 && role.role_type === "SKEPTIC",
    veto: Boolean(role.veto_capable && /veto|arbitration|escalate/i.test(topic) && round >= 3),
    fearAppeal: psychologist ? "Name credible downside risks without panic or manipulation." : null,
    greedAppeal: psychologist ? "Frame upside as measurable, reversible gain rather than hype." : null,
    strategicFraming: psychologist ? "Separate stakeholder emotion from verifiable decision criteria." : null
  }, { role, round });
  return { payload, content: renderHuman(payload) };
}

function normalizePayload(payload, { role, round }) {
  return {
    confidence: clamp(Number(payload.confidence ?? payload.confidenceScore ?? 0.5), 0, 1),
    shortSummary: String(payload.shortSummary ?? payload.positionSummary ?? payload.summary ?? `${role.display_name} compact output`).slice(0, 240),
    keyClaims: asArray(payload.keyClaims),
    knowledgeGaps: asArray(payload.knowledgeGaps),
    agreements: asArray(payload.agreements),
    disagreements: asArray(payload.disagreements),
    verifications: asArray(payload.verifications),
    falsifications: asArray(payload.falsifications),
    knowledgeSourcesUsed: asArray(payload.knowledgeSourcesUsed),
    flags: asArray(payload.flags),
    dissent: Boolean(payload.dissent),
    veto: Boolean(payload.veto || asArray(payload.flags).includes("VETO")),
    fearAppeal: payload.fearAppeal ?? null,
    greedAppeal: payload.greedAppeal ?? null,
    strategicFraming: payload.strategicFraming ?? null,
    compact: true,
    roundNumber: round,
    // Interview-specific fields — must be passed through without modification
    question: payload.question ?? null,
    isSatisfied: payload.isSatisfied ?? false,
    refinedTopic: payload.refinedTopic ?? null,
    confidenceScore: payload.confidenceScore ?? null
  };
}

function renderHuman(payload) {
  return `${payload.shortSummary} Claims: ${payload.keyClaims.join(" ")}`;
}

function roundLabel(round) {
  return ["", "independent position", "verification and falsification", "convergence analysis", "final position", "extra arbitration round"][round] ?? "deliberation";
}

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isAnythingLlmRole(role) {
  return /^(anythingllm|anythingllm-workspace)$/i.test(String(role.model_name ?? role.provider ?? ""));
}

export async function callHermesWebhook(payload) {
  // Stub for calling Hermes or external execution agent
  console.log("Handoff to Hermes payload:", JSON.stringify(payload, null, 2));
  try {
    const url = process.env.HERMES_WEBHOOK_URL;
    if (!url) {
      console.warn("HERMES_WEBHOOK_URL not defined. Skipping actual handoff.");
      return { success: true, simulated: true };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Hermes returned ${res.status}`);
    return { success: true };
  } catch (err) {
    console.error("Hermes handoff failed:", err);
    return { success: false, error: err.message };
  }
}

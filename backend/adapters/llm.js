import { AnythingLlmClient } from "./anythingllm.js";

export class LlmAdapter {
  constructor(env = process.env) {
    this.env = env;
    this.anything = new AnythingLlmClient(env);
  }

  async complete({ role, topic, round, priorMessages = [], compact = true }) {
    if (isAnythingLlmRole(role)) {
      return await this.callAnythingLlmWorkspace({ role, topic, round, priorMessages, compact });
    }
    if ((this.env.PROVIDER_MODE ?? "mock") !== "mock") {
      const real = await this.tryRealProvider({ role, topic, round, priorMessages, compact });
      if (real) return real;
    }
    return mockCompletion({ role, topic, round, compact });
  }

  async callAnythingLlmWorkspace(input) {
    try {
      const response = await this.anything.chat({
        workspaceId: input.role.workspace_id,
        prompt: providerPrompt(input),
        mode: "chat"
      });
      const text = response.textResponse ?? response.response ?? response.message ?? JSON.stringify(response);
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
      if (this.env.OPENAI_API_KEY && /openai|gpt/i.test(input.role.model_name ?? "")) {
        return await callOpenAI(this.env, input);
      }
      if (this.env.ANTHROPIC_API_KEY && /claude|anthropic/i.test(input.role.model_name ?? "")) {
        return await callAnthropic(this.env, input);
      }
      if (this.env.GEMINI_API_KEY && /gemini/i.test(input.role.model_name ?? "")) {
        return await callGemini(this.env, input);
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

async function callOpenAI(env, input) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: providerPrompt(input) }]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.choices?.[0]?.message?.content, input);
}

async function callAnthropic(env, input) {
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
      messages: [{ role: "user", content: providerPrompt(input) }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.content?.[0]?.text, input);
}

async function callGemini(env, input) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: providerPrompt(input) }] }] })
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = await res.json();
  return parseProviderJson(data.candidates?.[0]?.content?.parts?.[0]?.text, input);
}

function providerPrompt({ role, topic, round, priorMessages, compact }) {
  if (role.role_type === "VERDICT") {
    return `You MUST return strict JSON for the Final Executive Verdict of the deliberation. Do NOT output any conversational text outside the JSON.
Topic: ${topic}
Prior deliberations: ${JSON.stringify(priorMessages).slice(0, 8000)}
You must synthesize the prior deliberations into a final executive verdict.
Required JSON fields: 
- shortSummary: A 1-2 sentence high-level executive summary of the final verdict.
- keyClaims: An array of the final agreed upon points and recommendations.
- disagreements: An array of any remaining unresolved tensions.
- confidence: A number between 0.0 and 1.0 representing the final confidence level.`;
  }
  return `You MUST return strict JSON for Synod role deliberation. Do NOT output any conversational text outside the JSON.
Topic: ${topic}
Role: ${role.display_name} (${role.role_type})
Round: ${round}
Compact mode: ${compact}
If Compact mode is true, be extremely brief and concise. If false, provide detailed, lengthy, and verbose explanations INSIDE the JSON string fields.
Execution provider: ${role.workspace_id ? `AnythingLLM workspace ${role.workspace_id}` : role.model_name}
Prior messages: ${JSON.stringify(priorMessages).slice(0, 6000)}
Required JSON fields: confidence (number 0.0-1.0), keyClaims, knowledgeGaps, agreements, disagreements, verifications, falsifications, knowledgeSourcesUsed, flags. 
Optional: shortSummary, dissent, veto, fearAppeal, greedAppeal, strategicFraming.`;
}

function parseProviderJson(text, input) {
  const fallback = mockCompletion(input);
  try {
    let cleaned = String(text ?? "")
      .replace(/[“”]/g, '"') // Fix smart quotes
      .replace(/<think>[\s\S]*?<\/think>/gi, '') // Remove reasoning blocks
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
    confidence: clamp(Number(payload.confidence ?? 0.5), 0, 1),
    shortSummary: String(payload.shortSummary ?? payload.positionSummary ?? `${role.display_name} compact output`).slice(0, 240),
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
    roundNumber: round
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

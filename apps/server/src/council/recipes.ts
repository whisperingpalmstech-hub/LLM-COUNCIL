// Recommended councils per case type, so professionals never have to pick models.
//
// Chosen from public evals (October 2026) plus Synod's own 12-scenario test:
// - Legal: Vals LegalBench has Gemini 4 Argon at 88.3% (top 3) and Claude models leading;
//   Claude Opus 5 ties for first on Vals Legal Research Bench.
// - Medical: Vals MedQA is led by OpenAI (o1, GPT-5.1) and Gemini 3.1 Pro at ~96%.
// - Code/agents: Vals Terminal-Bench 4.0 is led by Claude Opus 5.5 (65.2%) and Sonnet 5.5 (64.1%).
// - Overall: Artificial Analysis puts Claude Opus 5.5 at 57.6 and Sonnet 5.5 at 56.0.
// - Gemini 3.8 Flash was dropped: in our test it was never a peer's first pick and finished last 10/13.
// Members come from different labs on purpose: independent training means less correlated mistakes.

import type { CaseMode, CouncilMember } from "@synod/contracts";

const m = (label: string, model: string): CouncilMember => ({ id: model.replace(/[^\w.-]/g, "-"), label, provider: "openrouter", model });

const OPUS = m("Claude Opus 5.5", "anthropic/claude-opus-5.5");
const SONNET = m("Claude Sonnet 5.5", "anthropic/claude-sonnet-5.5");
const TERRA = m("GPT-6.1 Terra", "openai/gpt-6.1-terra");
const ARGON = m("Gemini 4 Argon", "google/gemini-4-argon");
const GROK = m("Grok 4.7", "x-ai/grok-4.7");

export const RECIPES: Record<CaseMode, { members: CouncilMember[]; chairman: CouncilMember }> = {
  medical: { members: [TERRA, ARGON, SONNET], chairman: { ...OPUS, id: "chairman" } },
  legal: { members: [ARGON, SONNET, TERRA], chairman: { ...OPUS, id: "chairman" } },
  code: { members: [SONNET, TERRA, ARGON], chairman: { ...OPUS, id: "chairman" } },
  general: { members: [TERRA, SONNET, ARGON, GROK], chairman: { ...OPUS, id: "chairman" } }
};

/** Small, fast model for routing a case to the right mode. */
export const CLASSIFIER = m("Claude Haiku 5.5", "anthropic/claude-haiku-5.5");

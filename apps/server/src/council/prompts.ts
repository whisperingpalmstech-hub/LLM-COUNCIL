// All model-facing prompt text lives here. Stage 2 and 3 follow Karpathy's llm-council.

import type { Attachment, CaseMode, SearchResult, Stage1Response, Stage2Review, Turn } from "@synod/contracts";
import { MODES } from "./modes.ts";

export function answerSystem(mode: CaseMode): string {
  return MODES[mode].answerSystem;
}

export interface TurnContext {
  prompt: string;
  history: string;
  attachments: string;
  research: string;
  clarification: string;
}

export function buildContext(turn: Turn, previousTurns: Turn[]): TurnContext {
  return {
    prompt: turn.prompt,
    history: historyBlock(previousTurns),
    attachments: attachmentsBlock(turn.attachments),
    research: researchBlock(turn.research),
    clarification: turn.clarification?.answer ? `Clarifying question: ${turn.clarification.question}\nUser's clarifying answer: ${turn.clarification.answer}` : ""
  };
}

/** The question as every council member sees it, with all supporting context. */
export function questionBlock(ctx: TurnContext): string {
  return [
    ctx.history && `Earlier in this conversation:\n${ctx.history}`,
    ctx.attachments && `Attached material:\n${ctx.attachments}`,
    ctx.research && `Web search results (may be incomplete; cite when used):\n${ctx.research}`,
    `Question:\n${ctx.prompt}`,
    ctx.clarification
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function clarifyPrompt(ctx: TurnContext, mode: CaseMode): string {
  return `${questionBlock(ctx)}

Before a council of advisers answers this, decide whether to ask the user ONE clarifying question.
Ask when the best answer depends on specifics of the user's situation that the message and earlier conversation do not give. In this kind of case that usually means: ${MODES[mode].clarifyFocus}. Advice built on guessed context is generic; one good question makes it specific.
Do not ask for factual or general-knowledge questions, when the user already gave enough context, or merely to confirm something obvious.
If you ask, make it a single question that gathers the most decision-relevant context at once.
Return JSON: {"needed": boolean, "question": string}`;
}

export function reviewPrompt(ctx: TurnContext, labelled: { label: string; text: string }[]): string {
  const responses = labelled.map((r) => `${r.label}:\n${r.text}`).join("\n\n");
  return `You are evaluating different responses to the following question:

${questionBlock(ctx)}

Here are the responses from different models (anonymized):

${responses}

Your task:
1. First, evaluate each response individually: in 1-3 sentences each, name its most important strengths and any errors, omissions, or unsafe advice. Be concrete; do not summarize the response.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...

FINAL RANKING:
1. Response B
2. Response A

Now provide your evaluation and ranking:`;
}

export function synthesisPrompt(ctx: TurnContext, stage1: Stage1Response[], stage2: Stage2Review[]): string {
  const answers = stage1.map((r) => `Model: ${r.label} (${r.model})\nResponse:\n${r.text}`).join("\n\n");
  const reviews = stage2.map((r) => `Reviewer: ${r.label}\nEvaluation:\n${r.text}`).join("\n\n");
  return `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

${questionBlock(ctx)}

STAGE 1 - Individual Responses:
${answers}

STAGE 2 - Peer Rankings:
${reviews}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Keep genuine disagreement visible rather than averaging it away. Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;
}

export function briefPrompt(ctx: TurnContext, mode: CaseMode, answers: Stage1Response[], reviews: Stage2Review[], ranking: string): string {
  const def = MODES[mode];
  const members = answers.map((r, i) => `Response ${String.fromCharCode(65 + i)} — ${r.label}:\n${truncate(r.text, 3000)}`).join("\n\n");
  const critiques = reviews.map((r) => `${r.label}:\n${truncate(r.text.replace(/FINAL RANKING:[\s\S]*$/, ""), 1200)}`).join("\n\n");
  const sections = def.sections.map((s) => `    {"title": ${JSON.stringify(s.title)}, "items": [{"text": string, "detail": string, "level": "high"|"medium"|"low"}]}  // ${s.guidance}`).join(",\n");
  return `${questionBlock(ctx)}

Individual council answers:
${members}

Peer critiques (members reviewed each other's answers anonymously; labels refer to the answers above in order):
${critiques || "None"}

Peer ranking (best first): ${ranking || "not available"}

You are the chairman. Weigh the answers by their quality and the critiques (correct errors the critiques identified; don't just average), then write a structured second-opinion brief. Return JSON with exactly these fields:
{
  "verdict": string,            // ${def.verdictHint}; at most 10 words
  "bottomLine": string,         // 1-2 sentences: the answer a busy professional needs first
  "confidence": number,         // 0-1, the council's overall confidence
  "redFlags": string[],         // urgent or dangerous issues needing attention now; [] if none
  "sections": [
${sections}
  ],
  "nextSteps": [{"action": string, "why": string, "urgency": "now"|"soon"|"later"}],
  "consensus": string[],        // points the members agreed on
  "disagreements": [{"point": string, "positions": string[]}],  // real disagreements between members, each position naming who held it
  "openQuestions": string[]     // facts that would change the opinion
}
Be faithful to what the council actually said. Keep items short; put reasoning in "detail".`;
}

function historyBlock(turns: Turn[]): string {
  return turns
    .filter((t) => t.status === "completed" && t.synthesis)
    .slice(-4)
    .map((t) => {
      const clarified = t.clarification?.answer ? `\nClarifying question: ${t.clarification.question}\nUser: ${t.clarification.answer}` : "";
      return `User: ${t.prompt}${clarified}\nCouncil: ${truncate(t.synthesis?.text ?? "", 1500)}`;
    })
    .join("\n\n");
}

function attachmentsBlock(attachments: Attachment[]): string {
  return attachments
    .map((a) => (a.excerpt ? `--- ${a.name} ---\n${a.excerpt}` : `--- ${a.name} (${a.mimeType}, content not readable as text) ---`))
    .join("\n\n");
}

function researchBlock(results: SearchResult[]): string {
  return results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${truncate(r.snippet, 600)}`).join("\n\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

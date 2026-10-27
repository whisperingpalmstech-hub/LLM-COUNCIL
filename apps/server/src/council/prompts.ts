// All model-facing prompt text lives here. Stage 2 and 3 follow Karpathy's llm-council.

import type { Attachment, SearchResult, Stage1Response, Stage2Review, Turn } from "@synod/contracts";

export const ANSWER_SYSTEM =
  "You are one member of a council of independent AI advisers. Answer the user's question directly and substantively. " +
  "Be specific, show your reasoning, state key assumptions and risks, and say plainly when you are uncertain. Use Markdown.";

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

export function clarifyPrompt(ctx: TurnContext): string {
  return `${questionBlock(ctx)}

Before a council of advisers answers this, decide whether ONE clarifying question is essential.
Ask only if a missing fact would materially change the answer and cannot reasonably be assumed. Otherwise do not ask.
Return JSON: {"needed": boolean, "question": string}`;
}

export function reviewPrompt(ctx: TurnContext, labelled: { label: string; text: string }[]): string {
  const responses = labelled.map((r) => `${r.label}:\n${r.text}`).join("\n\n");
  return `You are evaluating different responses to the following question:

${questionBlock(ctx)}

Here are the responses from different models (anonymized):

${responses}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
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

export function planPrompt(ctx: TurnContext, synthesis: string): string {
  return `${questionBlock(ctx)}

The council's final answer:
${synthesis}

Turn this into an execution plan. Return JSON with exactly these fields:
{
  "decision": "GO" | "NO-GO" | "CONDITIONAL GO" | "PIVOT" | "CONTINUE INVESTIGATION",
  "summary": string,
  "assumptions": string[],
  "risks": string[],
  "phases": [{"name": string, "objective": string, "duration": string, "owner": string, "tasks": string[], "acceptanceCriteria": string[], "decisionGate": string}],
  "successMetrics": string[],
  "openQuestions": string[],
  "dissent": string[],
  "confidence": number between 0 and 1
}
Use 2-5 ordered phases. Each phase needs measurable acceptance criteria and a stop/continue/scale decision gate.
If the question is not a decision or project, still return a short plan for acting on the answer.`;
}

function historyBlock(turns: Turn[]): string {
  return turns
    .filter((t) => t.status === "completed" && t.synthesis)
    .slice(-4)
    .map((t) => `User: ${t.prompt}\nCouncil: ${truncate(t.synthesis?.text ?? "", 1500)}`)
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

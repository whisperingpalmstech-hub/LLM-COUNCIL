// All model-facing prompt text lives here. Stage 2 and 3 follow Karpathy's llm-council.

import type { Attachment, CaseContext, CaseMode, SearchResult, Stage1Response, Stage2Review, Turn } from "@synod/contracts";
import { MODES } from "./modes.ts";

export function answerSystem(mode: CaseMode): string {
  return MODES[mode].answerSystem;
}

export interface TurnContext {
  /** The user asked for concise answers. */
  concise: boolean;
  /** Date and who is asking, so advice fits today and the user's country and role. */
  about: string;
  prompt: string;
  history: string;
  attachments: string;
  research: string;
  clarification: string;
}

export function buildContext(turn: Turn, previousTurns: Turn[]): TurnContext {
  return {
    concise: turn.context?.profile?.answerStyle === "concise",
    about: aboutBlock(turn.context),
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
    ctx.about,
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

/** Route a case to a mode from its first message. */
export function classifyPrompt(text: string): string {
  return `Classify this request for a council of expert advisers into exactly one case type:
- "medical": clinical questions about patients, diagnosis, treatment, drugs, or tests
- "legal": questions about law, contracts, disputes, liability, regulation, or rights, including legal questions asked by clinicians or engineers
- "code": software, code review, infrastructure, data, security, or an action an AI agent wants to take
- "general": business, strategy, product, finance, and anything else

Request:
${text.slice(0, 4000)}

Return JSON: {"mode": "medical" | "legal" | "code" | "general"}`;
}

/** A later round: revise your answer after seeing the others and their critiques. */
export function revisePrompt(ctx: TurnContext, labelled: { label: string; text: string }[], ownLabel: string, reviews: Stage2Review[]): string {
  const answers = labelled.map((r) => `${r.label}${r.label === ownLabel ? " (your previous answer)" : ""}:\n${truncate(r.text, 4000)}`).join("\n\n");
  const critiques = reviews.map((r, i) => `Reviewer ${i + 1}:\n${truncate(r.text.replace(/FINAL RANKING:[\s\S]*$/, "").trim(), 2000)}`).join("\n\n");
  return `${questionBlock(ctx)}

The council answered this independently, then reviewed each other's answers anonymously.

Answers from the last round:
${answers}

Peer critiques (they refer to answers by label):
${critiques || "None"}

Write your revised answer. Fix any errors the critiques identified in ${ownLabel || "your answer"}. Adopt better points from the other answers when they are right. Keep positions you still believe are correct, and say briefly why you disagree with a critique if you do. Write the complete revised answer, not a list of changes.`;
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

Keep genuine disagreement visible rather than averaging it away. Lead with the answer. A structured brief is produced separately, so don't repeat every detail: stay under about ${ctx.concise ? 450 : 800} words. Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;
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
  "redFlags": string[],         // urgent or dangerous issues in the user's situation needing attention now; [] if none. Never about the council's own mistakes or debate.
  "sections": [
${sections}
  ],
  "nextSteps": [{"action": string, "why": string, "urgency": "now"|"soon"|"later"}],
  "consensus": string[],        // points the members agreed on
  "disagreements": [{"point": string, "positions": string[]}],  // real disagreements between members, each position naming who held it
  "openQuestions": string[]     // facts that would change the opinion
}
Use the section titles above when they fit the question. If the question is a different kind (for example a medication-interaction question, or a legal question about a clinical event), replace them with 2-4 section titles that fit it better, in the same shape.
Correct errors silently in the content; mention a member's mistake only inside "disagreements", never in the verdict, bottom line, or red flags.
Be faithful to what the council actually said. Keep items short; put reasoning in "detail".`;
}

function aboutBlock(context?: CaseContext): string {
  if (!context) return "";
  const p = context.profile;
  const who = p
    ? [
        `The person asking is a ${p.profession === "other" ? "professional" : p.profession}${p.specialty ? ` (${p.specialty})` : ""}`,
        p.setting ? `working in ${p.setting}` : "",
        `in ${[p.region, p.country].filter(Boolean).join(", ")}.`,
        `Use that country's guidelines, law, units, terminology, and spelling unless the question says otherwise.`,
        p.answerStyle === "concise" ? "They prefer concise answers." : "They prefer detailed answers."
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  return [`Today is ${context.date}${context.timezone ? ` (${context.timezone})` : ""}.`, who].filter(Boolean).join(" ");
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
    .map((a) =>
      a.excerpt
        ? `--- ${a.name} ---\n${a.excerpt}`
        : a.kind === "image" || a.mimeType.startsWith("image/")
          ? `--- ${a.name} (image, shown to you alongside this message) ---`
          : `--- ${a.name} (${a.mimeType}, content could not be read) ---`
    )
    .join("\n\n");
}

function researchBlock(results: SearchResult[]): string {
  return results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${truncate(r.snippet, 600)}`).join("\n\n");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

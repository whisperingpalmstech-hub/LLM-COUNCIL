// Discuss mode: a moderated group chat between the user and the council's models.
// Prompt text and the transcript format live here; the engine runs the loop.

import type { CaseMode, ChatMessage, CouncilMember } from "@synod/contracts";
import { MODES } from "./modes.ts";

import type { Depth } from "@synod/contracts";

/** How many model messages may follow one user message, by discussion length. */
export const MAX_REPLIES: Record<Depth, number> = { quick: 4, standard: 8, thorough: 12 };
const TRANSCRIPT_MESSAGES = 40;

export function transcript(messages: ChatMessage[], userLabel = "User"): string {
  return messages
    .slice(-TRANSCRIPT_MESSAGES)
    .map((m) => `${m.author.kind === "user" ? userLabel : m.author.label}: ${m.text}`)
    .join("\n\n");
}

/** The moderator decides who has something genuinely new to add — or that nobody does. */
export function moderatorPrompt(about: string, members: CouncilMember[], messages: ChatMessage[], repliesSoFar: number, budget: number, resumed = false): string {
  const roster = members.map((m) => `- id: ${m.id} | name: ${m.label}`).join("\n");
  const last = messages.at(-1);
  const left = budget - repliesSoFar;
  const situation = resumed
    ? "The user asked the panel to keep discussing. Pick 1-2 panellists who would push the discussion forward: test the weakest point so far, raise what hasn't been considered, or settle an open disagreement."
    : repliesSoFar === 0
      ? `The user just wrote. Pick ${members.length > 2 ? "2-3" : members.length > 1 ? "2" : "1"} panellists to open the discussion, chosen for different angles. Even when the answer seems clear, a second voice should check or sharpen it.`
      : `${last?.author.kind === "model" ? last.author.label : "Someone"} just replied (${left} messages left before the user's turn). Keep the discussion going while it is productive: someone disagrees or would correct a claim, a question was put to a panellist, an important angle is missing, or a claim needs checking. Pick 1-2 panellists. Pick nobody once the panel has converged, is repeating itself, or the user clearly needs to answer something.`;
  return `${about}

You moderate a live group chat between a professional and a panel of AI models:
${roster}

Conversation so far:
${transcript(messages)}

${situation}
Never pick someone just to agree or repeat a point. Vary who speaks; don't let one panellist dominate.
Return JSON: {"speakers": [panellist ids in speaking order], "reason": "a few words, e.g. 'Gemini disagrees on dosing'"}`;
}

export function chatSystem(member: CouncilMember, others: CouncilMember[], mode: CaseMode, about: string): string {
  return `You are ${member.label}, one panellist in a group chat with a professional and other AI models (${others.map((o) => o.label).join(", ")}).
${about}
${MODES[mode].answerSystem.split(". ").slice(0, 1).join("")}.
How to talk here:
- Reply in 1-4 sentences, like a sharp colleague in a group chat. No headings, no bullet lists unless asked, no preamble.
- Respond to what was actually said. Address people by name when you agree, disagree, or build on their point. Disagree plainly when you think someone is wrong, and say why.
- Add something new: a fact, a risk, a correction, or a sharper question. Don't restate what's already been said.
- If you're unsure, say so briefly. Never pretend to be human.`;
}

export function chatTurnPrompt(messages: ChatMessage[], member: CouncilMember): string {
  return `Group chat so far:
${transcript(messages)}

Write your next message as ${member.label}. Just the message text.`;
}

/** Wrap up: the chairman turns the discussion into a final opinion. */
export function wrapUpPrompt(about: string, messages: ChatMessage[]): string {
  return `${about}

You chaired this group discussion between a professional and a panel of AI models:

${transcript(messages)}

Write the conclusion the user needs: lead with the answer, keep real disagreements visible (naming who held which view), correct anything the discussion got wrong, and end with clear next steps. Stay under about 600 words.`;
}

/**
 * Find @mentions of panellists ("@Gemini 4 Argon", "@Gemini"). The most specific form wins:
 * full names first, then the first two words, then a first word only if no one else shares it.
 */
export function mentioned(text: string, members: CouncilMember[]): CouncilMember[] {
  const lower = text.toLowerCase();
  if (/@(everyone|all|panel)(?![\w.-])/.test(lower)) return members;
  const has = (name: string) => new RegExp(`@${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`).test(lower);
  const forms: ((m: CouncilMember) => string)[] = [(m) => m.label, (m) => m.label.split(" ").slice(0, 2).join(" "), (m) => m.label.split(" ")[0]];
  const found = new Set<CouncilMember>();
  for (const form of forms) {
    for (const m of members) {
      const name = form(m);
      const shared = members.filter((o) => form(o).toLowerCase() === name.toLowerCase()).length > 1;
      if (!shared && has(name)) found.add(m);
    }
  }
  return members.filter((m) => found.has(m));
}

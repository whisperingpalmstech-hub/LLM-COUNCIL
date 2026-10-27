// Discuss mode: a moderated group chat between the user and the council's models.
// Prompt text and the transcript format live here; the engine runs the loop.

import type { CaseMode, ChatMessage, CouncilMember } from "@synod/contracts";
import { MODES } from "./modes.ts";

/** At most this many model messages follow one user message, so a chat never runs away. */
export const MAX_REPLIES_PER_TURN = 4;
const TRANSCRIPT_MESSAGES = 40;

export function transcript(messages: ChatMessage[], userLabel = "User"): string {
  return messages
    .slice(-TRANSCRIPT_MESSAGES)
    .map((m) => `${m.author.kind === "user" ? userLabel : m.author.label}: ${m.text}`)
    .join("\n\n");
}

/** The moderator decides who has something genuinely new to add — or that nobody does. */
export function moderatorPrompt(about: string, members: CouncilMember[], messages: ChatMessage[], repliesSoFar: number): string {
  const roster = members.map((m) => `- id: ${m.id} | name: ${m.label}`).join("\n");
  const last = messages.at(-1);
  return `${about}

You moderate a group chat between a professional and a panel of AI models:
${roster}

Conversation so far:
${transcript(messages)}

${
  repliesSoFar === 0
    ? "The user just wrote. Pick the 1-3 panellists who would add the most: different expertise, a real disagreement, or a missing angle. Prefer fewer when the question is simple."
    : `${last?.author.kind === "model" ? last.author.label : "Someone"} just replied. Pick at most 1 panellist ONLY if they would materially correct, challenge, or extend what was just said, or if they were directly asked something. Otherwise pick nobody so the user can respond.`
}
Never pick someone just to agree or repeat a point.
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

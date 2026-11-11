// Discuss mode: a moderated group chat between the user and the council's models.
// Prompt text and the transcript format live here; the engine runs the loop.

import { VOICES, type CaseMode, type ChatMessage, type CouncilMember, type Persona, type SearchResult, type SpeechLength, type VoiceId } from "@synod/contracts";
import { MODES } from "./modes.ts";

const TRANSCRIPT_MESSAGES = 40;

/** What a panellist is called in the room: their persona's name when they have one. */
export function nameOf(member: CouncilMember, personas: Persona[]): string {
  return personas.find((p) => p.memberId === member.id)?.name || member.label;
}

export function transcript(messages: ChatMessage[], userLabel = "User"): string {
  return messages
    .slice(-TRANSCRIPT_MESSAGES)
    .map((m) => `${m.author.kind === "user" ? userLabel : m.author.persona || m.author.label}: ${m.text}`)
    .join("\n\n");
}

export interface RoundInfo {
  round: number;
  of: number;
  /** Most panellists the moderator may pick for this round. */
  speakers: number;
  resumed: boolean;
}

/** The moderator decides who has something genuinely new to add — or that nobody does. */
export function moderatorPrompt(about: string, members: CouncilMember[], personas: Persona[], messages: ChatMessage[], info: RoundInfo): string {
  const roster = members
    .map((m) => {
      const p = personas.find((x) => x.memberId === m.id);
      return `- id: ${m.id} | name: ${p ? `${p.name} (${p.role}; ${p.stance})` : m.label}`;
    })
    .join("\n");
  const last = messages.at(-1);
  const n = Math.max(1, Math.min(info.speakers, members.length));
  const upTo = n === 1 ? "1 panellist" : `up to ${n} panellists`;
  const situation = info.resumed
    ? `The user asked the panel to keep discussing. Pick ${upTo} who would push the discussion forward: test the weakest point so far, raise what hasn't been considered, or settle an open disagreement.`
    : info.round === 1
      ? `The user just wrote. Pick ${upTo} to open the discussion, chosen for different angles. Even when the answer seems clear, a second voice should check or sharpen it.`
      : `${last?.author.kind === "model" ? last.author.persona || last.author.label : "Someone"} just spoke. This is round ${info.round} of ${info.of}. Keep the discussion going while it is productive: someone disagrees or would correct a claim, a question was put to a panellist, an important angle is missing, or a claim needs checking. Pick ${upTo} for this round, starting with whoever was challenged or has not spoken yet. Pick nobody once the panel has converged, is repeating itself, or the user clearly needs to answer something.`;
  return `${about}

You moderate a live discussion between a professional and a panel:
${roster}

Conversation so far:
${transcript(messages)}

${situation}
Never pick someone just to agree or repeat a point. Vary who speaks; don't let one panellist dominate.
Return JSON: {"speakers": [panellist ids in speaking order], "reason": "a few words, e.g. 'Maya disagrees on dosing'"}`;
}

const LENGTH_RULE: Record<SpeechLength, string> = {
  short: "Reply in 1-3 sentences (about 50 words at most), like a sharp colleague in a group chat.",
  medium: "Reply in one short paragraph (about 110 words at most): make your point, back it, stop.",
  long: "Reply in two or three short paragraphs (about 220 words at most): make your case properly, but waste no words."
};

export function chatSystem(member: CouncilMember, others: string[], mode: CaseMode, about: string, options: { persona?: Persona; speechLength?: SpeechLength } = {}): string {
  const p = options.persona;
  const who = p
    ? `You are playing ${p.name}, ${p.role}, in a moderated panel debate with a professional and other panellists (${others.join(", ")}).
Your position: ${p.stance}
How you talk: ${p.style}
Argue from this position with conviction, but stay honest: the persona shapes your perspective and emphasis, never the facts. Concede a point when the evidence is against you. Don't claim personal experience or credentials as proof. If someone sincerely asks, you are the AI model ${member.label} playing this role.`
    : `You are ${member.label}, one panellist in a group chat with a professional and other AI models (${others.join(", ")}).`;
  return `${who}
${about}
${MODES[mode].answerSystem.split(". ").slice(0, 1).join("")}.
How to talk here:
- ${LENGTH_RULE[options.speechLength ?? "short"]} No headings, no bullet lists unless asked, no preamble. Your words may be read aloud, so write the way people speak.
- Respond to what was actually said. Address people by name when you agree, disagree, or build on their point. Disagree plainly when you think someone is wrong, and say why.
- Add something new: a fact, a risk, a correction, or a sharper question. Don't restate what's already been said.
- If you're unsure, say so briefly.${p ? "" : " Never pretend to be human."}`;
}

export function chatTurnPrompt(messages: ChatMessage[], name: string, knowledge: SearchResult[] = []): string {
  const reference = knowledge.length
    ? `Reference material from the user's knowledge bases (use it when relevant and name the source; it may not cover everything):
${knowledge.map((k, i) => `[${i + 1}] ${k.title}${k.url ? ` — ${k.url}` : ""}\n${k.snippet}`).join("\n\n")}

`
    : "";
  return `${reference}Discussion so far:
${transcript(messages)}

Write your next message as ${name}. Just the message text.`;
}

/** The moderator casts the panel: one persona per model, built to disagree usefully about this question. */
export function castingPrompt(about: string, question: string, members: CouncilMember[], mode: CaseMode, hint = ""): string {
  return `${about}

You are the moderator of a panel debate. A professional has brought this ${mode === "general" ? "" : `${mode} `}question:

${question.slice(0, 4000)}

Cast the panel. There are ${members.length} seats, each played by an AI model:
${members.map((m) => `- id: ${m.id} | model: ${m.label}`).join("\n")}

Give each seat a persona that makes the debate worth watching:
- Pick the perspectives that genuinely matter for THIS question and that will pull in different directions (for example the cautious specialist, the pragmatist who has to make it work, the one who speaks for whoever bears the risk, the contrarian who checks the numbers). No two personas may share a stance.
- name: a realistic full name (vary backgrounds). role: who they are, in 2-6 words. stance: the position they argue from, in one sentence of at most 25 words, specific to this question. style: how they talk, in 3-8 words.
- voice: one of ${VOICES.map((v) => `"${v.id}" (${v.tone})`).join(", ")}. These ids only pick how the persona sounds: never use one as the persona's name. Use a different voice for each seat, and match it to the persona (a woman's voice for a woman, a man's for a man).
${hint ? `The user asked for this change to the cast: ${hint.slice(0, 500)}\n` : ""}
Return JSON: {"personas": [{"id": seat id, "name": "", "role": "", "stance": "", "style": "", "voice": ""}]}`;
}

const VOICE_IDS = VOICES.map((v) => v.id) as VoiceId[];

/** Clean up personas from the model or the user: one per member, sane lengths, distinct voices where possible. */
export function normalizePersonas(input: unknown, members: CouncilMember[]): Persona[] {
  const list = Array.isArray(input) ? (input as Record<string, unknown>[]) : [];
  const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const used = new Set<VoiceId>();
  const out: Persona[] = [];
  members.forEach((m, i) => {
    const raw = list.find((p) => p && (p.id === m.id || p.memberId === m.id)) ?? list[i];
    const name = text(raw?.name, 60);
    if (!raw || !name) return;
    let voice = VOICE_IDS.includes(raw.voice as VoiceId) ? (raw.voice as VoiceId) : VOICE_IDS[i % VOICE_IDS.length];
    if (used.has(voice)) voice = VOICE_IDS.find((v) => !used.has(v)) ?? voice;
    used.add(voice);
    out.push({ memberId: m.id, name, role: text(raw.role, 80), stance: text(raw.stance, 280), style: text(raw.style, 120), voice });
  });
  return out;
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
export function mentioned(text: string, members: CouncilMember[], personas: Persona[] = []): CouncilMember[] {
  if (personas.length) {
    // People can be addressed by persona name or by model name.
    // "@Dr Tomasz Wierzbicki", "@Tomasz Wierzbicki" and "@Tomasz" should all reach the same person.
    const untitled = (name: string) => name.replace(/^(dr|prof|professor|mr|mrs|ms|sir|dame)\.?\s+/i, "");
    const hits = [
      ...mentionedByLabel(text, members.map((m) => ({ ...m, label: nameOf(m, personas) }))),
      ...mentionedByLabel(text, members.map((m) => ({ ...m, label: untitled(nameOf(m, personas)) }))),
      ...mentionedByLabel(text, members)
    ];
    return members.filter((m) => hits.some((x) => x.id === m.id));
  }
  return mentionedByLabel(text, members);
}

function mentionedByLabel(text: string, members: CouncilMember[]): CouncilMember[] {
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

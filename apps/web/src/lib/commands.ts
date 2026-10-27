// Shared "/" commands and "@" mentions for the composers.
import { BookOpen, Gauge, HelpCircle, ListChecks, MessageCircleQuestion, MessagesSquare, Play, Scale, Sparkles, Square, Swords, Users, Vote, Wand2 } from "lucide-react";
import { createElement } from "react";
import type { CaseMode, CouncilMember, Depth } from "@synod/contracts";
import type { CommandItem, MentionItem } from "~/components/ComposerMenu";
import { ModelLogo } from "~/components/ModelLogo";
import { MODE_UI } from "./modes";

export function memberMentions(members: CouncilMember[]): MentionItem[] {
  return [
    { id: "everyone", label: "everyone", description: "The whole panel answers", icon: createElement(Users, { className: "size-3.5 text-muted-foreground" }) },
    ...members.map((m) => ({ id: m.id, label: m.label, description: m.model || m.provider, icon: createElement(ModelLogo, { member: m, className: "size-3.5" }) }))
  ];
}

/** Prompt templates that work in both a discussion and a council follow-up. */
export const PROMPT_COMMANDS: CommandItem[] = [
  { name: "challenge", description: "Strongest argument against where this is heading", icon: Swords, insert: "@everyone What's the strongest argument against where we're heading, and what would change your mind?" },
  { name: "plain", description: "Explain it in plain language for a patient or client", icon: MessageCircleQuestion, insert: "Explain the conclusion in plain language I can share with a patient or client." },
  { name: "sources", description: "Which guidelines, laws, or sources back the key claims", icon: BookOpen, insert: "Which guidelines, statutes, or sources support the key claims? Flag anything you're unsure of." },
  { name: "summarize", description: "Where the panel agrees and disagrees so far", icon: ListChecks, insert: "Summarize where the panel agrees and disagrees so far, in a few bullet points." }
];

export function discussionCommands(actions: { continue: () => void; wrapUp: () => void; stop: () => void }): CommandItem[] {
  return [
    { name: "continue", description: "Let the panel keep discussing", icon: Play, run: actions.continue },
    { name: "wrap", description: "Wrap up into a brief and a shareable document", icon: Sparkles, run: actions.wrapUp },
    { name: "stop", description: "Stop the panel", icon: Square, run: actions.stop },
    { name: "vote", description: "Everyone gives a one-line position and confidence", icon: Vote, insert: "@everyone Give your one-line position and how confident you are (0-100%)." },
    ...PROMPT_COMMANDS
  ];
}

export function depthCommands(setDepth: (d: Depth) => void): CommandItem[] {
  return [
    { name: "quick", description: "Quick: 3 rounds, about 1 minute", icon: Gauge, run: () => setDepth("quick") },
    { name: "standard", description: "Standard: 5 rounds, about 2 minutes", icon: Gauge, run: () => setDepth("standard") },
    { name: "thorough", description: "Thorough: 7 rounds, for high-stakes calls", icon: Gauge, run: () => setDepth("thorough") }
  ];
}

export function newCaseCommands(actions: { setKind: (k: "council" | "chat") => void; setMode: (m: CaseMode | "auto") => void; setDepth: (d: Depth) => void }): CommandItem[] {
  return [
    { name: "discuss", description: "Start a group discussion instead", icon: MessagesSquare, run: () => actions.setKind("chat") },
    { name: "opinion", description: "Get a structured council opinion", icon: Scale, run: () => actions.setKind("council") },
    { name: "auto", description: "Let Synod pick the case type", icon: Wand2, run: () => actions.setMode("auto") },
    ...(["medical", "legal", "code", "general"] as const).map((m) => ({ name: m, description: `${MODE_UI[m].label} case: ${MODE_UI[m].tagline.toLowerCase()}`, icon: MODE_UI[m].icon, run: () => actions.setMode(m) })),
    ...depthCommands(actions.setDepth),
    { name: "help", description: "Type @ to ask a model, / for commands", icon: HelpCircle, run: () => undefined }
  ];
}

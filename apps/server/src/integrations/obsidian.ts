import fs from "node:fs/promises";
import path from "node:path";
import type { Conversation, Turn } from "@synod/contracts";

/** Writes each completed council turn into an Obsidian vault as a Markdown note. */
export async function writeTurnToVault(vaultPath: string, conversation: Conversation, turn: Turn): Promise<string> {
  await fs.mkdir(vaultPath, { recursive: true });
  const date = turn.startedAt.slice(0, 10);
  const slug = turn.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "decision";
  const file = path.join(vaultPath, `${date}-${slug}-${turn.id.slice(0, 8)}.md`);
  const ranking = turn.aggregate?.rankings.map((r, i) => `${i + 1}. ${r.label} (avg ${r.averageRank})`).join("\n") ?? "";
  const plan = turn.plan
    ? `\n## Execution plan (${turn.plan.decision})\n${turn.plan.summary}\n\n${turn.plan.phases.map((p) => `- **${p.name}** — ${p.objective}`).join("\n")}\n`
    : "";
  const note = `---
tags: [synod, council]
conversation: ${conversation.id}
turn: ${turn.id}
date: ${turn.startedAt}
members: [${turn.council.members.map((m) => JSON.stringify(m.label)).join(", ")}]
---
# ${turn.prompt.split("\n")[0].slice(0, 120)}

## Question
${turn.prompt}

## Council answer
${turn.synthesis?.text ?? ""}

## Peer ranking
${ranking}
${plan}`;
  await fs.writeFile(file, note, "utf8");
  return file;
}

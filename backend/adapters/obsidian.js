import fs from "fs";
import path from "path";

function resolveVaultPath(options = {}) {
  return options.vaultPath || process.env.OBSIDIAN_VAULT_PATH || "./data/synod-brain-vault";
}

export function initVault(options = {}) {
  const vaultPath = resolveVaultPath(options);
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
  return vaultPath;
}

function noteTitle(content, fallback) {
  return content.match(/^# (?:Decision|Verdict):\s*(.+)$/m)?.[1]?.trim()
    || fallback.replace(/\.md$/, "").replace(/[_-]+/g, " ");
}

function noteDate(content, fallback) {
  return content.match(/^date:\s*(.+)$/m)?.[1]?.trim() || fallback;
}

function isReliableNote(content) {
  return !/advance only if the proposal meets explicit value|offline result is a workflow demonstration|do not scale on mock output alone/i.test(content);
}

export function getVaultStatus(options = {}) {
  const vaultPath = initVault(options);
  const notes = fs.readdirSync(vaultPath)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const filePath = path.join(vaultPath, file);
      const content = fs.readFileSync(filePath, "utf8");
      return { file, content, modifiedAt: fs.statSync(filePath).mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const reliableNotes = notes.filter((note) => isReliableNote(note.content));
  const latest = reliableNotes[0];
  return {
    enabled: true,
    noteCount: reliableNotes.length,
    latest: latest ? { title: noteTitle(latest.content, latest.file), date: noteDate(latest.content, latest.modifiedAt) } : null
  };
}

export function writeToVault(sessionId, topic, verdict, options = {}) {
  const vaultPath = initVault(options);
  
  const safeTopic = topic.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 50);
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `${dateStr}-${safeTopic}-${sessionId}.md`;
  const filePath = path.join(vaultPath, filename);

  const frontmatter = `---
tags: [synod, verdict, AI_decision]
session_id: ${sessionId}
confidence: ${verdict.confidence || 0}
date: ${new Date().toISOString()}
---
`;

  const summary = verdict.executiveSummary || verdict.shortSummary || verdict.summary || verdict.decision || "No summary provided.";
  const decision = verdict.decision || verdict.shortSummary || verdict.summary || "No decision recorded.";
  const actions = Array.isArray(verdict.recommendedActions) ? verdict.recommendedActions : [];
  const openQuestions = Array.isArray(verdict.openQuestions) ? verdict.openQuestions : [];
  const content = `# Decision: ${topic}

## Summary
${summary}

## Recommendation
${decision}

## Rationale
${verdict.rationale || "No rationale recorded."}

## Recommended Actions
${actions.length ? actions.map((action) => `- ${action}`).join("\\n") : "None recorded."}

## Open Questions
${openQuestions.length ? openQuestions.map((question) => `- ${question}`).join("\\n") : "None."}

## Warnings
${verdict.warnings?.length ? verdict.warnings.map(w => `- ${w.message}`).join("\\n") : "None."}
`;

  fs.writeFileSync(filePath, frontmatter + content, "utf-8");
  console.log(`[Memory Architect] Wrote verdict to Obsidian vault: ${filePath}`);
}

export function searchVault(query, options = {}) {
  const vaultPath = initVault(options);
  // Lightweight local retrieval. Results are context, not verified current facts.
  const files = fs.readdirSync(vaultPath).filter(f => f.endsWith('.md'));
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !["should", "would", "could", "about", "between", "their", "there", "which"].includes(w));
  
  const results = [];
  for (const file of files) {
    const filePath = path.join(vaultPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!isReliableNote(content)) continue;
    const contentLower = content.toLowerCase();
    
    let matchScore = 0;
    for (const kw of keywords) {
      if (contentLower.includes(kw)) matchScore++;
    }
    
    if (matchScore > 0) {
      results.push({
        file,
        title: noteTitle(content, file),
        score: matchScore,
        content: content.slice(0, 900) + "..." // enough structured context to be useful
      });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 3); // top 3 matches
}

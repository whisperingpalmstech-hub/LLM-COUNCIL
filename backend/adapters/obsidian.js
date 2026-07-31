import fs from "fs";
import path from "path";

const vaultPath = process.env.OBSIDIAN_VAULT_PATH || "./data/synod-brain-vault";

export function initVault() {
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
}

export function writeToVault(sessionId, topic, verdict) {
  initVault();
  
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

  const content = `# Verdict: ${topic}

## Summary
${verdict.summary || "No summary provided."}

## Majority Consensus
${verdict.majority || "No consensus reached."}

## Dissents & Tensions
${verdict.unresolvedTensions?.length ? verdict.unresolvedTensions.map(t => `- ${t}`).join("\\n") : "None."}

## Warnings
${verdict.warnings?.length ? verdict.warnings.map(w => `- ${w.message}`).join("\\n") : "None."}
`;

  fs.writeFileSync(filePath, frontmatter + content, "utf-8");
  console.log(`[Memory Architect] Wrote verdict to Obsidian vault: ${filePath}`);
}

export function searchVault(query) {
  initVault();
  // Very basic full-text search across vault files
  const files = fs.readdirSync(vaultPath).filter(f => f.endsWith('.md'));
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  const results = [];
  for (const file of files) {
    const filePath = path.join(vaultPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const contentLower = content.toLowerCase();
    
    let matchScore = 0;
    for (const kw of keywords) {
      if (contentLower.includes(kw)) matchScore++;
    }
    
    if (matchScore > 0) {
      results.push({
        file,
        score: matchScore,
        content: content.slice(0, 500) + "..." // return snippet
      });
    }
  }
  
  return results.sort((a, b) => b.score - a.score).slice(0, 3); // top 3 matches
}

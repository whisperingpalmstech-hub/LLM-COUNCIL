import type { Brief, BriefItem, BriefSection, CaseMode, Level, NextStep, Visual } from "@synod/contracts";
import { MODES } from "./modes.ts";

/** Pull the first JSON object out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Normalize whatever the model returned into a complete, safe Brief. */
export function normalizeBrief(raw: unknown, mode: CaseMode, version: number, agreement: number | null = null): Brief {
  const b = obj(raw);
  const expected = MODES[mode].sections.map((s) => s.title);
  const given = list(b.sections).map(obj);
  // Keep the mode's sections in their defined order, then any extras the model added.
  const sections: BriefSection[] = [
    ...expected.map((title) => ({ title, items: items(given.find((s) => str(s.title).toLowerCase() === title.toLowerCase())?.items) })),
    ...given.filter((s) => !expected.some((t) => t.toLowerCase() === str(s.title).toLowerCase())).map((s) => ({ title: str(s.title) || "Notes", items: items(s.items) }))
  ].filter((s) => s.items.length);
  return {
    version,
    mode,
    bottomLine: str(b.bottomLine),
    verdict: str(b.verdict).slice(0, 120),
    confidence: clamp01(b.confidence),
    agreement,
    consensus: strings(b.consensus),
    disagreements: list(b.disagreements)
      .map(obj)
      .map((d) => ({ point: str(d.point), positions: strings(d.positions) }))
      .filter((d) => d.point),
    redFlags: strings(b.redFlags),
    sections,
    nextSteps: list(b.nextSteps)
      .map((x): NextStep => {
        const o = typeof x === "string" ? { action: x } : obj(x);
        const urgency = str(o.urgency).toLowerCase();
        return { action: str(o.action), why: str(o.why), urgency: urgency === "now" || urgency === "later" ? urgency : "soon" };
      })
      .filter((s) => s.action),
    openQuestions: strings(b.openQuestions),
    caveats: MODES[mode].caveats,
    visuals: normalizeVisuals(b.visuals)
  };
}

export function briefMarkdown(brief: Brief, question: string): string {
  const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- None");
  const level = (i: BriefItem) => (i.level ? ` _(${i.level})_` : "");
  const parts = [
    `# Second opinion`,
    `> ${question.split("\n")[0].slice(0, 200)}`,
    `**${brief.verdict || "Assessment"}** · confidence ${Math.round(brief.confidence * 100)}% · v${brief.version}`,
    brief.bottomLine,
    brief.redFlags.length ? `## Red flags\n${bullets(brief.redFlags)}` : "",
    ...brief.sections.map((s) => `## ${s.title}\n${s.items.map((i) => `- **${i.text}**${level(i)}${i.detail ? ` — ${i.detail}` : ""}`).join("\n")}`),
    `## Next steps\n${brief.nextSteps.map((s, i) => `${i + 1}. **${s.action}** (${s.urgency})${s.why ? ` — ${s.why}` : ""}`).join("\n") || "- None"}`,
    `## Where the council agreed\n${bullets(brief.consensus)}`,
    `## Where it disagreed\n${brief.disagreements.length ? brief.disagreements.map((d) => `- **${d.point}**\n${d.positions.map((p) => `  - ${p}`).join("\n")}`).join("\n") : "- None"}`,
    `## Open questions\n${bullets(brief.openQuestions)}`,
    brief.caveats.length ? `---\n_${brief.caveats.join(" ")}_` : ""
  ];
  return parts.filter(Boolean).join("\n\n") + "\n";
}

/**
 * Validate visuals strictly: unknown kinds are dropped, strings are trimmed and length-capped,
 * numbers clamped, and every list bounded. Rendering escapes everything again.
 */
export function normalizeVisuals(value: unknown): Visual[] {
  const out: Visual[] = [];
  for (const raw of list(value).map(obj).slice(0, 3)) {
    const title = cap(raw.title, 80);
    switch (raw.kind) {
      case "ranked": {
        const scale = ["likelihood", "strength", "severity", "priority"].includes(String(raw.scale)) ? (raw.scale as "likelihood") : "likelihood";
        const items = list(raw.items)
          .map(obj)
          .map((i) => ({ label: cap(i.label, 90), value: Math.round(Math.max(0, Math.min(100, Number(i.value) <= 1 && Number(i.value) > 0 ? Number(i.value) * 100 : Number(i.value) || 0))), ...(cap(i.note, 160) ? { note: cap(i.note, 160) } : {}) }))
          .filter((i) => i.label)
          .slice(0, 8);
        if (items.length >= 2) out.push({ kind: "ranked", title: title || "Ranked", scale, items });
        break;
      }
      case "timeline": {
        const events = list(raw.events)
          .map(obj)
          .map((e) => ({ when: cap(e.when, 40), label: cap(e.label, 100), ...(cap(e.detail, 200) ? { detail: cap(e.detail, 200) } : {}), ...(e.urgent === true ? { urgent: true } : {}) }))
          .filter((e) => e.when && e.label)
          .slice(0, 10);
        if (events.length >= 2) out.push({ kind: "timeline", title: title || "Timeline", events });
        break;
      }
      case "decision": {
        const branches = list(raw.branches)
          .map(obj)
          .map((b) => ({ condition: cap(b.condition, 140), action: cap(b.action, 180) }))
          .filter((b) => b.condition && b.action)
          .slice(0, 6);
        if (branches.length >= 1) out.push({ kind: "decision", title: title || "Decision path", branches, ...(cap(raw.otherwise, 180) ? { otherwise: cap(raw.otherwise, 180) } : {}) });
        break;
      }
      case "comparison": {
        const options = strings(raw.options).map((o) => o.slice(0, 50)).slice(0, 4);
        const rows = list(raw.rows)
          .map(obj)
          .map((r) => ({ criterion: cap(r.criterion, 60), cells: options.map((_, i) => cap(list(r.cells)[i], 120)) }))
          .filter((r) => r.criterion)
          .slice(0, 8);
        const rec = Number(raw.recommended);
        if (options.length >= 2 && rows.length >= 1)
          out.push({ kind: "comparison", title: title || "Comparison", options, rows, ...(Number.isInteger(rec) && rec >= 0 && rec < options.length ? { recommended: rec } : {}) });
        break;
      }
      case "risk": {
        const items = list(raw.items)
          .map(obj)
          .map((i) => ({ label: cap(i.label, 70), likelihood: level(i.likelihood), impact: level(i.impact) }))
          .filter((i) => i.label)
          .slice(0, 9);
        if (items.length >= 2) out.push({ kind: "risk", title: title || "Risks", items });
        break;
      }
    }
  }
  return out;
}

function cap(value: unknown, max: number): string {
  const s = str(value).replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function level(value: unknown): Level {
  const v = str(value).toLowerCase();
  return v === "high" || v === "low" ? v : "medium";
}

function items(value: unknown): BriefItem[] {
  return list(value)
    .map((x) => {
      const o = typeof x === "string" ? { text: x } : obj(x);
      const lvl = str(o.level).toLowerCase();
      const item: BriefItem = { text: str(o.text) };
      if (str(o.detail)) item.detail = str(o.detail);
      if (lvl === "high" || lvl === "medium" || lvl === "low") item.level = lvl;
      return item;
    })
    .filter((i) => i.text);
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value.filter((x) => x != null && x !== "") : value ? [value] : [];
}

function strings(value: unknown): string[] {
  return list(value).map(str).filter(Boolean);
}

function clamp01(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

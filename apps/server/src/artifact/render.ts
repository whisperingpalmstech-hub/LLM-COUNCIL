// The shareable second-opinion document: one self-contained HTML page rendered from the
// structured brief. The model never writes HTML; every string is escaped here.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Brief, CouncilMember, Level, Turn, Visual } from "@synod/contracts";
import { ROOT } from "../config.ts";

export interface RenderOptions {
  /** Shown inside the app: adds a tiny script that reports height and opens links outside the frame. */
  embed?: boolean;
  theme?: "light" | "dark";
  /** When the document was shared, for the footer. */
  sharedUntil?: string;
}

export interface RenderedDocument {
  html: string;
  /** Content-Security-Policy for this exact document. */
  csp: string;
}

const MODE_LABEL: Record<Brief["mode"], string> = { medical: "Medical", legal: "Legal", code: "Code", general: "General" };

export function renderDocument(turn: Turn, brief: Brief, options: RenderOptions = {}): RenderedDocument {
  const nonce = crypto.randomBytes(12).toString("base64");
  const members = turn.council.members;
  const chairman = turn.council.chairman;
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(turn.completedAt ?? turn.startedAt));
  const pct = Math.round(brief.confidence * 100);
  const sections: string[] = [];

  if (brief.redFlags.length) {
    sections.push(`<section class="flags"><h2>Needs attention now</h2><ul>${brief.redFlags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></section>`);
  }
  for (const visual of brief.visuals ?? []) sections.push(renderVisual(visual));
  for (const s of brief.sections) {
    sections.push(
      `<section><h2>${esc(s.title)}</h2><ul class="items">${s.items
        .map((i) => `<li><div><strong>${esc(i.text)}</strong>${i.detail ? `<p>${esc(i.detail)}</p>` : ""}</div>${i.level ? `<span class="lvl lvl-${i.level}">${levelWord(s.title, i.level)}</span>` : ""}</li>`)
        .join("")}</ul></section>`
    );
  }
  if (brief.nextSteps.length) {
    sections.push(
      `<section><h2>Next steps</h2><ol class="steps">${brief.nextSteps
        .map((s) => `<li><div><strong>${esc(s.action)}</strong>${s.why ? `<p>${esc(s.why)}</p>` : ""}</div>${s.urgency === "now" ? '<span class="now">Now</span>' : s.urgency === "later" ? '<span class="later">Later</span>' : ""}</li>`)
        .join("")}</ol></section>`
    );
  }
  if (brief.consensus.length || brief.disagreements.length) {
    sections.push(
      `<section class="two"><div><h2>Where the council agreed</h2><ul class="plain">${brief.consensus.map((c) => `<li>${esc(c)}</li>`).join("") || "<li>None recorded</li>"}</ul></div><div><h2>Where it disagreed</h2>${
        brief.disagreements
          .map((d) => `<div class="dis"><strong>${esc(d.point)}</strong><ul class="plain">${d.positions.map((p) => `<li>${logoFor(p, [...members, chairman])}${esc(p)}</li>`).join("")}</ul></div>`)
          .join("") || "<p class=\"muted\">None recorded</p>"
      }</div></section>`
    );
  }
  sections.push(renderCouncil(turn, brief));
  if (brief.openQuestions.length) {
    sections.push(`<section><h2>What would change this opinion</h2><ul class="plain">${brief.openQuestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></section>`);
  }

  const script = options.embed
    ? `<script nonce="${nonce}">(function(){var h=0;function s(){var v=Math.ceil(document.documentElement.scrollHeight);if(v!==h){h=v;parent.postMessage({synodDocHeight:v},"*");}}new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s);document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(a){e.preventDefault();parent.postMessage({synodOpen:a.href},"*");}});})();</script>`
    : "";

  const html = `<!doctype html>
<html lang="en"${options.theme ? ` data-theme="${options.theme}"` : ""}${options.embed ? " data-embed" : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(brief.verdict || "Second opinion")} · Synod</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <header>
    <p class="eyebrow"><span>${esc(MODE_LABEL[brief.mode])} second opinion</span><span>${esc(date)}</span></p>
    <h1>${esc(brief.verdict || "Assessment")}</h1>
    ${brief.bottomLine ? `<p class="bottom">${esc(brief.bottomLine)}</p>` : ""}
    <div class="meta">
      <div class="conf" title="The chairman's own estimate"><span class="bar"><i style="width:${pct}%"></i></span>${pct >= 75 ? "High" : pct >= 50 ? "Moderate" : "Low"} confidence, ${pct}%</div>
      ${brief.agreement != null ? `<span class="pill ${brief.agreement >= 0.99 ? "ok" : brief.agreement >= 0.6 ? "" : "warn"}">${brief.agreement >= 0.99 ? "Unanimous" : brief.agreement >= 0.6 ? "Majority agreed" : "Split council"} ${Math.round(brief.agreement * 100)}%</span>` : ""}
      <span class="council">${members.map((m) => `<span class="seat" title="${esc(m.label)}">${logo(m)}</span>`).join("")}<span class="muted">${members.length} models, ${turn.rounds ?? 3} rounds</span></span>
    </div>
  </header>
  <details class="question"><summary>The question</summary><p>${esc(turn.prompt)}</p>${turn.clarification?.answer ? `<p class="muted"><strong>Asked:</strong> ${esc(turn.clarification.question)}<br><strong>Answer:</strong> ${esc(turn.clarification.answer)}</p>` : ""}</details>
  ${sections.join("\n  ")}
  <footer>
    ${brief.caveats.length ? `<p>${esc(brief.caveats.join(" "))}</p>` : ""}
    <p class="muted">Prepared by a Synod council of ${esc(members.map((m) => m.label).join(", "))}, chaired by ${esc(chairman.label)}. Each model answered independently, then ranked the others' answers without knowing who wrote them.${options.sharedUntil ? ` Shared link valid until ${esc(options.sharedUntil)}.` : ""}</p>
  </footer>
</main>
${script}
</body>
</html>`;

  const csp = ["default-src 'none'", "style-src 'unsafe-inline'", "img-src data:", options.embed ? `script-src 'nonce-${nonce}'` : "script-src 'none'", "base-uri 'none'", "form-action 'none'", options.embed ? "frame-ancestors 'self'" : "frame-ancestors 'none'"].join("; ");
  return { html, csp };
}

function renderVisual(v: Visual): string {
  switch (v.kind) {
    case "ranked":
      return `<section><h2>${esc(v.title)}</h2><div class="ranked">${v.items
        .map((i) => `<div class="row"><div class="lab"><span>${esc(i.label)}</span><b>${i.value}%</b></div><span class="bar ${v.scale}"><i style="width:${i.value}%"></i></span>${i.note ? `<p>${esc(i.note)}</p>` : ""}</div>`)
        .join("")}</div></section>`;
    case "timeline":
      return `<section><h2>${esc(v.title)}</h2><ol class="timeline">${v.events
        .map((e) => `<li class="${e.urgent ? "urgent" : ""}"><span class="when">${esc(e.when)}</span><div><strong>${esc(e.label)}</strong>${e.detail ? `<p>${esc(e.detail)}</p>` : ""}</div></li>`)
        .join("")}</ol></section>`;
    case "decision":
      return `<section><h2>${esc(v.title)}</h2><div class="decision">${v.branches
        .map((b) => `<div class="branch"><span class="if">If</span><p>${esc(b.condition)}</p><span class="arrow">→</span><p class="then">${esc(b.action)}</p></div>`)
        .join("")}${v.otherwise ? `<div class="branch other"><span class="if">Otherwise</span><p class="then">${esc(v.otherwise)}</p></div>` : ""}</div></section>`;
    case "comparison":
      return `<section><h2>${esc(v.title)}</h2><div class="table"><table><thead><tr><th></th>${v.options
        .map((o, i) => `<th class="${i === v.recommended ? "rec" : ""}">${esc(o)}${i === v.recommended ? "<em>Recommended</em>" : ""}</th>`)
        .join("")}</tr></thead><tbody>${v.rows
        .map((r) => `<tr><th>${esc(r.criterion)}</th>${r.cells.map((c, i) => `<td class="${i === v.recommended ? "rec" : ""}">${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div></section>`;
    case "risk": {
      const order: Level[] = ["high", "medium", "low"];
      const cells = order
        .map((impact) =>
          order
            .slice()
            .reverse()
            .map((likelihood) => {
              const here = v.items.filter((i) => i.impact === impact && i.likelihood === likelihood);
              const score = { high: 3, medium: 2, low: 1 }[impact] * { high: 3, medium: 2, low: 1 }[likelihood];
              return `<div class="cell s${score >= 6 ? 3 : score >= 3 ? 2 : 1}">${here.map((i) => `<span>${esc(i.label)}</span>`).join("")}</div>`;
            })
            .join("")
        )
        .join("");
      return `<section><h2>${esc(v.title)}</h2><div class="risk"><span class="y">Impact</span><div class="grid">${cells}</div><span class="x">Likelihood</span></div></section>`;
    }
  }
}

function renderCouncil(turn: Turn, brief: Brief): string {
  const agg = turn.aggregate;
  if (!agg?.rankings.length) return "";
  const n = agg.rankings.length;
  const members = new Map(turn.council.members.map((m) => [m.id, m]));
  return `<section><h2>How the council decided</h2><p class="muted">Average position in anonymous peer review (each model's vote for its own answer ignored)${brief.agreement != null ? `; agreement ${Math.round(brief.agreement * 100)}%` : ""}${turn.convergedEarly ? "; stopped early on consensus" : ""}.</p><div class="ranked">${agg.rankings
    .map((r, i) => {
      const m = members.get(r.memberId);
      const strength = r.votes ? Math.round(((n - r.averageRank + 1) / n) * 100) : 0;
      return `<div class="row"><div class="lab"><span>${m ? logo(m) : ""}${esc(r.label)}${i === 0 ? ' <em class="top">Top-ranked</em>' : ""}</span><b>${r.votes ? r.averageRank.toFixed(2) : "–"}</b></div><span class="bar council"><i style="width:${Math.max(6, strength)}%"></i></span></div>`;
    })
    .join("")}</div></section>`;
}

function levelWord(title: string, level: Level): string {
  const t = title.toLowerCase();
  const words = /bug|risk|can.?t.?miss/.test(t)
    ? { high: "Serious", medium: "Moderate", low: "Minor" }
    : /differential|diagnos|option/.test(t)
      ? { high: "Most likely", medium: "Possible", low: "Less likely" }
      : /argument/.test(t)
        ? { high: "Strong", medium: "Moderate", low: "Weak" }
        : { high: "First", medium: "Next", low: "Later" };
  return words[level];
}

// ---- logos (LobeHub Icons, MIT) ----

const LOGO_DIR = path.join(ROOT, "apps/web/src/assets/logos");
const LOGO_FILES: [RegExp, string][] = [
  [/anthropic|claude/i, "claude-color.svg"],
  [/openai|gpt|\bo\d/i, "openai.svg"],
  [/google|gemini|gemma/i, "gemini-color.svg"],
  [/deepseek/i, "deepseek-color.svg"],
  [/x-ai|grok|xai/i, "grok.svg"],
  [/z-ai|glm|zhipu/i, "zhipu-color.svg"],
  [/qwen/i, "qwen-color.svg"],
  [/mistral/i, "mistral-color.svg"],
  [/meta|llama/i, "meta-color.svg"],
  [/moonshot|kimi/i, "kimi-color.svg"]
];
const logoCache = new Map<string, string>();

function logo(member: Pick<CouncilMember, "model" | "provider" | "label">): string {
  const hit = LOGO_FILES.find(([re]) => re.test(member.model) || re.test(member.provider));
  if (!hit) return `<span class="initial">${esc(member.label.slice(0, 1).toUpperCase())}</span>`;
  if (!logoCache.has(hit[1])) {
    try {
      // Static files from the repo; strip anything that isn't plain SVG markup.
      const svg = fs.readFileSync(path.join(LOGO_DIR, hit[1]), "utf8").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
      logoCache.set(hit[1], svg.replace(/<title>[\s\S]*?<\/title>/, ""));
    } catch {
      logoCache.set(hit[1], `<span class="initial">${esc(member.label.slice(0, 1).toUpperCase())}</span>`);
    }
  }
  return `<span class="logo">${logoCache.get(hit[1])}</span>`;
}

function logoFor(text: string, members: CouncilMember[]): string {
  const m = members.find((x) => text.toLowerCase().includes(x.label.toLowerCase()));
  return m ? logo(m) : "";
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CSS = `
:root{color-scheme:light;--bg:#fcfcfc;--paper:#fff;--ink:#0a0a0b;--soft:#3f3f46;--muted:#71717a;--faint:#a1a1aa;--line:rgba(10,10,11,.08);--line2:rgba(10,10,11,.14);--accent:oklch(.52 .16 255);--red:#dc2626;--red-bg:rgba(220,38,38,.07);--amber:#d97706;--amber-bg:rgba(217,119,6,.09);--green:#059669;--green-bg:rgba(5,150,105,.09);
--serif:"Newsreader","Iowan Old Style","Charter","Georgia",serif;--sans:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--bg:#000;--paper:#0d0d0e;--ink:#f4f4f5;--soft:#d4d4d8;--muted:#a1a1aa;--faint:#71717a;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--accent:oklch(.7 .14 255);--red:#f87171;--red-bg:rgba(248,113,113,.1);--amber:#fbbf24;--amber-bg:rgba(251,191,36,.1);--green:#34d399;--green-bg:rgba(52,211,153,.1)}}
:root[data-theme=dark]{color-scheme:dark;--bg:#000;--paper:#0d0d0e;--ink:#f4f4f5;--soft:#d4d4d8;--muted:#a1a1aa;--faint:#71717a;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--accent:oklch(.7 .14 255);--red:#f87171;--red-bg:rgba(248,113,113,.1);--amber:#fbbf24;--amber-bg:rgba(251,191,36,.1);--green:#34d399;--green-bg:rgba(52,211,153,.1)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 var(--sans);-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
main{max-width:780px;margin:0 auto;padding:56px 40px 64px;background:var(--paper);min-height:100vh;border-left:1px solid var(--line);border-right:1px solid var(--line)}
h1,h2,p{margin:0}h1{font:500 2.15rem/1.12 var(--serif);letter-spacing:-.015em;margin-top:14px;text-wrap:balance}
.eyebrow{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:.8rem}
.bottom{font:1.13rem/1.6 var(--serif);color:var(--soft);margin-top:14px;max-width:62ch}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:12px 22px;margin-top:22px;font-size:.8rem;color:var(--muted)}
.conf{display:flex;align-items:center;gap:10px}.conf .bar{width:110px}
.bar{display:block;height:6px;border-radius:99px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;border-radius:99px;background:var(--ink)}
.pill{padding:3px 10px;border-radius:99px;background:var(--line);color:var(--soft)}.pill.ok{background:var(--green-bg);color:var(--green)}.pill.warn{background:var(--amber-bg);color:var(--amber)}
.council{display:flex;align-items:center;gap:6px}.seat{display:inline-flex;width:24px;height:24px;border-radius:99px;border:1px solid var(--line2);background:var(--bg);align-items:center;justify-content:center;margin-right:-8px;box-shadow:0 0 0 2px var(--paper)}.council .muted{margin-left:14px}
.logo{display:inline-flex;width:14px;height:14px;vertical-align:-2px;margin-right:6px}.logo svg{width:100%;height:100%}.seat .logo{margin:0}
.initial{display:inline-flex;width:14px;height:14px;border-radius:99px;background:var(--line2);font-size:9px;align-items:center;justify-content:center;margin-right:6px}
.question{margin-top:28px;border-top:1px solid var(--line);padding-top:14px;color:var(--soft);font-size:.9rem}.question summary{cursor:pointer;color:var(--muted);font-size:.8rem}.question p{margin-top:8px;white-space:pre-wrap}
section{margin-top:34px}h2{font-size:.82rem;font-weight:600;margin-bottom:10px;letter-spacing:.01em}
.muted{color:var(--muted)}section>.muted{font-size:.8rem;margin:-4px 0 10px}
.flags{background:var(--red-bg);border-radius:16px;padding:16px 18px}.flags h2{color:var(--red)}.flags ul{margin:0;padding-left:18px}.flags li{margin:4px 0}.flags li::marker{color:var(--red)}
.items,.steps{list-style:none;margin:0;padding:0}.items li,.steps li{display:flex;gap:16px;justify-content:space-between;padding:11px 0;border-top:1px solid var(--line)}.items li:first-child,.steps li:first-child{border-top:0}
.items p,.steps p{color:var(--muted);font-size:.88rem;margin-top:2px}
.steps{counter-reset:s}.steps li{counter-increment:s}.steps li>div{position:relative;padding-left:32px}.steps li>div::before{content:counter(s);position:absolute;left:0;top:1px;width:20px;height:20px;border:1px solid var(--line2);border-radius:99px;font-size:.7rem;display:flex;align-items:center;justify-content:center;color:var(--muted)}
.lvl,.now,.later{flex:none;font-size:.72rem;align-self:flex-start;margin-top:3px;color:var(--muted)}.lvl-high{color:var(--ink);font-weight:600}.now{color:var(--red);background:var(--red-bg);padding:1px 8px;border-radius:99px;font-weight:600}
.two{display:grid;grid-template-columns:1fr 1fr;gap:28px}.plain{margin:0;padding-left:0;list-style:none}.plain li{margin:6px 0;color:var(--soft);font-size:.9rem}.dis{margin-bottom:12px}.dis strong{font-size:.9rem}.dis .plain li{color:var(--muted);font-size:.85rem;margin:4px 0}
.ranked .row{margin:10px 0}.ranked .lab{display:flex;justify-content:space-between;gap:12px;font-size:.88rem;margin-bottom:5px}.ranked .lab b{font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}.ranked p{font-size:.8rem;color:var(--muted);margin-top:4px}
.bar.severity i{background:var(--red)}.bar.strength i,.bar.council i{background:var(--accent)}.bar.priority i{background:var(--amber)}
.top{font-style:normal;font-size:.7rem;color:var(--green);background:var(--green-bg);padding:1px 7px;border-radius:99px;margin-left:6px}
.timeline{list-style:none;margin:0;padding:0 0 0 4px;border-left:2px solid var(--line2)}.timeline li{position:relative;display:grid;grid-template-columns:118px 1fr;gap:12px;padding:6px 0 12px 18px}.timeline li::before{content:"";position:absolute;left:-7px;top:12px;width:12px;height:12px;border-radius:99px;background:var(--paper);border:2px solid var(--ink)}
.timeline li.urgent::before{border-color:var(--red);background:var(--red)}.timeline .when{font-size:.8rem;color:var(--muted);padding-top:2px}.timeline li.urgent .when{color:var(--red);font-weight:600}.timeline p{color:var(--muted);font-size:.85rem}
.decision{display:grid;gap:8px}.branch{display:grid;grid-template-columns:auto 1fr auto 1.2fr;gap:12px;align-items:start;border:1px solid var(--line);border-radius:14px;padding:12px 14px;font-size:.9rem}.branch.other{grid-template-columns:auto 1fr}
.if{font-size:.7rem;font-weight:600;color:var(--accent);padding-top:3px}.arrow{color:var(--faint)}.then{font-weight:500}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:14px}table{border-collapse:collapse;width:100%;font-size:.86rem}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-top:1px solid var(--line)}thead th{border-top:0;font-weight:600}tbody th{font-weight:500;color:var(--muted);width:24%}
.rec{background:var(--green-bg)}th em{display:block;font-style:normal;font-size:.68rem;color:var(--green);font-weight:600}
.risk{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center}.risk .y{writing-mode:vertical-rl;transform:rotate(180deg);font-size:.72rem;color:var(--muted)}.risk .x{grid-column:2;text-align:center;font-size:.72rem;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.cell{min-height:64px;border-radius:10px;padding:6px;display:flex;flex-wrap:wrap;gap:4px;align-content:flex-start}.cell span{font-size:.72rem;background:var(--paper);border:1px solid var(--line2);border-radius:99px;padding:2px 8px}
.s1{background:var(--green-bg)}.s2{background:var(--amber-bg)}.s3{background:var(--red-bg)}
footer{margin-top:44px;border-top:1px solid var(--line);padding-top:16px;font-size:.78rem;color:var(--soft)}footer p{margin:6px 0}
[data-embed] body{background:transparent}[data-embed] main{border:0;min-height:0;padding-top:24px;background:transparent;max-width:none}
@media (max-width:640px){main{padding:36px 20px;border:0}h1{font-size:1.7rem}.two{grid-template-columns:1fr}.timeline li{grid-template-columns:1fr}.branch{grid-template-columns:auto 1fr}.arrow{display:none}.branch .then{grid-column:2}}
@media print{body{background:#fff}main{border:0;padding:0;max-width:none}.question{display:block}.question summary{display:none}section,.flags,.branch,tr{break-inside:avoid}a{color:inherit}}
`;

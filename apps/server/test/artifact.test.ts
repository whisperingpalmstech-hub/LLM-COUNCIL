import assert from "node:assert/strict";
import { test } from "node:test";
import type { Brief, Turn } from "@synod/contracts";
import { renderDocument } from "../src/artifact/render.ts";
import { normalizeVisuals } from "../src/council/brief.ts";
import { readShareToken, signShareToken } from "../src/auth/accounts.ts";

const brief: Brief = {
  version: 1,
  mode: "medical",
  bottomLine: "Start <script>alert(1)</script> LMWH now.",
  verdict: 'Likely PE "high" & <b>urgent</b>',
  confidence: 0.9,
  agreement: 1,
  consensus: ["CTPA needed"],
  disagreements: [{ point: "Timing", positions: ["GPT-6.1 Terra: image first"] }],
  redFlags: ["Hypotension"],
  sections: [{ title: "Differential diagnosis", items: [{ text: "PE", level: "high" }] }],
  nextSteps: [{ action: "Give enoxaparin", why: "Delay to CT", urgency: "now" }],
  openQuestions: [],
  caveats: ["AI-generated."],
  visuals: normalizeVisuals([
    { kind: "ranked", title: "Differential", scale: "likelihood", items: [{ label: "PE", value: 0.8 }, { label: "Pneumonia", value: 15 }, { label: "<img src=x onerror=alert(1)>", value: 500 }] },
    { kind: "comparison", title: "Options", options: ["Image first", "Treat first"], rows: [{ criterion: "Speed", cells: ["Slower", "Faster"] }], recommended: 1 },
    { kind: "risk", title: "Risks", items: [{ label: "Bleeding", likelihood: "low", impact: "high" }, { label: "Clot", likelihood: "high", impact: "high" }] },
    { kind: "html", html: "<script>evil()</script>" }
  ])
};
const turn = {
  id: "t",
  prompt: "34F postpartum <chest pain>",
  mode: "medical",
  attachments: [],
  status: "completed",
  stage: null,
  council: { auto: true, depth: "standard", members: [{ id: "g", label: "GPT-6.1 Terra", provider: "openrouter", model: "openai/gpt-6.1-terra" }], chairman: { id: "c", label: "Claude Opus 5.5", provider: "openrouter", model: "anthropic/claude-opus-5.5" }, clarify: true, brief: true, webSearch: false },
  rounds: 5,
  cycle: 2,
  research: [],
  stage1: [],
  stage2: [],
  startedAt: "2026-10-27T10:00:00.000Z",
  completedAt: "2026-10-27T10:01:30.000Z"
} as Turn;

test("visuals are validated: unknown kinds dropped, values clamped, at most 3", () => {
  assert.equal(brief.visuals?.length, 3);
  assert.deepEqual(brief.visuals?.map((v) => v.kind), ["ranked", "comparison", "risk"]);
  const ranked = brief.visuals![0] as Extract<NonNullable<Brief["visuals"]>[number], { kind: "ranked" }>;
  assert.deepEqual(ranked.items.map((i) => i.value), [80, 15, 100], "fractions become percentages, values cap at 100");
});

test("the document escapes every model-provided string and ships without scripts", () => {
  const { html, csp } = renderDocument(turn, brief);
  assert.ok(!/<script/i.test(html), "no script tags at all");
  assert.ok(!html.includes("<img src=x"), "model text cannot inject markup");
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("Likely PE &quot;high&quot; &amp; &lt;b&gt;urgent&lt;/b&gt;"));
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(html, /Recommended/);
  assert.match(html, /<svg/, "lab logos are embedded");
});

test("the in-app variant allows only its own nonce'd script and same-origin framing", () => {
  const { html, csp } = renderDocument(turn, brief, { embed: true, theme: "dark" });
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.match(html, /data-theme="dark"/);
  assert.match(csp, /frame-ancestors 'self'/);
});

test("share tokens are signed and expire", () => {
  const token = signShareToken("s3cret", { c: "c", t: "t", s: "s", e: Date.now() + 60_000 });
  assert.deepEqual(readShareToken("s3cret", token)?.s, "s");
  assert.equal(readShareToken("other", token), null);
  assert.equal(readShareToken("s3cret", token.slice(0, -3) + "abc"), null);
  assert.equal(readShareToken("s3cret", signShareToken("s3cret", { c: "c", t: "t", s: "s", e: Date.now() - 1 })), null);
});

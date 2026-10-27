import type { CompletionRequest, Provider } from "./types.ts";

/**
 * Deterministic offline provider. Used for tests, demos, and when no key is configured.
 * Responses are clearly labelled so nobody mistakes them for real model output.
 */
export class MockProvider implements Provider {
  readonly id = "mock" as const;
  private readonly delayMs: number;

  constructor(options: { delayMs?: number } = {}) {
    this.delayMs = options.delayMs ?? 0;
  }

  configured(): boolean {
    return true;
  }

  defaultModel(): string {
    return "mock";
  }

  async complete(request: CompletionRequest): Promise<string> {
    const text = await this.reply(request);
    if (request.onText) {
      // Simulate streaming in a few chunks.
      const step = Math.max(1, Math.ceil(text.length / 4));
      for (let i = step; i < text.length; i += step) request.onText(text.slice(0, i));
    }
    return text;
  }

  private async reply(request: CompletionRequest): Promise<string> {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    request.signal?.throwIfAborted();
    const prompt = request.messages.at(-1)?.content ?? "";
    const model = request.model || "mock";
    switch (request.purpose) {
      case "clarify": {
        if (prompt.startsWith("Classify this request")) {
          const q = prompt.slice(prompt.indexOf("Request:"));
          const mode = /patient|mg|diagnos|dose|symptom/i.test(q) ? "medical" : /contract|court|lawsuit|sue|clause|legal/i.test(q) ? "legal" : /code|kubectl|sql|deploy|function|bug/i.test(q) ? "code" : "general";
          return JSON.stringify({ mode });
        }
        const question = prompt.match(/Question:\n([\s\S]*?)(\n\n|$)/)?.[1] ?? prompt;
        return JSON.stringify(
          question.length < 40 && !/clarifying answer/i.test(prompt)
            ? { needed: true, question: "What outcome would make this decision a success for you, and by when?" }
            : { needed: false, question: "" }
        );
      }
      case "answer":
        return `**[mock:${model}]** Offline demonstration answer.\n\nStart with the smallest reversible step, measure it against an explicit success metric, and only scale once evidence supports it.`;
      case "review": {
        const labels = [...new Set(prompt.match(/Response [A-Z]\b/g) ?? [])];
        // Rotate by model name so different reviewers disagree a little.
        const shift = [...model].reduce((sum, c) => sum + c.charCodeAt(0), 0) % Math.max(1, labels.length);
        const ranked = [...labels.slice(shift), ...labels.slice(0, shift)];
        return `**[mock:${model}]** Each response is reasonable; differences are in specificity.\n\nFINAL RANKING:\n${ranked.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
      }
      case "synthesis":
        return `**[mock:${model}]** Council synthesis (offline demo).\n\nThe council agrees: run a small, time-boxed pilot with a clear stop/scale gate before committing further resources.`;
      case "moderate": {
        const ids = [...prompt.matchAll(/- id: (\S+) \|/g)].map((m) => m[1]);
        const fresh = prompt.includes("The user just wrote");
        return JSON.stringify(fresh ? { speakers: ids.slice(0, 2), reason: "Two different angles" } : { speakers: [], reason: "" });
      }
      case "chat": {
        const lines = prompt.split("\n").filter((l) => /^[^:]{1,40}: /.test(l));
        const previous = lines.at(-1)?.split(":")[0] ?? "everyone";
        return `[mock:${model}] Building on ${previous}: I'd test the riskiest assumption first.`;
      }
      case "brief": {
        const sections = [...prompt.matchAll(/\{"title": "([^"]+)"/g)].map((m) => ({
          title: m[1],
          items: [
            { text: `${m[1]}: first point (demo)`, detail: "Offline demo detail.", level: "high" },
            { text: `${m[1]}: second point (demo)`, level: "medium" }
          ]
        }));
        return JSON.stringify({
          verdict: "Demo verdict",
          bottomLine: "Offline demo brief. Connect a real provider for a substantive second opinion.",
          confidence: 0.5,
          redFlags: ["Demo red flag"],
          sections,
          nextSteps: [{ action: "Connect a real model provider", why: "Mock output is not advice", urgency: "now" }],
          consensus: ["Members agreed on the overall direction."],
          disagreements: [{ point: "How cautious to be", positions: ["Mock Analyst: move now", "Mock Skeptic: wait for more data"] }],
          openQuestions: ["What would change the answer?"],
          visuals: [
            { kind: "ranked", title: "Options by strength", scale: "strength", items: [{ label: "Pilot first", value: 80, note: "Lowest regret" }, { label: "Full launch", value: 45 }] },
            { kind: "timeline", title: "What happens when", events: [{ when: "Now", label: "Agree the success metric", urgent: true }, { when: "Week 2", label: "Review pilot results" }] },
            { kind: "unknown-kind", title: "Should be dropped" }
          ]
        });
      }
    }
  }
}

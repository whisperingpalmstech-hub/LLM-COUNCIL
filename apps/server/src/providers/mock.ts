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
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    request.signal?.throwIfAborted();
    const prompt = request.messages.at(-1)?.content ?? "";
    const model = request.model || "mock";
    switch (request.purpose) {
      case "clarify": {
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
          openQuestions: ["What would change the answer?"]
        });
      }
    }
  }
}

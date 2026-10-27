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
      case "plan":
        return JSON.stringify({
          decision: "CONDITIONAL GO",
          summary: "Run a time-boxed pilot before committing (offline demo plan).",
          assumptions: ["Demo output — connect a real provider for substantive advice."],
          risks: ["Pilot results may not generalise."],
          phases: [
            { name: "Define", objective: "Write down the success metric and budget ceiling.", duration: "1 week", owner: "Decision owner", tasks: ["Agree the metric", "Set the budget cap"], acceptanceCriteria: ["Metric and cap documented"], decisionGate: "Metric agreed" },
            { name: "Pilot", objective: "Run the smallest experiment that produces evidence.", duration: "2-4 weeks", owner: "Pilot lead", tasks: ["Launch pilot", "Collect results"], acceptanceCriteria: ["Results captured against the metric"], decisionGate: "Scale, iterate, or stop" }
          ],
          successMetrics: ["Pilot metric meets target"],
          openQuestions: [],
          dissent: [],
          confidence: 0.5
        });
    }
  }
}

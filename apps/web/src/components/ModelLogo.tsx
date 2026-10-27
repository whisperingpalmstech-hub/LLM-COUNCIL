// Company marks from LobeHub Icons (MIT, https://github.com/lobehub/lobe-icons).
import anthropic from "~/assets/logos/claude-color.svg?raw";
import deepseek from "~/assets/logos/deepseek-color.svg?raw";
import gemini from "~/assets/logos/gemini-color.svg?raw";
import kimi from "~/assets/logos/kimi-color.svg?raw";
import meta from "~/assets/logos/meta-color.svg?raw";
import mistral from "~/assets/logos/mistral-color.svg?raw";
import ollama from "~/assets/logos/ollama.svg?raw";
import openai from "~/assets/logos/openai.svg?raw";
import openrouter from "~/assets/logos/openrouter.svg?raw";
import perplexity from "~/assets/logos/perplexity-color.svg?raw";
import qwen from "~/assets/logos/qwen-color.svg?raw";
import silicon from "~/assets/logos/siliconcloud-color.svg?raw";
import grok from "~/assets/logos/grok.svg?raw";
import zhipu from "~/assets/logos/zhipu-color.svg?raw";
import type { CouncilMember } from "@synod/contracts";
import { cn } from "~/lib/utils";

const MARKS: [RegExp, string, string][] = [
  [/anthropic|claude/i, anthropic, "Anthropic"],
  [/openai|gpt|\bo\d/i, openai, "OpenAI"],
  [/google|gemini|gemma/i, gemini, "Google"],
  [/deepseek/i, deepseek, "DeepSeek"],
  [/x-ai|grok|xai/i, grok, "xAI"],
  [/z-ai|glm|zhipu/i, zhipu, "Zhipu AI"],
  [/qwen|alibaba/i, qwen, "Qwen"],
  [/mistral|voxtral|codestral/i, mistral, "Mistral"],
  [/meta|llama/i, meta, "Meta"],
  [/moonshot|kimi/i, kimi, "Moonshot"],
  [/perplexity|sonar/i, perplexity, "Perplexity"],
  [/siliconflow/i, silicon, "SiliconFlow"],
  [/ollama/i, ollama, "Ollama"],
  [/openrouter/i, openrouter, "OpenRouter"]
];

/** Resolve a company mark from the model id first (OpenRouter models name their lab), then the provider. */
export function markFor(member: Pick<CouncilMember, "provider" | "model">): { svg: string; company: string } | null {
  for (const source of [member.model, member.provider]) {
    const hit = MARKS.find(([re]) => re.test(source));
    if (hit) return { svg: hit[1], company: hit[2] };
  }
  return null;
}

export function ModelLogo({ member, className }: { member: Pick<CouncilMember, "provider" | "model" | "label">; className?: string }) {
  const mark = markFor(member);
  if (!mark)
    return (
      <span aria-hidden className={cn("inline-flex size-4 items-center justify-center rounded-full bg-muted font-semibold text-[0.6rem] text-muted-foreground", className)}>
        {member.label.slice(0, 1).toUpperCase()}
      </span>
    );
  return <span aria-hidden title={mark.company} className={cn("inline-flex size-4 shrink-0 [&>svg]:size-full", className)} dangerouslySetInnerHTML={{ __html: mark.svg }} />;
}

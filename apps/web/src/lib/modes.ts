import { Code2, Scale, Sparkles, Stethoscope, type LucideIcon } from "lucide-react";
import type { CaseMode } from "@synod/contracts";

export interface ModeUi {
  label: string;
  icon: LucideIcon;
  tagline: string;
  placeholder: string;
  example: string;
  /** Tailwind classes for the mode's accent. */
  tint: string;
}

export const MODE_UI: Record<CaseMode, ModeUi> = {
  medical: {
    label: "Medical",
    icon: Stethoscope,
    tagline: "Differential, red flags, workup",
    placeholder: "Describe the case: presentation, history, exam, results, and what you're unsure about…",
    example:
      "58M, 3 days fever and productive cough, right basal crackles, SpO2 93% on air, RR 24. CRP 140, WCC 15. Hx T2DM, smoker. Outpatient or admit, and which antibiotics?",
    tint: "text-rose-500 dark:text-rose-400"
  },
  legal: {
    label: "Legal",
    icon: Scale,
    tagline: "Issues, both sides, deadlines",
    placeholder: "Describe the matter: jurisdiction, parties, key facts and documents, and the question…",
    example:
      "California. My client, a software contractor, signed a non-compete with a former employer 8 months ago and has an offer from a competitor. Is the clause enforceable, and what are the risks of taking the job?",
    tint: "text-amber-500 dark:text-amber-400"
  },
  code: {
    label: "Code",
    icon: Code2,
    tagline: "Bugs, risks, safer alternatives",
    placeholder: "Paste code, a design, or an action your agent wants to take, and say what it should achieve…",
    example:
      "My agent wants to run this on production Postgres to fix a bug: `UPDATE orders SET status = 'paid' WHERE payment_id IS NOT NULL;` The table has 40M rows. Is it safe to execute as-is?",
    tint: "text-sky-500 dark:text-sky-400"
  },
  general: {
    label: "General",
    icon: Sparkles,
    tagline: "Any decision or hard question",
    placeholder: "Describe the decision or question, with context: constraints, budget, timeline, what success looks like…",
    example: "We're a 12-person B2B SaaS team at $2M ARR. Should we launch in Europe next quarter or focus on the US first?",
    tint: "text-violet-500 dark:text-violet-400"
  }
};

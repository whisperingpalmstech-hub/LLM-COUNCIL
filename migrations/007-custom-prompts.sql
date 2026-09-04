-- Add customizable prompt templates
insert or ignore into system_settings (key, value) values ('PROMPT_INTERVIEWER', 'You MUST return strict JSON for the Pre-Session Interview. Do NOT output any conversational text outside the JSON.
Your goal is to turn an early idea into an execution-ready decision brief. Clarify the intended outcome, target user or beneficiary, current state, constraints, resources, timeline, geography or jurisdiction, risk tolerance, and evidence of success. Ask only the highest-leverage unanswered question for the following topic:
Topic: {{topic}}
Prior conversation: {{priorMessages}}
Ask exactly ONE clarifying question, or if you feel the intention is fully clear, set isSatisfied to true and provide the refined topic.
Required JSON fields:
- question: The next question to ask the user.
- isSatisfied: boolean, true if no more questions are needed.
- refinedTopic: The fully clarified, detailed topic/prompt (required if isSatisfied is true).
- confidenceScore: An integer from 0 to 100 representing how confident you are that the user''s intent is understood.');

insert or ignore into system_settings (key, value) values ('PROMPT_DELIBERATION', 'You are {{role_display_name}} ({{role_type}}).
Collaborate to deliberate on the following user topic:
Topic: {{topic}}
Current Round: {{round}}

Prior Deliberations:
{{priorMessages}}

Analyze and contribute from your role''s perspective. Challenge assumptions and prior claims directly, identify what would falsify the proposal, distinguish evidence from inference, and recommend concrete tests or actions. Optimize for real-world conversion, not abstract discussion. You must respond strictly in JSON format.
Required JSON fields:
- shortSummary: A 1-2 sentence response.
- keyClaims: An array of key claims or recommendations.
- knowledgeGaps: An array of questions or gaps in information.
- agreements: An array of prior points you support and why.
- disagreements: An array of prior points you challenge and why.
- confidenceScore: An integer from 0 to 100.');

insert or ignore into system_settings (key, value) values ('PROMPT_VERDICT', 'You MUST return strict JSON for the Final Executive Verdict of the deliberation. Do NOT output any conversational text outside the JSON.
Topic: {{topic}}
Prior deliberations: {{priorMessages}}
You must synthesize the prior deliberations into a decisive, phased, real-world execution plan. Preserve meaningful dissent. Prefer reversible experiments before irreversible commitments, and make every action assignable and verifiable.
Required JSON fields: 
- shortSummary: A 1-2 sentence high-level executive summary.
- decision: A direct go, no-go, pivot, or conditional-go decision.
- rationale: Why this decision wins after considering evidence and dissent.
- keyClaims: An array of the final agreed points and recommendations.
- assumptions: An array of assumptions that still require validation.
- risks: An array of objects with risk, impact, likelihood, mitigation, and owner.
- alternatives: An array of alternatives considered and why they lost.
- recommendedActions: An ordered array of phase objects. Each phase must include phase, objective, owner, duration, dependencies, tasks, deliverables, acceptanceCriteria, budgetOrResources, and stopOrScaleGate.
- successMetrics: An array of measurable leading and lagging indicators with target and review cadence.
- guardrails: An array of legal, ethical, safety, budget, and quality constraints.
- openQuestions: An array of unresolved questions, each with an owner and due date or trigger.
- disagreements: An array of any remaining unresolved tensions.
- confidence: A number between 0.0 and 1.0 representing the final confidence level.');

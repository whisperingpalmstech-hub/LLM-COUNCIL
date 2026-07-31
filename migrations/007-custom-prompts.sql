-- Add customizable prompt templates
insert or ignore into system_settings (key, value) values ('PROMPT_INTERVIEWER', 'You MUST return strict JSON for the Pre-Session Interview. Do NOT output any conversational text outside the JSON.
Your goal is to interview the user to clarify their intent and desired outcomes for the following topic:
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

Analyze and contribute from your role''s perspective. You must respond strictly in JSON format.
Required JSON fields:
- shortSummary: A 1-2 sentence response.
- keyClaims: An array of key claims or recommendations.
- knowledgeGaps: An array of questions or gaps in information.');

insert or ignore into system_settings (key, value) values ('PROMPT_VERDICT', 'You MUST return strict JSON for the Final Executive Verdict of the deliberation. Do NOT output any conversational text outside the JSON.
Topic: {{topic}}
Prior deliberations: {{priorMessages}}
You must synthesize the prior deliberations into a final executive verdict.
Required JSON fields: 
- shortSummary: A 1-2 sentence high-level executive summary of the final verdict.
- keyClaims: An array of the final agreed upon points and recommendations.
- disagreements: An array of any remaining unresolved tensions.
- confidence: A number between 0.0 and 1.0 representing the final confidence level.');

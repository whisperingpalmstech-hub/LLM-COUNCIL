# Synod User Manual

## Purpose

Synod Council turns a question into a structured decision brief: recommendation, rationale, risks, actions, success measures, assumptions, alternatives, and open questions. It organizes a decision; it does not replace qualified medical, legal, financial, or safety advice.

## Workspace map

| Area | Use it for |
| --- | --- |
| Companion sidebar | Avatar, voice, question input, advice depth, context upload, and phone handoff. |
| Mission route | Honest status through Interview, Deliberate, Decide, and Execute. |
| Live decision plane | Read the recommendation, confidence, warnings, and transcript. |
| Research notes | Reveal independent council perspectives when you need them. |
| History | Reopen prior sessions and their evidence trail. |
| Councils | Reuse a fixed role configuration. |
| Settings | Configure providers, memory, companion context, and health checks. |

## Start a decision

### Quick answer

Use **Quick answer** for a direct question, first opinion, or narrow choice. It runs Fast mode with one round and the Lead Synthesist, Domain Expert, and Risk Officer.

### Detailed advice

Use **Detailed advice** when the decision has material trade-offs, risk, cost, or people impact. It runs Deep mode with three rounds. Synod dynamically adds perspectives according to topic complexity—for example a Skeptic, web researcher, growth strategist, risk officer, or regulatory reviewer.

### Write a useful prompt

Include the choice, desired outcome, constraints, and deadline.

```text
Should I work for two years in India before pursuing a master's degree in Germany? I can spend up to ₹20 lakh and want a stable technical career within five years.
```

### Speak or attach context

- Select the microphone to dictate. Review the transcription before sending important names or numbers.
- Select **Add context** to attach a file up to 8 MB. An attachment is session context, not automatically verified evidence.
- Open **Fine-tune this decision** and use **Scout** with a canonical public GitHub repository URL to generate a repository brief.

## Control the context

Fine-tune controls let you override depth and rounds, choose a static council, select voice, permit guided follow-up questions, allow saved-decision memory, and define **Working toward**.

The optional **Active context** disclosure shows the persona/voice, working outcome, council mode, saved-context consent, and companion brief. These values are saved with the session, so later Settings changes do not rewrite past decisions.

In **Settings → Companion context**, set:

- **Persona brief** — how Synod should challenge and support you;
- **Default outcome** — the default aim for new decisions;
- **Show active context** — whether the disclosure is visible.

## Understand results

| State | Meaning | Your next step |
| --- | --- | --- |
| Interview | Synod needs one material clarification. | Answer it, or disable guided follow-ups for a direct answer. |
| Deliberating | Roles are forming and testing positions. | Wait; use Research notes only if necessary. |
| Completed | A decision brief is ready. | Check assumptions, evidence, risk, and owners before acting. |
| Resilience notice | A provider failed but usable remaining evidence completed the result. | Review the warning and retry if the missing source matters. |
| Failed | No reliable decision was completed. | Test provider health and retry. |

Synod renders readable sections rather than raw provider JSON. **Research notes** in the top bar are intentionally hidden by default to prevent a model-output dump from obscuring the recommendation.

## Phone evidence bridge

An active session shows **Continue on your phone** with a QR code. Scan it from a device that can reach the host to add a photo, audio file, or note. For local use, both devices normally need the same Wi-Fi; public deployments should use an HTTPS hostname.

## Memory and history

When **Use relevant saved decisions** is enabled, Synod can retrieve relevant local Obsidian-compatible decision notes. These are user context, not independently verified facts. You can disable memory per session.

Open **History** to revisit decisions. A session retains its topic, roles, messages, verdict, transcript, context snapshot, and visible warnings.

## Troubleshooting

| Symptom | Recovery |
| --- | --- |
| Microphone does not start | Allow browser microphone permission and retry. |
| QR upload does not work | Start a session, verify network reachability, and keep uploads below 8 MB. |
| Generic result | Choose Detailed advice and include constraints, deadline, and desired outcome. |
| Unwanted follow-up question | Turn off **Let Synod ask follow-up questions**. |
| Provider fallback | Open Settings, select **Test connections**, then check the selected provider key/model. |
| Saved context should not be used | Clear **Use relevant saved decisions** before starting. |

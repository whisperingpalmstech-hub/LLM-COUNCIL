# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Founders, operators, consultants, and leadership teams making consequential decisions under uncertainty. They need to move quickly without losing evidence, dissent, risk visibility, or accountability.

## Product Purpose

Synod Council turns an ambiguous decision into an accountable decision brief. It interviews the user for material context, assembles multiple independent model roles, deliberates across perspectives, and produces a structured recommendation with rationale, risks, actions, success measures, and unresolved questions.

## Positioning

Synod is a decision-intelligence workspace rather than a generic chatbot. Its differentiating mechanism is a visible multi-model council whose independent roles test assumptions and converge on an auditable verdict.

## Operating Context

Users start a conversation with a question or decision, optionally attaching files (from desktop or phone) or dictating by voice. They answer a clarifying question when asked, watch the council answer and peer-review live, read the chairman's synthesis and execution plan, revisit past conversations, and configure which models sit on the council.

## Capabilities and Constraints

- Core flow: optional clarifying question → independent answers → anonymized peer ranking → chairman synthesis → execution plan.
- Supporting workflows: conversation history, council settings, voice input, file and phone attachments, Obsidian notes, Hermes hand-off.
- Provider failures must degrade gracefully and must never make the product appear frozen.
- Structured decision sections replace raw provider payloads in the primary experience.
- The interface must remain responsive from mobile through wide desktop displays.
- Provider credentials remain masked and must never appear in rendered output.

## Brand Commitments

Preserve the name **Synod Council**. The voice is precise, calm, consequential, and executive rather than playful or chatty. The user has explicitly requested a beautiful, striking, modern glassmorphic application and hero.

## Evidence on Hand

The repository contains a working application, persisted deliberation sessions, provider health data, structured verdicts, browser E2E coverage, and a functional dark dashboard implementation. No customer logos, testimonials, adoption statistics, or third-party endorsements are available and none should be invented.

## Product Principles

- Make the decision—not the machinery—the visual protagonist.
- Show progress and uncertainty honestly so waiting never resembles failure.
- Make dissent, evidence, risk, and next actions quickly scannable.
- Keep advanced controls available without burdening the primary workflow.
- Preserve accountability through structured, auditable output.

## Accessibility & Inclusion

Support keyboard navigation, visible focus, reduced motion, sufficient contrast, semantic controls, readable responsive layouts, and clear non-color status indicators.

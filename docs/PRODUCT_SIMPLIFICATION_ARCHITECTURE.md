# Product simplification architecture

## Default experience

Synod presents one companion, one conversation, one recommendation, and one execution plan. Automatic depth is the default. Model, council, workspace, round, cost, and prompt mechanics remain available through Advanced View and Advanced Settings.

## Decision lifecycle

1. **Understand** — accept the user's natural-language goal and infer QUICK, STANDARD, or DEEP depth.
2. **Clarify** — ask one question only when missing information is material and cannot safely be inferred or deferred.
3. **Assess independently** — selected specialists form their first positions without seeing same-round conclusions.
4. **Challenge** — specialists test competing claims, assumptions, estimates, feasibility, and compliance gaps.
5. **Synthesize** — supported conclusions converge while dissent and unknowns remain visible.
6. **Plan** — produce ordered execution phases, owner involvement, acceptance criteria, resources, and stop/scale gates.
7. **Prepare handoff** — create a versioned machine-readable executor payload with `execution_authorized: false`.

## Prompt registry

`backend/core/prompt_registry.js` owns the default text and metadata for every active orchestration prompt. `prompt_registry` stores editable text, defaults, version, scope, expected schema, model guidance, and last-modified time. The REST API supports list, retrieve, edit, and reset. Advanced Settings is the editing surface.

Dynamic context—topic, stage, role, prior material, thresholds, preferences, and retrieved evidence—is rendered into registry templates at runtime. Output parsing and security validation remain code-owned.

## Execution plans

`backend/core/execution_plan.js` normalizes every verdict into a stable plan schema, calculates an operational-completeness score, creates an executor handoff, and stores immutable versions in `execution_plans`. New decisions in the same conversation create new versions and supersede the previous current version without deleting history.

Executor handoffs are preparation artifacts only. This sprint does not dispatch Hermes or authorize external execution.

## API additions

- `GET /api/v1/prompts`
- `GET /api/v1/prompts/:id`
- `PUT /api/v1/prompts/:id`
- `POST /api/v1/prompts/:id/reset`
- `GET /api/v1/sessions/:id/execution-plan`
- `GET /api/v1/sessions/:id/execution-plan.md`
- `GET /api/v1/conversations/:id/plan-versions`

## Persistence

Migration `012-product-simplification.sql` adds the prompt registry and versioned execution plans without rewriting existing sessions, conversations, council records, or verdicts.

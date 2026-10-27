# Architecture

```
packages/contracts   Shared types, event definitions, and the event reducer
apps/server          Node 22 + TypeScript (run directly, no build step)
  src/providers/     One interface for every LLM provider
  src/council/       The council pipeline (engine), prompts, ranking, and plan normalization
  src/events/        Append-only event store + in-memory projections
  src/integrations/  Search, attachments, voice, Obsidian, Hermes
  src/http/          REST commands, WebSocket push, Basic auth
apps/web             React + Vite single-page app
```

## Data flow

```
browser ──REST command──▶ CouncilEngine ──append──▶ EventStore (SQLite `events` table)
   ▲                                                    │
   └──────────── WebSocket push (every event) ◀─────────┘
```

* **Commands** (`POST /api/conversations/:id/messages`, `/clarification`, `/cancel`, …) validate input and return immediately (202). The engine runs the pipeline in the background.
* **Events** are the only record of state. Examples: `turn.started`, `turn.stage1_response` (one per member, as each finishes), `turn.stage2_review`, `turn.stage2_aggregated`, `turn.synthesis_completed`, `turn.plan_generated`, `turn.completed` / `turn.failed`.
* **Projection**: `applyEvent` in `packages/contracts/src/events.ts` folds events into a `Conversation`. The server and the browser run the *same* reducer. The browser loads a snapshot over REST, then applies pushed events. On reconnect it simply refetches.
* **Restart safety**: on boot the store replays all events. Any turn left `running` gets a `turn.failed` ("Interrupted by a server restart"). A turn waiting on a clarifying answer stays open.

## Council pipeline (`apps/server/src/council/engine.ts`)

| Step | Who | Notes |
| --- | --- | --- |
| Clarify | chairman, JSON | Returns `{needed, question}`. If needed, the turn pauses as `awaiting_clarification`. Failures skip the step instead of blocking the turn. |
| Research | Tavily / Perplexity | Optional. Results go into every member's prompt. |
| Stage 1 | all members, in parallel | A member that fails is recorded with its error. The turn fails only if *every* member fails. |
| Stage 2 | members that answered, in parallel | Answers are labelled `Response A…`. The `FINAL RANKING:` section is parsed, and real names are revealed only in the aggregate. Skipped when just one member answered. |
| Stage 3 | chairman | If the chairman fails, the top-ranked Stage 1 answer is shown instead, with a warning. |
| Plan | chairman, JSON | `normalizePlan` fills missing fields. `executionAuthorized` is always `false`. |

Every prompt is in `council/prompts.ts`. The Stage 2 and Stage 3 prompts follow Karpathy's llm-council.

Follow-up messages include the last four completed turns (each question plus a truncated council answer) as context.

## Providers (`apps/server/src/providers/`)

`Provider.complete({model, system, messages, json, purpose, signal})` returns the reply text.

* `OpenAiCompatibleProvider` covers OpenAI, DeepSeek, OpenRouter, SiliconFlow, Ollama (`/v1`) and RouteLLM.
* `AnthropicProvider`, `GeminiProvider` and `AnythingLlmProvider` each implement their own API.
* `MockProvider` gives deterministic offline output and is what the tests use.
* `ProviderRegistry.complete` adds retries for transient errors only (timeouts, 429, 5xx). Configuration errors (401, 404) fail at once.

Adding a provider means one class plus one line in `ProviderRegistry.fromConfig`, and its id in `PROVIDER_IDS`.

## Persistence

SQLite via `node:sqlite`, in one file (`data/synod.sqlite`):

* `events(seq, conversation_id, type, at, payload)`: append-only.
* `settings(key, value)`: the saved council configuration and the upload-link signing secret.
* `users` and `sessions`: accounts (scrypt password hashes) and sign-in sessions (only a SHA-256 of each token is stored).

## Accounts and privacy

* Sign-in sets an HttpOnly, SameSite=Lax session cookie (Secure over HTTPS). Sign-in attempts are rate-limited.
* Every case records its owner in `conversation.created`. The REST API returns 404 for other people's cases, `/uploads` only serves a file to the owner of its case, and the WebSocket only pushes events and drafts for cases the connected user owns.
* The first account is the administrator (the only role that can change the council). After that, sign-up needs `SYNOD_INVITE_CODE`, is closed, or is open with `SYNOD_SIGNUP=open`.
* The phone QR code carries an HMAC-signed, 12-hour token bound to one case, so a phone can add files without signing in.

Uploads go in `data/uploads/` and are served with `Content-Security-Policy: sandbox`. Voice audio is written to the OS temp directory and deleted right after transcription.

## What was removed in v2

The v1 codebase (Express + a 3,000-line vanilla JS frontend + a 1,265-line orchestrator) was replaced outright. These were dropped:

* GitHub Scout.
* Fixed persona roles: Skeptic, Doom Council and the rest. Members are now just models, and diversity comes from using different models.
* Veto, Kelly circuit breaker, budget pause, decision market, OODA and entropy checks.
* The prompt registry UI.
* The landing page and three.js visuals.
* Committed binaries (`vendor/`) and runtime data (`data/`). These are now git-ignored.

v1 data in `data/synod.sqlite` is not migrated. The v2 tables live alongside the old ones in the same file.

# Synod Technical and Deployment Manual

## Architecture

Synod is a Node.js 22+ Express application with a static browser frontend, SQLite persistence, LLM adapters, optional AnythingLLM workspace calls, optional Tavily/Perplexity search, local Obsidian-compatible Markdown memory, SSE updates, GitHub Scout, and a mobile evidence upload route.

| Layer | Location |
| --- | --- |
| Browser UI | `frontend/` |
| Express server | `backend/app.js` |
| Decision engine | `backend/core/orchestrator.js` |
| SQLite/migrations | `backend/db/sqlite.js`, `migrations/` |
| LLM/AnythingLLM/Search adapters | `backend/adapters/` |
| REST, mobile, and Scout routes | `backend/routes/` |

See [architecture blueprints](blueprints/README.md) for the canonical diagrams.

## Local deployment

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm start
```

The application listens on `PORT` (default `3000`). Startup also applies migrations in lexical order. Back up production data before an upgrade.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listener. |
| `DATABASE_URL` | `./data/synod.sqlite` | SQLite path. |
| `PROVIDER_MODE` | `mock` | Primary LLM provider. |
| `PROVIDER_REQUEST_TIMEOUT_MS` | `60000` | Per-provider timeout in milliseconds. |
| `PROVIDER_MAX_RETRIES` | `1` | Provider retry count. |
| `CORS_ORIGIN` | empty | Deliberate comma-separated cross-origin allowlist. |
| `OBSIDIAN_VAULT_PATH` | `./data/synod-brain-vault` | Local decision-memory vault. |

Provider keys and models are listed in `.env.example`: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, SiliconFlow, AnythingLLM, Tavily, and Perplexity.

Example DeepSeek configuration:

```text
PROVIDER_MODE=deepseek
DEEPSEEK_API_KEY=replace-with-a-secret
DEEPSEEK_MODEL=deepseek-v4-flash
```

Set `SYNOD_ACCESS_PASSWORD` (and optionally `SYNOD_ACCESS_USERNAME`) for any network-accessible instance. This enables Basic Auth for the UI and API, while `/api/v1/health` remains public for health checks. Always use HTTPS through a reverse proxy.

## Docker Compose

Compose launches Synod and an AnythingLLM service:

```bash
cp .env.example .env
# edit secrets in .env
docker compose up -d --build
docker compose ps
docker compose logs -f synod
```

Persist the full `data/` directory. It includes the SQLite database, SQLite WAL/SHM files when present, uploads, Obsidian vault, and AnythingLLM storage.

Use a reverse proxy that terminates TLS and supports long-lived SSE connections. Example Caddy configuration:

```caddyfile
synod.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

### Phone companion voice

Browser microphone access on a phone requires HTTPS. Set `PUBLIC_BASE_URL` to the HTTPS origin served by the reverse proxy (for example, `https://synod.example.com`). Synod uses it when generating its phone QR bridge. A raw local-network URL such as `http://192.168.x.x:3000` can display the app but cannot reliably access the phone microphone.

Synod records 16-bit microphone PCM in the browser, updates the transcript while the person speaks, and sends it to the local Whisper engine after a natural pause or an explicit stop. Audio is only retained for the active transcription request and temporary server files are removed afterwards.

## Verification

```bash
npm run check
npm test
npm run test:e2e:browser
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/settings/health
```

Use `BROWSER_E2E_PROVIDER_MODE=deepseek npm run test:e2e:browser` to exercise a configured DeepSeek path in Chrome. The default E2E path uses mocks.

## Operations

| Symptom | Check | Recovery |
| --- | --- | --- |
| App unavailable | Process/container, listener, reverse proxy. | Restart after reviewing logs. |
| Provider fallback | Settings health, mode, key, model, timeout. | Restore the primary provider or explicitly accept the warning. |
| Session appears stalled | Browser SSE/network and logs. | Refresh; polling and startup recovery handle interrupted runs. |
| Budget approval requested | Session cost panel and `GET /api/v1/sessions/:id/cost`. | Explicitly approve a new limit through the UI or `POST /api/v1/sessions/:id/budget-approval`. |
| QR upload fails | Active session, host reachability, file size. | Ensure same-network access locally and uploads under 8 MB. |
| AnythingLLM failure | URL, API key, Compose service logs. | Restore service or rely on the configured primary path. |

Compose diagnostics:

```bash
docker compose logs -f synod
docker compose logs -f anythingllm
```

## Cost controls and RouteLLM

Synod records conservative *estimated* spend per planned model call. It does not present the figure as provider-billed usage. New sessions default to the estimated cost plus the 1.5 safety multiplier; a configured user cap can never be lower than the initial estimate. If an extra call would exceed the cap, the session enters `AWAITING_BUDGET_APPROVAL` and remains intact until an explicit `POST /api/v1/sessions/:id/budget-approval` with `{ "budgetLimitUsd": 1.25 }` resumes it.

RouteLLM is optional. Run and secure RouteLLM independently with its chosen strong/weak model providers, then configure:

```text
ROUTELLM_ENABLED=true
ROUTELLM_BASE_URL=http://127.0.0.1:6060
ROUTELLM_THRESHOLD=0.55
ROUTELLM_ESTIMATED_COST_PER_1K=0.003
```

When enabled, Synod sends each council role to RouteLLM’s OpenAI-compatible endpoint with `router-mf-<threshold>`. If that service is unavailable, Synod falls back to its configured direct provider. Treat RouteLLM as a cost–quality router, not a guarantee that every response is “best in class.”

## Backups, update, rollback

Back up the complete persistent `data/` directory on a tested schedule. Use an approved SQLite-consistent backup procedure rather than copying a live database file in isolation.

Update:

```bash
git pull
npm install
npm run check
npm test
npm run migrate
# restart the process manager or docker compose service
```

Rollback by stopping the new version, restoring the prior application revision, restoring a compatible data backup if needed, restarting, then checking both health endpoints.

## Security checklist

- Protect `.env`; never commit or expose provider keys.
- Use HTTPS and `SYNOD_ACCESS_PASSWORD` outside localhost.
- Persist and back up data, uploads, and the Obsidian vault.
- Set provider-side budgets and usage alerts.
- Limit ingress and set `CORS_ORIGIN` only for intentional clients.
- Treat uploaded files and saved vault notes as user data subject to your retention policy.
- Monitor connection health and fallback warnings.

Current boundaries: SQLite is the default store; uploads live on the host; Obsidian notes are contextual rather than verified facts; mock mode is for demonstrations and testing, not factual research; Basic Auth is suitable for simple protection but enterprise deployments should add SSO, central secrets, monitoring, and audit controls.

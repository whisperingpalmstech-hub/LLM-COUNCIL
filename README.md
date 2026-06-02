# Synod

Synod is a complete, mocks-first LLM Council application. It runs out of the box on your computer, then lets you connect OpenAI, Anthropic, Gemini, Tavily/Perplexity, and AnythingLLM when you are ready.

Synod implements the LLM Council FRD v1.3 modules M1-M11, including dynamic role assignment, user-defined static councils, veto handling, compact internal communication, transcripts, mock fallbacks, and provider health checks.

This build also supports **AnythingLLM Workspace Chain** mode: a static council role can use `model_overrides: { "ROLE_TYPE": "anythingllm" }` and a `workspace_id`, causing Synod to call that workspace's `/api/v1/workspace/{slug}/chat` endpoint directly. In that mode, AnythingLLM owns the model choice inside each workspace while Synod remains the conductor for rounds, compact JSON, validation, consensus, veto, and transcripts.

```text
+--------------------------------------------------+
| Synod                                            |
| Topic -> Dynamic Council or Static Council       |
| Roles exchange compact JSON to save tokens       |
| Human transcript is rendered from structured data|
+--------------------------------------------------+
```

## Quick Start

### Windows

Double-click:

```text
start.bat
```

### Mac or Linux

```bash
chmod +x start.sh
./start.sh
```

The script will:

1. Check Node.js 22 or newer.
2. Copy `.env.example` to `.env` if needed.
3. Install dependencies.
4. Run SQLite migrations.
5. Seed a default council.
6. Open `http://localhost:3000`.

## Manual Setup

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm start
```

Open:

```text
http://localhost:3000
```

## Connect Real Services

Synod works with mocks by default. Blank API keys are safe.

### Step 1: Get API Keys

- OpenAI: create an API key in your OpenAI dashboard.
- Anthropic: create an Anthropic API key.
- Gemini: create a Google AI Studio key.
- Tavily or Perplexity: create a web search API key.
- AnythingLLM: copy your AnythingLLM base URL and API key.

### Step 2: Fill `.env`

Copy:

```bash
cp .env.example .env
```

Then edit:

```text
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
TAVILY_API_KEY=...
ANYTHINGLLM_BASE_URL=http://localhost:3001
ANYTHINGLLM_API_KEY=...
```

### Step 3: Migrate SQLite

```bash
npm run migrate
```

### Step 4: Start Synod

```bash
npm start
```

### Step 5: Test Connections

In the UI:

```text
Settings -> Test Connections
```

If a provider key is missing or a provider fails, Synod uses the mock fallback and records the fallback as a warning.

### Step 6: Bind AnythingLLM Workspaces

In the council builder, set `workspace_id` for a role. To use AnythingLLM as that role's actual model provider, also set the model override to `anythingllm`:

```json
{
  "model_overrides": {
    "DOMAIN_EXPERT": "anythingllm"
  }
}
```

Role manifest example:

```json
{
  "role_type": "DOMAIN_EXPERT",
  "display_name": "Product Workspace Agent",
  "priority": 2,
  "knowledge_source_type": "RAG",
  "workspace_id": "your-anythingllm-workspace-slug",
  "confidence_weight": 1.2
}
```

Use the workspace preview in the UI to check whether IDs are known locally. If a workspace is unavailable or AnythingLLM is not configured, Synod falls back to mock workspace-agent output and records a warning.

### AnythingLLM Workspace Chain Pattern

```text
Synod Council
  Lead Synthesist -> mock/OpenAI/Claude/Gemini or AnythingLLM
  Domain Expert   -> AnythingLLM workspace: product
  Policy Reviewer -> AnythingLLM workspace: policy
  Risk Officer    -> AnythingLLM workspace: architecture
```

Each workspace can use a different model configured inside AnythingLLM. Synod sends compact role prompts, validates the returned structured JSON, and renders the final human transcript.

## Main Features

- Dynamic sessions: enter a topic and Synod spawns roles.
- Static councils: create fixed role manifests, hierarchy, model overrides, workspace bindings, and veto roles.
- Compact internal communication: roles exchange structured JSON, reducing token use and latency.
- Human-readable transcripts: transcripts are rendered from compact JSON on demand.
- Veto and arbitration: static council veto roles can trigger an extra round.
- Mock fallbacks: works without paid services.
- Real integrations: OpenAI, Anthropic, Gemini, Tavily, AnythingLLM-ready adapters.
- AnythingLLM Workspace Chain: route each static council agent to a dedicated AnythingLLM workspace chat endpoint.
- SQLite by default: simple local database in `data/synod.sqlite`.
- Docker Compose optional: included for simple deployment.

## UI Map

```text
Dashboard
  - Start dynamic/static session
  - Live roles, compact transcript stream, verdict

Councils
  - Create static councils
  - Set veto roles, model overrides, workspace IDs
  - Import a council from the current session

Settings
  - Step-by-step connection guide
  - Provider health checks
```

## Test Suite

Run:

```bash
npm test
```

The suite covers:

- M1-M5 session orchestration and compact messages.
- M6 consensus/verdict.
- M7 audit trail.
- M8 session lifecycle.
- M9 REST/SSE API surface.
- M10 memory-ready persisted outcomes.
- M11 static council create/import/use behavior.

## Production Notes

SQLite is the default because it is easiest for non-technical users. For heavier production use:

Synod uses Node's built-in SQLite support, so no native build tools are required.

1. Keep `data/synod.sqlite` on persistent storage.
2. Schedule regular backups.
3. Put Synod behind HTTPS.
4. Store `.env` securely.
5. Use provider-side budgets and Synod session budgets.
6. Run `npm test` after every upgrade.

Optional Docker:

```bash
docker compose up
```

## Troubleshooting

### Port Already In Use

Edit `.env`:

```text
PORT=3001
```

### Provider Fails

Go to Settings -> Test Connections. If a provider fails, Synod continues with mocks and records warnings.

### AnythingLLM Workspace Not Found

Check the workspace ID in AnythingLLM and update the role manifest. Synod can still run with fallback RAG context.

## License

Internal use template. Adapt as needed for your organization.

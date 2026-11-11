# Synod

**A second opinion from a council of AI models**, for clinicians, lawyers, engineers, and anyone making a hard call. Choose a case mode (**Medical**, **Legal**, **Code**, or **General**), describe the case, and get a structured brief: verdict, confidence, red flags, mode-specific sections (differential diagnosis, legal issues, bugs & risks…), next steps, and where the models agreed and disagreed.

How the council works:

1. **Clarify** (optional): the chairman asks one question first, but only if a missing fact would materially change the answer.
2. **Stage 1, independent answers:** every council member answers on its own, in parallel.
3. **Stage 2, anonymized peer review:** each member reviews and ranks every answer, labelled "Response A", "Response B" and so on, without knowing who wrote what. Rankings are combined into an average.
4. **Stage 3, chairman synthesis:** the chairman reads all answers and reviews and writes one final answer, keeping real disagreement visible.
5. **Brief**: the chairman distills everything into the structured second opinion. Export it as Markdown; in Code mode you can also hand it to an agent (Hermes) with an explicit click.

The council pipeline follows Andrej Karpathy's [llm-council](https://github.com/karpathy/llm-council). The orchestration style follows [T3 Code](https://github.com/pingdotgg/t3code): commands go in, an append-only event log is the source of truth, and events are pushed live to the browser.

## Quick start

```bash
./start.sh            # installs, builds, opens http://localhost:3000
```

or manually:

```bash
cp .env.example .env  # add any provider keys you have
npm install
npm run build
npm start
```

With no keys, a clearly labelled **mock council** runs so you can try the whole flow. Add keys to `.env`, then choose members, models and the chairman in **Council settings**.

Development, with hot reload for both the server and the web app (open http://localhost:5173):

```bash
npm run dev
```

## Providers

OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, SiliconFlow, Ollama, RouteLLM and AnythingLLM workspaces. Any member can use any configured provider and model. For AnythingLLM, the "model" is the workspace slug. With only `OPENROUTER_API_KEY`, the default council is GPT-6.1 Terra, Claude Sonnet 5.5, Gemini 4 Argon and Grok 4.7, with Claude Sonnet 5.5 as chairman. Override it with `OPENROUTER_COUNCIL_MODELS` and `OPENROUTER_CHAIRMAN_MODEL`, or in the UI.

## Features

| Feature | How to enable |
| --- | --- |
| Clarifying question | Council settings (on by default) |
| Second-opinion brief, Markdown export | Council settings (on by default) |
| Web search shared with the council | `EXA_API_KEY`, then enable it in settings |
| File attachments | 📎 button or paste. Text-like files are shared with the council (up to 20k characters each) |
| Upload from phone | 📱 button shows a QR code with a signed link to that case (valid 12 hours). Set `PUBLIC_BASE_URL` when off-LAN |
| Voice input | `OPENROUTER_API_KEY` (cheap `google/gemini-2.5-flash-lite`, with fallbacks), or local whisper.cpp, or `OPENAI_API_KEY` |
| Debates with personas | Start a discussion. The moderator casts a persona for each model; you edit or approve the panel, then they debate. Turn off under Settings → Debates |
| Round Table and Stage views | The view switcher at the top of a discussion. Avatars speak aloud; pause, skip, change speed, or raise your hand to interject |
| Spoken voices | `OPENROUTER_API_KEY` (OpenRouter's speech endpoint). Natural or economy voices under Settings → Debates; `SPEECH_MODEL` to override |
| Debate length | Settings → Debates: rounds, speakers per round, and speech length. Rounds can also be set per message |
| Knowledge bases | Settings → Knowledge: files, web links, or AnythingLLM workspaces. Relevant passages are given to every debate and council case |
| Obsidian notes | `OBSIDIAN_VAULT_PATH`: every completed answer is written as a note |
| Hermes hand-off | `HERMES_WEBHOOK_URL`. Simulated when unset, and always needs a confirm click |
| Continue with Google | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (redirect URI `<PUBLIC_BASE_URL>/api/auth/google/callback`) |
| Onboarding | New users answer four questions (role, specialty, country, answer style); every case gets them plus today's date as context |
| Depth | Quick (3 rounds), Standard (5), Thorough (7): answer → blind review → revise → review → verdict. Stops early when reviewers agree |
| Recommended councils | Models picked per case type from public evals; users can choose their own in settings |
| Accounts | Email and password sign-in; each person's cases are private. `SYNOD_ADMIN_EMAIL` / `SYNOD_ADMIN_PASSWORD` create the admin on startup; testers join with `SYNOD_INVITE_CODE` |

## Commands

```bash
npm test           # server + contracts tests (node:test, no network)
npm run typecheck  # tsc across all packages
npm run build      # build the web app into apps/web/dist
```

Docker: `docker compose up --build`. Add `--profile anythingllm` to also run AnythingLLM.

Requires Node.js 22.18 or newer. The server runs its TypeScript directly with Node's built-in type stripping, so it has no build step.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

Company logos are from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT). The web UI borrows its design tokens and several patterns from [T3 Code](https://github.com/pingdotgg/t3code) (MIT License, © 2026 T3 Tools Inc.).

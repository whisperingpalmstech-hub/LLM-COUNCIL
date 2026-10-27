# Synod

A multi-model LLM council. You ask a question, and:

1. **Clarify** (optional): the chairman asks one question first, but only if a missing fact would materially change the answer.
2. **Stage 1, independent answers:** every council member answers on its own, in parallel.
3. **Stage 2, anonymized peer review:** each member reviews and ranks every answer, labelled "Response A", "Response B" and so on, without knowing who wrote what. Rankings are combined into an average.
4. **Stage 3, chairman synthesis:** the chairman reads all answers and reviews and writes one final answer, keeping real disagreement visible.
5. **Execution plan** (optional): the final answer becomes ordered phases with owners, acceptance criteria and stop/scale gates. You can download it as Markdown, or hand it to Hermes with an explicit click.

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

OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, SiliconFlow, Ollama, RouteLLM and AnythingLLM workspaces. Any member can use any configured provider and model. For AnythingLLM, the "model" is the workspace slug. OpenRouter alone is enough to seat models from every major lab.

## Features

| Feature | How to enable |
| --- | --- |
| Clarifying question | Council settings (on by default) |
| Execution plan, Markdown export | Council settings (on by default) |
| Web search shared with the council | `TAVILY_API_KEY` or `PERPLEXITY_API_KEY`, then enable it in settings |
| File attachments | 📎 button or paste. Text-like files are shared with the council (up to 20k characters each) |
| Upload from phone | 📱 button shows a QR code. Set `SYNOD_ACCESS_PASSWORD` first, and `PUBLIC_BASE_URL` when off-LAN |
| Voice input | Local whisper.cpp (`WHISPER_CPP_BIN`, `WHISPER_MODEL_PATH`, plus ffmpeg), or `OPENAI_API_KEY` |
| Obsidian notes | `OBSIDIAN_VAULT_PATH`: every completed answer is written as a note |
| Hermes hand-off | `HERMES_WEBHOOK_URL`. Simulated when unset, and always needs a confirm click |
| Password protection | `SYNOD_ACCESS_PASSWORD` (HTTP Basic auth, covers the WebSocket too) |

## Commands

```bash
npm test           # server + contracts tests (node:test, no network)
npm run typecheck  # tsc across all packages
npm run build      # build the web app into apps/web/dist
```

Docker: `docker compose up --build`. Add `--profile anythingllm` to also run AnythingLLM.

Requires Node.js 22.18 or newer. The server runs its TypeScript directly with Node's built-in type stripping, so it has no build step.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

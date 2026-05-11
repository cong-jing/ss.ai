# ss.ai scaffold

A minimal Node.js + TypeScript scaffold with:

- reusable core agent module in `src/agent`
- HTTP runtime launcher in `src`
- config/logging handled outside the core and injected into the agent

## Quick start

```bash
npm install
cp config.local.json.example config.local.json
npm run build
npm run prod:server
```

Runtime config is layered and merged in this order:

- `config.default.json` (shared baseline, committed)
- `config.local.json` (developer/local overrides, gitignored)

Models are configured in `config.default.json` under `models`.
Each model entry defines `provider` and `apiUrl`.
Optional `model` can map a config key (alias) to the real provider model id.
`apiUrl` is kept in `config.default.json`.
`apiKey` and current model are managed in user settings at runtime.

`logger.filePath`, `runtimeFiles.tempDir`, and `runtimeFiles.userDataDir` support relative or absolute path.
If a path is empty or missing, defaults are under project root.

Health check:

```bash
curl http://127.0.0.1:3000/health
```

Chat endpoint:

```bash
curl -X POST http://127.0.0.1:3000/v1/chat \
  -H "Content-Type: application/json" \
  -d "{\"characterId\":\"<character-id>\",\"conversationId\":\"<conversation-id>\",\"prompt\":\"hello\"}"
```

Simple web UI (provider + apiKey + model list mock):

```bash
npm run dev:server
npm run build:web
# open http://127.0.0.1:3000/web
```

Note: web page HTTP call for model list is intentionally left as TODO in `web/src/api/modelApi.ts`.

## Current TODOs

- Replace placeholder model client with real LLM API integration.
- Add tests for `AgentService` and API handlers.

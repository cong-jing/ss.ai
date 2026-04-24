# ss.ai scaffold

A minimal Node.js + TypeScript scaffold with:

- reusable core agent package in `packages/agent`
- runtime launchers (HTTP + CLI) in `src`
- config/logging handled outside the core and injected into the agent

## Quick start

```bash
npm install
cp config.local.json.example config.local.json
npm run build
npm run prod:serve
```

Runtime config is layered and merged in this order:

- `config.default.json` (shared baseline, committed)
- `config.local.json` (developer/local overrides, gitignored)

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
  -d "{\"prompt\":\"hello\"}"
```

CLI mode:

```bash
npm run prod:cli chat
```

## Current TODOs

- Replace placeholder model client with real LLM API integration.
- Add config schema validation (zod/valibot).
- Add streaming/interactive CLI mode.
- Add tests for `AgentService` and API handlers.

# ss.ai Project Map

[English](project-map.md) | [简体中文](project-map.zh-CN.md) | [日本語](project-map.ja.md)

This document is the maintainer-oriented project map for `ss.ai`.
Use it when you need a cold-start overview of the workspace, the main chat flow, runtime configuration, and the files that currently anchor behavior.

For a portfolio-style overview, live demo links, and a shorter quick start, see the repository root [README](../README.md).

## Workspace Purpose

`ss.ai` is an experimental TypeScript project for LLM-driven character chat and TRPG-style interaction. Its center is `packages/persona-flow`: it builds prompt context, renders prompt templates, selects a model for each model-call purpose, calls the LLM through an injected client, and persists the resulting chat turn through injected stores.

This repository is a personal portfolio and research project.

Its main purpose is to demonstrate experience in the following areas:

- application design with TypeScript and Node.js
- LLM API integration
- SSE-based streaming chat
- prompt template composition and management
- structured-output turn event design with provider-neutral tool-call abstractions reserved for future agent tools
- SQLite-backed persistence for conversations and character data
- character chat and TRPG-style interaction design
- LLM provider abstraction layer

At this stage, it is not intended to be used as a general-purpose OSS framework.
API stability, backward compatibility, production-grade quality, and ongoing external support are not guaranteed.

## Workspace

The repo uses a pnpm workspace declared in `pnpm-workspace.yaml`:

- `packages/*`
- `apps/*`

Common commands:

```bash
npm run setup
pnpm install
pnpm run dev:server
pnpm run dev:web
pnpm run build
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run start:server:staging
pnpm run start:server:prod
pnpm run test
pnpm run prompt:debug -- --help
```

The local default HTTP port is `8999` from `apps/server/config/config.default.json`.

## Install And Deploy

First-time setup installs and activates the pinned pnpm version:

```bash
npm run setup
```

After setup, use pnpm commands only:

```bash
pnpm install
pnpm run build:server
pnpm run build:web
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run deploy:server:staging
pnpm run deploy:server:prod
pnpm run deploy:web:staging
pnpm run deploy:web:prod
```

Deployment output roots are `.deploy-staging` and `.deploy-prod`.

Each deploy root contains:

- `server`: Node.js server package, including `config/*` and `schemas/config.schema.json`
- `web`: static assets built from `apps/web/dist`

The deployed server reads config assets from the server package root:

- `.deploy-staging/server/config/config.default.json`
- `.deploy-staging/server/config/config.staging.json`
- `.deploy-staging/server/config/config.local.json.example`
- `.deploy-staging/server/schemas/config.schema.json`
- `.deploy-prod/server/config/config.default.json`
- `.deploy-prod/server/config/config.prod.json`
- `.deploy-prod/server/config/config.local.json.example`
- `.deploy-prod/server/schemas/config.schema.json`

Lightsail deployment can also create `server/config/config.local.json` during release activation. The current workflow uses CI secret `LIGHTSAIL_DEFAULT_API_KEY` and `scripts/activate-lightsail-release.mjs` to write a machine-local override file on the target host.

Web deploy output lives under:

- `.deploy-staging/web/*`
- `.deploy-prod/web/*`

Run the deployed server with either of these commands:

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

Local development commands are meant to run from the repo root. `pnpm run dev:server`, `pnpm run dev:web`, and `pnpm run dev:qq-bot` therefore use the repo root as `process.cwd()`, so runtime files land under `./.runtime/`. In the deployed layout, `pnpm run start:server:staging`, `pnpm run start:server:prod`, or `pnpm --dir ./.deploy-prod/server start` run with `.deploy-*/server` as the working directory, so runtime files land under that server package.

Examples:

```bash
pnpm --filter @ss-ai/server start
pnpm --dir ./.deploy-prod/server start
```

If you need to override the runtime file root, set `RUNTIME_HOME`.

If dependency declarations change in any workspace package (`dependencies`, `devDependencies`, `peerDependencies`, or workspace links), run `pnpm install` again so `pnpm-lock.yaml` and the deploy dependency graph stay in sync.

## Packages

### `packages/persona-flow`

Core domain package. It should stay mostly framework-free and persistence-free.

Responsibilities:

- Defines domain store interfaces in `src/stores/**`.
- Defines `AppStores`, the aggregate dependency boundary used by apps.
- Builds prompt context from stores via `PromptContextBuilder`.
- Resolves model-call handlers via `modelCallRegistry`.
- Implements the current `chat.main/single_character_chat` prompt assembly and structured-output event flow.
- Owns chat-turn orchestration via `PersonaFlowChatTurnService`.
- Resolves model runtime and calls the injected `ModelClient` via `ModelRuntime`.
- Defines LLM client interfaces in `src/llm/modelClient.ts`, including provider-neutral tool definitions and tool choice.
- Defines the `submit_turn_events` event schema and parses turn events returned by the model. `ModelToolDefinition` is retained for future query-style tool calls but is no longer the terminal output channel for `single_character_chat`.

Layering note: `PersonaFlowChatTurnService` orchestrates turns and persistence, but it should not parse provider tool calls or structured output directly. A registered `ModelCall<TParsedOutput>` owns prompt assembly, the requested output format (`structuredOutputSchema` or `tools`), and business-level parsing for its purpose. `ModelRuntime` stays provider/model/API-key focused and returns the raw provider-neutral `llmResponse` (`output` / `structuredOutput` / `toolCalls`). The model call then converts that response into `parsedOutput`; optional `parsedToolCalls` is reserved for intermediate tool results that callers need to inspect. For `single_character_chat`, the final result is produced via `response_format: json_schema` and folded into `parsedOutput` as `{ displayText, events }`, so it is not duplicated in `parsedToolCalls`.

Main chat flow:

1. `PersonaFlowChatTurnService.chatTurn()` receives user, character, conversation, and message input.
2. `prepareChatTurnContext()` validates character and conversation, resolves the sender actor, optionally appends the user message, and builds `PromptContext`.
3. `resolveModelCall()` selects the registered handler for the requested purpose and interaction mode. Today that is `chat.main:single_character_chat`.
4. The handler assembles LLM messages and requests structured output via `structuredOutputSchema` (built from the `submit_turn_events` event schema). `ModelRuntime.chat()` resolves provider and model from `userPreferences.modelAssignments[modelCallPurpose]`, resolves the API key from `providerCredential`, then calls `ModelClient`.
5. The model call parses `llmResponse.structuredOutput` as `SubmitTurnEventsArgs` and returns a chat-specific `parsedOutput` containing normalized display text plus the ordered `TurnEvent[]`.
6. `PersonaFlowChatTurnService` consumes that parsed result without knowing the underlying output format. The complete ordered turn event list is persisted with the assistant turn.
7. Assistant turns are appended to the chat store as the conversation self actor via `appendAssistantTurn()`, which writes both the timeline message and the structured turn events.

The `single_character_chat` streaming path has migrated to structured output: `/v1/chat/stream` lets the provider stream the JSON text channel token by token under `response_format: json_schema`. `createSubmitTurnEventsPreviewParser` incrementally parses that JSON and emits `chunk` (decoded `replyText.text` characters) and `turnEventPreview` SSE events; the final `done` event still carries the canonical `turnEvents`.

Interaction modes are shared from `@ss-ai/contracts`, and the broader architecture is intended to support multiple modes over time. Today only `single_character_chat` is actually implemented for runtime use. Other modes already exist in contracts and UI as planned placeholders, but are not wired into prompt or model-call dispatch yet.

### `packages/contracts`

Shared frontend and backend contracts.

Responsibilities:

- HTTP API definitions through `ApiDefine`.
- API request and response types under `src/apis/*.api.ts`.
- `INTERACTION_MODES`, `DEFAULT_INTERACTION_MODE`, and `InteractionMode`.
- `MODEL_CALL_PURPOSES`, `ModelCallPurpose`, and model assignment types.
- `TurnEvent`, `SubmitTurnEventsArgs`, `MessageKind`, and the Zod schemas that validate model-submitted turn events.

Model-call configuration uses `MODEL_CALL_PURPOSES` / `ModelCallPurpose` plus `ModelAssignment` / `ModelAssignmentMap`.

Turn event pure types and literal constants live in `packages/contracts/src/turnEvents.ts`. Runtime Zod schemas live in `packages/contracts/src/turnEvents.schema.ts` and are exposed through the `@ss-ai/contracts/turnEvents.schema` sub-entry. This keeps the web app able to import pure contracts without pulling Zod into its main bundle. Adding a new event type should start in contracts, then flow outward through runtime schema validation, storage, prompt history assembly, and UI display.

### `packages/persona-flow-sqlite`

SQLite implementation of `AppStores`.

Responsibilities:

- Opens a `better-sqlite3` database with Drizzle.
- Defines schema in `src/db/schema.ts`.
- Implements concrete stores for characters, conversations, actors, messages, user profiles, preferences, and provider credentials.
- Creates a fully wired `AppStores` with `createSqliteStores()`.

Important tables:

- `characters`
- `conversations`
- `conversation_actors`
- `messages`
- `turn_events`
- `user_profiles`
- `user_preferences`
- `user_character_states`
- `user_provider_credentials`

`user_preferences.model_assignments_json` stores the mapping from model-call purpose to `{ provider, model }`.

`messages` is the conversation timeline and stores `kind`, `display_text`, sender actor, conversation id, and timestamp. Assistant turns with structured events are stored as `kind = "assistant_turn_events"`.

`turn_events` stores the ordered event payloads emitted by the model (historically called `submit_turn_events`, now produced as structured JSON output). Each row belongs to one assistant message and stores `seq`, `type`, JSON payload, schema version, and timestamp. `SQLiteChatStore.appendAssistantTurn()` writes the message and its turn events together; recent-message reads rehydrate assistant messages with their `turnEvents`.

### `packages/persona-flow-model-client`

Model provider integration package.

Responsibilities:

- Implements the `ModelClient` interface from `persona-flow`.
- `DefaultModelClient` dispatches by provider.
- Mistral is the current concrete provider via `MistralModelClient`.
- Supports non-structured generation, structured generation (`response_format: json_schema`) for both non-streaming and streaming, tool calls, model listing, and structured-output streaming over the text channel. Streaming structured responses accumulate raw JSON text for preview and expose the parsed final object as `ModelStreamResult.structuredOutput`.
- Converts provider-neutral `ModelToolDefinition` values to Mistral function tools in `src/mistral/mistralToolAdapter.ts` (kept for future query-style tool calls).

The provider list and API URLs come from runtime config. API keys are stored per user and provider in the credential store. SQLite currently runs them through no-op encrypt/decrypt helpers, so the stored value remains plaintext until real encryption is added.

### `packages/persona-flow-logger`

Small file logger used by server and bot runtime.

Responsibilities:

- Log levels: `verbose`, `debug`, `info`, `warn`, `error`.
- Optional source locations and stack traces.
- Global logger helpers.

## Apps

### `apps/server`

Express HTTP server.

Responsibilities:

- Loads runtime config from `apps/server/config/config.default.json`, optional `apps/server/config/config.{APP_ENV}.json`, and optional `apps/server/config/config.local.json`.
- Opens the SQLite DB under `runtimeFiles.userDataDir/app.db`.
- Creates `AppStores` through `createSqliteStores`.
- Registers HTTP routes for chat, user preferences, profiles, characters, conversations, and conversation actors.
- Creates `PersonaFlowChatTurnService` per chat request with stores, logger, prompt logger, and `DefaultModelClient`.

Important behavior:

- The app is effectively single-user right now: API code uses `DEFAULT_USER_ID = "default"` unless a request supplies `userId` in selected chat paths.
- Auth supports two modes through `config.auth.mode`: `default-user` and `local-password`.
- `default-user` skips real sign-in and treats every request as the configured default user.
- `local-password` enables a small built-in username/password plus session-cookie auth flow.
- `/v1/chat` uses `response_format: json_schema` structured output internally and returns the unified `output + turnEvents` chat contract.
- `/v1/chat/stream` keeps the SSE response shape and now streams `chunk` / `turnEventPreview` events token by token as the provider emits the structured-output JSON text channel. The final `done` event carries `turnEvents`.
- `/v1/chat/dry-run` assembles prompt messages without LLM calls or persistence.
- Prompt logs are controlled by `promptLog` config.

### `apps/web`

Vue 3 plus Vite frontend.

Responsibilities:

- Main three-panel UI: left workspace sidebar, center chat panel, right context inspector and settings.
- Uses `@ss-ai/contracts` for API types and constants.
- Lets the user configure provider API keys and model assignments.
- Sends chat requests, stream requests, dry-run requests, and message deletion requests.
- Renders assistant output from `TurnEvent[]`: `replyText` becomes text segments, `expression` and `sceneAtmosphere` become inline marker chips, and the full `turnEvents` payload remains available in the debug block.

Important UI state:

- `contextVersion` in `src/shared/state/appState.ts` triggers chat history reload when character or conversation context changes.
- Active character, conversation, and actor state lives in panel view-model modules.
- Chat can run in non-streaming or streaming UI mode. Both paths derive display from `turnEvents` when available. Streaming mode receives token-level `chunk` events from the structured-output JSON preview parser, paces text through a small render queue, applies inline `turnEventPreview` markers as they arrive, and snaps the message to canonical `displaySegments` built from the final `done.turnEvents`.

Current settings behavior:

- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts` loads and saves per-purpose `modelAssignments`.
- The API endpoint is `/v1/user-preference/model-assignment`.

### `apps/prompt-debug-cli`

CLI for prompt experiments.

Responsibilities:

- Reads YAML prompt-debug configs.
- Renders Handlebars prompt templates.
- Can run render-only mode or call the configured model.
- Can dump final assembled messages.

Example:

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --render-only
```

### `apps/qq-bot`

QQ bot integration.

Responsibilities:

- Receives QQ private and group messages.
- Resolves or creates a server conversation.
- Calls the server chat API and logs or skips replies based on server output.

It depends on the HTTP server being available and configured.

## Runtime Config

Config loading is implemented in `apps/server/src/util/config.ts`.

Load order:

1. `apps/server/config/config.default.json`
2. `apps/server/config/config.{APP_ENV}.json` if `APP_ENV` is set and the file exists
3. `apps/server/config/config.local.json` if present

The merged config is validated by `apps/server/schemas/config.schema.json`.

Config files are always read from `apps/server/config` in source mode or from `server/config` in the deployed package. Relative runtime paths such as `logger.logFilePath`, `runtimeFiles.tempDir`, `runtimeFiles.userDataDir`, and `promptLog.filePath` are resolved from the current working directory by default. Set `RUNTIME_HOME` if you need to override that.

`apps/server/config/config.local.json` is meant for machine-local overrides and is not committed. `apps/server/config/config.local.json.example` is the template to copy when you need local development overrides.

In the current Lightsail deploy flow, `config.local.json` does not need to exist in the release archive ahead of time. It can be created on the server during release activation and used as the highest-precedence runtime override.

Committed environment overlays currently live in `apps/server/config/config.staging.json` and `apps/server/config/config.prod.json`.

`apps/qq-bot` defaults to loading its bot environment from `apps/qq-bot/.env`. When started through `pnpm run dev:qq-bot` from the repo root, its runtime output also lands under the repo root `.runtime/`.

Important sections:

- `http`: host and port.
- `logger`: file path, level, source and stack options.
- `runtimeFiles`: temp and user data directories.
- `agent`: timeout and retry settings for model clients.
- `promptLog`: prompt logging enablement and path.
- `models`: provider config, API URL, optional default API key, default model, and optional static `availableModels`.
- `defaultModelAssignments`: per-`ModelCallPurpose` fallback provider and model mapping.
- `auth`: auth mode, default user id, registration flag, session lifetime, and cookie settings.

The default config currently defines provider key `mistral.ai` with the Mistral API URL and a static model list.

## Data And Actor Model

Conversations are not simple user and assistant transcripts. They have explicit actors:

- `self`: the AI character replying in the conversation.
- `other`: logged-in user or local actors.
- `system`: reserved system actor role.

Messages store `senderActorId`, `conversationId`, `kind`, `displayText`, optional `turnEvents`, and timestamp. Prompt rendering maps actors to LLM roles:

- `self` -> `assistant`
- `system` -> `system`
- everything else -> `user`

There is a shared speaker-tag helper in `packages/persona-flow/src/prompt/speakerTag.ts`, intended for richer interaction modes. The current `single_character_chat` prompt path does not prepend speaker tags to outgoing LLM messages. Assistant history that has `turnEvents` contributes only its `replyText` events to prompt history. Other event types, such as expression or scene atmosphere, are persisted for future prompt/state use but are not yet injected into prompt history. Assistant-style name prefixes are still stripped during output normalization to avoid repeated labels in replies.

## Model Assignment

Model assignment is purpose-based. Shared identifiers live in `packages/contracts/src/modelCallPurpose.ts`.

Current purposes:

- `chat.main`
- `memory.summarize`

The chat path currently calls the model with `modelCallPurpose: "chat.main"`.

Resolution order is user-first with config fallback:

1. user model assignment
2. `defaultModelAssignments[modelCallPurpose]`
3. error

API key resolution is also user-first:

1. user provider credential
2. `models[provider].apiKey`
3. error

For a call to work, the current user must have:

1. a model assignment in user preferences for the requested purpose, or a matching `defaultModelAssignments` entry
2. a provider credential for that assignment's provider, or a default API key in runtime config
3. runtime config for that provider

## Key Files

Start here when reviewing or changing behavior:

- `packages/contracts/src/modelCallPurpose.ts`
- `packages/contracts/src/interactionMode.ts`
- `packages/contracts/src/turnEvents.ts`
- `packages/contracts/src/turnEvents.schema.ts`
- `packages/contracts/src/apis/*.api.ts`
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
- `packages/persona-flow/src/chatTurn/chatTurnPreparation.ts`
- `packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts`
- `packages/persona-flow/src/chatTurn/events/turnEventText.ts`
- `packages/persona-flow/src/llm/tools/modelTool.ts`
- `packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts`
- `packages/persona-flow/src/modelCall/modelRuntime.ts`
- `packages/persona-flow/src/modelCall/modelCallRegistry.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/promptViewModel.ts`
- `packages/persona-flow/src/stores/appStores.ts`
- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts`
- `packages/persona-flow-sqlite/src/db/CharacterDbRouter.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`
- `packages/persona-flow-model-client/src/defaultModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts`
- `apps/server/src/http/apis/chat/*.ts`
- `apps/server/src/http/apis/userPreference.route.ts`
- `apps/web/src/panels/chat/useChatViewModel.ts`
- `apps/web/src/panels/chat/turnEventDisplay.ts`
- `apps/web/src/panels/chat/chatTypes.ts`
- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts`

## Current Maintenance Notes

- The `AI_FUNCTIONS` / `AiFunction` to `MODEL_CALL_PURPOSES` / `ModelCallPurpose` rename is complete in the contracts, web, server, and store layers.
- The SQLite model assignment column is `model_assignments_json`; old model-assignment storage compatibility has been removed.
- The single-character chat model output path now uses `response_format: json_schema` structured output (event schema still sourced from `submitTurnEventsTool.argsSchema`). The tool-call path is no longer the terminal output channel, but the `ModelToolDefinition` abstraction is kept for future intermediate query-style tools.
- Chat-turn/model-call layering is intentionally split: chat services consume model-call `parsedOutput`, while each model call owns provider response parsing (structured output or tool arguments) for its purpose. This keeps future interaction modes free to use different output formats without changing chat-turn persistence code.
- `messages` is now a timeline/display table with `kind` and `display_text`; structured assistant facts are stored in `turn_events`.
- Prompt history currently reuses only `replyText` events from assistant turns. TODO: include selected latest non-text state, such as expression or scene atmosphere, once prompt format and UI needs are settled.
- API key encryption hooks exist in the SQLite credential store, but currently return the input unchanged.
- Low-priority TODO: replace the current no-op API key encryption and decryption with a real at-rest protection scheme once deployment and key-management expectations are settled.
- `single_character_chat` streaming now flows token by token from the provider's structured-output JSON text channel; SSE `chunk` events are produced by an incremental JSON preview parser that extracts `replyText.text` as it appears.
- The web chat UI renders canonical `TurnEvent[]` into `displaySegments`; streamed text and inline marker previews are speculative until the final `done.turnEvents` replaces them.
- Interaction modes other than `single_character_chat` are declared but not registered in runtime model-call dispatch yet.
- Speaker-tag helpers and richer multi-actor prompt shaping are reserved for later interaction modes; the current `single_character_chat` path intentionally stays simpler.
- TODO: i18n access currently relies on shared module-level helpers in web components; migrate to a `useI18n`-style hook or provider when SSR, per-app instances, or stricter test isolation become requirements.

## Quick Smoke Paths

Useful checks:

```bash
pnpm run build
pnpm run test
pnpm run dev:server
pnpm run dev:web
```

HTTP health check:

```bash
curl http://127.0.0.1:8999/health
```

Dry-run prompt assembly before debugging model behavior:

```bash
curl -X POST http://127.0.0.1:8999/v1/chat/dry-run \
  -H "Content-Type: application/json" \
  -d '{"characterId":"<character-id>","conversationId":"<conversation-id>","userMessageText":"hello"}'
```

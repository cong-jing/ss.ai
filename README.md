# ss.ai

`ss.ai` is a TypeScript monorepo for roleplay/persona chat. The center of the project is `packages/persona-flow`: it assembles prompt context, renders prompt templates, chooses a model for a specific model-call purpose, calls the LLM through an injected client, then persists the resulting chat turn through injected stores.

This README is meant as a project map for future maintenance sessions. If you are opening the repo cold, read this first, then inspect the files listed in "Key Files".

## Workspace

The repo uses a pnpm workspace, declared in `pnpm-workspace.yaml`:

- `packages/*`
- `apps/*`

Useful root scripts:

```bash
npm run setup
pnpm install
pnpm run dev:server
pnpm run dev:web
pnpm run dev:all
pnpm run build
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run deploy:server:staging
pnpm run deploy:server:prod
pnpm run deploy:web:staging
pnpm run deploy:web:prod
pnpm run start:server:staging
pnpm run start:server:prod
pnpm run test
pnpm run prompt:debug -- --help
```

Current local default HTTP port is `8999` from `apps/server/config/config.default.json`.

## Install And Deploy

First-time setup (installs and activates the pinned pnpm version):

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

Deployment output root is `.deploy-staging` or `.deploy-prod`.

Fixed subdirectories under each deploy root:

- `server`: Node.js server package, including `config/*` and `schemas/config.schema.json`
- `web`: static web assets built from `apps/web/dist`

The deployed server reads config assets from the server package root:

- `.deploy-staging/server/config/config.default.json`
- `.deploy-staging/server/config/config.staging.json`
- `.deploy-staging/server/config/config.local.json.example`
- `.deploy-staging/server/schemas/config.schema.json`
- `.deploy-prod/server/config/config.default.json`
- `.deploy-prod/server/config/config.prod.json`
- `.deploy-prod/server/config/config.local.json.example`
- `.deploy-prod/server/schemas/config.schema.json`

Web deploy output:

- `.deploy-staging/web/*`
- `.deploy-prod/web/*`

Run the deployed server:

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

Manual startup still works:

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

`APP_HOME` defaults to the current working directory. In local development that means `apps/server` when you run `pnpm run dev:server`. In the deployed layout that means `.deploy-staging/server` or `.deploy-prod/server`, so starting from those directories works without setting `APP_HOME`. If you start the server from a different directory, set `APP_HOME` explicitly so relative runtime paths and config files resolve from the intended runtime root.

Examples:

```bash
pnpm --filter @ss-ai/server start
pnpm --dir ./.deploy-prod/server start
```

For manual environment variable setup, use the syntax of your shell. The built-in `pnpm run start:server:staging` and `pnpm run start:server:prod` scripts are the cross-platform option.

If dependency declarations change in any workspace package (`dependencies`, `devDependencies`, `peerDependencies`, or workspace links), run `pnpm install` again so `pnpm-lock.yaml` and the deploy dependency graph stay in sync.

## Packages

### `packages/persona-flow`

Core domain package. It should stay mostly framework-free and persistence-free.

Responsibilities:

- Defines domain store interfaces in `src/stores/**`.
- Defines `AppStores`, the aggregate dependency boundary used by apps.
- Builds prompt context from stores via `PromptContextBuilder`.
- Renders prompts via `promptRenderer`.
- Owns chat-turn orchestration via `PersonaFlowChatTurnService`.
- Resolves model runtime and calls the injected `ModelClient` via `ModelCallExecutor`.
- Defines LLM client interfaces in `src/llm/modelClient.ts`.
- Exports structured roleplay output shape in `src/structuredOutput/commonRoleplayTurnOutput.ts`.

Main chat flow:

1. `PersonaFlowChatTurnService.chatTurn()` receives user/character/conversation/message input.
2. `prepareChatTurnContext()` validates character and conversation, resolves the sender actor, optionally appends the user message, builds `PromptContext`, then renders LLM messages.
3. `ModelCallExecutor.chat()` resolves provider/model from `userPreferences.modelAssignments[modelCallPurpose]`, resolves API key from `providerCredential`, then calls `ModelClient`.
4. Structured replies are normalized. `skip` or empty structured output avoids appending an assistant message.
5. Non-skipped replies are appended to the chat store as the conversation self actor.

Streaming flow is similar but currently supports only `llmResponseMode = "non-structured"`.

Interaction modes are shared from `@ss-ai/contracts`. Only `single_character_chat` is currently implemented by `promptRenderer`; other modes exist as contract/template placeholders and fall back to single-character rendering.

### `packages/contracts`

Shared frontend/backend contracts.

Responsibilities:

- HTTP API definitions through `ApiDefine`.
- API request/response types under `src/apis/*.api.ts`.
- `INTERACTION_MODES`, `DEFAULT_INTERACTION_MODE`, and `InteractionMode`.
- `MODEL_CALL_PURPOSES`, `ModelCallPurpose`, and model assignment types.

Important note: model-call configuration uses `MODEL_CALL_PURPOSES` / `ModelCallPurpose` plus `ModelAssignment` / `ModelAssignmentMap`.

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
- `user_profiles`
- `user_preferences`
- `user_character_states`
- `user_provider_credentials`

`user_preferences.model_assignments_json` stores the mapping from model-call purpose to `{ provider, model }`.

### `packages/persona-flow-model-client`

Model provider integration package.

Responsibilities:

- Implements the `ModelClient` interface from `persona-flow`.
- `DefaultModelClient` dispatches by provider.
- Mistral is the current concrete provider via `MistralModelClient`.
- Supports non-structured generation, non-structured streaming, structured generation, and model listing.

The provider list and API URLs come from runtime config. API keys are stored per user/provider in the credential store. SQLite currently runs them through no-op encrypt/decrypt helpers, so the stored value is still plaintext until real encryption is added.

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
- Opens SQLite DB under `runtimeFiles.userDataDir/app.db`.
- Creates `AppStores` through `createSqliteStores`.
- Registers HTTP routes for chat, user preferences, profiles, characters, conversations, and conversation actors.
- Creates `PersonaFlowChatTurnService` per chat request with stores, logger, prompt logger, and `DefaultModelClient`.

Important behavior:

- The app is effectively single-user right now: API code uses `DEFAULT_USER_ID = "default"` unless a request supplies `userId` in selected chat paths.
- `/v1/chat` defaults to structured output.
- `/v1/chat/stream` defaults to non-structured SSE output and rejects structured mode.
- `/v1/chat/dry-run` assembles prompt messages without LLM calls or persistence.
- Prompt logs are controlled by `promptLog` config.

### `apps/web`

Vue 3 + Vite frontend.

Responsibilities:

- Main three-panel UI: left workspace sidebar, center chat panel, right context inspector/settings.
- Uses `@ss-ai/contracts` for API types and constants.
- Lets user configure provider API keys and model assignments.
- Sends chat requests, stream requests, dry-run requests, and message deletion requests.

Important UI state:

- `contextVersion` in `src/shared/state/appState.ts` triggers chat history reload when character/conversation context changes.
- Active character/conversation/actor state lives in panel view-model modules.
- Chat can run structured non-streaming mode or non-structured streaming mode.

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

- Receives QQ private/group messages.
- Resolves or creates a server conversation.
- Calls server chat API and logs/skips replies based on server output.

It depends on the HTTP server being available and configured.

## Runtime Config

Config loading is implemented in `apps/server/src/util/config.ts`.

Load order:

1. `apps/server/config/config.default.json`
2. `apps/server/config/config.{APP_ENV}.json` if `APP_ENV` is set and the file exists
3. `apps/server/config/config.local.json` if present

The merged config is validated by `apps/server/schemas/config.schema.json`.

Config files are resolved relative to the `apps/server` package (or the deployed server package root). `APP_HOME` only decides how relative runtime paths such as `logger.logFilePath`, `runtimeFiles.tempDir`, `runtimeFiles.userDataDir`, and `promptLog.filePath` are expanded. If `APP_HOME` is omitted, the server uses `process.cwd()` as the runtime root.

`apps/server/config/config.local.json` is intended for machine-local overrides and is not committed. `apps/server/config/config.local.json.example` is the template to copy when you need local development overrides.

Committed environment overlays currently live in `apps/server/config/config.staging.json` and `apps/server/config/config.prod.json`.

`apps/qq-bot` defaults to loading its bot environment from `apps/qq-bot/.env`.

Important sections:

- `http`: host and port.
- `logger`: file path, level, source/stack options.
- `runtimeFiles`: temp and user data directories.
- `agent`: timeout and retry settings for model clients.
- `promptLog`: prompt logging enablement/path.
- `models`: provider config, API URL, default model, and optional static `availableModels`.

The default config currently defines provider key `mistral.ai` with Mistral API URL and a static model list.

## Data And Actor Model

Conversations are not just user/assistant transcripts. They have explicit actors:

- `self`: the AI character replying in the conversation.
- `other`: logged-in user or local actors.
- `system`: reserved system actor role.

Messages store only `senderActorId`, `conversationId`, content, and timestamp. Prompt rendering maps actors to LLM roles:

- `self` -> `assistant`
- `system` -> `system`
- everything else -> `user`

Speaker tags such as `p1[Name]` are generated for actors and prepended to rendered message content. Assistant prefixes are stripped during prompt rendering and output normalization to avoid repeated labels.

## Model Assignment

Model assignment is purpose-based. Shared identifiers live in `packages/contracts/src/modelCallPurpose.ts`.

Current purposes:

- `chat.main`
- `memory.summarize`

The chat path currently calls the model with `modelCallPurpose: "chat.main"`.

For a call to work, the current user must have:

1. a model assignment in user preferences for the requested purpose
2. a provider credential for that assignment's provider
3. runtime config for that provider

## Key Files

Start here when reviewing or changing behavior:

- `packages/contracts/src/modelCallPurpose.ts`
- `packages/contracts/src/interactionMode.ts`
- `packages/contracts/src/apis/*.api.ts`
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
- `packages/persona-flow/src/chatTurn/chatTurnPreparation.ts`
- `packages/persona-flow/src/chatTurn/modelCallExecutor.ts`
- `packages/persona-flow/src/prompt/promptRenderer.ts`
- `packages/persona-flow/src/prompt/modes/singleCharacterChat/renderPrompt.ts`
- `packages/persona-flow/src/prompt/modes/singleCharacterChat/buildPromptViewModel.ts`
- `packages/persona-flow/src/stores/appStores.ts`
- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`
- `packages/persona-flow-model-client/src/defaultModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`
- `apps/server/src/http/apis/chat/*.ts`
- `apps/server/src/http/apis/userPreference.route.ts`
- `apps/web/src/panels/chat/useChatViewModel.ts`
- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts`

## Current Maintenance Notes

- The `AI_FUNCTIONS` / `AiFunction` to `MODEL_CALL_PURPOSES` / `ModelCallPurpose` rename is complete in the contracts/web/server/store layers.
- The SQLite model assignment column is `model_assignments_json`; old model-assignment storage compatibility has been removed.
- API key encryption hooks exist in the SQLite credential store, but currently return the input unchanged.
- Tool calls are detected/logged as TODO and not executed.
- Interaction modes other than `single_character_chat` are declared but not implemented in renderer dispatch yet.
- The server opens SQLite even when test overrides provide stores; this may matter for test/runtime isolation.
- TODO: i18n access currently relies on shared module-level helpers in web components; migrate to a `useI18n`-style hook/provider when SSR, per-app instances, or stricter test isolation become requirements.

## Quick Smoke Paths

After the current rename refactor is complete, these are the useful checks:

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

Dry-run prompt assembly is useful before debugging model behavior:

```bash
curl -X POST http://127.0.0.1:8999/v1/chat/dry-run \
  -H "Content-Type: application/json" \
  -d '{"characterId":"<character-id>","conversationId":"<conversation-id>","userMessageText":"hello","llmResponseMode":"structured"}'
```

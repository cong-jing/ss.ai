# Persona Flow Model Client Migration Checklist

## Goal

Extract provider-specific `ModelClient` implementations from `apps/server` into a reusable package, so:

1. `@ss-ai/persona-flow` remains interface + orchestration owner.
2. provider adapters become reusable by `apps/server`, `apps/prompt-debug-cli`, and future tools.
3. internal implementation can later switch to unified multi-provider SDKs without changing app wiring.

## Package Name Recommendation

Recommended package name:

- `@ss-ai/persona-flow-model-client`

Reason:

1. scope is explicit: implementations of persona-flow `ModelClient`.
2. avoids confusion with `persona-flow` core package.
3. leaves room for future packages:
   - `@ss-ai/persona-flow-model-client-openai`
   - `@ss-ai/persona-flow-model-client-anthropic`

Alternative (shorter):

- `@ss-ai/persona-flow-client`

## What Moves

From `apps/server/src/modelClients/**` to new package:

1. `clientFactory.ts`
2. `mistral/mistralModelClient.ts`
3. `mistral/messageTransforms.ts`
4. `mistral/structuredOutputSchema.ts`
5. `mistral/timeout.ts`

## Target Package Structure

`packages/persona-flow-model-client/`

1. `src/index.ts`
2. `src/clientFactory.ts`
3. `src/mistral/mistralModelClient.ts`
4. `src/mistral/messageTransforms.ts`
5. `src/mistral/structuredOutputSchema.ts`
6. `src/mistral/timeout.ts`
7. `package.json`
8. `tsconfig.json`

## Dependency Direction

1. New package depends on `@ss-ai/persona-flow` (for `ModelClient` interface and related types).
2. `apps/server` depends on new package and removes local `modelClients` implementation usage.
3. `apps/prompt-debug-cli` should also depend on new package and call its client instead of direct SDK call.

## Migration Steps

### Phase 1: Scaffold Package

1. Create `packages/persona-flow-model-client` with ESM + TypeScript config.
2. Add exports from `src/index.ts`.
3. Add dependency on `@ss-ai/persona-flow`, `@mistralai/mistralai`, `zod`.

### Phase 2: Move Existing Code (No Behavior Change)

1. Copy files from `apps/server/src/modelClients/**`.
2. Update import paths to package-local layout.
3. Keep API surface equivalent (`createModelClientFromConfig`).

### Phase 3: Switch Server Wiring

1. Replace imports in server code from local `apps/server/src/modelClients/*` to `@ss-ai/persona-flow-model-client`.
2. Delete old `apps/server/src/modelClients` folder after compile passes.
3. Run server tests.

### Phase 4: Switch Prompt Debug CLI

1. Replace direct `Mistral` SDK calls in CLI with new package client factory + `ModelClient` methods.
2. Keep CLI rendering and report formatting logic local.
3. Run CLI smoke tests.

### Phase 5: Cleanup and Validate

1. Run workspace tests.
2. Run typechecks for:
   - `packages/persona-flow`
   - `packages/persona-flow-model-client`
   - `apps/server`
   - `apps/prompt-debug-cli`
3. Verify no remaining imports from old server `modelClients` path.

## About `--dump-messages`

Recommendation: implement `--dump-messages` in `apps/prompt-debug-cli`, not inside model-client package.

Reason:

1. `--dump-messages` is a CLI/reporting concern.
2. model-client package should focus on provider transport + response normalization.
3. message assembly context (prompt + history) belongs to caller layer.

Optional compromise:

- model-client package can export small debug helpers (e.g. usage/toolCall formatters), but not CLI flags.

## Acceptance Criteria

1. `apps/server` and `apps/prompt-debug-cli` both use `@ss-ai/persona-flow-model-client`.
2. No functional behavior regressions in current Mistral path.
3. `ModelClient` interface remains implemented exactly.
4. `--dump-messages` writes assembled messages JSON to report/log in CLI.
5. All relevant tests pass.

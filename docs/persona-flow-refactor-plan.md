# Persona Flow Refactor Plan

## Goals

1. Move model-selection and generation orchestration from server `AgentService` into `@ss-ai/persona-flow`.
2. Keep server routes as adapters: validate HTTP input, compose prompt context, call persona-flow service.
3. Let persona-flow define model-client contracts, tool-call handling hooks, and generation/log result shape.
4. Keep current behavior stable for `chat` and `chatStream`, with TODO placeholders for tool execution and summarize flow.

## Current Pain Points

1. Responsibility inversion: server owns model-client contract and orchestration.
2. Route/service coupling: provider/model selection is embedded in server chat shared helpers.
3. Extensibility risk: future multi-provider SDK integration cannot evolve independently.
4. Test focus mismatch: most tests are HTTP integration tests, not orchestration-level unit tests.

## Target Architecture

### persona-flow owns

1. LLM contracts (`ModelClient`, stream callbacks/results, usage/tool-call metadata).
2. Function-level model selection by user preference (`chat`, `summarize`).
3. Runtime orchestration for:
   1. non-stream generation
   2. structured generation
   3. streaming generation
4. Unified prompt-log payload shape.

### server owns

1. HTTP route handling and status code mapping.
2. Store implementations and injection.
3. Provider SDK implementations and client factory wiring.
4. Runtime config (provider endpoint mappings, timeout settings).

## Implementation Phases

### Phase 1 (this iteration)

1. Add persona-flow model interfaces and orchestration service (function-scoped model resolution + chat/chatStream APIs).
2. Export new persona-flow service/contracts from package root.
3. Update server chat service factory to create persona-flow orchestration service instead of server `AgentService`.
4. Keep route-level prompt assembly unchanged for now.
5. Keep behavior parity and run server tests.

### Phase 2

1. Move prompt-turn orchestration (currently in server chat services) into persona-flow service.
2. Server routes call persona-flow `chatTurn`/`chatStreamTurn` directly.
3. Introduce summarize orchestration entry (can return TODO/unimplemented result initially).

### Phase 3

1. Deprecate/remove server `AgentService` and duplicated model types.
2. Optionally extract provider SDK client implementations into separate package.
3. Add tool runtime contract and structured tool-result wiring.

## Testing Strategy

### A. persona-flow unit tests (new)

1. Selects function model from preferences for `chat`.
2. Selects function model from preferences for `summarize`.
3. Throws expected errors on:
   1. missing function model
   2. unknown provider
   3. missing provider credential
4. Structured mode returns normalized structured output + metadata.
5. Stream mode:
   1. emits text deltas
   2. captures tool-calls
   3. captures usage
   4. marks completion state
6. Stream failure still writes failed prompt log payload.

### B. server integration tests (existing + delta)

1. Existing `chat` validation tests stay green.
2. Add one test proving server route path uses injected persona-flow service and still returns expected output schema.
3. Add one stream test for non-completed stream (if mockable in current harness).

### C. logging contract tests

1. Non-stream and stream produce the same top-level prompt-log JSON keys.
2. `usage` and `toolCalls` are always present as fields (value may be empty/undefined).
3. Failed execution has `status=failed` and `error` field populated.

## Risks and Mitigations

1. Risk: Behavior drift in route error timing (setup-time vs generation-time errors).
   1. Mitigation: keep `ensureFunctionReady("chat")` pre-check in server factory.
2. Risk: Type duplication during migration.
   1. Mitigation: keep server types temporarily but make chat route use persona-flow service directly.
3. Risk: Stream lifecycle logging regression.
   1. Mitigation: use `finally` in orchestration service for prompt-log writes.

## Done Criteria for Phase 1

1. New persona-flow orchestration service compiles and is exported.
2. Server chat factory instantiates persona-flow orchestration service.
3. `npm run test --workspace=apps/server` passes.
4. No behavior regression in current chat route tests.

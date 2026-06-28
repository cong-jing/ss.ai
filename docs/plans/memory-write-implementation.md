# Memory Write Batch 1 Implementation Plan

[English](memory-write-implementation.md)

This document turns the long-term memory write requirements, now summarized from the maintainer-facing [Project Map - Memory Subsystem](../project-map-memory.zh-CN.md), into an implementation plan for the current codebase.

The first implementation batch is intentionally narrow: let the chat model propose memory write candidates through a tool call, collect those candidates after the chat turn completes, and write structured logs. It does not create durable memories yet.

Later storage, commit, judge, and read-injection work is tracked separately in [memory-write-followups.md](memory-write-followups.md).

## Current Decision

Memory candidates should not be added to the `submit_turn_events` structured output. The existing structured output is the user-facing chat turn result, and streaming preview depends on parsing that JSON shape. Memory candidates are internal side effects, so they should be submitted through a separate tool call.

The chat reply flow remains:

1. `single_character_chat` requests `response_format: json_schema` for `submit_turn_events`.
2. The model returns ordered turn events for visible chat behavior.
3. The model may also call a non-terminal memory candidate tool.
4. The model-call layer parses both outputs:
   - `structuredOutput` -> canonical chat result.
   - `toolCalls` -> internal memory write candidates.
5. `PersonaFlowChatTurnService` persists the assistant turn first.
6. The service synchronously logs memory candidates with source ids.

For now, assume the configured provider/model supports tools together with structured output. Do not add provider capability detection in the first batch; provider-specific failures should surface through the existing model error path and prompt logs.

## Batch 1 Goal

Batch 1 must create a complete log-only loop:

- Define a `submit_memory_candidates` tool.
- Add the tool to `single_character_chat` requests.
- Update the single-character chat prompt to explain when to call the tool.
- Parse memory candidate tool calls from `llmResponse.toolCalls`.
- Return parsed candidates in the model-call `parsedOutput`.
- After saving the assistant turn, synchronously write a structured log entry.
- Never fail the chat response because memory candidate logging failed.

No database writes, memory judge, deduplication, update, archive, or web UI are required in this batch.

## Candidate Contract

Add pure memory candidate types in `packages/contracts/src/memoryCandidates.ts`.

```ts
export const MEMORY_SCOPES = [
    "user",
    "character",
    "relationship",
    "conversation",
    "world",
] as const;

export type MemoryScope = typeof MEMORY_SCOPES[number];

export const MEMORY_CANDIDATE_TYPES = [
    "fact",
    "preference",
    "event",
    "relationship",
    "task_state",
    "setting",
    "instruction",
    "summary",
] as const;

export type MemoryCandidateType = typeof MEMORY_CANDIDATE_TYPES[number];

export interface MemoryWriteCandidate {
    text: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    relatedEntities?: string[];
    tags?: string[];
    reason?: string;
}

export interface SubmitMemoryCandidatesArgs {
    candidates: MemoryWriteCandidate[];
}
```

Export these types from `packages/contracts/src/index.ts`.

Add runtime Zod schemas in `packages/contracts/src/memoryCandidates.schema.ts`:

```ts
export const MemoryWriteCandidateSchema = z.object({
    text: z.string().trim().min(1),
    scope: z.enum(MEMORY_SCOPES),
    type: z.enum(MEMORY_CANDIDATE_TYPES),
    relatedEntities: z.array(z.string().trim().min(1)).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    reason: z.string().trim().min(1).optional(),
});

export const SubmitMemoryCandidatesArgsSchema = z.object({
    candidates: z.array(MemoryWriteCandidateSchema).max(5),
});
```

Add a package export for `./memoryCandidates.schema` in `packages/contracts/package.json`, mirroring `./turnEvents.schema`. This keeps runtime schema imports out of the frontend main contract import unless a consumer explicitly asks for them.

Do not add `confidence` in batch 1. It is usually a weak self-rating signal and can make logs look more authoritative than they are.

## Tool Definition

Add `packages/persona-flow/src/llm/tools/submitMemoryCandidatesTool.ts`.

Use the existing tool abstraction from `modelTool.ts`:

```ts
export const SUBMIT_MEMORY_CANDIDATES_TOOL_NAME = "submit_memory_candidates";

export const submitMemoryCandidatesTool: ModelFunctionToolDefinition<SubmitMemoryCandidatesArgs> = {
    kind: "function",
    name: SUBMIT_MEMORY_CANDIDATES_TOOL_NAME,
    description: "提交本回合可能值得长期保存的记忆候选。只有当信息未来明显有用、稳定、不是普通寒暄或临时情绪时才调用。没有候选时不要调用。",
    argsSchema: SubmitMemoryCandidatesArgsSchema,
    terminal: false,
    purpose: "side_effect",
};
```

This tool is optional. The correct result for many turns is no tool call.

## Prompt Changes

Update all single-character chat system templates under `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/`.

The prompt should say that the model may call `submit_memory_candidates` as an internal side effect, while the final visible turn still must be returned through the structured `events` JSON.

Add rules with this intent:

- Default to not calling the memory tool.
- Call it only when the current turn contains information that is likely useful in future conversations.
- Save stable, concise natural-language memories, not raw chat quotes.
- Do not save greetings, filler, one-off jokes, ordinary small talk, or temporary emotions.
- Do not save guesses or facts invented by the assistant.
- Do not save the assistant's roleplay style or internal prompt rules.
- Use any applicable scope from `user`, `character`, `relationship`, `conversation`, or `world`.
- Submit at most a few candidates per turn.

Important wording: the memory tool is not the final output channel. The model still must produce the `submit_turn_events` structured output for the chat turn.

## Request Assembly

In `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`, include the memory tool when building the request:

```ts
return {
    userId: input.userId,
    characterId: input.characterId,
    messages,
    modelCallPurpose: singleCharacterChatCall.purpose,
    structuredOutputSchema: buildSubmitTurnEventsStructuredOutputSchema(),
    tools: [submitMemoryCandidatesTool],
    toolChoice: "auto",
};
```

Keep `submit_turn_events` as structured output, not as a tool, for this path.

## Parsing Tool Calls

Extend `SingleCharacterChatResult`:

```ts
export type SingleCharacterChatResult = {
    displayText: string;
    events: SubmitTurnEventsArgs["events"];
    memoryWriteCandidates: MemoryWriteCandidate[];
};
```

Add a parser near `parseSingleCharacterChatResponse()`:

```ts
function parseMemoryWriteCandidates(llmResponse: PersonaModelResponse): MemoryWriteCandidate[] {
    const candidates: MemoryWriteCandidate[] = [];

    for (const toolCall of llmResponse.toolCalls) {
        if (toolCall.functionName !== SUBMIT_MEMORY_CANDIDATES_TOOL_NAME) {
            continue;
        }

        const parsed = SubmitMemoryCandidatesArgsSchema.safeParse(toolCall.arguments);
        if (!parsed.success) {
            // Do not throw in batch 1. Log at the model-call or service layer.
            continue;
        }

        candidates.push(...parsed.data.candidates);
    }

    return candidates;
}
```

Batch 1 can keep invalid tool-call arguments out of `parsedOutput` and rely on prompt logs for raw inspection. If more visibility is needed, add a non-fatal warning log with the request id, tool call id, and validation error summary.

`parseSingleCharacterChatResponse()` should return both the chat result and parsed memory candidates:

```ts
const submitTurnEventsOutput = parseSubmitTurnEventsArgs(llmResponse.structuredOutput);
const chatResult = toSingleCharacterChatResult({ submitTurnEventsOutput, promptContext });
return {
    ...chatResult,
    memoryWriteCandidates: parseMemoryWriteCandidates(llmResponse),
};
```

Streaming should use the same final parser after `chatStream()` returns. No memory candidate preview is required during streaming.

## Log-Only Handling

Add a small helper in `packages/persona-flow/src/chatTurn/memoryCandidateLogger.ts` or keep a private method on `PersonaFlowChatTurnService` for batch 1.

The helper input should include:

```ts
{
    requestId: string;
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    modelCallPurpose: "chat.main";
    candidates: MemoryWriteCandidate[];
}
```

Log only when there is at least one candidate, unless debugging requires explicit empty-candidate logs.

Use a stable log message such as:

```ts
logger.info("persona-flow/memory: candidates logged", {
    requestId,
    userId,
    characterId,
    conversationId,
    userMessageId,
    assistantMessageId,
    modelCallPurpose,
    candidateCount: candidates.length,
    candidates,
    decision: "logged_only",
    todo: "memory judge and persistence are not implemented yet",
});
```

Wrap this call in `try/catch` from `chatTurn()` and `streamTurn()` after `appendAssistantTurn()` succeeds:

```ts
try {
    this.logMemoryWriteCandidates({ ... });
} catch (err) {
    this.logger.warn("persona-flow/memory: candidate logging failed", { ... });
}
```

Memory logging must be fail-soft. It must not roll back the saved chat turn and must not make `/v1/chat` or `/v1/chat/stream` fail.

## Service Flow

For non-streaming `chatTurn()`:

1. Prepare context and persist the user message.
2. Run `singleCharacterChatCall.run()`.
3. Parse `displayText`, `turnEvents`, and `memoryWriteCandidates`.
4. Persist assistant turn with `appendAssistantTurn()`.
5. Log memory candidates with `userMessageId` and `assistantMessageId`.
6. Return the existing chat API response shape unchanged.

For `streamTurn()`:

1. Keep current streaming preview behavior unchanged.
2. After `runStream()` returns, parse final structured output and final tool calls.
3. Persist assistant turn.
4. Log memory candidates.
5. Return the existing stream final response shape unchanged.

Do not add memory candidates to HTTP responses in batch 1. Prompt logs and normal logs are enough for evaluation.

## Model Purpose

Batch 1 does not need a new `ModelCallPurpose`. Candidate extraction happens inside the existing `chat.main` call.

The existing `memory.summarize` purpose in `MODEL_CALL_PURPOSES` can be reused later for memory-related LLM work if we add a second model call. However, the semantics are not identical:

- `memory.summarize`: summarize or compress memory/history.
- Future `memory.extract`: extract candidate memories from a turn.
- Future `memory.judge`: decide whether a candidate should be persisted, merged, ignored, or archived.

Keep `memory.summarize` as-is in batch 1.

## Validation And Tests

Batch 1 should add focused tests rather than full integration coverage.

Recommended checks:

- The memory candidate schema accepts a valid candidate with each allowed scope.
- The schema rejects empty `text` and unknown `scope`/`type`.
- `buildSingleCharacterChatRequest()` includes `submitMemoryCandidatesTool` and keeps `structuredOutputSchema` enabled.
- `parseSingleCharacterChatResponse()` returns an empty `memoryWriteCandidates` array when no matching tool call exists.
- Matching tool calls are parsed and included in `parsedOutput`.
- Invalid memory tool call arguments do not fail the chat parser.
- `chatTurn()` logs candidates after assistant turn persistence.
- Candidate logging failure does not fail `chatTurn()`.
- `streamTurn()` uses final tool calls only and does not change token preview behavior.

Useful commands:

```bash
pnpm run build
pnpm run test
```

If test execution hits missing workspace `dist` files in a fresh checkout, build the dependent packages first.

## Review Notes

Review date: 2026-06-26.

Validation run during review:

```bash
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/persona-flow typecheck
```

Both commands passed.

Findings:

- High: `parseMemoryWriteCandidates()` currently validates `toolCall.arguments` directly as an object, but provider adapters can return tool-call arguments as JSON strings. The Mistral streaming path explicitly preserves merged tool-call arguments as a string in `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`, and the non-stream message transform also forwards `function.arguments` without normalizing it. As a result, real `submit_memory_candidates` calls that arrive as JSON strings will be silently ignored by `SubmitMemoryCandidatesArgsSchema.safeParse()`. Fix before relying on logs for behavior evaluation: parse JSON string arguments before Zod validation, similar to the existing submit-turn-events parser, and add tests for both object and string tool-call arguments.

Test gaps to close with that fix:

- Add a `singleCharacterChatCall` test where `submit_memory_candidates.arguments` is a JSON string.
- Add a stream-path service or model-call test proving final stream tool calls are parsed and logged.

### Resolution

Decision: normalize tool-call arguments inside the provider adapter rather than at every consumer. The `ModelToolCall` contract was tightened so `arguments` is always a parsed JavaScript value, with the original text preserved on a new `argumentsRaw` field for prompt-log diagnostics.

Changes landed:

- `ModelToolCall` in `packages/persona-flow/src/llm/modelClient.ts` documents `arguments` as a parsed value and adds `argumentsRaw`.
- `normalizeToolCallArguments()` was added to `packages/persona-flow-model-client/src/mistral/messageTransforms.ts`. Both `normalizeToolCall()` (non-stream) and `toModelToolCall()` (stream accumulator in `mistralModelClient.ts`) now parse the JSON-text payload once, preserve the original text on `argumentsRaw`, and leave `arguments` undefined when parsing fails.
- `parseMemoryWriteCandidates()` no longer needs to handle the string case; the comment now points at the contract instead of inviting per-consumer JSON parsing.
- `ModelToolCallDelta.argumentsDelta` is intentionally left as `string` because stream fragments only make sense as text.

Tests added:

- `packages/persona-flow-model-client/test/messageTransforms.test.ts`: JSON-string parsing, structured pass-through, missing arguments, invalid JSON keeps `argumentsRaw`, and non-stream `normalizeToolCall()` for both string and object arguments.
- `packages/persona-flow/test/singleCharacterChatCall.test.ts`: confirms a string-typed `arguments` value is treated as invalid (because adapters must pre-parse it) and that valid object arguments are still parsed.
- `packages/persona-flow/test/personaFlowChatTurnService.test.ts`: adds a `streamTurn` case that asserts final stream tool calls are parsed and logged with the assistant message id.

Validation after the fix:

```bash
pnpm run test
```

Persona-flow now reports 49 tests, model-client 12, with all suites green.

### Test Coverage Review After Structured-Output Migration

Review date: 2026-06-26.

Context: memory candidates were moved out of the `submit_memory_candidates` tool-call side channel and into the top-level `memoryWriteCandidates` field of the same `submit_turn_events` structured-output JSON. This avoids the observed model/provider tendency to choose either tool calls or structured response content, but it changes the main risk profile: memory candidates now share the authoritative chat-turn schema with visible `events`.

Existing useful coverage:

- `packages/persona-flow/test/singleCharacterChatCall.test.ts` verifies that `single_character_chat` no longer registers tools, parses `memoryWriteCandidates` from structured output, returns an empty candidate list when the field is omitted, and rejects invalid candidate entries.
- `packages/persona-flow/test/personaFlowChatTurnService.test.ts` verifies candidate logging after assistant-turn persistence for non-streaming and streaming calls, no log emission when candidates are omitted, and fail-soft behavior when logging itself throws.
- `packages/persona-flow/test/memoryCandidatesSchema.test.ts` verifies candidate scope/type validation, optional fields, empty text rejection, and the max candidate count on `SubmitMemoryCandidatesArgsSchema`.
- `packages/persona-flow-model-client/test/messageTransforms.test.ts` verifies structured-output extraction when provider content is parsed, content JSON fallback, empty content, and tool-only provider responses.

Recommended missing tests:

- Add direct `SubmitTurnEventsArgsSchema` coverage for `memoryWriteCandidates`: accepts `{ events, memoryWriteCandidates }`, accepts omitted `memoryWriteCandidates`, rejects more than 5 candidates, and rejects invalid candidates. Candidate-only schema tests are useful but do not fully cover the combined output contract that the model now emits.
- Add `submitTurnEventsStreamPreview` tests proving extra top-level `memoryWriteCandidates` does not affect preview output. Cover both field orders: `memoryWriteCandidates` before `events`, and `events` before `memoryWriteCandidates`. The expected behavior is that only `events[].replyText.text` emits `replyTextDelta`, only valid `events[]` objects emit `turnEventPreview`, and candidate text never appears as streamed display text.
- Add a chunked `streamTurn` service test where the final structured-output JSON includes `memoryWriteCandidates` and is delivered in fragments, not as one full `onTextDelta`. Assert that streamed chunks reconstruct only the assistant reply text, candidates are logged after the assistant message id exists, and candidate text is not mixed into the live display stream.
- Add a dry-run/request assembly assertion that the rendered system prompt mentions `memoryWriteCandidates`, the request does not register `submit_memory_candidates`, and `toolChoice` remains undefined. This guards against accidentally reintroducing the old tool-call design.

Open product decision for tests:

- Current tests intentionally treat invalid `memoryWriteCandidates` as a full chat parse failure because candidates live inside the strict `SubmitTurnEventsArgsSchema`. If memory candidate collection should remain log-only and fail-soft, change this behavior: parse visible `events` authoritatively, validate `memoryWriteCandidates` separately with `safeParse`, drop or warn on invalid candidates, and update the invalid-candidate test to assert the reply still succeeds.

## Open Notes

- The first prompt tuning target is under-saving versus over-saving. Since there is no judge in batch 1, the model should be conservative.
- Sensitive-information filtering is intentionally out of scope for batch 1, but the later commit service should revisit it before memories become durable user-facing data.
- Batch 1 should not change web UI behavior or API response contracts.

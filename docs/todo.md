# TODO

## Higher priority follow-ups

- Character-level `modelConfig` is stored and editable, but chat model selection still does not consume it. Decide whether to implement that priority chain or hide the field until it becomes real.
- Richer streaming UX for `single_character_chat`: sync character avatar expression to `expression` events, sync scene background/overlay to `sceneAtmosphere` events, and add a side debug panel that renders the live `turnEvents` stream as it arrives (currently inline marker chips in the bubble + post-stream debug block are the only surfaces).
- **Memory commit pipeline atomicity.** `MemoryCommitService.commitOne()` currently calls `memoryStore.createMemory()` first, then `candidateStore.updateCandidateStatus()` + `decisionStore.appendDecision()` inside `finalize()`. If either of the latter two fails after `createMemory()` succeeds, the new memory row is orphaned — no matching `committed` candidate state, no `create` decision row. The in-memory fakes hide this because single-threaded JS makes "partial write" hard to reproduce, but the SQLite store (Step 5) will be vulnerable. Likely fix: introduce a small `MemoryCommitGateway` port with `commitNewMemory({ memory, candidateUpdate, decision })` and `recordCandidateDecision({ candidateUpdate, decision })` methods; SQLite implementation wraps both in `db.transaction()` (same pattern as `SQLiteMessageStore.appendAssistantTurn`); in-memory fake keeps the sequential behaviour. Also add a regression test that throws on `appendDecision` after `createMemory` and asserts no orphan memory remains. (Deferred per 2026-06-27 review; revisit before / during Step 5.)

## Lower priority follow-ups

- API key at-rest protection is still a no-op encrypt/decrypt layer. Revisit once deployment and key-management expectations are stable.
- Prompt log tool-call output is still hard to read when arguments are logged as one-line strings. Reformat tool-call arguments into a more readable structured block when revisiting prompt-log UX.
- `PromptLogger` and `DefaultModelClient` are still created per chat request by design for now. The SDK client promise is intentionally not reused across requests. Current prompt logs append to one file rather than recreating files, so this is a maintainability/perf note, not an active correctness bug.

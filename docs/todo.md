# TODO

## Higher priority follow-ups

- Character-level `modelConfig` is stored and editable, but chat model selection still does not consume it. Decide whether to implement that priority chain or hide the field until it becomes real.
- Richer streaming UX for `single_character_chat`: sync character avatar expression to `expression` events, sync scene background/overlay to `sceneAtmosphere` events, and add a side debug panel that renders the live `turnEvents` stream as it arrives (currently inline marker chips in the bubble + post-stream debug block are the only surfaces).
- **Memory commit pipeline atomicity.** `MemoryCommitService.commitOne()` currently calls `memoryStore.createMemory()` first, then `candidateStore.updateCandidateStatus()` + `decisionStore.appendDecision()` inside `finalize()`. If either of the latter two fails after `createMemory()` succeeds, the new memory row is orphaned — no matching `committed` candidate state, no `create` decision row. The in-memory fakes hide this because single-threaded JS makes "partial write" hard to reproduce, but the SQLite store (Step 5) will be vulnerable. Likely fix: introduce a small `MemoryCommitGateway` port with `commitNewMemory({ memory, candidateUpdate, decision })` and `recordCandidateDecision({ candidateUpdate, decision })` methods; SQLite implementation wraps both in `db.transaction()` (same pattern as `SQLiteMessageStore.appendAssistantTurn`); in-memory fake keeps the sequential behaviour. Also add a regression test that throws on `appendDecision` after `createMemory` and asserts no orphan memory remains. (Deferred per 2026-06-27 review; revisit before / during Step 5.)

## Lower priority follow-ups

- **Decision list 端口缺 `characterId` 过滤（Step 7 debug API 顺手处理）。** 写入路径已经把 `characterId` 钉死成 NOT NULL，但 `ListMemoryDecisionsInput` 目前只有 `userId / candidateId / decision / limit`。未来 debug API 想展示"当前角色世界里的 memory decisions"时，只能先按 user 拉全量再在调用方手动按 characterId 过滤，容易漏或者把别的 character 的 decision 误展示出来。修法：给 `ListMemoryDecisionsInput` 加 `characterId?: string`（保持可选，向后兼容现有调用方），在 `SQLiteMemoryDecisionStore.listDecisions` 里 `input.characterId` 存在时多 push 一条 `eq(memoryDecisions.characterId, input.characterId)`，in-memory fake 同步。建议跟 Step 7 debug API 一起做，避免单独开一个小 PR。

- API key at-rest protection is still a no-op encrypt/decrypt layer. Revisit once deployment and key-management expectations are stable.
- Prompt log tool-call output is still hard to read when arguments are logged as one-line strings. Reformat tool-call arguments into a more readable structured block when revisiting prompt-log UX.
- `PromptLogger` and `DefaultModelClient` are still created per chat request by design for now. The SDK client promise is intentionally not reused across requests. Current prompt logs append to one file rather than recreating files, so this is a maintainability/perf note, not an active correctness bug.

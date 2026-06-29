# Memory Batch 3.5 代码 Review

[返回实施计划](memory-layered-refactor-batch3.5.zh-CN.md) ｜ [返回分层设计](memory-layered-refactor.zh-CN.md)

Review 时间：2026-06-29
二次复查时间：2026-06-29

## 结论

二次复查后，上一轮 4 个 finding 均已修复，未发现新的 blocking 问题。当前实现可以进入下一步集成 / 合入前整理。

已确认的修复点：

- `@ss-ai/persona-flow` typecheck 已恢复通过。
- `MemoryStagingProcessor` 的 idempotent 分支现在会走 `finalize(...)`，可修复 candidate 持久化状态。
- `allowMissingEmbedding` 已从 core settings / processor / tests / server config schema 中移除。
- embedding 失败 warning log 已补齐 `candidateId`、`userId`、`characterId`、`scope`、`type`、`reason`。

## Findings

以下为上一轮 review finding。二次复查状态均为 resolved。

### 1. High：`@ss-ai/persona-flow` typecheck 失败，旧测试 fixture 仍使用旧 AppStores 形状

状态：Resolved。

二次复查：`packages/persona-flow/test/helpers/inMemoryStores.ts` 已改为 `memoryCandidate` / `memoryStaging` / `memoryRetained`，`pnpm --filter @ss-ai/persona-flow typecheck` 已通过。

位置：`packages/persona-flow/test/helpers/inMemoryStores.ts:361-362`

现象：

```text
test/helpers/inMemoryStores.ts:361:9 - error TS2353: Object literal may only specify known properties, and 'memory' does not exist in type 'AppStores'.
test/helpers/inMemoryStores.ts:361:30 - error TS2339: Property 'memoryStore' does not exist on type 'InMemoryMemoryStores'.
test/helpers/inMemoryStores.ts:362:38 - error TS2339: Property 'decisionStore' does not exist on type 'InMemoryMemoryStores'.
```

原因：`AppStores` 已改为：

```ts
memoryCandidate
memoryStaging
memoryRetained
```

但 `createTestFixture()` 还在组装旧字段：

```ts
memory: memoryStores.memoryStore,
memoryDecision: memoryStores.decisionStore,
```

影响：测试 runner 当前没有暴露这个问题，但 `pnpm --filter @ss-ai/persona-flow typecheck` 失败，包不能通过类型检查。

建议修复：改为：

```ts
memoryCandidate: memoryStores.candidateStore,
memoryStaging: memoryStores.stagingStore,
memoryRetained: memoryStores.retainedStore,
```

并清理相关旧字段引用。

### 2. High：idempotent 分支没有修复 candidate 状态，失败重跑会一直 pending

状态：Resolved。

二次复查：`MemoryStagingProcessor` 的 existing-link 分支已改为调用 `finalize(...)`，并新增测试覆盖“已有 source link 但 candidate 仍 pending 时，重跑会修复为 processed / idempotent_already_linked”。

位置：`packages/persona-flow/src/memory/staging/MemoryStagingProcessor.ts:149-163`

实现现在的逻辑是：如果 `findBySourceCandidate(candidateId)` 找到已有 link，就直接返回：

```ts
candidateStatus: "processed",
statusReason: "idempotent_already_linked",
stagingOutcome: "idempotent",
```

但这条分支没有调用 `candidateStore.updateCandidateStatus(...)`。

这会破坏 Batch 3.5 文档里的关键幂等要求：如果“写入 memory staging 成功但更新 candidate 状态失败”，下次重跑应通过 source 关系识别已处理结果并修复 candidate 状态。

实际结果：

- source link 已存在。
- candidate 仍可能是 `pending`。
- `processPendingCandidates()` 下一轮还会捞到它。
- processor 每次都返回 processed outcome，但 DB 里的 candidate 状态不会被修复，导致重复扫描。

现有测试 `is idempotent: re-processing a candidate already linked...` 只断言 occurrenceCount 不重复，没有断言 candidate store 状态被修复，因此漏掉了这个问题。

建议修复：idempotent 分支也走 `finalize(...)` 或至少显式调用 `updateCandidateStatus({ status: "processed", statusReason: "idempotent_already_linked" })`。同时补一个测试：手工构造 `pending candidate + existing memory_staging_sources link`，跑 processor 后断言 candidate 持久化状态变为 `processed`。

### 3. Medium：`allowMissingEmbedding` 仍允许创建无 embedding 的 memory staging，和已确认决策不一致

状态：Resolved。

二次复查：`allowMissingEmbedding` 已从 `MemorySettings`、默认配置、processor 分支、测试、server raw config/schema 中移除。全仓库 grep 仅在本 review 文档历史 finding 中出现。

位置：

- `packages/persona-flow/src/memory/settings.ts:53`
- `packages/persona-flow/src/memory/staging/MemoryStagingProcessor.ts:188-195`
- `packages/persona-flow/test/memoryStagingProcessor.test.ts:224`

已确认决策是：Batch 3.5 不允许创建无 embedding 的 memory staging；embedding 失败时 candidate 标记 `failed / embedding_failed`，并输出 warning log。

但代码仍保留 `settings.staging.allowMissingEmbedding`，并且测试明确覆盖：

```text
stages the row when allowMissingEmbedding is true even if embedding fails
```

影响：只要配置里把 `allowMissingEmbedding` 打开，系统就会写出无 embedding 的 memory staging。这和 Batch 3.5 的 downstream 简化假设冲突，也会让 similarity sampling / future consolidation 输入出现额外分支。

建议修复：Batch 3.5 先移除该配置项和测试分支；或者保留类型字段但不暴露 config schema，processor 不再根据它放行无 embedding staging。

### 4. Low：embedding 失败 warning log 信息不足

状态：Resolved。

二次复查：`MemoryEmbeddingStep.embed()` 的 warning payload 已包含 `candidateId`、`userId`、`characterId`、`scope`、`type`、`reason`，并新增测试断言这些字段。

位置：

- `packages/persona-flow/src/memory/embedding/MemoryEmbeddingStep.ts:58-61`
- `packages/persona-flow/src/memory/logging/MemoryPipelineLogger.ts:218-221`

当前 `embeddingFailed` warning payload 只有：

```ts
candidateId
error
```

已确认文档要求 warning log 至少包含 `candidateId`、`userId`、`characterId`、`scope`、`type`、错误 reason。现在日志是 warning 级别，但排障信息不够，尤其多个 character / scope 混在一起时不方便定位。

建议修复：扩展 `EmbeddingFailedPayload`，在 `MemoryEmbeddingStep.embed()` 从 candidate.source 和 candidate 本体补齐字段。

## 验证记录

二次复查已运行：

```text
pnpm --filter @ss-ai/persona-flow typecheck
pnpm --filter @ss-ai/persona-flow-sqlite typecheck
pnpm --filter @ss-ai/server typecheck
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/persona-flow-sqlite test
pnpm --filter @ss-ai/server test
```

结果：全部通过。

上一轮验证记录保留如下。

已运行：

```text
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/persona-flow-sqlite test
pnpm --filter @ss-ai/server test
```

结果：全部通过。

已运行：

```text
pnpm --filter @ss-ai/persona-flow typecheck
pnpm --filter @ss-ai/persona-flow-sqlite typecheck
pnpm --filter @ss-ai/server typecheck
```

结果：

- `@ss-ai/persona-flow` typecheck 失败，见 Finding 1。
- `@ss-ai/persona-flow-sqlite` typecheck 通过。
- `@ss-ai/server` typecheck 通过。

## 建议修复顺序

二次复查：下列修复项均已完成。

1. 先修 `test/helpers/inMemoryStores.ts` 的旧 `AppStores` 字段，恢复 persona-flow typecheck。
2. 修 `MemoryStagingProcessor` idempotent 分支，让它能修复 candidate 状态，并补覆盖测试。
3. 按 Batch 3.5 决策移除或禁用 `allowMissingEmbedding` 放行路径。
4. 扩展 embedding failure warning log payload。
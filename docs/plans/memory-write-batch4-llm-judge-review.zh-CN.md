# Memory Write Batch 4 代码 Review

[返回 Batch 4 功能设计](memory-write-batch4-llm-judge.zh-CN.md) ｜ [返回 followups](memory-write-followups.md)

Review 时间：2026-06-29

## 结论

当前实现已经覆盖了 Batch 4 的大部分领域模型和存储骨架：`memory.consolidate` purpose、consolidation processor、judge output validation、retained store 写接口、consolidation decision audit store、SQLite 表和核心单测都已落地，工作方向和文档里的分层判断一致。

但本轮 review 发现 5 个需要修复的问题，其中前两个会影响 Batch 4 是否真的可运行 / 是否满足幂等审计语义。建议修复后再进入下一轮集成。

## Findings

### 1. High：生产路径不会构造 retained consolidation processor，Batch 4 运行时不可达

位置：

- `packages/persona-flow/src/memory/createMemoryPipelineService.ts:53`
- `packages/persona-flow/src/memory/createMemoryPipelineService.ts:95`
- `packages/persona-flow/src/memory/MemoryPipelineService.ts:192`
- `apps/server/src/http/apis/chat/chatUtil.ts:75`

现象：`MemoryPipelineService.processPendingMemoryStaging()` 只有在 `consolidationProcessor` 被注入时才会处理，否则直接返回空结果。但 `createMemoryPipelineService()` 当前只从 `overrides.consolidationProcessor` 透传 processor，并不会根据 `settings.retained.enabled` / `retained.judge.enabled` 构造默认 `MemoryRetainedConsolidationProcessor`。

server 侧也没有看到任何 debug route、worker、script 或 composition 代码创建 `MemoryRetainedConsolidationProcessor` / `createMemoryConsolidationJudgeProvider()`。因此当前实现的 retained consolidation 只在单测里可达，实际运行时即使配置了 `memory.retained.enabled = true`，也不会把 `memory_staging` 推进到 `memory_retained`。

影响：Batch 4 的核心功能“memory staging 到 memory retained 的筛选保存”没有生产入口。`memory_retained` 写入、LLM judge、audit 表在真实服务中都不会被触发。

建议修复：

- 在 composition 层构造默认 consolidation processor：`MemoryRetainedConsolidationProcessor + createMemoryConsolidationJudgeProvider + ModelRuntime + character/candidate lookup adapters`。
- `MemoryPipelineService.processPendingMemoryStaging()` 至少检查 `settings.retained.enabled` 和 `settings.retained.judge.enabled`。
- 增加一个最小触发面：debug POST endpoint、script、或明确的 worker stub。若本批次不做 HTTP 触发，也应提供 server composition 可调用的入口和测试覆盖。

### 2. High：retained 写入、audit 写入、staging 状态更新不是一个原子操作，幂等依赖可能失效

位置：

- `packages/persona-flow/src/memory/consolidation/MemoryRetainedConsolidationProcessor.ts:182-214`
- `packages/persona-flow/src/memory/consolidation/MemoryRetainedConsolidationProcessor.ts:229-258`
- `packages/persona-flow/src/memory/consolidation/MemoryRetainedConsolidationProcessor.ts:361-396`
- `packages/persona-flow-sqlite/src/db/openDatabase.ts:496-498`

现象：processor 的顺序是先写 retained / archive retained，再调用 `writeDecision(...)`，最后更新 staging 状态。`writeDecision(...)` 会吞掉 audit store 失败，只写 warning。SQLite 虽然有 `memory_staging_id WHERE status = 'applied'` 的唯一索引，但这个约束只保护 audit 表，不保护 retained mutation 本身。

可能的失败窗口：

- create retained 成功，audit 写失败，staging 状态也失败或之后被重置为 pending：下一次重跑找不到 applied decision，会再次创建 retained。
- 并发两个 processor 同时处理同一 staging：两个都可能先写 retained；其中一个 audit applied 成功，另一个 audit 因唯一约束失败但被吞掉，重复 retained 已经产生。
- update/merge 分支也类似：retained occurrence / text / archive 可能已经被改动，但 audit 没有留下 applied record，幂等和 debug replay 都断裂。

影响：当前 Batch 4 的核心不变量“同一 staging row 只能被 applied 一次”没有覆盖实际 retained side effect，只覆盖了 audit row。出现 store failure 或并发时可能重复创建/重复累计 occurrence/重复 archive。

建议修复：

- 把“检查 applied decision -> retained mutation -> create applied decision -> staging status update”放进一个 store-level transaction，至少 SQLite adapter 需要提供一个 consolidation transaction port。
- 或者调整顺序为先用唯一约束 claim staging / decision，再执行 side effect，并在失败时把 decision 标为 failed/retryable；不要在 applied side effect 后吞掉 audit 写失败。
- `writeDecision` 对 applied/failed audit 写入不应总是吞掉。对于会影响幂等的 applied decision，失败应让本 staging outcome 进入 failed，并避免把 staging 标记 processed。
- 增加测试覆盖：audit write 失败、staging status update 失败、并发/重复 applied decision 冲突。

### 3. Medium：retained `normalizedText` 使用 `trim()`，没有复用 memory normalization 规则

位置：

- `packages/persona-flow/src/memory/consolidation/MemoryRetainedConsolidationProcessor.ts:195`
- `packages/persona-flow/src/memory/consolidation/MemoryRetainedConsolidationProcessor.ts:237`
- `packages/persona-flow/src/memory/candidate/textNormalization.ts`

现象：create/update retained 时，`normalizedText` 直接来自 `action.text.trim()` / `text.trim()`。这和 staging 阶段使用的 `normalizeMemoryText()` 不一致。

影响：retained retrieval 中 exact match 使用 `row.normalizedText === staging.normalizedText`。如果 retained row 保存的是未规范化文本，例如大小写、标点、空白、全半角没有折叠，后续同义或同文本 staging 很难命中 exact 分支，只能依赖 embedding similarity。`normalized_text` 字段也失去它在 candidate/staging 层已有的语义。

建议修复：create/update retained 时统一调用 `normalizeMemoryText(finalText)`；如果归一化后为空，应拒绝该 action 或标记 failed。补测试：创建 retained 后断言 normalized text 与 staging normalizer 结果一致，后续相同文本 staging 能 exact 排到 retained context 前列。

### 4. Medium：`retained.judge.maxTextChars` 配置没有被 prompt builder 使用

位置：

- `packages/persona-flow/src/memory/settings.ts:124`
- `packages/persona-flow/src/memory/settings.ts:167`
- `packages/persona-flow/src/memory/consolidation/MemoryRetainedConsolidationProcessor.ts:318-343`
- `packages/persona-flow/src/modelCall/memory.consolidate/consolidationPromptBuilder.ts:20-53`

现象：settings 暴露了 `retained.judge.maxTextChars`，但 `buildJudgeInput()` 和 `buildConsolidationMessages()` 没有使用该值。staging text、source candidate text、retained text、persona summary 都会原样进入 prompt。

影响：真实聊天数据中 candidate / retained 文本可能较长，Batch 4 judge prompt 的 token 成本和失败风险不可控。这个配置目前给了调用方一种“已经有限长保护”的错觉。

建议修复：在 build judge input 或 prompt builder 中统一截断：staging text、每条 source candidate、每条 related retained、persona summary。截断策略应保留 id、scope/type、importance 等结构字段，只裁剪长文本字段。补一个单测覆盖 `maxTextChars`。

### 5. Low：`retained.enabled` / `retained.judge.enabled` / `processingMode` 语义尚未真正接入

位置：

- `packages/persona-flow/src/memory/settings.ts:85-119`
- `packages/persona-flow/src/memory/MemoryPipelineService.ts:192-197`

现象：settings 定义了 retained 总开关、judge 开关和 `processingMode`，但 `processPendingMemoryStaging()` 只检查 `settings.enabled` 和 `consolidationProcessor` 是否存在。当前因为生产路径没有构造 processor，这个问题被 Finding 1 掩盖；一旦后续默认构造 processor，关闭 `memory.retained.enabled` 仍可能被手动入口处理。

影响：配置语义不完整，后续 debug route / worker 接进来后容易出现“配置关闭但手动触发仍写 retained”的行为。

建议修复：

- `processPendingMemoryStaging()` 明确检查 `settings.retained.enabled` 和 `settings.retained.judge.enabled`。
- `processingMode` 用于决定 chat inline 是否自动触发；manual endpoint 可以允许显式触发，但应在 API 层或 service 层文档化是否绕过 mode。

## 验证记录

已运行：

```text
pnpm -r test 2>&1 | Select-String -Pattern "# tests|# pass|# fail|not ok|ERR_PNPM|FAIL|Error:" | Select-Object -First 80
```

结果摘要：

```text
apps/qq-bot: 8 tests, 8 pass, 0 fail
packages/persona-flow: 146 tests, 146 pass, 0 fail
packages/persona-flow-model-client: 31 tests, 31 pass, 0 fail
packages/persona-flow-sqlite: 64 tests, 64 pass, 0 fail
apps/server: 104 tests, 104 pass, 0 fail
```

编辑器诊断：`get_errors` 全仓库无错误。

## 建议修复顺序

1. 先补生产 composition / 触发入口，让 Batch 4 功能在运行时可达，并接入 retained settings 开关。
2. 修 retained mutation + audit + staging status 的原子性，避免幂等只保护 audit 而不保护 side effect。
3. 统一 retained `normalizedText` 使用 `normalizeMemoryText()`。
4. 接入 `maxTextChars` 截断，补 prompt size 控制测试。
5. 补充集成测试：从 pending staging 通过真实 service/composition 走到 retained row 和 audit row。
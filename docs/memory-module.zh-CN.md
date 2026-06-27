# Memory 模块实现说明

本文档记录当前长期记忆写入原型的代码边界和函数职责。它描述的是截至 Step 7 的实际实现，不是最终目标状态。

当前状态一句话：聊天模型已经能在 structured output 中产生 `memoryWriteCandidates`，`packages/persona-flow/src/memory/**` 已经具备候选记录、embedding 相似度判断和提交决策的核心服务，对应的 SQLite stores 已经落在 core `app.db`，并且已经端到端接入 chat turn —— 默认配置下每条带候选的对话都会写入 `memory_candidates` / `memories` / `memory_decisions` 三张表（fail-soft）；Step 7 已提供只读 debug API 查询 candidates、active memories 和 decisions，回读 prompt 仍在后续 step。

## 当前边界

核心 memory 代码位于：

- `packages/persona-flow/src/memory/**`

这个目录被当作未来可抽包的核心模块雏形。它只依赖稳定 contracts 类型和本目录内部代码，不直接依赖 chat turn、model runtime、Mistral、Express 或 SQLite。

边界适配代码位于：

- `packages/persona-flow/src/memoryAdapters/modelClientEmbeddingProvider.ts`
- `packages/persona-flow-model-client/src/mistral/mistralEmbed.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`

这些文件负责把 memory core 需要的 `MemoryEmbeddingProvider` 接到真实 model client/provider。

## 输入来源

Batch 1 后，`single_character_chat` 的 structured output schema 中包含顶层 `memoryWriteCandidates` 字段。候选记忆不是可见回复，也不参与 streaming preview。

Step 6 完成后，`PersonaFlowChatTurnService.chatTurn()` / `streamTurn()` 在持久化 assistant turn 后调用 `safeHandleMemoryWriteCandidates(...)`：先保留 Batch 1 的 INFO 摘要行（`persona-flow/memory: candidates logged`），再按 `MemoryFeatureConfig` 决定是否调用 `MemoryCandidateRecorder` + `MemoryCommitService`。整段 try/catch，任何异常仅 WARN 日志，不会让 chat turn 失败。

服务端 boot 在 `apps/server/src/http/apis/chat/chatUtil.ts` 把 stores、`ModelClientEmbeddingProvider`、recorder、commit service 一起绑定到 `PersonaFlowChatTurnService.memory` 字段；`RuntimeConfig.memory` 字段控制 enabled / immediateCommitEnabled。

## 核心数据类型

### `types.ts`

文件：`packages/persona-flow/src/memory/types.ts`

主要职责：定义 memory 子系统内部流转的数据形状。

关键类型：

- `MemoryCandidateSource`
  - 记录候选来自哪个 user、character、conversation、user message、assistant message、request。
  - 后续 candidate、decision、debug event 都通过这些字段追溯来源。
- `MemoryCandidateDraft`
  - 候选输入类型，目前等同于 contracts 里的 `MemoryWriteCandidate`。
- `MemoryCandidateRecord`
  - 已保存的候选行形状。
  - 包含 `seq`、`normalizedText`、`status`、可选 `embedding`、时间戳和 schema version。
- `MemoryEmbedding`
  - embedding 向量和签名 metadata。
  - `provider + model + dim + version` 共同决定两个向量是否可比较。
- `ActiveMemoryRecord`
  - 已提交的长期记忆行形状。
  - 当前只创建 `active`，`archived` 预留给后续。
- `MemoryDecisionRecord`
  - 每个 candidate 的最终处理结果。
  - 保存 decision、reason、可选 memoryId、topK similarity 摘要和 policyVersion。
- `MemoryEmbedInput` / `MemoryEmbedResult`
  - memory core 调用 embedding provider 的最小输入输出。

关键枚举：

- `MEMORY_CANDIDATE_STATUSES`
  - `pending`、`embedded`、`committed`、`ignored_duplicate`、`ignored_low_value`、`needs_judge`、`embedding_failed`、`commit_failed`
- `MEMORY_DECISION_KINDS`
  - `create`、`ignore_duplicate`、`ignore_low_value`、`needs_judge`、`embedding_failed`、`error`

## 端口定义

### `ports.ts`

文件：`packages/persona-flow/src/memory/ports.ts`

主要职责：定义 memory core 对外部系统的依赖，不提供具体实现。

关键端口：

- `MemoryCandidateStore`
  - `appendCandidates()`：批量保存 candidate。
  - `listCandidates()`：按 user/conversation/status 等查询 candidate。
  - `updateCandidateStatus()`：更新候选状态。
  - `saveCandidateEmbedding()`：把候选 embedding 回写到 candidate。
- `MemoryStore`
  - `createMemory()`：创建 active memory。
  - `listActiveMemories()`：读取同 bucket 的 active memories，用于相似度扫描。
  - `findExactActiveMemory()`：按 normalized text 做精确重复判断。
  - `saveMemoryEmbedding()`：给 memory 回写 embedding，预留能力。
- `MemoryDecisionStore`
  - `appendDecision()`：写入 candidate 的处理结果。
  - `listDecisions()`：用于 debug API，可按 user、character、candidate、decision kind 查询。
- `MemoryEmbeddingProvider`
  - `embed()`：把文本变成 `MemoryEmbedResult`。
- `MemoryClock` / `MemoryIdGenerator` / `MemoryLogger`
  - 让服务不直接依赖 `Date`、随机数和具体 logger 实现。

## 文本标准化

### `normalizeMemoryText()`

文件：`packages/persona-flow/src/memory/textNormalization.ts`

作用：生成用于精确重复判断的稳定 key。

处理步骤：

1. Unicode NFKC 标准化。
2. 折叠少量常见全角/弯引号/破折号/零宽字符。
3. 小写化。
4. 合并空白。
5. trim。

这个函数不是语义相似度算法，也不是展示文本。它只用于保守的 exact duplicate lookup。

## 相似度算法

### `cosineSimilarity()`

文件：`packages/persona-flow/src/memory/similarity.ts`

作用：计算两个等长非零向量的 cosine similarity。

防御行为：

- 非数组、空数组、维度不一致、零向量都会返回 `NaN`。
- 调用方通过 `Number.isFinite()` 过滤无效结果。

### `rankSimilarMemories()`

文件：`packages/persona-flow/src/memory/similarity.ts`

作用：把 candidate embedding 和一组 active memories 做相似度排序。

输入：

- candidate vector
- active memory records
- `topK`
- 可选 `requireSignature`

过滤规则（按检查顺序，同一条 memory 只会被计入第一条命中的原因）：

- memory 没有 embedding：跳过，计入 `skipped.noEmbedding`。
- embedding signature 不匹配：跳过，计入 `skipped.signatureMismatch`。
- stored vector length 与 declared dim 不一致：跳过，计入 `skipped.corruptDim`。
- cosine 结果非 finite：跳过，计入 `skipped.nonFiniteSimilarity`。
- candidate vector length 与 required dim 不一致：直接返回 `{ ranked: [], skipped: <全零> }`，根本不扫 memories（因此这种场景不会体现在 breakdown 里，调用方需要通过 `ranked.length === 0 && memories.length > 0` 自行判断）。

返回 `{ ranked, skipped }`：

- `ranked`：按 similarity 降序排列的 `RankedMemory[]`，最多 `topK` 条。
- `skipped`：`MemoryRankSkipBreakdown`，4 个计数器互不重叠。可以用 `totalSkipped(skipped)` 拿总和。未触发 `topK` 截断时，`ranked.length + totalSkipped(skipped)` 等于传入的 memories 数量；触发 `topK` 截断时，这个和会小于等于传入数量，因为被截掉的是可排名项，不属于 skipped。

## 决策策略

### `defaultMemoryDecisionPolicy`

文件：`packages/persona-flow/src/memory/decisionPolicy.ts`

当前默认值：

- `exactDuplicateThreshold: 0.95`
- `needsJudgeThreshold: 0.80`
- `topK: 10`
- `policyVersion: 1`

真实 `mistral-embed` probe 显示，短中文事实之间的相似度基线偏高；后续调参时不要把 `0.80` 理解成“80% 一样”。

### `decideBySimilarity()`

文件：`packages/persona-flow/src/memory/decisionPolicy.ts`

作用：根据 top ranked memory 产生保守决策。

规则：

- 没有相似 memory：`create`。
- top similarity >= `exactDuplicateThreshold`：`needs_judge`。
- top similarity >= `needsJudgeThreshold`：`needs_judge`。
- 低于阈值：`create`。

注意：embedding near-duplicate 当前不会自动 `ignore_duplicate`。Batch 2/3 只把它路由到 `needs_judge`，避免误删真实新信息。

### `isLowValueCandidate()`

文件：`packages/persona-flow/src/memory/decisionPolicy.ts`

作用：在付费 embedding 前过滤明显没有记忆价值的候选。

只过滤非常保守的情况：

- normalize 后为空。
- 太短。
- 没有任何字母/数字/文字字符。

## 候选记录服务

### `MemoryCandidateRecorder.recordCandidates()`

文件：`packages/persona-flow/src/memory/candidateRecorder.ts`

作用：把模型提出的 candidate drafts 保存成 candidate records，供 commit service 处理。

流程：

1. 空 candidates 直接返回 `{ accepted: [], rejectedCount: 0 }`。
2. 对每条 draft trim `text`。
3. 空白文本直接丢弃，计入 `rejectedCount`。
4. 对保留项计算 `normalizedText`。
5. 调用 `candidateStore.appendCandidates({ source, candidates, normalizedTexts })`。
6. 返回 store 生成的 records。
7. 如果 store 抛错，warn log，返回空 accepted，并把 error 放到 `storeError`。

设计重点：

- recorder 只做结构性过滤和 normalization。
- 低价值、重复、相似度判断都放在 commit service。
- store failure 必须 fail-soft，不影响 chat turn。

## 提交服务

### `MemoryCommitService.commitCandidates()`

文件：`packages/persona-flow/src/memory/commitService.ts`

作用：逐条处理 candidate record，产出 active memory 或 decision。

它按顺序处理 batch 内 candidates；每条 candidate 有自己的 try/catch，一条失败不会中断后续候选。

### `commitOne()` 的处理流程

文件：`packages/persona-flow/src/memory/commitService.ts`

1. `candidate_received`
   - 记录候选开始处理。
2. 低价值过滤
   - 调用 `isLowValueCandidate(candidate)`。
   - 命中则 finalize 为：
     - decision: `ignore_low_value`
     - candidate status: `ignored_low_value`
3. 精确重复检查
   - 调用 `memoryStore.findExactActiveMemory()`。
   - bucket 由 `userId + characterId + scope + type + normalizedText` 决定。
   - 命中则 finalize 为：
     - decision: `ignore_duplicate`
     - candidate status: `ignored_duplicate`
     - similarity summary 中记录该 memory，similarity = 1。
4. embedding
   - 调用 `embeddingProvider.embed({ text, purpose: "memory.write.candidate", userId })`。
   - 失败则 finalize 为：
     - decision: `embedding_failed`
     - candidate status: `embedding_failed`
   - 成功后调用 `candidateStore.saveCandidateEmbedding()` 回写 candidate embedding。
5. 相似 memory 扫描
   - 调用 `memoryStore.listActiveMemories()` 读取同 bucket active memories。
   - 调用 `rankWithSkipDiagnostics()`，内部使用 `rankSimilarMemories()` 排序。
   - signature 不匹配的 memory 会跳过，不参与比较。跳过原因拆成 4 个计数器放进 `MemoryCommitOutcome.skipped`。
6. 决策
   - 调用 `decideBySimilarity(ranked, policy)`。
   - `needs_judge`：finalize 为 candidate status `needs_judge`，不创建 memory。
   - `create`：先调用 `memoryStore.createMemory()`，再 finalize 为 candidate status `committed` 和 decision `create`。
7. 未捕获错误
   - 转成 decision `error` 和 candidate status `commit_failed` 的 best-effort finalize。
   - 如果 finalize 本身也失败，最终 outcome 仍返回 `error`，不向外抛。

### memory 与 character 的绑定

文件：`packages/persona-flow/src/memory/commitService.ts`

每条 memory 都属于**某一个 character 世界**。这是 Batch 2 收尾时确立的硬规则：

- 写入 memory 时直接使用 `candidate.source.characterId`，所有 scope（`user`、`character`、`relationship`、`conversation`、`world`）都一样，不再做拆分。
- `scope` 只用来在同一个 character 世界内部分类（这是关于「用户」的事实 / 关于「角色」的事实 / 关于「世界观」的事实 / ……），不会让 memory 跨 character 共享。
- `MemoryStore.createMemory` / `listActiveMemories` / `findExactActiveMemory` 的 `characterId` 是必填 `string`。`MemoryDecisionStore.appendDecision` 同理。
- SQLite 的 `memories.character_id` 和 `memory_decisions.character_id` 列是 `NOT NULL`。`idx_memories_user_character_scope_type_normtext_status` 包含 `character_id`，保证 brute-force 扫描按 `(user, character, scope, type)` bucket 分桶。
- 同一 `user` + 同一 `normalizedText` + 同一 `scope/type` 但 character 不同，会作为两条独立 memory 各自存在；一边的 memory 不会被另一边查询到。

因此 commit service 不再有 `scopeCharacterId()` 这种辅助方法 —— bucket 由 candidate source 直接决定。

### `rankWithSkipDiagnostics()`

文件：`packages/persona-flow/src/memory/commitService.ts`

作用：在排序前逐条扫描 memories 只为了为 signature mismatch 发出逐行 debug log，随后委托 `rankSimilarMemories()` 汇总计数 + 排序。本身不再重复跳过逻辑 —— 计数只有 similarity.ts 一个权威源。

输出 `{ ranked, skipped: MemoryRankSkipBreakdown }`，拆分为四个独立计数器：

- `skipped.noEmbedding`：memory 行没有存 embedding。一般是该 memory 早于 embedding rollout，或首次 embed 失败后未重试。
- `skipped.signatureMismatch`：stored embedding 的 provider/model/dim/version 跟 candidate signature 不一致。防止跨隐藏空间的伪高相似度。另外会输出 `memory.commit.skipped_signature_mismatch` per-memory debug log。
- `skipped.corruptDim`：stored vector 长度与认为的 `embedding.dim` 不一致。数据损坏信号，需要走数据库修复不是看日志。
- `skipped.nonFiniteSimilarity`：cosine 结果是 NaN / Infinity，多半来自零向量漏过上游。

为什么只给 signature mismatch 加 per-memory 日志：这是唯一一个“只从aggregate 计数看不出是哪一行损伤”但仍是合法运行时状态（换了 embedding 模型后老数据会全部被跳）的场景；其他三种都是环境或数据 bug，需要查表不是查日志。

`MemoryCommitOutcome.skipped` 是该结果的拷贝；debug API / try-script 可以直接渲染。

### `finalize()`

文件：`packages/persona-flow/src/memory/commitService.ts`

作用：统一写 candidate status 和 decision row，并返回 `MemoryCommitOutcome`。

写入顺序：

1. `candidateStore.updateCandidateStatus()`
2. `decisionStore.appendDecision()`

对于 `create` 分支，当前实现是在 `createMemory()` 成功后再调用 `finalize()`。因此 Step 5 SQLite 接入时要特别注意 transaction：`createMemory + updateCandidateStatus + appendDecision` 最好在同一个事务中完成，避免 memory 已创建但 decision/status 写失败。

## Embedding adapter

### `ModelClientEmbeddingProvider.embed()`

文件：`packages/persona-flow/src/memoryAdapters/modelClientEmbeddingProvider.ts`

作用：把 memory core 的 `MemoryEmbeddingProvider` 端口接到通用 `ModelClient.embed()`。

处理流程：

1. 校验 input text 非空。
2. 解析 `memory.embed` model assignment：
   - 用户 assignment 优先。
   - 默认 `defaultModelAssignments["memory.embed"]` 兜底。
   - 缺失时报 `assignment_missing`。
3. 解析 API key：
   - 用户 provider credential 优先。
   - 默认 provider key 兜底。
   - 缺失时报 `api_key_missing`。
4. 检查 `modelClient.embed` 是否存在。
5. 调用 `modelClient.embed({ provider, model, encryptedApiKey, inputs: [text] })`。
6. 校验返回 vector 非空且每项是 finite number。
7. 返回 `MemoryEmbedResult`，补齐 provider/model/dim/version/createdAt。

该文件刻意放在 `memoryAdapters/**`，不放在 `memory/**`，因为它依赖 model client、app stores 和 chat logger 类型。

## Mistral embedding client

### `ModelClient.embed()`

文件：`packages/persona-flow/src/llm/modelClient.ts`

新增 provider-neutral embedding 方法：

```ts
embed?(input: ModelEmbedInput): Promise<ModelEmbedResult>;
```

它是可选方法。调用方如果依赖 embedding，必须在缺失时给出清晰错误，不能静默 fallback。

### `DefaultModelClient.embed()`

文件：`packages/persona-flow-model-client/src/defaultModelClient.ts`

作用：按 provider 分发到具体 adapter，并在 adapter 不支持 embedding 时抛错。

### `MistralModelClient.embed()`

文件：`packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`

作用：取得 Mistral SDK client，调用 `runMistralEmbed()`，并套用 timeout。

### `mistralEmbed.ts`

文件：`packages/persona-flow-model-client/src/mistral/mistralEmbed.ts`

主要函数：

- `buildMistralEmbeddingRequest(model, inputs)`
  - 校验 model 和 inputs。
  - 返回 Mistral SDK 需要的 `{ model, inputs }`。
- `transformMistralEmbeddingResponse(response, expectedCount, requestedModel)`
  - 校验 response object、data array、数量一致。
  - 校验每个 embedding 是 finite number array。
  - 如果 provider 返回 index，校验 index 是唯一且在范围内，再按 index 排序。
  - 提取 model 和 usage。
- `runMistralEmbed(sdkClient, model, inputs)`
  - 构建 request。
  - 调 SDK `embeddings.create()`。
  - provider 抛错时包一层稳定错误前缀。
  - 转换 response。

真实 probe 结果：`mistral-embed` 返回 1024 维向量，中文短事实之间 baseline similarity 偏高，需要后续阈值校准。

## 手工 probe

### `mistral-embed-similarity-probe.mts`

文件：`packages/persona-flow-model-client/mistral-embed-similarity-probe.mts`

作用：真实调用 Mistral embedding，并把结果接到现有 memory similarity/decision policy。

读取 API key 顺序：

1. `apps/prompt-debug-cli/.apikey.yaml`
2. 根目录 `.apikey.yaml`
3. `MISTRAL_API_KEY` / `MODEL_API_KEY`
4. `apps/server/config/config.local.json` 中的 `models["mistral.ai"].apiKey`

运行：

```bash
pnpm tsx --conditions=source packages/persona-flow-model-client/mistral-embed-similarity-probe.mts
```

输出包括：

- keySource（不打印 key）
- returnedModel
- dim
- usage
- ranked similarity
- decision
- decisionWithoutClosest

## 测试覆盖

### persona-flow

- `packages/persona-flow/test/memoryTextNormalization.test.ts`
- `packages/persona-flow/test/memorySimilarity.test.ts`
- `packages/persona-flow/test/memoryDecisionPolicy.test.ts`
- `packages/persona-flow/test/modelClientEmbeddingProvider.test.ts`
- `packages/persona-flow/test/memoryCandidateRecorder.test.ts`
- `packages/persona-flow/test/memoryCommitService.test.ts`

### persona-flow-model-client

- `packages/persona-flow-model-client/test/mistralEmbed.test.ts`

### fake stores

文件：`packages/persona-flow/test/helpers/memoryFakes.ts`

提供测试用：

- in-memory candidate store
- in-memory memory store
- in-memory decision store
- fake embedding provider
- recording logger
- fixed clock
- sequential id generator

这些 fake stores 只用于 Step 4 测试，不代表 SQLite transaction 行为。

## 当前未完成事项

- active memories 还没有读回 prompt。
- 还没有 `memory_debug_events` 表和更细粒度的判定过程 API（Step 8 范围）。
- `createMemory + finalize` 的一致性边界仍记为已知 TODO；当前实现里两次写入不在同一 transaction，详见 `docs/todo.md`。
- `memory.embed` 模型在设置页的静态 availableModels 列表中需要保持可选，否则 effective assignment 可能不在下拉选项里。

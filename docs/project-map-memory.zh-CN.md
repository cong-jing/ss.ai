# Project Map - Memory 子系统

[返回项目地图](project-map.zh-CN.md)

本文档是 `docs/project-map.zh-CN.md` 拆出的 memory 子系统说明。主项目地图只保留 memory 的入口级介绍；这里记录 memory 写入链路的代码边界、配置入口、数据流、核心机制，以及当前已经完成和仍未完成的部分。

当前状态一句话：`single_character_chat` 可以在 structured output 中提交 `memoryWriteCandidates`，chat turn 持久化 assistant 回复后会把这些候选交给 `MemoryPipelineService`。默认配置下，系统会记录候选、生成 embedding、扫描同一用户与角色下的 active memories、做保守决策，并写入 `memory_candidates`、`memories`、`memory_decisions`。active memories 目前还不会回读进 prompt，因此现在是写入侧原型，不是完整 RAG 闭环。

## 代码边界

核心代码位于：

- `packages/persona-flow/src/memory/**`

这个目录是 memory 子系统的领域核心。它定义候选、记忆、决策、embedding、排序、日志和 store ports，不直接依赖 Express、SQLite SDK、Mistral SDK 或具体 HTTP API。

边界适配代码包括：

- `packages/persona-flow/src/memory/embedding/ModelClientMemoryEmbeddingProvider.ts`：把 memory 的 `MemoryEmbeddingProvider` 接到通用 `ModelClient.embed()`。
- `packages/persona-flow-sqlite/src/db/*Memory*.ts`：实现 memory candidates、active memories、decisions 的 SQLite store。
- `apps/server/src/http/apis/chat/chatUtil.ts`：创建 `PersonaFlowChatTurnService`，传入 stores、model client、logger 和 `memorySettings`。
- `apps/server/src/http/apis/memoryDebug.route.ts`：提供只读 debug 查询。

`apps/server` 是装配层。普通 chat 调用方不需要手动理解 recorder、processor、embedding provider 的细节；`PersonaFlowChatTurnService` 会用 `createMemoryPipelineService()` 在内部组装 memory 服务。

## 配置入口

服务端配置文件位于 `apps/server/config/*.json`，schema 位于 `apps/server/schemas/config.schema.json`，加载逻辑位于 `apps/server/src/util/config.ts`。

当前对外暴露的 memory 配置只有两个：

- `memory.enabled`
  - 类型：`boolean`
  - 默认：`true`
  - 作用：memory 总开关。为 `false` 时，`MemoryPipelineService` 会跳过本回合所有 memory 工作，不写 candidate，也不做后续处理；chat turn 仍正常完成。

- `memory.candidateProcessingMode`
  - 类型：`"inline" | "record_only"`
  - 默认：`"inline"`
  - `"inline"`：assistant turn 持久化后，在同一次 chat turn 内完成候选记录、embedding、相似度扫描、决策和写入。
  - `"record_only"`：只记录候选到 `memory_candidates`，不立即生成 embedding，也不创建 memory / decision。候选会保留为后续 worker、debug 工具或人工处理使用。

memory 日志不在 `memory` 配置段里单独开关，而是复用全局 `logger.level`：

- `logger.level = "debug"`：输出 memory pipeline 阶段事件、关键计数、policy 阈值和 decision reason，适合确认链路是否运行以及粗略观察判断结果。
- `logger.level = "verbose"`：额外输出 `memory.pipeline.retrieval_evidence`，包含候选文本、normalizedText、bucket、embedding 签名、ranking 阈值、扫描数量、跳过原因、top matches 和最终 decision，适合调 ranking / similarity 参数。

要在 `.runtime/logs/ss-ai.log` 看到 verbose evidence，可以设置：

```json
{
  "logger": {
    "level": "verbose"
  }
}
```

其余 memory 调参项目前不放进 server JSON，而是由 `packages/persona-flow/src/memory/settings.ts` 中的 `DEFAULT_MEMORY_SETTINGS` 提供：

- `ranking.listLimit`：每个候选最多读取多少条同 bucket active memories 用于扫描。
- `ranking.topK`：决策摘要中保留多少条相似 memory。
- `ranking.needsJudgeThreshold`：高于该相似度时进入 `needs_judge`，避免直接创建可能重复的 memory。
- `ranking.exactDuplicateThreshold`：embedding 相似度达到更高阈值时仍进入 `needs_judge`，不会自动丢弃。
- `embedding.version`：embedding 签名版本。文本预处理、包装方式或归一化策略变化时可提升版本，避免旧向量和新向量混比。
embedding 使用的模型不是 `memory` 配置项，而是 model assignment 体系的一部分：

- 固定 purpose：`memory.embed`
- 默认配置：`defaultModelAssignments["memory.embed"]`
- 用户覆盖：user preferences 中的 `modelAssignments["memory.embed"]`
- 可选模型列表：`models[provider].availableModels.embed`
- API key 解析：用户 credential 优先，其次 `models[provider].apiKey`

配置传入路径是：

`loadRuntimeConfig()` -> `RuntimeConfig.memory` -> `createChatTurnService()` -> `PersonaFlowChatTurnService.memorySettings` -> `createMemoryPipelineService()` -> `MemoryPipelineService` / `MemoryCandidateProcessor` / `MemoryPipelineLogger` / `ModelClientMemoryEmbeddingProvider`。

## Chat 到 Memory 的数据流

`single_character_chat` 的 model call 要求模型返回结构化 JSON。这个 JSON 包含可见回复事件，也可以包含顶层 `memoryWriteCandidates`。

非流式和流式 chat 都遵循同一个最终处理点：模型输出被解析为 `parsedOutput` 后，`PersonaFlowChatTurnService` 先持久化 user message 和 assistant turn，再把 `parsedOutput.memoryWriteCandidates` 交给 memory 服务。memory 候选不是可见回复，也不会参与 streaming preview；streaming preview 只来自 `replyText` 和已经完成解析的 turn events。

memory 服务收到的数据包括：

- `MemoryCandidateSource`：user、character、conversation、user message、assistant message、request id、model-call purpose。
- `MemoryCandidateDraft[]`：模型提交的候选，字段来自 contracts 里的 `MemoryWriteCandidate`，包括 text、scope、type、relatedEntities、tags、reason 等。

`MemoryPipelineService.handleChatTurnCandidates()` 会先检查 `memory.enabled` 和候选数量。真正运行时先由 `MemoryCandidateRecorder` 写入候选，再按 `memory.candidateProcessingMode` 决定是否立即交给 `MemoryCandidateProcessor`。

`MemoryCandidateProcessor` 的核心处理链路是：低价值过滤、精确 normalized text 去重、embedding、同 bucket active memories 扫描、cosine similarity 排序、保守决策、创建 memory 或记录需要人工判断的 decision。每个候选都有独立错误隔离，一个候选失败不会中断其他候选，也不会让 chat turn 失败。

## 目录结构

- `MemoryPipelineService.ts`
  - memory 子系统的顶层入口，负责开关、模式选择、候选记录和处理器调用。

- `createMemoryPipelineService.ts`
  - 从 `stores`、`modelClient`、settings、默认 model assignments 和 logger 组装完整 memory 服务。

- `settings.ts`
  - 定义 `MemorySettings` 和 `DEFAULT_MEMORY_SETTINGS`。

- `types.ts`
  - 定义跨阶段共享的 `MemoryCandidateSource`、clock、id generator、logger 等基础类型。

- `candidate/`
  - `candidateTypes.ts`：candidate draft / record / status。
  - `candidatePorts.ts`：candidate store port。
  - `MemoryCandidateRecorder.ts`：trim、normalization、候选落库、store failure fail-soft。
  - `textNormalization.ts`：用于精确去重的稳定文本 key。

- `embedding/`
  - `embeddingPorts.ts`：embedding provider port 和 embedding 签名类型。
  - `MemoryEmbeddingStep.ts`：包装 embedding 调用和日志。
  - `ModelClientMemoryEmbeddingProvider.ts`：把 `memory.embed` 解析到 `ModelClient.embed()`。

- `duplicate/`
  - `exactDuplicateStep.ts`：按 user、character、scope、type、normalizedText 做精确重复检查。

- `ranking/`
  - `similarity.ts`：cosine similarity、embedding signature 比较、skip 计数工具。
  - `rankSimilarMemories.ts`：按相似度排序 active memories，并返回跳过原因统计。

- `decision/`
  - `decisionPorts.ts`：decision store port、decision record、similarity summary 类型。
  - `decisionPolicy.ts`：低价值判断和相似度决策策略。
  - `MemoryDecisionRecorder.ts`：统一写 candidate status 和 decision row。

- `processing/`
  - `MemoryCandidateProcessor.ts`：处理已记录候选，产出 memory 或 decision。
  - `processingTypes.ts`：processor 输入输出类型。

- `logging/`
  - `memoryPipelineLogEvents.ts`：memory pipeline 日志事件名。
  - `MemoryPipelineLogger.ts`：集中控制日志等级、payload 和候选文本输出开关。

- `stores/`
  - `activeMemoryStorePort.ts`：active memory store port 和 record shape。

## 核心机制

### 候选记录

`MemoryCandidateRecorder` 只负责候选层面的结构化处理：过滤空文本、生成 `normalizedText`、调用 candidate store、返回实际写入的 records。它不判断低价值、不做 embedding、不决定是否创建 memory。

candidate store 异常会被吞掉并记录到结果中的 `storeError`。`MemoryPipelineService` 会把这种情况记录为 pipeline failure，但不会向 chat turn 抛错。

### 文本归一化

`normalizeMemoryText()` 用于生成精确去重 key，不是展示文本，也不是语义相似度算法。它会做 Unicode NFKC、常见空白和引号折叠、小写化、空白合并和 trim。

### Embedding 与模型解析

`ModelClientMemoryEmbeddingProvider` 使用固定 purpose `memory.embed` 解析模型。解析顺序是用户 assignment 优先，默认 assignment 兜底；API key 也是用户 credential 优先，server config 的 provider key 兜底。

返回的 embedding 会携带 `provider + model + dim + version` 签名。相似度比较时签名必须匹配，否则该 memory 会被跳过，避免把不同 embedding 空间里的向量直接比较。

### 相似度排序和保守决策

`rankSimilarMemories()` 对同 bucket active memories 做 cosine similarity 排序，并统计跳过原因：没有 embedding、签名不匹配、维度损坏、相似度非 finite。

`decideBySimilarity()` 当前只会在语义相似度层面返回 `create` 或 `needs_judge`。即使相似度达到 `exactDuplicateThreshold`，也不会自动 `ignore_duplicate`。自动忽略只发生在 normalized text 精确相同的情况下。

这个策略刻意偏保守：低置信度时宁可创建或等待人工判断，也不因为 embedding 相似而直接丢弃可能真实的新信息。

### Character 绑定

每条 memory 都绑定到一个明确的 `characterId`。`scope` 只是在同一 character 世界内部分类，不会让 memory 跨 character 共享。

active memory 查询 bucket 使用：`userId + characterId + scope + type`。精确去重还会加上 `normalizedText`。

### 日志

memory 日志集中在 `packages/persona-flow/src/memory/logging/**`。阶段代码只调用 `MemoryPipelineLogger` 的命名方法，不直接拼事件名。

当前日志覆盖 pipeline start / skip / complete / failure、候选记录、候选处理、低价值过滤、精确重复、embedding、active memory 扫描、相似度排序、签名不匹配、检索证据、决策、memory 创建和 decision 记录。

`memory.pipeline.retrieval_evidence` 是调参时最重要的事件：它把一次候选处理的检索依据放在同一个 payload 中，避免只看到一串 id 却不知道 similarity、阈值和匹配文本。这个事件只走 `verbose`，因此默认 `info` / `debug` 日志不会写入完整文本证据。

## 已完成

- `single_character_chat` structured output 支持 `memoryWriteCandidates`。
- chat turn 持久化 assistant turn 后会触发 memory 写入链路。
- `memory.enabled` 和 `memory.candidateProcessingMode` 已接入 server runtime config。
- memory 服务由 `PersonaFlowChatTurnService` 内部组装，外部调用方只传 stores、model client 和 settings。
- candidate / active memory / decision 的领域类型、store ports 和 SQLite stores 已存在。
- candidate 记录、文本归一化、精确去重、低价值过滤、embedding、相似度排序、保守决策已实现。
- `memory.embed` 已接入 model assignment 和 `ModelClient.embed()`。
- debug API 可以只读查询 candidates、active memories 和 decisions。
- memory pipeline 采用 fail-soft：memory 异常不会导致 chat turn 失败。
- 关键单元测试和 chat turn 集成测试已覆盖当前写入链路。

## 未完成

- active memories 尚未回读进 prompt，当前不是完整 RAG 闭环。
- `record_only` 只负责留下 pending candidates，还没有后台 worker 或队列消费者。
- 还没有 LLM judge、人工审核 UI、merge / update memory 策略。
- `memory.summarize` purpose 已声明，但 memory 摘要链路尚未实现。
- `createMemory + candidate status + decision` 还没有跨 store 的事务一致性保证。
- 还没有 `memory_debug_events` 表，也没有面向 UI 的细粒度判定过程查询。
- ranking 阈值仍需要更多真实样本校准，尤其是短中文事实的 baseline similarity。
- memory 的 ranking、embedding version 等调参项目前仍是代码默认值，还没有迁移到用户偏好或管理 UI。

# Memory Pipeline 重构计划

> **本计划已有后续修正**：在第一轮重构落地后又收束了命名、目录和配置边界，详见 [memory-pipeline-refactor-adjustment.zh-CN.md](memory-pipeline-refactor-adjustment.zh-CN.md)。下文保留作为历史计划，最终目录结构（`packages/persona-flow/src/memory/**` 一层 barrel，`memoryPipeline/` 已经被压平）、配置字段（仅 `memory.enabled` + `memory.candidateProcessingMode`）以及 ChatTurnService 默认 settings 行为以 adjustment 文档为准。

本文档记录 memory 写入链路的结构重构方案。目标不是增加新功能，而是让调用关系和文件组织更容易理解：外部只看到一个 memory pipeline，memory 内部按执行步骤组织。

当前项目尚未开始部署运行，因此本次重构不需要兼容旧的 `PersonaFlowChatTurnService.memory = { recorder, commitService, config }` 注入形态，可以直接调整公开构造参数和文件结构。

## 背景问题

当前 memory 写入链路已经能从 `single_character_chat` 的 structured output 中接收 `memoryWriteCandidates`，并完成 candidate 记录、embedding、相似度扫描、保守 decision 和 active memory 写入。

但结构上有几个理解成本：

- `apps/server/src/http/apis/chat/chatUtil.ts` 需要手动 new `ModelClientEmbeddingProvider`、`MemoryCandidateRecorder`、`MemoryCommitService`，HTTP 层知道了 memory pipeline 的内部步骤。
- `PersonaFlowChatTurnServiceDependencies` 外部依赖已经不少，memory 又额外暴露了 recorder / commit service，调用方要理解的对象过多。
- `MemoryCandidateRecorder` 和 `MemoryCommitService` 命名不对等：前者像一步，后者其实包含 low-value、exact duplicate、embedding、ranking、decision、create memory 等多步。
- `packages/persona-flow/src/memory/ports.ts` 把不同阶段的端口聚在一起，读代码时不容易看出哪个接口属于哪个执行步骤。
- memory 判断过程需要更完整、更统一的结构化日志，方便未来调 prompt、ranking 参数和 decision policy。

## 设计目标

- `apps/server` 不再理解 memory 内部步骤，只提供已有基础依赖：`stores`、`modelClient`、`defaultModelAssignments`、`defaultProviderApiKeys`、`logger` 和 memory settings。
- `PersonaFlowChatTurnService` 只持有一个高层 `MemoryPipelineService`，不直接调用 recorder / processor / embedding step。
- memory 文件夹从命名上突出 pipeline 概念，按执行流程组织代码边界。
- candidate 记录和 candidate 后处理是两个明确阶段。后处理未来可以移到后台 worker，不阻塞本次对话。
- memory settings 与 `ModelAssignments` 类似，作为运行时参数传入，后续可以允许用户修改 threshold、topK、rank limit 等。
- memory 内部日志集中管理，每个阶段都有可追踪的 debug event。

## 目标调用关系

目标上，server 只创建 chat turn service：

```ts
return new PersonaFlowChatTurnService({
    stores: context.stores,
    logger: context.logger,
    promptLogger,
    defaultModelAssignments: context.config.defaultModelAssignments,
    defaultProviderApiKeys,
    modelClient,
    memoryPipeline: context.config.memoryPipeline,
});
```

`PersonaFlowChatTurnService` 内部创建或持有 pipeline：

```ts
this.memoryPipelineService = new MemoryPipelineService({
    stores: deps.stores,
    modelClient: deps.modelClient,
    defaultModelAssignments: deps.defaultModelAssignments,
    defaultProviderApiKeys: deps.defaultProviderApiKeys,
    logger: deps.logger,
    settings: deps.memoryPipeline,
});
```

chat turn 完成 assistant persistence 后，只调用一个入口：

```ts
await this.memoryPipelineService.handleChatTurnCandidates({
    source: {
        userId,
        characterId,
        conversationId,
        userMessageId,
        assistantMessageId,
        requestId,
        modelCallPurpose: "chat.main",
    },
    candidates: chatResult.memoryWriteCandidates,
});
```

chat 层只知道“本次 turn 产生了候选记忆”，不关心后续是立即处理、只记录、还是交给后台 worker。

## 目标目录结构

建议将 `packages/persona-flow/src/memory` 重组为：

```text
packages/persona-flow/src/memory/
  index.ts

  memoryPipeline/
    MemoryPipelineService.ts
    createMemoryPipelineService.ts
    memoryPipelineSettings.ts
    memoryPipelineTypes.ts

    candidate/
      MemoryCandidateRecorder.ts
      candidatePorts.ts
      textNormalization.ts

    processing/
      MemoryCandidateProcessor.ts
      processingTypes.ts

    embedding/
      MemoryEmbeddingStep.ts
      ModelClientMemoryEmbeddingProvider.ts
      embeddingPorts.ts

    duplicate/
      exactDuplicateStep.ts

    ranking/
      similarity.ts
      rankSimilarMemories.ts

    decision/
      decisionPolicy.ts
      MemoryDecisionRecorder.ts
      decisionPorts.ts

    logging/
      MemoryPipelineLogger.ts
      memoryPipelineLogEvents.ts

    stores/
      memoryCandidateStorePort.ts
      activeMemoryStorePort.ts
      memoryDecisionStorePort.ts
```

说明：

- `memoryPipeline/MemoryPipelineService.ts` 是主入口，体现“这是一个 pipeline”。
- `candidate/` 只负责从 chat turn 输出中接收 candidates、过滤结构性空值、normalize、写入 candidate store。
- `processing/` 负责处理已记录的 candidates，可以 inline 执行，也可以未来被 worker 调用。
- `embedding/` 负责把 memory core 的 embedding 需求接到 `ModelClient`，并保留 `memory.embed` 模型分配解析。
- `ranking/` 只放 similarity 和排序逻辑。
- `decision/` 放 policy 和 decision row 写入。
- `logging/` 集中管理 memory pipeline 的结构化日志事件。
- `stores/` 拆分原 `ports.ts` 中的 store 端口，让每类 store 的边界更清楚。

## Pipeline 阶段

### Stage 1: handle chat-turn candidates

入口：`MemoryPipelineService.handleChatTurnCandidates(...)`

职责：

- 检查 `settings.enabled`。
- 记录 batch-level start / skipped 日志。
- 调用 candidate recorder。
- 根据 `settings.processingMode` 决定是否立即处理。

### Stage 2: record candidates

入口：`MemoryCandidateRecorder.recordCandidates(...)`

职责：

- 丢弃 text 为空或 trim 后为空的 candidate。
- 生成 normalized text。
- 保存 `memory_candidates`。
- 返回已保存的 candidate records。

这个阶段应该尽量便宜，并且适合跟 chat turn 同步执行。

### Stage 3: process candidates

入口：`MemoryCandidateProcessor.processCandidates(...)`

职责：

- 对每个 candidate 独立处理，单个 candidate 失败不影响其他 candidate。
- 执行 low-value 判断。
- 执行 exact normalized-text duplicate 判断。
- 调用 embedding step。
- 查询同 bucket active memories。
- 调用 ranking。
- 调用 decision policy。
- 根据 decision 创建 active memory 或标记为 `needs_judge` / ignored / failed。
- 写入 decision row。

这个阶段未来可以移出 chat 请求线程，作为 worker 消费 pending candidates。

### Stage 4: ranking and decision

职责：

- `ranking/` 只负责“相似度计算和排序”，不做业务 decision。
- `decision/decisionPolicy.ts` 只负责从 ranked memories + thresholds 得到 decision。
- decision row 写入由 `MemoryDecisionRecorder` 负责，避免 processor 里塞满持久化细节。

## Settings 设计

当前不需要兼容旧的 `MemoryFeatureConfig`。建议直接升级为：

```ts
export interface MemoryPipelineSettings {
    enabled: boolean;
    processingMode: "inline" | "record_only";
    ranking: {
        listLimit: number;
        topK: number;
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
    };
    embedding: {
        modelCallPurpose: "memory.embed";
        version: number;
    };
    logging: {
        detailLevel: "summary" | "debug";
        includeCandidateText: boolean;
    };
}
```

建议默认值：

```ts
export const DEFAULT_MEMORY_PIPELINE_SETTINGS: MemoryPipelineSettings = {
    enabled: true,
    processingMode: "inline",
    ranking: {
        listLimit: 500,
        topK: 10,
        needsJudgeThreshold: 0.80,
        exactDuplicateThreshold: 0.95,
    },
    embedding: {
        modelCallPurpose: "memory.embed",
        version: 1,
    },
    logging: {
        detailLevel: "debug",
        includeCandidateText: false,
    },
};
```

`processingMode` 替代旧的 `immediateCommitEnabled`：

- `inline`: chat turn 保存 candidate 后立即处理 candidate。
- `record_only`: 只保存 candidate，后续由 debug 工具、人工 judge 或后台 worker 处理。

## 日志设计

memory pipeline 的日志代码放在：

```text
packages/persona-flow/src/memory/memoryPipeline/logging/
```

建议提供 `MemoryPipelineLogger`，隐藏具体 log event 字符串：

```ts
logger.pipelineStarted(...)
logger.pipelineSkipped(...)
logger.candidatesRecorded(...)
logger.candidateProcessingStarted(...)
logger.lowValueRejected(...)
logger.exactDuplicateFound(...)
logger.embeddingRequested(...)
logger.embeddingCompleted(...)
logger.embeddingFailed(...)
logger.activeMemoriesFetched(...)
logger.similarityRanked(...)
logger.decisionMade(...)
logger.memoryCreated(...)
logger.decisionRecorded(...)
logger.candidateProcessingFailed(...)
logger.pipelineCompleted(...)
```

每条日志尽量带稳定字段：

- `requestId`
- `userId`
- `characterId`
- `conversationId`
- `assistantMessageId`
- `candidateId`
- `scope`
- `type`
- `stage`
- `decision`
- `reason`
- `topSimilarity`
- `thresholds`
- `rankedCount`
- `skippedCount`
- `provider`
- `model`
- `embeddingDim`
- `durationMs`

`candidate.text` 默认不写入日志。调试 prompt 时可以通过 `settings.logging.includeCandidateText = true` 打开。

## 实施步骤

### Step 1: 引入 MemoryPipelineService 壳

- 新建 `memory/memoryPipeline/MemoryPipelineService.ts`。
- 将 `safeHandleMemoryWriteCandidates` 中 memory 相关逻辑迁移到 `MemoryPipelineService.handleChatTurnCandidates()`。
- `PersonaFlowChatTurnService` 只调用 pipeline service。
- 删除 `PersonaFlowChatTurnMemoryDeps` 中 recorder / commitService 直接注入形态。

验收：

- chat turn 仍然能保存 assistant message。
- memory candidate 仍然能写入。
- memory pipeline disabled 时只跳过 pipeline，不影响 chat。

### Step 2: 把 server 装配收敛到 ChatTurnService 内

- 从 `apps/server/src/http/apis/chat/chatUtil.ts` 删除 `MemoryCandidateRecorder`、`MemoryCommitService`、`ModelClientEmbeddingProvider` 的手动 new。
- `chatUtil.ts` 只传 `context.config.memoryPipeline`。
- `PersonaFlowChatTurnService` 或 `createMemoryPipelineService()` 根据已有 `stores` / `modelClient` / assignments / api keys 创建内部 pipeline 依赖。

验收：

- server 层不再 import memory recorder / processor / embedding provider。
- server 仍然可以通过 config 控制 memory pipeline。

### Step 3: 重命名 settings

- `featureConfig.ts` 改为 `memoryPipelineSettings.ts`。
- `RuntimeConfig.memory` 改为 `RuntimeConfig.memoryPipeline`，或保留配置文件字段名 `memory` 但代码内部统一叫 `memoryPipelineSettings`。
- 去掉 `immediateCommitEnabled`，改为 `processingMode`。
- 将 ranking thresholds、topK、listLimit、embedding version 纳入 settings。

验收：

- config schema 能校验新字段。
- 默认配置明确展示 memory pipeline 的主要可调参数。

### Step 4: 按 pipeline 目录移动现有代码

只移动和改 import，不改行为：

- `candidateRecorder.ts` -> `memoryPipeline/candidate/MemoryCandidateRecorder.ts`
- `commitService.ts` -> `memoryPipeline/processing/MemoryCandidateProcessor.ts`
- `decisionPolicy.ts` -> `memoryPipeline/decision/decisionPolicy.ts`
- `similarity.ts` -> `memoryPipeline/ranking/similarity.ts`
- `textNormalization.ts` -> `memoryPipeline/candidate/textNormalization.ts`
- `memoryAdapters/modelClientEmbeddingProvider.ts` -> `memoryPipeline/embedding/ModelClientMemoryEmbeddingProvider.ts`

验收：

- `packages/persona-flow/src/memory/index.ts` 继续作为统一导出入口。
- 测试路径和 import 更新后全部通过。

### Step 5: 拆分 ports

将原 `ports.ts` 拆到对应目录：

- candidate store port -> `candidate/candidatePorts.ts`
- active memory store port -> `stores/activeMemoryStorePort.ts`
- decision store port -> `decision/decisionPorts.ts`
- embedding provider port -> `embedding/embeddingPorts.ts`
- clock / id / logger 等共用依赖 -> `memoryPipelineTypes.ts`

验收：

- 每个阶段文件只 import 自己需要的 port。
- `AppStores` 仍然聚合具体 store，但 memory pipeline 内部不再依赖单一大 `ports.ts`。

### Step 6: 拆开 processor 内部步骤

把当前 `commitOne()` 拆为小函数或 step class：

- low-value assessment
- exact duplicate lookup
- embedding candidate
- fetch active memories
- rank active memories
- decide candidate
- create active memory
- record decision

验收：

- 每个分支都有独立单元测试。
- processor 主流程能一眼看出 pipeline 顺序。

### Step 7: 集中日志

- 新建 `logging/MemoryPipelineLogger.ts`。
- 把散落的 memory log event 字符串集中到 `logging/memoryPipelineLogEvents.ts`。
- 为每个 pipeline stage 增加结构化 debug log。
- 通过 settings 控制是否包含 candidate text。

验收：

- 一条带 memory candidates 的 chat turn，在 debug log 中可以完整追踪：record -> process -> embed -> rank -> decide -> persist。
- 不需要读代码也能从日志看出 candidate 为什么被 create / ignored / needs_judge / failed。

### Step 8: 为后台处理预留入口

- `MemoryPipelineService` 暴露 `processPendingCandidates(...)` 或 `processCandidates(...)`。
- `handleChatTurnCandidates()` 在 `processingMode = "inline"` 时调用它。
- `processingMode = "record_only"` 时只保存 pending candidates。

验收：

- chat turn 不依赖 processor 是否立即运行。
- 后续 worker 可以复用同一 processor，不需要复制 memory 判断逻辑。

## 测试建议

- `persona-flow` 单元测试覆盖 pipeline settings、candidate recorder、processor 分支、logging event shape。
- `persona-flow` integration test 覆盖 `PersonaFlowChatTurnService` 只通过 `MemoryPipelineService` 入口处理 candidates。
- `server` 测试覆盖 `chatUtil.ts` 不再装配 memory 内部对象，config 能正确传入 chat turn service。
- `sqlite` 测试保持 store 行为不变。

建议每个阶段至少跑：

```bash
pnpm --filter @ss-ai/persona-flow typecheck
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/server typecheck
pnpm --filter @ss-ai/server test
pnpm --filter @ss-ai/persona-flow-sqlite test
```

## 预期结果

重构完成后，读代码的人应该能从文件组织直接看出：

- chat turn 只把 candidates 交给 memory pipeline。
- candidate 记录是第一阶段。
- candidate 后处理是可同步、也可后台化的第二阶段。
- embedding、ranking、decision 是后处理里的明确步骤。
- store ports、算法、日志都跟随所属步骤放置。
- server 层不再知道 memory pipeline 的内部构成。

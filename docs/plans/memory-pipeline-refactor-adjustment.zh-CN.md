# Memory Pipeline 重构调整计划

本文档是 `memory-pipeline-refactor.zh-CN.md` 的后续修正版，记录当前重构中需要收束的命名、目录和配置边界。

核心判断：**系统仍然叫 memory，pipeline 只是 memory 内部的执行方式**。因此代码可以保留 `MemoryPipelineService` 这类类名，但文件夹和外部配置不需要再多包一层 `memoryPipeline` 概念。

## 当前问题

当前重构已经把 server 对 memory 内部步骤的理解减少了，但产生了新的结构成本：

- 目录变成 `packages/persona-flow/src/memory/memoryPipeline/**`，形成了 `memory` 下面再套一个完整 `memoryPipeline` 子系统的感觉。
- `packages/persona-flow/src/memory/index.ts` 和 `packages/persona-flow/src/memory/memoryPipeline/index.ts` 形成两层 barrel，导出路径变长，维护时容易忘记同步。
- 配置字段从 `memory` 改成了 `memoryPipeline`，但产品和系统概念仍然是 memory。
- `memoryPipeline.embedding.modelCallPurpose` 暂时暴露到 config 中，但实际 embedding provider 仍固定解析 `"memory.embed"`，导致配置项看起来可调、实际不可调，也引入了 literal type 问题。
- `PersonaFlowChatTurnService` 的 `memoryPipelineSettings` 变成必填后，许多普通 chat turn 测试需要理解 memory 默认配置，和“外部少理解 memory”的目标有冲突。

## 调整原则

- 外部概念统一叫 `memory`。
- 内部执行入口可以叫 `MemoryPipelineService`，因为它描述 memory 的执行形态。
- `src/memory/` 本身就是 memory pipeline 的根，不再保留 `src/memory/memoryPipeline/`。
- 配置文件暂时只保留稳定、必要的 memory 开关；ranking、threshold、embedding version、logging detail 先使用代码默认值。
- `PersonaFlowChatTurnService` 可以默认创建 memory pipeline，不要求普通调用方显式传 memory settings。
- model assignment 仍使用现有 `defaultModelAssignments["memory.embed"]` 和用户偏好中的 `"memory.embed"`，不改变 `availableModels` 或 provider/model 分配机制。

## 目标目录结构

将当前：

```text
packages/persona-flow/src/memory/
  index.ts
  memoryPipeline/
    index.ts
    MemoryPipelineService.ts
    createMemoryPipelineService.ts
    memoryPipelineSettings.ts
    memoryPipelineTypes.ts
    candidate/
    processing/
    embedding/
    duplicate/
    ranking/
    decision/
    logging/
    stores/
```

调整为：

```text
packages/persona-flow/src/memory/
  index.ts
  MemoryPipelineService.ts
  createMemoryPipelineService.ts
  settings.ts
  types.ts
  candidate/
  processing/
  embedding/
  duplicate/
  ranking/
  decision/
  logging/
  stores/
```

说明：

- `index.ts` 是唯一 memory barrel。
- `MemoryPipelineService.ts` 是 memory 写入 pipeline 的主入口。
- `settings.ts` 放 `MemorySettings` / `DEFAULT_MEMORY_SETTINGS`。
- `types.ts` 放跨阶段共享类型，例如 `MemoryCandidateSource`、`MemoryClock`、`MemoryIdGenerator`、`MemoryLogger`、`MEMORY_SCHEMA_VERSION`。
- `candidate/`、`processing/`、`embedding/`、`ranking/` 等目录仍按执行步骤组织。

## 配置边界

### 外部配置名

server runtime config 对外仍使用：

```ts
RuntimeConfig.memory
```

server JSON config 也使用：

```json
{
  "memory": {
    "enabled": true,
    "candidateProcessingMode": "inline"
  }
}
```

不要使用：

```json
{
  "memoryPipeline": {}
}
```

### 当前先不放进配置文件的项

以下先放在代码默认值里，不进入 `config.default.json` / `config.schema.json`：

- `ranking.listLimit`
- `ranking.topK`
- `ranking.needsJudgeThreshold`
- `ranking.exactDuplicateThreshold`
- `embedding.modelCallPurpose`
- `embedding.version`
- `logging.detailLevel`
- `logging.includeCandidateText`

理由：

- 这些参数后续很可能会进入用户 preference 或管理界面，而不一定适合 server config。
- 当前还没有真实数据调参结果，过早暴露会让配置面变复杂。
- `embedding.modelCallPurpose` 当前实际上固定为 `"memory.embed"`，先不要伪装成可配置项。

### 代码默认配置

建议在 `packages/persona-flow/src/memory/settings.ts` 中保留完整默认值：

```ts
export interface MemorySettings {
    enabled: boolean;
    candidateProcessingMode: "inline" | "record_only";
    ranking: {
        listLimit: number;
        topK: number;
        needsJudgeThreshold: number;
        exactDuplicateThreshold: number;
    };
    embedding: {
        version: number;
    };
    logging: {
        detailLevel: "summary" | "debug";
        includeCandidateText: boolean;
    };
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
    enabled: true,
    candidateProcessingMode: "inline",
    ranking: {
        listLimit: 500,
        topK: 10,
        needsJudgeThreshold: 0.80,
        exactDuplicateThreshold: 0.95,
    },
    embedding: {
        version: 1,
    },
    logging: {
        detailLevel: "debug",
        includeCandidateText: false,
    },
};
```

`loadRuntimeConfig()` 只 merge 少量外部字段：

```ts
memory: {
    ...DEFAULT_MEMORY_SETTINGS,
    enabled: fileConfig.memory?.enabled ?? DEFAULT_MEMORY_SETTINGS.enabled,
    candidateProcessingMode: fileConfig.memory?.candidateProcessingMode ?? DEFAULT_MEMORY_SETTINGS.candidateProcessingMode,
}
```

如果后续要开放 ranking / logging 参数，再在单独 step 中更新 schema、UI 或 preference。

## ChatTurnService 构造参数

当前 `PersonaFlowChatTurnServiceDependencies` 不应要求普通调用方一定传 `memoryPipelineSettings`。

建议改为：

```ts
export interface PersonaFlowChatTurnServiceDependencies {
    stores: AppStores;
    logger?: PersonaFlowLogger;
    promptLogger: PersonaFlowPromptLogger;
    modelClient: ModelClient;
    defaultModelAssignments?: ModelAssignmentMap;
    defaultProviderApiKeys?: Record<string, string>;
    memorySettings?: MemorySettings;
    memoryPipelineService?: MemoryPipelineService;
}
```

constructor 中使用：

```ts
const memorySettings = deps.memorySettings ?? DEFAULT_MEMORY_SETTINGS;
this.memoryPipelineService = deps.memoryPipelineService ?? createMemoryPipelineService({
    stores: deps.stores,
    modelClient: deps.modelClient,
    settings: memorySettings,
    defaultModelAssignments: deps.defaultModelAssignments,
    defaultProviderApiKeys: deps.defaultProviderApiKeys,
    logger: this.logger,
});
```

这样：

- server 可以传 `context.config.memory`。
- tests 不关心 memory 时不用显式传。
- 需要测试 record-only / disabled / fake pipeline 时仍然可以传 `memorySettings` 或 `memoryPipelineService`。

## 需要同步修改的文件

### persona-flow

- `packages/persona-flow/src/memory/memoryPipeline/**`
  - 全部上移到 `packages/persona-flow/src/memory/**`。
- `packages/persona-flow/src/memory/index.ts`
  - 合并 `memoryPipeline/index.ts` 的导出。
  - 删除第二层 barrel。
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
  - `memoryPipelineSettings` 改为 `memorySettings?: MemorySettings`。
  - 默认使用 `DEFAULT_MEMORY_SETTINGS`。
- `packages/persona-flow/src/index.ts`
  - 保持 `export * from "./memory/index.js"`。
- `packages/persona-flow/test/**/*.ts`
  - 更新 import 路径。
  - 普通 chat turn service 测试不需要再传 memory settings。
  - memory integration 测试继续显式传 fake pipeline / custom settings。

### server

- `apps/server/src/util/config.ts`
  - `RuntimeConfig.memoryPipeline` 改回 `RuntimeConfig.memory`。
  - `RawConfig.memoryPipeline` 改回 `RawConfig.memory`。
  - 只解析 `enabled` / `candidateProcessingMode`。
  - 移除 `embedding.modelCallPurpose` 的 raw string 到 literal 赋值。
- `apps/server/config/config.default.json`
  - `memoryPipeline` 改回 `memory`。
  - 只保留当前要暴露的字段。
- `apps/server/schemas/config.schema.json`
  - `memoryPipeline` 改回 `memory`。
  - schema 只描述 `enabled` / `candidateProcessingMode`。
- `apps/server/src/http/apis/chat/chatUtil.ts`
  - `memoryPipelineSettings: context.config.memoryPipeline` 改为 `memorySettings: context.config.memory`。
- `apps/server/test/helpers/testServer.ts`
  - `memory: { enabled: true, immediateCommitEnabled: true }` 改为 `memory: { enabled: true, candidateProcessingMode: "inline" }`。

### docs

- `docs/project-map*.md`
  - 更新旧路径和旧类名。
  - 移除 `MemoryCommitService` 旧称，改为 `MemoryCandidateProcessor` / `MemoryPipelineService`。
- `docs/project-map-memory.zh-CN.md`
  - 更新当前实现说明：server 不再装配 recorder / processor / embedding provider，chat turn service 内部创建 memory pipeline。
- `docs/plans/memory-pipeline-refactor.zh-CN.md`
  - 可保留作为历史计划，但建议补一句“后续调整见本文件”。

## storeError 日志语义修正

这项和目录/配置无关，但应在同轮修掉。

当前 `MemoryCandidateRecorder.recordCandidates()` 在 store 写入失败时返回：

```ts
{ accepted: [], rejectedCount, storeError }
```

但 `MemoryPipelineService.handleChatTurnCandidates()` 忽略 `storeError`，继续记录 `candidatesRecorded` / `pipelineCompleted`，容易让日志误判为正常完成。

建议改为：

```ts
if (recordResult.storeError) {
    logger.candidatesRecordingFailed({
        ...baseFields,
        error: recordResult.storeError.message,
        attemptedCount: input.candidates.length,
    });
    logger.pipelineFailed({
        ...baseFields,
        error: recordResult.storeError.message,
        stage: "record",
    });
    return { recordedCount: 0 };
}
```

或者在 result 中增加：

```ts
failedStage?: "record" | "process";
```

验收标准：recorder store outage 不应被记录成 pipeline completed。

## 实施步骤

### Step 1: 移动目录并合并 barrel

- 把 `memory/memoryPipeline/*` 上移到 `memory/*`。
- 更新所有相对 import。
- 删除 `memory/memoryPipeline/index.ts`。
- 确认所有外部引用都走 `packages/persona-flow/src/memory/index.ts`。

### Step 2: 配置名改回 memory

- `RuntimeConfig.memoryPipeline` -> `RuntimeConfig.memory`。
- JSON config / schema 改回 `memory`。
- 只保留 `enabled` / `candidateProcessingMode`。
- 默认 ranking / embedding / logging 由 `DEFAULT_MEMORY_SETTINGS` 提供。

### Step 3: ChatTurnService 默认 settings

- `memoryPipelineSettings` 改为 `memorySettings?: MemorySettings`。
- 不传时使用默认配置。
- 清理普通测试里的必填参数。

### Step 4: 修正 storeError 日志语义

- `MemoryPipelineService` 显式处理 `recordResult.storeError`。
- 增加或更新测试，覆盖 candidate store append 失败时：
  - chat turn 不失败；
  - 不记录 pipeline completed；
  - 记录 candidates recording failed / pipeline failed。

### Step 5: 文档同步

- 更新 project-map 和 memory 子系统文档。
- 标注新目录结构。
- 保留 `MemoryPipelineService` 作为内部执行入口的说明。

## 验收命令

至少执行：

```bash
pnpm --filter @ss-ai/persona-flow typecheck
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/server typecheck
pnpm --filter @ss-ai/server test
pnpm --filter @ss-ai/persona-flow-sqlite typecheck
pnpm --filter @ss-ai/persona-flow-sqlite test
```

验收目标：

- `persona-flow typecheck` 不再因为普通 chat turn service 测试缺 memory settings 失败。
- `server typecheck` 不再出现 `string` 赋给 `"memory.embed"` 的 literal 错误。
- server config 中对外字段仍是 `memory`。
- `packages/persona-flow/src/memory/` 下不再有 `memoryPipeline/` 二级目录。
- memory pipeline 日志能区分 recorder store failure 和正常完成。

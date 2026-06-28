# Memory Write Batch 2/3 实现文档：独立 Memory 模块、候选存储与 SQLite Embedding 提交原型

本文档描述 Persona-flow 长期记忆写入机制 Batch 2/3 的合并实现方案。

Batch 1 已经让主聊天模型在 `submit_turn_events` 结构化输出中附带顶层 `memoryWriteCandidates` 字段，并在 assistant turn 保存后进行 log-only 记录。原本 Batch 2 只做候选存储，Batch 3 再做正式 memory commit；但这两个阶段边界不够清晰，因此本次合并为一个更完整的早期原型：

- 保存候选记忆和来源信息，方便 debug 与追踪。
- 建立正式 active memory 表。
- 为候选和 active memory 生成 embedding，并把向量保存在 SQLite。
- 在没有向量数据库的情况下，由应用层读取同范围 memory 并逐条计算相似度。
- 用保守规则自动创建明显的新记忆，把相似、冲突、复杂合并留给后续 judge。

这个阶段的重点不是一次性做出最终记忆系统，而是建立一个边界清楚、可替换、可观察的 memory 子系统。后续如果要抽成独立 package，应该尽量只移动目录和导出，不重写核心逻辑。

## 目标

Batch 2/3 的目标：

- 将每轮 chat turn 产生的 `memoryWriteCandidates` 保存为可查询的中间数据。
- 新增 active memory 存储，让系统可以真正创建长期记忆。
- 新增 memory decision 记录，保存每个 candidate 的处理结果。
- 新增 embedding 端口，把向量生成作为注入依赖，而不是让 memory 核心直接依赖 model call 或具体 provider。
- 在 SQLite 中保存 embedding，并用应用层 brute-force cosine similarity 做早期相似检索。
- 提供最小 debug API 查询 candidates、active memories、decision 与相似检索结果。
- 所有 memory 写入、embedding、commit 失败都必须 fail-soft，不影响聊天消息持久化和 API 响应。

完成后，系统可以自动把低风险候选提交成 active memory，但遇到相似、模糊、可能冲突的候选时只记录 `needs_judge`，不做复杂合并。

## 非目标

Batch 2/3 不做以下事情：

- 不引入外部向量数据库。
- 不要求 SQLite 原生支持向量索引。
- 不做复杂 LLM judge。
- 不自动改写、合并、纠错、归档已有 memory。
- 不把 active memory 读回 prompt。
- 不做 Web 管理 UI。
- 不把候选记忆返回给普通 chat API 调用方。
- 不让 memory 核心模块直接依赖 `chatTurn`、`modelCall`、Express route 或 SQLite 实现细节。

复杂语义判断进入下一阶段：LLM judge 或更强的检索层。

## 核心设计原则

### Memory 代码独立成目录

本次新增的核心 memory 代码放在：

- `packages/persona-flow/src/memory/**`

这个目录应被视为未来独立 package 的雏形。它可以定义 memory 领域类型、端口、算法、commit service 和纯工具函数，但应尽量避免引用其它 persona-flow 内部目录。

允许引用：

- TypeScript 标准能力。
- `@ss-ai/contracts` 中已经稳定的纯类型，例如 `MemoryScope`、`MemoryCandidateType`。
- 本目录内部文件。

尽量避免引用：

- `src/chatTurn/**`
- `src/modelCall/**`
- `src/llm/**`
- `src/stores/**` 中非 memory 的 store 类型
- `persona-flow-sqlite`
- Express/server 代码

如果必须和 chat turn、model runtime、SQLite 连接，连接代码放在边界层，不放进 memory 核心。

### 依赖用端口注入

Memory 核心只定义端口，不直接创建依赖。

主要注入依赖：

- `MemoryCandidateStore`: 保存和查询候选。
- `MemoryStore`: 保存和查询 active memory。
- `MemoryDecisionStore`: 保存 commit decision。
- `MemoryEmbeddingProvider`: 把文本转换为 embedding。
- `Clock`: 生成当前时间。
- `IdGenerator`: 生成 id。
- `Logger`: 可选，使用最小接口。

SQLite、model provider、server route 都是这些端口的外部实现。

### SQLite 只是存储，不是向量数据库

SQLite 中保存 embedding column，但相似度计算在应用层完成。

早期流程：

1. 读取 candidate embedding。
2. 按 user、character、scope、type 等条件过滤 active memories。
3. 取出这些 memory 的 embedding。
4. 在 TypeScript 中逐条计算 cosine similarity。
5. 排序取 topK。

当单个用户/角色的 active memory 只有几百到几千条时，这个复杂度可以接受。未来需要向量数据库时，只替换 retrieval 端口实现。

## 建议目录结构

```text
packages/persona-flow/src/memory/
    index.ts
    types.ts
    ports.ts
    candidateRecorder.ts
    commitService.ts
    similarity.ts
    textNormalization.ts
    decisionPolicy.ts
```

职责建议：

- `types.ts`: memory 领域类型，不引用 chat turn 或 model call。
- `ports.ts`: store、embedding、clock、id、logger 等端口。
- `candidateRecorder.ts`: 保存候选，负责来源信息与 candidate row 组装。
- `commitService.ts`: 从 pending candidate 到 active memory 的提交流程。
- `similarity.ts`: cosine similarity、topK、embedding 维度校验。
- `textNormalization.ts`: 文本标准化、精确重复 key。
- `decisionPolicy.ts`: 阈值和保守决策规则。
- `index.ts`: 导出外部需要的 memory API。

Chat turn 集成代码可以仍然在 `src/chatTurn/**`，但它只负责把 chat 上下文转换成 memory 模块的输入：

```ts
await memoryCandidateRecorder.recordCandidates({
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

注意：`memory/**` 不应知道 `PersonaFlowChatTurnService` 的存在。

## 数据模型

本批次建议新增 3 个必需表，外加 1 个可选 debug 表：

| 表 | 是否必需 | 作用 |
| --- | --- | --- |
| `memory_candidates` | 必需 | 保存模型从 chat turn 中提出的候选记忆、来源 message/request、candidate embedding 和处理状态。 |
| `memories` | 必需 | 保存已经提交成功的 active long-term memory，是后续相似比较的主要对象。 |
| `memory_decisions` | 必需 | 保存每个 candidate 的最终判定结果、原因、policy/config snapshot 和 topK 相似结果摘要。 |
| `memory_debug_events` | 可选 | 保存更细粒度的判定过程 trace，供日志调试和未来前端 debug 窗口使用。 |

流程中的表操作总览：

1. assistant turn 保存后，把 `memoryWriteCandidates` 写入 `memory_candidates`。
2. commit service 从刚写入的 candidate records 开始处理。
3. 对 candidate 生成 embedding，并回写 `memory_candidates.embedding*` 字段。
4. 从 `memories` 读取同 user/character/scope/type 的 active memories。
5. 只对 embedding metadata 兼容的 active memories 做相似度比较。
6. 根据规则决定 `create | ignore_duplicate | ignore_low_value | needs_judge | embedding_failed | error`。
7. 如果 decision 是 `create`，写入 `memories`。
8. 无论 create/ignore/needs_judge/error，都写入 `memory_decisions`，并更新 `memory_candidates.status`。
9. 如果启用 verbose debug persistence，每个关键阶段额外写入 `memory_debug_events`。

注意：相似比较的语料是 `memories` 表中的 active memories。`memory_decisions` 不参与相似比较，它只记录判断过程和结果。

### `memory_candidates`

候选表保存模型提出的原始候选和来源信息。

建议字段：

```ts
export const memoryCandidates = sqliteTable("memory_candidates", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    requestId: text("request_id").notNull(),
    modelCallPurpose: text("model_call_purpose").notNull(),
    seq: integer("seq").notNull(),
    scope: text("scope").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    reason: text("reason"),
    status: text("status").notNull().default("pending"),
    embeddingJson: text("embedding_json"),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDim: integer("embedding_dim"),
    embeddingVersion: integer("embedding_version"),
    embeddedAt: text("embedded_at"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});
```

`status` 建议值：

- `pending`: 已保存，等待 commit。
- `embedded`: 已生成 embedding，等待或准备 commit。
- `committed`: 已创建 active memory。
- `ignored_duplicate`: 精确重复或近似重复，已忽略。
- `ignored_low_value`: 规则判断价值太低。
- `needs_judge`: 有相似 memory 或复杂语义关系，需要后续 judge。
- `embedding_failed`: embedding 失败。
- `commit_failed`: commit 流程失败。

### `memories`

正式长期记忆表。

建议字段：

```ts
export const memories = sqliteTable("memories", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    scope: text("scope").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    sourceCandidateId: text("source_candidate_id"),
    sourceConversationId: text("source_conversation_id"),
    sourceUserMessageId: text("source_user_message_id"),
    sourceAssistantMessageId: text("source_assistant_message_id"),
    status: text("status").notNull().default("active"),
    importance: integer("importance").notNull().default(1),
    embeddingJson: text("embedding_json"),
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDim: integer("embedding_dim"),
    embeddingVersion: integer("embedding_version"),
    embeddedAt: text("embedded_at"),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});
```

每条 memory 都必须绑定一个 character 世界，因此 `characterId` 是 `NOT NULL`。`scope`（`user`、`character`、`relationship`、`conversation`、`world`）只用于在同一个 character 世界内部分类，不会让 memory 跨 character 共享。relationship/world 等 scope 第一版可以先通过 `relatedEntitiesJson` 表达关系，后续再拆更严格的 key。

`status` 第一版只需要：

- `active`
- `archived`

Batch 2/3 只创建 `active`，不自动 archive。

### `memory_decisions`

提交决策表保存每个 candidate 的处理过程。

建议字段：

```ts
export const memoryDecisions = sqliteTable("memory_decisions", {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    decision: text("decision").notNull(),
    memoryId: text("memory_id"),
    reason: text("reason"),
    similarityJson: text("similarity_json").notNull().default("[]"),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
});
```

`decision` 建议值：

- `create`
- `ignore_duplicate`
- `ignore_low_value`
- `needs_judge`
- `embedding_failed`
- `error`

`similarityJson` 保存 topK 相似结果，便于 debug：

```json
[
  { "memoryId": "mem1", "similarity": 0.91, "text": "用户不喜欢晚上喝咖啡。" }
]
```

## Memory 核心类型与端口

建议在 `packages/persona-flow/src/memory/types.ts` 定义领域类型。这里的类型不要直接使用 chat turn 的 message 类型。

```ts
export interface MemoryCandidateSource {
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    requestId: string;
    modelCallPurpose: string;
}

export interface MemoryCandidateDraft {
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    relatedEntities?: string[];
    tags?: string[];
    reason?: string;
}

export interface MemoryCandidateRecord extends MemoryCandidateDraft {
    id: string;
    source: MemoryCandidateSource;
    seq: number;
    normalizedText: string;
    status: MemoryCandidateStatus;
    embedding?: MemoryEmbedding;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface ActiveMemoryRecord {
    id: string;
    userId: string;
    characterId: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    text: string;
    normalizedText: string;
    relatedEntities: string[];
    tags: string[];
    sourceCandidateId?: string;
    sourceConversationId?: string;
    sourceUserMessageId?: string;
    sourceAssistantMessageId?: string;
    status: "active" | "archived";
    importance: number;
    embedding?: MemoryEmbedding;
    schemaVersion: number;
    createdAt: string;
    updatedAt: string;
}

export interface MemoryEmbedding {
    vector: number[];
    provider: string;
    model: string;
    dim: number;
    version: number;
    createdAt: string;
}
```

建议在 `ports.ts` 定义端口：

```ts
export interface MemoryCandidateStore {
    appendCandidates(input: AppendMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    listCandidates(input: ListMemoryCandidatesInput): Promise<MemoryCandidateRecord[]>;
    updateCandidateStatus(input: UpdateMemoryCandidateStatusInput): Promise<void>;
    saveCandidateEmbedding(input: SaveCandidateEmbeddingInput): Promise<void>;
}

export interface MemoryStore {
    createMemory(input: CreateMemoryInput): Promise<ActiveMemoryRecord>;
    listActiveMemories(input: ListActiveMemoriesInput): Promise<ActiveMemoryRecord[]>;
    findExactActiveMemory(input: FindExactActiveMemoryInput): Promise<ActiveMemoryRecord | undefined>;
    saveMemoryEmbedding(input: SaveMemoryEmbeddingInput): Promise<void>;
}

export interface MemoryDecisionStore {
    appendDecision(input: AppendMemoryDecisionInput): Promise<void>;
    listDecisions(input: ListMemoryDecisionsInput): Promise<MemoryDecisionRecord[]>;
}

export interface MemoryEmbeddingProvider {
    embed(input: MemoryEmbedInput): Promise<MemoryEmbedResult>;
}

export interface MemoryRuntimeDeps {
    candidateStore: MemoryCandidateStore;
    memoryStore: MemoryStore;
    decisionStore: MemoryDecisionStore;
    embeddingProvider: MemoryEmbeddingProvider;
    clock: { nowIso(): string };
    ids: { randomId(): string };
    logger?: {
        info(message: string, meta?: unknown): void;
        warn(message: string, meta?: unknown): void;
        error(message: string, meta?: unknown): void;
    };
}
```

### Embedding 注入方式

Memory 模块只知道 `MemoryEmbeddingProvider`，不关心 embedding 来自哪里。

第一版实现可以放在 persona-flow 的边界层，内部调用现有 model client 或新增 provider client：

```ts
export class ModelClientMemoryEmbeddingProvider implements MemoryEmbeddingProvider {
    async embed(input: MemoryEmbedInput): Promise<MemoryEmbedResult> {
        // 这里可以调用未来的 ModelClient.embed，也可以临时调用具体 provider。
        // 这个类在 memory 目录外，或者作为 adapter 放在 memory/adapters 且不被核心算法依赖。
    }
}
```

长期建议给 model-client 抽象补一个 embedding 能力：

```ts
export interface ModelClient {
    chat(input: ModelChatInput): Promise<ModelChatResult>;
    streamChat(input: ModelChatInput): AsyncIterable<ModelStreamEvent>;
    embed?(input: ModelEmbedInput): Promise<ModelEmbedResult>;
}
```

但 Batch 2/3 不强制一次性完成通用抽象。如果短期只支持一个 provider，也要把 provider-specific 代码包在 `MemoryEmbeddingProvider` adapter 后面。

Embedding 结果和所使用的 provider/model 强相关。不同 embedding 模型通常不能直接混用，即使维度相同，向量空间也不一定一致。因此 similarity 检索必须只比较同一 embedding 配置下生成的向量。

第一版规则：

- candidate embedding 和 memory embedding 的 `provider`、`model`、`dim`、`version` 必须一致才参与相似度比较。
- 如果 embedding 配置变化，旧 memory 不应该直接和新 candidate 比较。
- 配置变化后的处理策略可以先保守地跳过旧 embedding，并记录 debug log；后续再做批量 re-embed。
- `embeddingVersion` 用于表达本地预处理、prompt 包装、归一化策略等非模型因素的变化。只换这些策略也应该 bump version。

Embedding 配置本身需要进入可配置项，但不要求在 Batch 2/3 立刻做前端设置页。第一版可以使用 server config 或用户偏好中的隐藏配置，前端配置入口放入本批次 todo。

### Embedding model assignment

当前项目已经通过 `defaultModelAssignments` 给不同 model-call purpose 配置默认模型，例如：

```json
"defaultModelAssignments": {
    "chat.main": {
        "provider": "mistral.ai",
        "model": "mistral-small-latest"
    },
    "memory.summarize": {
        "provider": "mistral.ai",
        "model": "mistral-small-latest"
    }
}
```

Batch 2/3 建议沿用这个机制，新增一个明确 purpose：

```ts
export const MODEL_CALL_PURPOSES = [
    "chat.main",
    "memory.summarize",
    "memory.embed",
] as const;
```

默认配置示例：

```json
"defaultModelAssignments": {
    "chat.main": {
        "provider": "mistral.ai",
        "model": "mistral-small-latest"
    },
    "memory.summarize": {
        "provider": "mistral.ai",
        "model": "mistral-small-latest"
    },
    "memory.embed": {
        "provider": "mistral.ai",
        "model": "mistral-embed"
    }
}
```

需要同步修改：

- `packages/contracts/src/modelCallPurpose.ts`: 增加 `memory.embed`。
- `apps/server/schemas/config.schema.json`: `defaultModelAssignments.properties` 增加 `memory.embed`。
- `apps/server/config/config.default.json`: 增加 `memory.embed` 默认 assignment。
- 用户偏好相关 API/UI 会自动枚举 `MODEL_CALL_PURPOSES`，但显示文案可能需要补充。
- `MemoryEmbeddingProvider` 根据 `memory.embed` 解析 provider/model，而不是复用 `chat.main` 或 `memory.summarize`。

注意：embedding 模型和 chat completion 模型不是一类能力。`memory.embed` 指向的 model 必须是 provider 支持的 embedding model；如果 provider 的模型列表把 chat 和 embedding 混在同一个 `availableModels` 里，第一版可以先靠配置约定，后续再拆分 `availableChatModels` / `availableEmbeddingModels`。

## 提交流程

### 外部调用方行为

外部调用方不直接做相似度判断，也不直接读写 `memories` 或 `memory_decisions` 表。

对 chat turn 来说，memory pipeline 是一个边界服务：

```ts
const records = await memoryCandidateRecorder.recordCandidates(...);
await memoryCommitService.commitCandidates({ candidates: records });
```

第一版可以在写入 candidate 后立刻 fail-soft 调用 commit service，这样实现简单、测试直接、debug 反馈及时。但这个“立刻调用”只是调用策略，不是核心算法的一部分。后续如果要改成后台队列、定时任务或手动 debug 触发，外部调用方只需要改调度方式，不需要改 `MemoryCommitService`。

推荐第一版调用策略：

- 非 streaming `chatTurn()`: assistant turn 保存成功后，保存 candidates，然后同步 fail-soft commit。
- streaming `streamTurn()`: final assistant turn 保存成功后，保存 candidates，然后同步 fail-soft commit。
- 如果 commit 变慢，第二步再改成 background job，并把 candidate status 留在 `pending` / `embedded`。

相似比较的对象是 `memories` 表中的 active memories，不是 `memory_decisions` 表。`memory_decisions` 只保存判定过程和结果，用于审计、debug、调参和未来前端 debug 窗口展示。

### 保存候选

Chat turn 保存 assistant message 后，调用 memory recorder：

```ts
await memoryCandidateRecorder.recordCandidates({
    source,
    candidates: chatResult.memoryWriteCandidates,
});
```

行为要求：

- `candidates.length === 0` 时直接 return。
- 文本 trim 后为空的 candidate 丢弃。
- 每条 candidate 生成 `normalizedText`。
- 保存失败只 warn，不影响 chat response。
- 返回保存成功的 candidate records，供后续 commit 使用。

### Commit candidate

保存候选后，可以同步触发轻量 commit，也可以由后续 background job 处理。

第一版建议在 chat turn 结束后 fail-soft 同步执行，因为实现简单，便于测试：

```ts
const records = await memoryCandidateRecorder.recordCandidates(...);
await memoryCommitService.commitCandidates({
    userId,
    characterId,
    candidates: records,
});
```

`commitCandidates()` 内部逐条处理，单条失败不能影响其它 candidate。

单条流程：

1. 规则过滤低价值 candidate。
2. 查询精确重复 active memory。
3. 为 candidate 生成 embedding 并保存到 `memory_candidates`。
4. 查询同 user/scope/type/character 范围内的 active memories。
5. 过滤掉没有 embedding 或 embedding 维度不一致的 memory。
6. 应用层计算 cosine similarity，取 topK。
7. 根据阈值做保守决策。
8. 如果是明确新记忆，创建 active memory，并保存同一个 embedding。
9. 写入 decision 表并更新 candidate status。

相似检索只读取 active memory：

- include: `memories.status = "active"`。
- exclude: `memory_candidates` 中尚未提交的候选。
- exclude: `memory_decisions`，它不是检索语料，只是过程记录。

建议伪代码：

```ts
async commitCandidate(candidate: MemoryCandidateRecord): Promise<void> {
    if (isLowValueCandidate(candidate)) {
        await decide(candidate, "ignore_low_value", "low-value candidate");
        return;
    }

    const exact = await memoryStore.findExactActiveMemory({
        userId: candidate.source.userId,
        characterId: candidate.source.characterId,
        scope: candidate.scope,
        type: candidate.type,
        normalizedText: candidate.normalizedText,
    });
    if (exact) {
        await decide(candidate, "ignore_duplicate", "exact normalized duplicate", { memoryId: exact.id });
        return;
    }

    const embedding = await embeddingProvider.embed({
        text: candidate.text,
        purpose: "memory.write.candidate",
    });
    await candidateStore.saveCandidateEmbedding({ candidateId: candidate.id, embedding });

    const memories = await memoryStore.listActiveMemories({
        userId: candidate.source.userId,
        characterId: candidate.source.characterId,
        scope: candidate.scope,
        type: candidate.type,
        limit: 1000,
    });

    const similar = rankSimilarMemories(embedding.vector, memories, { topK: 10 });
    const decision = decideBySimilarity(similar);

    if (decision.kind === "create") {
        const memory = await memoryStore.createMemory({ candidate, embedding });
        await decide(candidate, "create", "no similar active memory", { memoryId: memory.id, similar });
        return;
    }

    await decide(candidate, "needs_judge", decision.reason, { similar });
}
```

### 保守决策规则

第一版阈值建议只作为起点，后续要根据样本调参。

```ts
export interface MemoryDecisionPolicy {
    exactDuplicateThreshold: number;
    needsJudgeThreshold: number;
    topK: number;
}

export const defaultMemoryDecisionPolicy: MemoryDecisionPolicy = {
    exactDuplicateThreshold: 0.95,
    needsJudgeThreshold: 0.80,
    topK: 10,
};
```

这些值不能写死在算法里。Batch 2/3 可以先提供默认值，但 `MemoryCommitService` 应通过构造参数接收 policy：

```ts
export interface MemoryCommitConfig {
    policy: MemoryDecisionPolicy;
    candidateScanLimit: number;
    enableImmediateCommit: boolean;
    enableVerboseDebugLog: boolean;
}
```

第一版配置来源可以是 server config 或测试注入；前端设置页属于本批次 todo，不阻塞核心实现。

建议策略：

- 精确 normalized text 已存在：`ignore_duplicate`。
- 最高相似度 `>= 0.95`：`ignore_duplicate` 或 `needs_judge`。第一版建议用 `needs_judge`，避免误删细微信息。
- 最高相似度 `>= 0.80`：`needs_judge`。
- 没有相似项或最高相似度 `< 0.80`：`create`。
- embedding 失败：`embedding_failed`，不创建 memory。

不要在这一阶段自动 update 已有 memory。相似并不等于重复，也可能是补充、纠正或冲突。

### 低价值过滤

低价值过滤只做很保守的规则，例如：

- 文本长度过短。
- 只有寒暄或情绪反应。
- 缺少可复用信息。
- 明显是当前回合临时措辞，不适合长期保存。

规则函数放在 `decisionPolicy.ts` 或独立 `candidateQuality.ts`，不要把 prompt 或 model-call 逻辑放进去。

## 配置项与 Batch 2/3 Todo

Batch 2/3 需要先把配置边界设计出来，即使不立刻做前端 UI。

建议配置项：

```ts
export interface MemoryFeatureConfig {
    enabled: boolean;
    immediateCommitEnabled: boolean;
    verboseDebugLogEnabled: boolean;
    candidateScanLimit: number;
    decisionPolicy: MemoryDecisionPolicy;
    embedding: {
        provider: string;
        model: string;
        version: number;
        dimensions?: number;
        modelCallPurpose: "memory.embed";
    };
}
```

默认建议：

- `enabled: true`，如果希望更保守也可以默认 false。
- `immediateCommitEnabled: true`，便于早期观察完整链路。
- `verboseDebugLogEnabled: true`，早期调试优先。
- `candidateScanLimit: 1000`。
- `decisionPolicy.topK: 10`。

本批次 todo：

- 将 similarity 阈值、topK、scan limit、是否 immediate commit 做成可配置。
- 将 embedding provider/model/version 做成可配置。
- 将 embedding 默认模型接入 `defaultModelAssignments["memory.embed"]`。
- 明确配置来源：server config、用户偏好、角色级配置，或先用 server config 统一控制。
- 前端 debug/setting UI 暂缓，但 contracts 和 debug API 返回值要为这些字段预留位置。
- 记录每次 decision 使用的 policy/config snapshot，避免后续阈值变化后无法解释历史结果。

## 相似度算法

`similarity.ts` 提供纯函数：

```ts
export function cosineSimilarity(left: number[], right: number[]): number {
    if (left.length !== right.length || left.length === 0) return Number.NaN;

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        dot += a * b;
        leftNorm += a * a;
        rightNorm += b * b;
    }

    if (leftNorm === 0 || rightNorm === 0) return Number.NaN;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
```

如果 embedding provider 已返回归一化向量，可以优化为 dot product，但接口层不要假设这一点。第一版直接算 cosine 更安全。

向量存储建议第一版用 JSON：

```ts
JSON.stringify(vector)
```

原因：

- 实现简单。
- 方便 debug。
- SQLite 迁移容易。

未来数据量变大后，可以改为 `BLOB` 保存 `Float32Array`，或者替换为真正的向量数据库。

## SQLite 实现

SQLite store 放在：

- `packages/persona-flow-sqlite/src/db/SQLiteMemoryCandidateStore.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMemoryStore.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMemoryDecisionStore.ts`

并在：

- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`

接入。

如果启用了 `CharacterDbRouter`，memory 数据建议跟 conversation 数据进入同一个 character DB。这样候选、消息、turn events、active memory 可以在同一角色数据库内对照。

SQLite 实现注意事项：

- JSON 字段读取失败时返回空数组或空相似结果，并记录 warn。
- 批量写 candidates 使用 transaction。
- `createMemory` 和对应 decision 最好在同一个 transaction 内完成；如果当前 store 边界不方便，先保证 decision 记录 fail-soft。
- 查询 active memory 时必须带 `userId`。
- `limit` 做上限，第一版相似扫描建议最多 1000 或 2000 条。
- 相似扫描必须过滤 embedding metadata，只比较同 provider/model/dim/version 的向量。

建议索引：

- `memory_candidates(user_id, character_id, created_at)`
- `memory_candidates(conversation_id, assistant_message_id, seq)`
- `memory_candidates(status, created_at)`
- `memories(user_id, character_id, scope, type, status)`
- `memories(user_id, normalized_text, status)`
- `memory_decisions(candidate_id, created_at)`

## Verbose Debug Log

Batch 2/3 必须输出足够详细的判定过程日志。早期这些日志先写到结构化 logger 和 `memory_decisions`；未来可以直接投喂前端 debug 窗口。

建议每个 candidate 至少记录这些阶段：

1. `candidate_received`: candidate 已保存，包含 source ids、scope、type、text length、tags。
2. `quality_checked`: 低价值过滤结果和原因。
3. `exact_duplicate_checked`: normalized text 查询结果。
4. `embedding_requested`: 使用的 provider/model/version/dim。
5. `embedding_saved`: embedding 维度、耗时、是否成功。
6. `similarity_scan_started`: scan 条件、candidateScanLimit。
7. `similarity_scan_finished`: scanned count、eligible count、skipped count、topK。
8. `decision_made`: decision、reason、policy snapshot、memoryId。
9. `candidate_status_updated`: candidate 最终 status。

`memory_decisions.similarityJson` 只保存最终 topK 摘要，不适合保存完整 verbose 过程。为了前端 debug 窗口，建议新增可选表：

```ts
export const memoryDebugEvents = sqliteTable("memory_debug_events", {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    stage: text("stage").notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
});
```

如果本批次想保持表数量少，可以先不建 `memory_debug_events`，但 `MemoryCommitService` 的 logger 事件结构要按上述 stage 设计，方便后续无痛落库。

Verbose log 注意事项：

- 日志里不要输出 API key、完整 provider credential 或敏感配置。
- candidate/memory 文本可以记录，但 debug API 必须限定当前用户。
- 每条 decision 记录保存 `policyVersion` 和必要的 policy/config snapshot。
- embedding vector 本体不要写入普通日志；只记录 dim、provider、model、version 和耗时。

## Contracts 与 Debug API

Contracts 新增 debug API，建议文件：

- `packages/contracts/src/apis/memory.api.ts`

API 建议：

```ts
export const ApiListMemoryCandidates = new ApiDefine<
    ListMemoryCandidatesRequest,
    ListMemoryCandidatesResponse
>("/v1/debug/memory-candidates", "GET");

export const ApiListMemories = new ApiDefine<
    ListMemoriesRequest,
    ListMemoriesResponse
>("/v1/debug/memories", "GET");

export const ApiListMemoryDecisions = new ApiDefine<
    ListMemoryDecisionsRequest,
    ListMemoryDecisionsResponse
>("/v1/debug/memory-decisions", "GET");

export const ApiListMemoryDebugEvents = new ApiDefine<
    ListMemoryDebugEventsRequest,
    ListMemoryDebugEventsResponse
>("/v1/debug/memory-debug-events", "GET");
```

这些都是 debug API，不是正式用户功能。

查询规则：

- 必须使用当前登录用户的 `userId`。
- 不允许 query 传入任意 `userId`。
- `limit` 默认 100，最大 500。
- candidates 可按 `conversationId`、`assistantMessageId`、`status` 过滤。
- memories 可按 `characterId`、`scope`、`type`、`status` 过滤。
- decisions 可按 `candidateId`、`decision` 过滤。
- debug events 可按 `candidateId`、`stage`、`level` 过滤。

Server route 只调用 store/服务，不直接实现 memory 算法。

## 与 Chat Turn 的集成

`PersonaFlowChatTurnService` 只做边界调用：

1. 保存 assistant turn。
2. 调用 memory candidate recorder。
3. 可选调用 memory commit service。
4. 所有失败都 warn，不影响 chat response。

Chat turn 不应该：

- 自己计算 embedding。
- 自己做 similarity。
- 自己判断 candidate 是否 create/ignore。
- 直接操作 memory SQLite 表。

这样可以防止 memory 逻辑被 chat turn 和 model call 污染。

## 测试计划

### persona-flow memory 核心

- `normalizeMemoryText()` 对大小写、空白、标点的处理稳定。
- `cosineSimilarity()` 正确处理相同向量、正交向量、维度不一致、零向量。
- `rankSimilarMemories()` 过滤无 embedding 和维度不一致 memory，并按相似度排序。
- `decisionPolicy` 对低价值、无相似、高相似场景返回预期 decision。
- `MemoryCandidateRecorder` 保存候选时生成 source、seq、normalizedText。
- `MemoryCommitService` 在无相似 memory 时 create。
- `MemoryCommitService` 在 exact duplicate 时 ignore。
- `MemoryCommitService` 在高相似 memory 时 needs_judge。
- embedding provider 抛错时记录 `embedding_failed`，不 throw 到调用方。
- embedding metadata 不一致时跳过相似比较，并记录 skipped reason。
- verbose debug log 覆盖 candidate_received、embedding、similarity_scan、decision_made 等关键阶段。

这些测试优先使用内存 fake store 和 fake embedding provider，不依赖 SQLite。

### persona-flow chat turn

- `chatTurn()` 在 assistant turn 保存后调用 recorder。
- `streamTurn()` 在 assistant turn 保存后调用 recorder。
- candidates 为空时不调用 recorder/commit。
- recorder 或 commit 抛错时 chat response 仍然成功。
- chat turn 测试不关心 similarity 细节，只验证边界调用和 fail-soft。

### persona-flow-sqlite

- `appendCandidates()` 写入多条候选并保持 `seq`。
- `listCandidates()` 按 conversation/message/status 查询。
- `createMemory()` 写入 active memory 和 embedding。
- `listActiveMemories()` 按 user/character/scope/type/status 查询。
- `findExactActiveMemory()` 使用 normalized text 找到重复。
- `appendDecision()` 保存 decision 和 similarityJson。
- 如果实现 `memory_debug_events`，验证 debug event 按 candidate/stage 查询。
- JSON parse 失败时有安全兜底。
- 使用 `CharacterDbRouter` 时，memory 表与 conversation 数据在同一 character DB。

### server

- debug API 只返回当前用户数据。
- `limit` 默认值和上限生效。
- 过滤参数生效。
- memory debug events API 能按 candidate 查询判定过程。
- 未登录请求被 auth middleware 拦截。

### 回归测试

- chat API response shape 不变。
- SSE `done` event shape 不变。
- prompt structured output 仍然只负责 `events` 和顶层 `memoryWriteCandidates`。
- memory candidate 文本不会出现在 streaming preview 的 visible text 中。

## 实施顺序

建议按以下顺序实现：

1. 新建 `packages/persona-flow/src/memory/**`，先实现纯类型、端口、normalize、similarity、decision policy。
2. 实现 fake-store 驱动的 `MemoryCandidateRecorder` 与 `MemoryCommitService` 单元测试。
3. 设计 `MemoryFeatureConfig`，先用 server config 或测试注入提供默认值。
4. 在 contracts/config schema/default config 中增加 `memory.embed` model-call purpose 和默认 assignment。
5. 在 `AppStores` 或新的 memory runtime deps 中接入 memory stores。若不想污染 `AppStores`，可以让 `PersonaFlowChatTurnService` 额外接收 `memoryRuntime` 依赖。
6. 在 SQLite schema 中加入 `memory_candidates`、`memories`、`memory_decisions`，可选加入 `memory_debug_events`。
7. 实现 SQLite memory stores。
8. 实现第一版 `MemoryEmbeddingProvider` adapter。
9. 在 chat turn 保存 assistant turn 后 fail-soft 调用 recorder 和 commit service。
10. 新增 contracts debug API。
11. 新增 server debug routes。
12. 添加上述测试。
13. 运行：

```bash
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/persona-flow-sqlite test
pnpm --filter @ss-ai/server test
pnpm run build
```

## 完成标准

Batch 2/3 完成后，应满足：

- 一轮 chat 如果产生 memory candidates，它们会保存到 SQLite。
- 保存失败、embedding 失败、commit 失败都不会影响聊天。
- 明显的新 candidate 可以被创建成 active memory。
- 精确重复不会反复创建。
- 高相似 candidate 会进入 `needs_judge`，不会自动覆盖已有 memory。
- candidate、active memory、decision 都可以通过 debug API 查询。
- decision 中能看到 topK 相似 memory 与 similarity，方便调参。
- verbose debug log 能解释 candidate 从保存到最终 decision 的每个关键步骤。
- 相似度阈值、topK、scan limit、embedding provider/model/version 至少在后端配置层可调整。
- embedding 默认模型可以通过 `defaultModelAssignments["memory.embed"]` 提供。
- memory 核心逻辑集中在 `packages/persona-flow/src/memory/**`，不直接依赖 chat turn、model call、server 或 SQLite。

## 后续衔接

Batch 2/3 产出的数据用于回答这些问题：

- 模型是否过度提出候选？
- 哪些 scope/type 最常出现？
- embedding 相似度阈值是否合理？
- brute-force SQLite 检索在当前数据量下是否足够快？
- 哪些 `needs_judge` 实际上应该 create、merge、update 或 ignore？
- active memory 的文本是否适合未来读回 prompt？

下一阶段建议是 LLM Judge：

- 输入 candidate、source turn 摘要、topK similar memories。
- 输出 `create | ignore | update | merge | archive | needs_human_review` 等建议。
- 系统 commit service 保持最终裁决权。

再下一阶段才做 memory read injection，把 active memory 检索后注入 prompt。

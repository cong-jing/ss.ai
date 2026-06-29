# Memory Write Batch 4 — LLM Judge 实施计划（历史方案）

[返回 followups](memory-write-followups.md) ｜ [项目地图（记忆子系统）](../project-map-memory.zh-CN.md)

> 状态：本文档已被新的分层重构路线取代，仅作为历史参考保留。新的方向见 [Memory 分层重构设计草案](memory-layered-refactor.zh-CN.md)：先做 Batch 3.5，把 memory pipeline 拆成 candidate → memory staging → memory retained；Batch 4 再围绕 memory staging 到 memory retained 的 consolidation judge 重新设计。

本文档把 [memory-write-followups.md](memory-write-followups.md) 中 Batch 4 的 LLM Judge 方向，结合现有 batch 2/3 的代码现状，整理为可落实的实施计划。一次评审通过后再进入编码。

> 本文档与代码同步前置约定：本项目尚未进入实际生产，故不引入 SQLite migration 框架，schema 直接改 `packages/persona-flow-sqlite/src/db/schema.ts`，依赖应用启动时重建。

## 1. 目标与非目标

### 1.1 目标

- 当 `MemoryCandidateProcessor` 在 similarity 排序后判定 `needs_judge` 时，调用一次 LLM judge，由 judge 给出更细的建议。
- judge 可以推动候选走到下列结果之一：
  - 创建新 memory（`decision = "create"`）
  - 合并到现有 memory（`decision = "merge"`，新增枚举）
  - 视为重复，不创建（`decision = "ignore_duplicate"`，引用一条具体的 memoryId）
  - 仍然不确定（`decision = "needs_judge"`，reason 区分 `judge_uncertain` / `judge_failed`）
- 整个 judge 流程对 chat turn 保持 fail-soft：judge 失败、网络异常、返回非法都不抛错；chat 回复必须照常返回。
- judge 的输入、输出和原始 reasoning 写入 `memory_decisions.judge_json`，便于后续 debug UI 复现。

### 1.2 非目标

- 不实现完整 RAG 闭环（active memories 仍不回读 prompt）。
- 不引入 `archive_existing`、跨字符 memory 联动等更复杂的判断动作。
- 不在 batch 4 内做 background worker / 重试队列；judge 只在 `inline` 模式下运行。
- 不引入 SQLite migration 框架；直接改 schema。
- 不重命名既有 `memory.summarize` purpose，也不新增 `memory.judge` purpose；judge 沿用 `memory.summarize` 的 model assignment 通道。

## 2. 关键决议（决议表）

| 维度 | 决议 | 备注 |
| --- | --- | --- |
| Purpose | 复用 `memory.summarize` | 不动 `MODEL_CALL_PURPOSES`，不动 `MODEL_CALL_PURPOSE_CATEGORIES`；只是 judge 通过这个 purpose 解析 model & API key |
| 架构 | Provider port：`MemoryJudgeProvider` + `ModelClientMemoryJudgeProvider` | 与 embedding 一致；不进入 `modelCallRegistry`；memory core 仍 framework-free |
| 触发 | 仅当 `decideBySimilarity` reason = `needs_judge_threshold` 时调 judge | `exact_duplicate_threshold` 仍直接落 `needs_judge`、不调用 judge，避免在“几乎完全重复”的高相似带浪费 LLM |
| Judge 输入 | candidate 全字段 + topK 相似 memory + 当回合 user 文本 + 当回合 assistant `replyText` 文本 + character displayName + character.personaPrompt 摘要 | 各字段做长度截断 |
| Judge 输出 | `{ decision: "create" \| "merge" \| "ignore_duplicate" \| "uncertain", targetMemoryId?, mergedText?, reasoning, confidence? }` | structured output (`response_format: json_schema`) |
| Judge 语言 | 固定英文 prompt | 跨语言稳定，与 character.language 解耦 |
| Schema 位置 | `packages/persona-flow/src/memory/judge/` | 不映射到 contracts |
| `merge` 文本来源 | judge 必须返回 `mergedText`；处理器用它替换 `memory.text` | 不再保留原 text |
| `merge` 后 embedding | 重新调一次 embed | 多一次 token 成本换语义正确 |
| `merge` candidate 状态 | 复用 `committed` | 不新增 candidate status |
| `merge` decision 枚举 | 新增 `MemoryDecisionKind = "merge"` | contracts + 持久层枚举同步 |
| `MemoryStore.updateMemory` | 新增 partial-update 接口 | 支持 text/normalizedText/relatedEntities/tags/importance/embedding/updatedAt |
| `decision.memoryId` 字段语义 | 复用：create 时是新 id，merge / ignore_duplicate 时是目标 id | 不新增 `targetMemoryId` 字段 |
| 失败与 uncertain | candidate 保持 `needs_judge`，decisionRow.reason 区分 `judge_failed` / `judge_uncertain` | 仍写一条 decision row |
| policyVersion | 维持 `1`；是否经过 judge 看 `row.judge` 是否存在 | 不引入 v2 policy |
| 配置项 | `memory.judge.enabled` / `maxTopKForPrompt` / `includeSourceTurn` | 默认 `true / 5 / true` |
| 默认 assignment | `memory.summarize = mistral.ai / mistral-small-latest`（config.default.json 已存在） | 无需新增 |
| 测试 | memory 子系统单测覆盖 5 条路径 + chat turn 集成测试 | 见 §10 |

## 3. 现状速记（实施前的对齐）

- `MemoryCandidateProcessor.processOne()` 当前流程：low-value → exact text duplicate → embed → list active memories → `rankSimilarMemories` → `decideBySimilarity` →（`create` / `needs_judge` 两种系统决策）→ `finalize`。
- `decideBySimilarity` 当前只产出 `create` 或 `needs_judge`，且 `needs_judge` 包括两个 reason：`needs_judge_threshold`、`exact_duplicate_threshold`。
- `MemoryDecisionRecorder.record()` 把候选状态切换与 decision row 写入一并完成。
- chat turn 流程：assistant turn 持久化后，`safeHandleMemoryWriteCandidates` 把候选交给 `MemoryPipelineService.handleChatTurnCandidates`。该 service 内部按 `enabled` 与 `candidateProcessingMode` 决定调用 recorder/processor。
- `MemoryCandidateSource` 当前只带 ids，没有 user/assistant 文本。
- `MemoryStore` 仅 `createMemory` / `listActiveMemories` / `findExactActiveMemory` / `saveMemoryEmbedding`，无 `updateMemory`。
- `ModelClientMemoryEmbeddingProvider` 已有“user 偏好优先、defaults 兜底；用户 API key 优先、默认 API key 兜底”的解析模式，judge provider 直接照抄。

## 4. 数据流（含 judge 分支）

```
1. low-value filter
   └─ low-value → finalize(ignore_low_value)
2. exact normalized-text duplicate
   └─ hit  → finalize(ignore_duplicate, memoryId=existing)
3. embed
   └─ fail → finalize(embedding_failed)
4. list active memories + rankSimilarMemories
5. decideBySimilarity:
   - "create"                              → createMemory → finalize(create, memoryId=new)
   - "needs_judge" reason="exact_duplicate_threshold"  → finalize(needs_judge, reason="exact_duplicate_threshold")
   - "needs_judge" reason="needs_judge_threshold":
        if !settings.judge.enabled
            → finalize(needs_judge, reason="needs_judge_threshold")
        else
            6. judgeStep.run(input):
               - judge.invoke → ModelClientMemoryJudgeProvider.generate(structured)
               - 校验 targetMemoryId ∈ topK；非法→treat as uncertain
               - 校验 mergedText 非空（仅 merge）
               outcomes:
                 a) judge.decision="create"
                    → createMemory(candidate.text/embedding)
                    → finalize(create, judge=<...>)
                 b) judge.decision="merge"
                    → embed(mergedText) 再 updateMemory(targetMemoryId, mergedText, normalizedText, related, tags, embedding, updatedAt)
                    → finalize(merge, memoryId=targetMemoryId, judge=<...>)
                    → 失败回退：updateMemory 失败 → finalize(error, judge=<...>)
                 c) judge.decision="ignore_duplicate"
                    → finalize(ignore_duplicate, memoryId=targetMemoryId, judge=<...>)
                 d) judge.decision="uncertain"
                    → finalize(needs_judge, reason="judge_uncertain", judge=<...>)
                 e) judge 调用异常 / 输出非法
                    → finalize(needs_judge, reason="judge_failed", judge=<rawDecision=null, error=...>)
```

> finalize 仍由 `MemoryDecisionRecorder.record()` 统一写候选状态 + decision row。新增的 `judge` 字段透传给 recorder。

## 5. 输入上下文如何到达 judge

`MemoryJudgeStep` 需要：

- 候选本身：已经是 `MemoryCandidateRecord`，processor 持有。
- top-K 相似 memory：processor 已经算好 `RankedMemory[]`，截 `settings.judge.maxTopKForPrompt`。
- 当回合 user 文本 + assistant `replyText`：当前不在 processor 输入里，需要新增。
- character 的 displayName / personaPrompt：当前不在 processor 输入里，需要新增。

实现：

1. 扩展 `MemoryPipelineService.handleChatTurnCandidates` 入参，新增可选 `turnContext`：

   ```ts
   interface MemoryTurnContext {
       characterDisplayName?: string;
       personaPromptSummary?: string; // 截断后的 personaPrompt，便于 token 控制
       userMessageText?: string;
       assistantReplyText?: string;
   }
   ```

   `turnContext` 不持久化、仅在内存中透传到 processor。`record_only` 模式下不会用到。

2. `MemoryCandidateProcessor.processCandidates` 新增可选 `turnContext` 入参，在 `processOne` 中传给 `MemoryJudgeStep`。

3. chat turn 服务在调用 `handleChatTurnCandidates` 时，把：
   - `character.displayName ?? character.name`
   - `character.personaPrompt` 截断到 `JUDGE_PROMPT_MAX_PERSONA_CHARS`
   - 用户原始消息（`input.userMessageText`）截断
   - assistant `displayText` 截断
   一并放入 `turnContext`。

> `MemoryCandidateSource` 不变。`turnContext` 与之分离，避免把可变长的文本写进候选 schema。

## 6. 模块改动详单

### 6.1 `packages/contracts`

- `src/apis/memory.api.ts`
  - 在 `MemoryDecisionKind` 中新增 `"merge"`。
  - `MemoryDecisionInfo` 增加：

    ```ts
    judge?: {
        model: string;
        rawDecision: "create" | "merge" | "ignore_duplicate" | "uncertain" | null;
        reasoning: string | null;
        confidence: number | null;
        attemptedAt: string;
        targetMemoryId?: string | null;
        mergedTextPreview?: string | null; // 截断防止 debug 接口过大
        error?: string | null;
    };
    ```

- 不动 `MODEL_CALL_PURPOSES` / `MODEL_CALL_PURPOSE_CATEGORIES`。

### 6.2 `packages/persona-flow/src/memory/judge/`（新建目录）

- `judgeTypes.ts`
  - `JudgeRequestInput`：候选、topK memory 摘要、turnContext、settings 配额
  - `JudgeRawOutput`、`JudgeDecisionKind`（`"create" | "merge" | "ignore_duplicate" | "uncertain"`）
  - `JudgeResult`：`{ kind, targetMemoryId?, mergedText?, reasoning, confidence?, modelLabel, rawDecisionKind, errorMessage? }`
- `judgePorts.ts`
  - `MemoryJudgeProvider`：单一方法 `judge(input: JudgeRequestInput): Promise<JudgeResult>`
- `judgeOutputSchema.ts`
  - Zod schema：

    ```ts
    z.object({
      decision: z.enum(["create", "merge", "ignore_duplicate", "uncertain"]),
      targetMemoryId: z.string().min(1).optional(),
      mergedText: z.string().trim().min(1).max(2000).optional(),
      reasoning: z.string().trim().min(1).max(2000),
      confidence: z.number().min(0).max(1).optional(),
    });
    ```
  - 校验：`merge` 必须有 `targetMemoryId` + `mergedText`；`ignore_duplicate` 必须有 `targetMemoryId`；其余字段冗余忽略。
- `judgePromptBuilder.ts`
  - 固定英文 system + user 文案；其中 system 强调“conservative, never invent IDs”。
  - 在 user 部分把 candidate、top-K、turn summary、character 信息以 Markdown/小标题形式拼接；做长度截断（候选 1k chars、每条 memory 600 chars、user/assistant text 各 1k chars、persona 800 chars）。
- `MemoryJudgeStep.ts`
  - 包装一次 judge 调用：
    - 调 provider.generate
    - 用 zod 校验
    - 防御性校验 `targetMemoryId` ∈ topK；非法→当作 `uncertain`，error 写入 result
    - 把异常包成 `JudgeResult.kind = "uncertain"` + `errorMessage`
  - 与 `MemoryEmbeddingStep` 风格一致，自己只关心“一次 judge 调用是否得到一个可用结果”。
- `ModelClientMemoryJudgeProvider.ts`
  - 内部沿用 embedding adapter 的 model & API key 解析模式：purpose = `"memory.summarize"`。
  - 调 `ModelClient.generate({ structuredOutputSchema })`，把 `result.structuredOutput` 透传给上层做 zod 校验。
  - 错误码：`assignment_missing` / `api_key_missing` / `generate_failed` / `invalid_response`，统一抛出，由 step 层 fail-soft。

### 6.3 `packages/persona-flow/src/memory/settings.ts`

```ts
export interface MemorySettings {
    enabled: boolean;
    candidateProcessingMode: "inline" | "record_only";
    ranking: { listLimit: number; topK: number; needsJudgeThreshold: number; exactDuplicateThreshold: number; };
    embedding: { version: number; };
    judge: {
        enabled: boolean;
        maxTopKForPrompt: number;
        includeSourceTurn: boolean;
    };
}
```

`DEFAULT_MEMORY_SETTINGS.judge = { enabled: true, maxTopKForPrompt: 5, includeSourceTurn: true }`。

### 6.4 `packages/persona-flow/src/memory/decision/`

- `decisionPorts.ts`
  - `MEMORY_DECISION_KINDS` 加 `"merge"`。
  - `MemoryDecisionRecord` 与 `AppendMemoryDecisionInput` 增加 `judge?: MemoryDecisionJudgeMeta`。
  - 定义 `MemoryDecisionJudgeMeta`，对应 contracts 投影。
- `MemoryDecisionRecorder.ts`
  - `RecordDecisionInput` 增加 `judge?: MemoryDecisionJudgeMeta`，传给 `appendDecision`。

### 6.5 `packages/persona-flow/src/memory/stores/activeMemoryStorePort.ts`

新增：

```ts
export interface UpdateMemoryInput {
    memoryId: string;
    text?: string;
    normalizedText?: string;
    relatedEntities?: string[];
    tags?: string[];
    importance?: number;
    embedding?: MemoryEmbedding;
    updatedAt: string;
}

export interface MemoryStore {
    // 既有方法…
    updateMemory(input: UpdateMemoryInput): Promise<ActiveMemoryRecord>;
}
```

- 期望行为：partial patch，未提供字段不动；`updatedAt` 永远写入；返回最新 record。

### 6.6 `packages/persona-flow/src/memory/processing/MemoryCandidateProcessor.ts`

- `MemoryCandidateProcessorDeps` 新增可选字段：
  - `judgeStep?: MemoryJudgeStep`
  - 当 `settings.judge.enabled = false` 时可省略，processor 内自动 skip。
- `processCandidates` 新增可选 `turnContext: MemoryTurnContext`。
- 在“decision = needs_judge & reason = needs_judge_threshold”分支：
  - 调用 `judgeStep.run(...)` 拿 `JudgeResult`。
  - `kind = "create"`：直接走现有 createMemory 分支。
  - `kind = "merge"`：
    - 调用 `embeddingStep.embedText(mergedText)`（需新增 helper 接受裸字符串，或临时构造 draft 调用 `embed`）。
    - 调用 `memoryStore.updateMemory(...)`。失败 → finalize(`error`, candidateStatus=`commit_failed`, judge=...)。
    - 成功 → finalize(`merge`, memoryId=targetMemoryId, candidateStatus=`committed`, judge=...)
  - `kind = "ignore_duplicate"`：finalize(`ignore_duplicate`, memoryId=targetMemoryId, candidateStatus=`ignored_duplicate`, judge=...)
  - `kind = "uncertain"`：finalize(`needs_judge`, reason=`judge_uncertain`, judge=...)
  - `judgeStep` 整段 try/catch：异常 → finalize(`needs_judge`, reason=`judge_failed`, judge={rawDecision: null, error})
- finalize 函数签名增加可选 `judge` 字段。

### 6.7 `packages/persona-flow/src/memory/MemoryPipelineService.ts` & `createMemoryPipelineService.ts`

- `HandleChatTurnCandidatesInput` 增加 `turnContext?: MemoryTurnContext`。
- service 内：当 candidateProcessingMode = `inline` 时把 `turnContext` 透传给 `processor.processCandidates`。`record_only` 模式下忽略，不写入候选 row。
- `createMemoryPipelineService`：
  - 当 `settings.judge.enabled = true` 时，组装 `ModelClientMemoryJudgeProvider` + `MemoryJudgeStep` + `decisionRecorder`，注入 processor。
  - allow `overrides.judgeProvider` 便于测试注入 fake provider。
  - 当 `judge.enabled = false` 时不构造 judge 组件。

### 6.8 `packages/persona-flow/src/memory/embedding/MemoryEmbeddingStep.ts`

可能需要新增 `embedText(text: string, source: MemoryCandidateSource): Promise<EmbedOutcome>` 用于 merge 时对 mergedText 重新 embedding。原 `embed(candidate)` 行为不变。

### 6.9 `packages/persona-flow/src/memory/logging/MemoryPipelineLogger.ts` + 事件名

新增事件：

- `memory.pipeline.judge_skipped` — 触发分支不调用 judge（exact_duplicate_threshold 或 enabled=false）
- `memory.pipeline.judge_invoked` — 触发 judge 前
- `memory.pipeline.judge_completed` — judge 返回（带 rawDecision、reasoning 截断）
- `memory.pipeline.judge_failed` — judge 抛错或校验失败

事件级别：默认 debug；retrieval_evidence 已经覆盖大部分上下文，judge 不重复打全文。`verbose` 级再附 reasoning 全文与 raw response（不带原始用户文本，避免冗余）。

### 6.10 `packages/persona-flow/src/chatTurn/chatTurnService.ts`

- `safeHandleMemoryWriteCandidates` 新增 `turnContext` 入参，在 chatTurn / streamTurn 调用时构造：
  - characterDisplayName（来自 `prepared.promptContext.character`）
  - personaPromptSummary（截断 `character.personaPrompt`）
  - userMessageText（input.userMessageText）
  - assistantReplyText（`getTurnEventsReplyText(turnEvents)`）
- 把 turnContext 传到 `memoryPipelineService.handleChatTurnCandidates`。

### 6.11 `packages/persona-flow-sqlite`

- `src/db/schema.ts`
  - `memoryDecisions` 增加 `judgeJson: text("judge_json")`（可空）。
- `src/db/SQLiteMemoryDecisionStore.ts`
  - `appendDecision` 写 `judgeJson = input.judge ? JSON.stringify(input.judge) : null`。
  - `listDecisions` 反序列化为 `judge`。
- `src/db/SQLiteMemoryStore.ts`
  - 实现 `updateMemory`：动态构造 UPDATE 语句，未提供字段不写；`updatedAt` 必写；返回最新 row。
- `MEMORY_CANDIDATE_STATUSES` / `MEMORY_DECISION_KINDS` 在 sqlite 端如果有镜像枚举，同步加 `merge`。

### 6.12 `apps/server`

- `src/util/config.ts`
  - `RawConfig.memory` 增加 `judge: { enabled?, maxTopKForPrompt?, includeSourceTurn? }`。
  - 解析时与 `DEFAULT_MEMORY_SETTINGS.judge` 合并。
- `config/config.default.json`
  - 增加：

    ```json
    "memory": {
      "enabled": true,
      "candidateProcessingMode": "inline",
      "judge": {
        "enabled": true,
        "maxTopKForPrompt": 5,
        "includeSourceTurn": true
      }
    }
    ```

- `schemas/config.schema.json`
  - 同步 judge 段定义。
- `src/http/apis/memoryDebug.route.ts`
  - `MEMORY_DECISION_KINDS` 数组加 `"merge"`。
  - `toDecisionInfo` 把 `record.judge` 投影到响应 DTO，并对 reasoning / mergedTextPreview 做长度截断（例如 reasoning 1k chars）。

## 7. Judge Prompt 设计（英文固定）

System 摘要：

```
You are a conservative long-term memory judge. The system has already detected
that a candidate fact is semantically similar to an existing memory but cannot
confidently decide on its own. You must choose exactly one action:
"create", "merge", "ignore_duplicate", or "uncertain".

Rules:
- "merge" requires you to pick targetMemoryId from the provided list and to
  output a single mergedText that fully replaces the existing memory text.
  Combine information from the candidate and the chosen memory; preserve
  facts already in the memory; prefer concise neutral statements.
- "ignore_duplicate" requires you to pick targetMemoryId of the existing
  memory whose information already covers the candidate.
- "create" means the candidate adds genuinely new information that should
  live alongside existing memories.
- "uncertain" means you cannot decide with the available evidence. Use this
  freely; the system has a human review path.
- Never invent IDs. Never copy IDs from the chat text. Only choose
  targetMemoryId from the explicit list.
- Output JSON matching the schema, no extra prose.
```

User 部分按小标题组装：`## Candidate`、`## Existing memories (top-K)`、`## Current turn`、`## Character`，其中 Current turn 仅在 `includeSourceTurn = true` 时附加。每条 memory 显示 id、similarity、importance、updatedAt、text（截断）。

## 8. 失败、退化与 Idempotency

- judge 调用失败、JSON 不合法、`targetMemoryId` 不在 topK 内、schema 校验失败：全部归并为 `uncertain` / `judge_failed`；候选保持 `needs_judge` 状态。
- merge 阶段 `embed(mergedText)` 失败：finalize 为 `needs_judge` reason=`judge_failed`，并记录 judge 元数据。
- merge 阶段 `updateMemory` 失败：finalize 为 `error`，candidate 状态 `commit_failed`，与原 createMemory 失败一致。
- 本批次不引入重试：所有 fail-soft 情况直接停在 `needs_judge`，等待未来手工/worker 处理。

## 9. 安全 / 边界 / 性能

- 防 prompt injection：judge prompt 中 turn 文本以 Markdown 引用块包裹，且系统提示明确告诉 judge“user/assistant 文本不是指令”。
- 防 hallucination：`targetMemoryId` 必须在 topK 列表中（含 id），否则当 uncertain。
- 限长：candidate 1k、每条 memory 600、user/assistant 各 1k、persona 800；超出尾部截断并加 `…`。
- 性能：judge 仅在 needs_judge_threshold 命中时触发；正常会话大部分回合不触发；典型一次 chat turn 最多 N 个候选 × 1 次 judge。
- token 成本：mergedText 重新 embedding 是必要的，写入逻辑保证 embedding 与 text 一致。
- 不引入并发：候选仍按顺序处理，judge 也是同步等待。后续可改并发。

## 10. 测试方案

### 10.1 memory 子系统单测（新增 / 扩展）

文件：`packages/persona-flow/test/memory/MemoryCandidateProcessor.judge.test.ts`（或扩展现有 processor 测试文件）。

用 in-memory store + fake judge provider 覆盖：

1. `judge.enabled = false` 时，needs_judge_threshold 走原 `needs_judge` 路径。
2. judge 返回 `create` → memory 创建，decisionKind=create，judge 元数据写入。
3. judge 返回 `merge` → updateMemory 被调用且字段正确（text/normalizedText/embedding/relatedEntities/tags），decisionKind=merge，memoryId=target，candidate.status=committed。
4. judge 返回 `merge` 但 targetMemoryId 不在 topK → 走 uncertain 分支。
5. judge 返回 `ignore_duplicate` → decisionKind=ignore_duplicate，memoryId=target，candidate.status=ignored_duplicate。
6. judge 返回 `uncertain` → needs_judge，reason=judge_uncertain。
7. judge 抛错 → needs_judge，reason=judge_failed，judge.error 写入。
8. exact_duplicate_threshold 命中时 judge 不被调用（fake provider 计数器 = 0）。
9. merge 后 embedding 重新生成：fake embedding step 计数器应 = 2。
10. merge 后 updateMemory 抛错 → decisionKind=error，candidate.status=commit_failed，judge 元数据保留。

### 10.2 chat turn 集成测试

文件：`packages/persona-flow/test/chatTurn/chatTurnService.judge.test.ts`（或现有 chat turn 测试新增 case）。

- 用 stub model client（返回结构化输出，包括 memoryWriteCandidates）+ fake judge provider，跑完整 turn。
- 验证 chat 回复仍能返回；judge 流程影响最终 active memory 与 decision 记录。
- 覆盖 streamTurn 也走 judge（确保 turnContext 在两条路径都传入）。

### 10.3 不在本批次

- 不做 Mistral 真实 probe；judge 行为先靠 fake provider 验证。
- 不做 UI 改动测试（debug UI 在后续 batch）。

## 11. 阶段拆分（实现顺序建议）

1. contracts + sqlite schema/枚举/store 改动（决定数据形状）。
2. memory 模块：settings、port、step、provider 骨架。
3. processor 接入 judge 分支 + recorder/store 调用调整。
4. service + factory + chat turn 服务透传 turnContext。
5. server config / schema / debug route 投影。
6. 单元测试 + 集成测试。
7. 手动 smoke：用 `pnpm run dev:server` + 自己造一个会引发 needs_judge 的对话（或临时降低 needsJudgeThreshold）观察 judge 实际触发。

## 12. 后续未做事项（写给未来）

- Background worker 处理 `record_only` 模式 / 历史 needs_judge 候选的 judge 二次扫。
- 人工 review UI：根据 `decision.judge` 显示原始 reasoning 与 mergedText preview。
- archive_existing / 多 memory 合并 / 跨字符 merge 等更复杂操作。
- 监控指标：judge 调用频率、token 用量、各种 outcome 比例。
- 完整 RAG 闭环（active memories 回读 prompt）。

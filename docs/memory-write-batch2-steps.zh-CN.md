# Memory Write Batch 2/3 分步实施计划

本文档是 [memory-write-batch2.zh-CN.md](memory-write-batch2.zh-CN.md) 的实施切分版。
原计划把候选存储、active memory、embedding、commit、debug API 一次性合并实现，工程量大、review 难、风险集中。本文档把它切成 7 个必需步骤和 1 个可选步骤，每一步都满足：

- **独立可编译**：跑 `pnpm run build` 不报错。
- **独立可测试**：跑 `pnpm run test` 现有测试不回归，新增测试聚焦本步。
- **独立可演示**：除了自动测试外，每一步都列出**手工可观察验收点**，便于中途确认行为符合预期，而不是等到 Step 6 才能感知。
- **独立可回滚**：每一步是一个 PR、一次 deploy；任何一步都可以单独 revert。

每一步做完后都建议跑一次 `pnpm run test` 全量，把当前的 199 条测试（60 persona-flow + 16 model-client + 35 sqlite + 80 server + 8 qq-bot）作为参考基线。测试数量只能作为辅助信号，真正的安全网是：全量 build/test 通过，且本步新增测试覆盖新增行为。

---

## Step 1: Memory 核心 — 纯类型 + 端口 + 算法 ✅ 已完成

### 范围

新建目录 `packages/persona-flow/src/memory/`，本步只放纯函数和接口定义：

- `types.ts`: `MemoryCandidateSource`、`MemoryCandidateDraft`、`MemoryCandidateRecord`、`ActiveMemoryRecord`、`MemoryEmbedding` 等领域类型
- `ports.ts`: `MemoryCandidateStore`、`MemoryStore`、`MemoryDecisionStore`、`MemoryEmbeddingProvider`、`MemoryRuntimeDeps` 端口
- `textNormalization.ts`: `normalizeMemoryText()`
- `similarity.ts`: `cosineSimilarity()`、`rankSimilarMemories()`
- `decisionPolicy.ts`: `decideBySimilarity()`、`isLowValueCandidate()`、`defaultMemoryDecisionPolicy`
- `index.ts`: 对外导出

不改 contracts、不动 SQLite、不动 chat turn、不写实现类。

### 编译验收

```bash
pnpm --filter @ss-ai/persona-flow build
```

### 自动测试

新增测试到 `packages/persona-flow/test/`：

- `memoryTextNormalization.test.ts`：大小写、空白、标点、Unicode 标准化稳定
- `memorySimilarity.test.ts`：
  - 相同向量 `cosineSimilarity = 1`
  - 正交向量 `= 0`
  - 维度不一致返回 `NaN`
  - 零向量返回 `NaN`
  - `rankSimilarMemories` 过滤无 embedding / metadata 不一致项，按相似度降序
- `memoryDecisionPolicy.test.ts`：
  - 低价值文本 → `ignore_low_value`
  - 无相似项 → `create`
  - 最高相似度 ≥ `needsJudgeThreshold` → `needs_judge`
  - 最高相似度 ≥ `exactDuplicateThreshold` → `needs_judge`（Batch 1 保守策略）

跑命令：

```bash
pnpm --filter @ss-ai/persona-flow test
```

### 手工可观察验收

在 `packages/persona-flow/scripts/try-similarity.mts` 放一个临时脚本：

```ts
import {
    cosineSimilarity,
    normalizeMemoryText,
    rankSimilarMemories,
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
} from "../src/memory/index.js";

// 用可解释的关键词维度做 fake embedding，纯为了演示排序。
// 维度含义：[游戏, 咖啡, 东京]
const fakeEmbed = (text: string): number[] => [
    text.includes("游戏") || text.includes("玩") ? 1 : 0,
    text.includes("咖啡") ? 1 : 0,
    text.includes("东京") ? 1 : 0,
];

const candidate = "用户喜欢玩游戏";
const memories = [
    "用户喜欢游戏",
    "用户讨厌咖啡",
    "用户住在东京",
];

console.log("normalized:", normalizeMemoryText(candidate));
const ranked = rankSimilarMemories(
    fakeEmbed(candidate),
    memories.map((text, idx) => ({
        id: `m${idx}`,
        text,
        embedding: { vector: fakeEmbed(text), provider: "fake", model: "fake", dim: 4, version: 1, createdAt: "" },
    } as any)),
    { topK: 3 },
);
console.log("ranked:", ranked);
console.log("decision:", decideBySimilarity(ranked, defaultMemoryDecisionPolicy));
```

跑：

```bash
pnpm tsx packages/persona-flow/scripts/try-similarity.mts
```

**验收点**：
- 输出 `normalized` 与原文一致或合理（去空白/统一标点）
- `ranked` 的相似度数字稳定可解释，"用户喜欢游戏" 应该排第一
- `decision` 返回 `create` / `needs_judge` 等枚举之一，且与相似度数字匹配

这个脚本保留下来，后续调阈值时秒级重跑。

---

## Step 2: Contracts — `memory.embed` purpose + Config schema ✅ 已完成

### 范围

- `packages/contracts/src/modelCallPurpose.ts`: `MODEL_CALL_PURPOSES` 数组加 `"memory.embed"`
- `apps/server/schemas/config.schema.json`: `defaultModelAssignments.properties` 加 `memory.embed`
- `apps/server/config/config.default.json`: 加 `"memory.embed": { "provider": "mistral.ai", "model": "mistral-embed" }`
- `apps/server/src/util/config.ts`: 增加 `defaultModelAssignments` 的轻量交叉校验，确保 assignment provider 存在于 `models`

不动 chat turn、不动 memory 模块、不动 runtime 行为。

### 编译验收

```bash
pnpm run build
```

### 自动测试

- `apps/server/test/config.test.ts`：加一条用例断言 `memory.embed` 是合法 purpose、`defaultModelAssignments` 里有它
- `apps/server/test/config.test.ts`：加一条用例断言 default assignment provider 不存在时配置加载失败，错误信息指向 `defaultModelAssignments.memory.embed.provider`
- 现有 contracts/server config 测试全绿

```bash
pnpm --filter @ss-ai/server test
```

### 手工可观察验收

1. 改 `apps/server/config/config.local.json`，把 `defaultModelAssignments.memory.embed.provider` 故意写成 `"not-a-provider"`，启动：
   ```bash
   pnpm run dev:server
   ```
   **期望**：启动时配置校验失败，错误信息清晰指向 `memory.embed`。
2. 改回正确值，再启动一次：服务正常起来。
3. 已登录后调：
    ```bash
    curl -s "http://localhost:8999/v1/user-preference" | jq .
    ```
    **期望**：返回的 `modelAssignments` 包含 `memory.embed`，且 effective assignment 来自 default 或 user。

---

## Step 3: Embedding Probe + Minimal Adapter（真实调用） ✅ 已完成（自动测试部分）

### 范围

配置完 `memory.embed` 后，下一步先验证真实 embedding 调用是否可用。本步不接 commit service、不接 SQLite、不接 chat turn，只打通最小 embedding vertical slice。

- `packages/persona-flow/src/llm/modelClient.ts`: 增加最小 `embed?(input: ModelEmbedInput): Promise<ModelEmbedResult>` 可选方法和相关类型。
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`: 实现 `embed()`，调用 Mistral embeddings API。
- `packages/persona-flow/src/memoryAdapters/modelClientEmbeddingProvider.ts`: 实现 `MemoryEmbeddingProvider` adapter，从 `memory.embed` assignment 解析 provider/model 后调用 `modelClient.embed()`。
- `packages/persona-flow-model-client/mistral-embed-probe.mjs`: 新增真实 API probe 脚本。

Adapter 放在 `src/memoryAdapters/**` 或其它边界目录，不放进 `src/memory/**`。`src/memory/**` 仍然只保留核心类型、端口、算法和 service，避免未来抽包时被 `ModelRuntime` / provider client 污染。

### 编译验收

```bash
pnpm --filter @ss-ai/persona-flow-model-client build
pnpm --filter @ss-ai/persona-flow build
```

### 自动测试

- `packages/persona-flow-model-client/test/mistralEmbed.test.ts`：mock Mistral SDK，验证请求体、响应转换、错误转发。
- `packages/persona-flow/test/modelClientEmbeddingProvider.test.ts`：
  - 从 `defaultModelAssignments["memory.embed"]` 或用户 assignment 解析到正确 provider/model。
  - 缺失 `memory.embed` assignment → 抛清晰错误。
  - model client 不支持 `embed()` → 抛清晰错误。
  - model client `embed()` 抛错 → adapter 抛 typed error。
  - 返回结果带正确 metadata：provider、model、dim、version。

```bash
pnpm --filter @ss-ai/persona-flow-model-client test
pnpm --filter @ss-ai/persona-flow test
```

### 手工可观察验收

新增 `packages/persona-flow-model-client/mistral-embed-probe.mjs`（仿照已有的 `mistral-stream-probe.mjs`）：

```js
import { Mistral } from "@mistralai/mistralai";

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const r = await client.embeddings.create({
    model: "mistral-embed",
    inputs: ["我喜欢玩游戏", "玩游戏的用户", "用户住在东京"],
});

const cosine = (a, b) => {
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        aa += a[i] * a[i];
        bb += b[i] * b[i];
    }
    return dot / (Math.sqrt(aa) * Math.sqrt(bb));
};

console.log("count:", r.data.length);
console.log("dim:", r.data[0].embedding.length);
console.log("usage:", r.usage);
console.log("first 5 dims:", r.data[0].embedding.slice(0, 5));
console.log("sim(game, game-user):", cosine(r.data[0].embedding, r.data[1].embedding));
console.log("sim(game, tokyo):", cosine(r.data[0].embedding, r.data[2].embedding));
```

跑：

```bash
node packages/persona-flow-model-client/mistral-embed-probe.mjs
```

**验收点**：
- 真实打到 Mistral API（用 dev key），返回 3 条 embedding。
- `dim` 数字记下来，后续作为默认 `dimensions` 或测试 fixture 参考。
- `usage` 显示 token 数。
- `sim(game, game-user)` 应明显高于 `sim(game, tokyo)`。
- 如果 API 报错，先在本步修 provider/model/request shape，不要等到 Step 6 才发现。

这一步**特别重要**：provider 实际行为（rate limit、批量大小、token 计费、返回格式）只有真打才知道，越早打越好。

---

## Step 4: MemoryCandidateRecorder + MemoryCommitService（fake stores）✅ 已完成（自动测试部分）

### 范围

- `packages/persona-flow/src/memory/candidateRecorder.ts`: 实现 `MemoryCandidateRecorder`
- `packages/persona-flow/src/memory/commitService.ts`: 实现 `MemoryCommitService`
- `packages/persona-flow/src/memory/index.ts`: 补导出

用内存 fake `MemoryCandidateStore` / `MemoryStore` / `MemoryDecisionStore` / `MemoryEmbeddingProvider` 驱动测试。本步**不接 SQLite，不接 chat turn**，但接口形状要和 Step 3 的真实 adapter 对齐。

### 编译验收

```bash
pnpm --filter @ss-ai/persona-flow build
```

### 自动测试

新增 `packages/persona-flow/test/memoryCandidateRecorder.test.ts`：

- 空候选数组 → 直接 return，不调 store
- 文本 trim 后为空的候选被丢弃
- 每条候选生成正确的 source/seq/normalizedText
- store 抛错时 recorder warn 但不上抛
- 返回保存成功的 records

新增 `packages/persona-flow/test/memoryCommitService.test.ts`：

- 无相似 memory → `create`，写入 memory store + decision
- exact normalized duplicate → `ignore_duplicate`
- 最高相似度 ≥ `needsJudgeThreshold` → `needs_judge`，不创建 memory
- 低价值候选 → `ignore_low_value`，不调 embedding provider
- embedding provider 抛错 → `embedding_failed`，不抛到调用方
- embedding metadata（provider/model/dim/version）不一致的 memory 被跳过比较，并记录 skipped reason
- 多条候选时，一条失败不影响其它
- verbose logger 至少收到 `candidate_received`、`embedding_requested`、`similarity_scan_finished`、`decision_made` 几个 stage 事件

```bash
pnpm --filter @ss-ai/persona-flow test
```

### 手工可观察验收

新增 `packages/persona-flow/scripts/try-commit-service.mts`：

```ts
import { MemoryCommitService, MemoryCandidateRecorder } from "../src/memory/index.js";
import { makeInMemoryMemoryStores, makeFakeEmbeddingProvider } from "./helpers/memoryFakes.js";

const stores = makeInMemoryMemoryStores();
const embed = makeFakeEmbeddingProvider({ dim: 8 });
const clock = { nowIso: () => new Date().toISOString() };
const ids = { randomId: () => Math.random().toString(36).slice(2) };

const recorder = new MemoryCandidateRecorder({ candidateStore: stores.candidateStore, clock, ids });
const commit = new MemoryCommitService({
    candidateStore: stores.candidateStore,
    memoryStore: stores.memoryStore,
    decisionStore: stores.decisionStore,
    embeddingProvider: embed,
    clock,
    ids,
    logger: console as any,
});

const source = {
    userId: "u1", characterId: "c1", conversationId: "conv1",
    userMessageId: "m1", assistantMessageId: "m2", requestId: "r1",
    modelCallPurpose: "chat.main",
};

// 第一次：3 条候选，预期都 create
const first = await recorder.recordCandidates({
    source,
    candidates: [
        { scope: "user", type: "fact", text: "用户喜欢玩游戏" },
        { scope: "user", type: "fact", text: "用户讨厌咖啡" },
        { scope: "user", type: "fact", text: "用户住在东京" },
    ],
});
await commit.commitCandidates({ candidates: first });

// 第二次：再喂一条几乎一样的，预期 needs_judge 或 ignore_duplicate
const second = await recorder.recordCandidates({
    source: { ...source, assistantMessageId: "m4", requestId: "r2", userMessageId: "m3" },
    candidates: [{ scope: "user", type: "fact", text: "用户喜欢游戏" }],
});
await commit.commitCandidates({ candidates: second });

console.log("memories:", await stores.memoryStore.listActiveMemories({ userId: "u1", characterId: "c1", scope: "user", type: "fact", limit: 100 }));
console.log("decisions:", await stores.decisionStore.listDecisions({ userId: "u1", candidateId: undefined, limit: 100 }));
```

跑：

```bash
pnpm tsx packages/persona-flow/scripts/try-commit-service.mts
```

**验收点**：
- 第一次 3 条全部 `decision === "create"`，`memories` 表里 3 行
- 第二次那条相似的，`decision === "needs_judge"`，`memories` 表仍然 3 行（没被覆盖）
- console 打印的 verbose log 能清晰看到每个 stage

这个脚本保留下来，后续每次改 policy 都跑一次。

---

## Step 5: SQLite Schema + Stores

### 当前实现边界

到 Step 4 为止，已经实现的是 **memory 写入的 core/service 层**：`MemoryCandidateRecorder` 能把候选写入注入的 `MemoryCandidateStore`，`MemoryCommitService` 能通过注入的 `MemoryStore` / `MemoryDecisionStore` 创建 active memory 和 decision，并且已有 fake store 测试覆盖。

但这还不是应用端到端的持久化写入：当前 chat turn 仍然只做 log-only，SQLite 里也还没有 `memory_candidates` / `memories` / `memory_decisions` 的具体表和 store。因此 Step 5 是把这些已经存在的 core ports 落到 SQLite 的第一步，Step 6 才是把它们接入聊天流程。

### 范围

- `packages/persona-flow-sqlite/src/db/schema.ts`: 新增 `memory_candidates`、`memories`、`memory_decisions` 表定义 + 索引
- `packages/persona-flow-sqlite/src/db/SQLiteMemoryCandidateStore.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMemoryStore.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMemoryDecisionStore.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`: 导出新 stores
- 如果有 `CharacterDbRouter`：让 memory 表跟着 character DB 走

本步不要重复实现 Step 4 的判断逻辑；SQLite store 只负责把 `packages/persona-flow/src/memory/ports.ts` 里的端口可靠落库。

跨 `createMemory()`、candidate status update、decision append 的事务边界已经记录为后续 TODO。本步如果还不做 composite transaction / UnitOfWork，文档和测试里要明确这是已知限制；不要让调用方误以为 create + finalize 已经原子化。

`memory_debug_events` 表本步**不做**，留到 Step 8 触发时再加。

### 编译验收

```bash
pnpm --filter @ss-ai/persona-flow-sqlite build
```

### 自动测试

新增 `packages/persona-flow-sqlite/test/memoryStores.test.ts`：

- `appendCandidates` 写多条、`seq` 单调递增
- `listCandidates` 按 `conversationId` / `assistantMessageId` / `status` 过滤
- `updateCandidateStatus` / `saveCandidateEmbedding` 回写正确
- `createMemory` + `listActiveMemories` 按 user/character/scope/type/status
- `findExactActiveMemory` 用 normalized text 命中
- `appendDecision` + `listDecisions` 保存 similarityJson 正常
- embedding JSON 损坏时返回 `undefined` + warn，不抛
- 用 `CharacterDbRouter` 时表落在正确的 character DB

```bash
pnpm --filter @ss-ai/persona-flow-sqlite test
```

### 手工可观察验收

新增 `packages/persona-flow-sqlite/scripts/try-memory-store.mts`：

```ts
import { createSqliteStores } from "../src/createSqliteStores.js";

const stores = createSqliteStores({ dbPath: "./tmp-memory.db", /* 其它必要参数 */ });

await stores.memoryCandidateStore.appendCandidates({
    source: { userId: "u1", characterId: "c1", conversationId: "conv1", userMessageId: "m1", assistantMessageId: "m2", requestId: "r1", modelCallPurpose: "chat.main" },
    candidates: [
        { scope: "user", type: "fact", text: "User likes hiking." },
        { scope: "user", type: "preference", text: "User dislikes coffee." },
    ],
});

const rows = await stores.memoryCandidateStore.listCandidates({ userId: "u1", limit: 100 });
console.log("candidates:", rows);
```

跑：

```bash
pnpm tsx packages/persona-flow-sqlite/scripts/try-memory-store.mts
```

**验收点**：
- 控制台输出两条 candidate row
- 用 `sqlite3 tmp-memory.db` 或 DB Browser 打开：
  - 表结构（`.schema memory_candidates`）符合预期
  - 数据可读，JSON 字段 `[]` 而不是 NULL
  - `EXPLAIN QUERY PLAN SELECT * FROM memory_candidates WHERE user_id = 'u1' AND status = 'pending'` 显示使用了索引
- 删掉 `tmp-memory.db` 不留垃圾

---

## Step 6: Chat Turn 集成（端到端） ✅

### 范围

- `PersonaFlowChatTurnService.chatTurn()` / `streamTurn()`: 在 `appendAssistantTurn` 之后调用 `MemoryCandidateRecorder` + `MemoryCommitService`，fail-soft
- 保留 Batch 1 的 `memoryCandidateLogger` 作为 commit service 的一个 logger sink（避免一次砍掉太多）
- 接入 `MemoryFeatureConfig`（至少 `enabled` + `immediateCommitEnabled`）到 server config、config schema、default config
- `apps/server/src/index.ts` / `composeStores`：把 memory stores + embedding adapter 接到 chat turn service

### 编译验收

```bash
pnpm run build
```

### 自动测试

- 现有 60 条 persona-flow + 80 条 server 测试不回归

新增测试覆盖：

- chat turn 有候选时调用 recorder + commit
- 空候选时不调用
- recorder 抛错 → chat 仍成功
- commit service 抛错或返回 error outcome → chat 仍成功
- stream turn 同上
- `MemoryFeatureConfig.enabled = false` → 完全跳过 memory pipeline（连 recorder 都不调）

### 手工可观察验收

启动完整栈：

```bash
pnpm run dev:server
pnpm run dev:web
```

在前端发送一条诱导性消息："我喜欢玩游戏，帮我记住"。然后查询 core `app.db`（不再是 character DB —— 见 Step 5 设计决策）：

```bash
sqlite3 <userData>/app.db "SELECT id, scope, type, text, status FROM memory_candidates ORDER BY created_at DESC LIMIT 5"
sqlite3 <userData>/app.db "SELECT id, scope, type, text, importance FROM memories ORDER BY created_at DESC LIMIT 5"
sqlite3 <userData>/app.db "SELECT decision, reason, memory_id, similarity_json FROM memory_decisions ORDER BY created_at DESC LIMIT 5"
```

**验收点**：
- `memory_candidates` 多一行，`status` 是 `committed` 或 `needs_judge`
- 如果是 `create` decision，`memories` 多一行
- `memory_decisions` 多一行，`similarity_json` 是合法 JSON
- 服务器日志能看到完整 verbose stage 链
- 再发一条相似消息，验证第二条进 `needs_judge`、`memories` 表没增加新行
- 把 `config.local.json` 里 `memory.enabled` 设为 false，重启，再发消息：上述三个表不变化

### 实施纪要 (2026-06)

- 新增 `packages/persona-flow/src/memory/featureConfig.ts`：`MemoryFeatureConfig` + `DEFAULT_MEMORY_FEATURE_CONFIG`，从 `@ss-ai/persona-flow` 包根 re-export。
- `PersonaFlowChatTurnServiceDependencies` 新增可选 `memory?: PersonaFlowChatTurnMemoryDeps`（包含 `recorder` / `commitService` / 可选 `config`）。未提供时回退到 Batch 1 仅日志的行为，保持向后兼容。
- `chatTurn()` 与 `streamTurn()` 都把原先的 `safeLogMemoryWriteCandidates(...)` 替换为 `await this.safeHandleMemoryWriteCandidates(...)`：
  1. **总是**先调用 `logMemoryWriteCandidates`（Batch 1 INFO 行），保证可观测性不下降。
  2. 没装 memory deps 或 `enabled === false` → 跳出，不调用 recorder/commit。
  3. 没有候选 → 跳出。
  4. 调 `recorder.recordCandidates(...)`，再按 `immediateCommitEnabled` 决定是否调 `commitService.commitCandidates(...)`。
  5. 整段 `try/catch`，任何异常只 WARN 日志，不会让 chat turn 失败。
- 服务端 `RuntimeConfig.memory` 字段类型直接复用 persona-flow 导出的 `MemoryFeatureConfig`；新增 `apps/server/config/config.default.json` 的 `"memory"` 段（默认全开）、扩展 `apps/server/schemas/config.schema.json`。
- 服务端 `apps/server/src/http/apis/chat/chatUtil.ts` 在原有 `DefaultModelClient` 之外，构造 `ModelClientEmbeddingProvider`、`MemoryCandidateRecorder`、`MemoryCommitService`，把它们 + `context.config.memory` 一起传给 `PersonaFlowChatTurnService`。memory 服务复用 chat 用的同一份 `defaultModelAssignments` / `defaultProviderApiKeys` —— embedding 走 `memory.embed` purpose，与 chat 的 provider 解析路径一致。
- 测试：新增 `packages/persona-flow/test/personaFlowChatTurnMemoryIntegration.test.ts`（7 条），覆盖：
  - 默认配置下 recorder + commit 都执行，`memory_candidates`/`memories`/`memory_decisions` 三表都被写入。
  - `immediateCommitEnabled = false` 时只 record 不 commit。
  - `enabled = false` 时 recorder/commit 都不调，但 Batch 1 INFO 行仍然输出。
  - 没有候选时两步都不调。
  - recorder 抛错 / commit 抛错 → chat 仍返回成功 + WARN `persona-flow/memory: write pipeline failed`。
  - streamTurn 也跑完整 pipeline。
- 全仓库测试：312 通过（persona-flow 135 / qq-bot 8 / model-client 31 / sqlite 52 / server 86）。

### 设计决策

- **Batch 1 INFO 行始终保留**：原本想用 commit service 的 stage 日志完全取代它，但那会让一直依赖 `persona-flow/memory: candidates logged` 的运维查询失效。改为"两层并存"：Batch 1 是高层摘要，commit service 的 `memory.commit.*` 是细粒度链路。Disable memory 时只关 Batch 2，summary 行还在。
- **memory deps 是可选的 (`memory?:`)**：很多 persona-flow 单元测试不关心 memory 流程，让 deps 必填会强迫每个测试都 wire fake stores + recorder + commit service。可选并默认回退到 Batch 1 是最低侵入式的设计。
- **服务端构造放在 `chatUtil.ts` 而不是 `composeStores`**：memory pipeline 依赖 `modelClient` + `defaultModelAssignments`，而这两个本来就在 `chatUtil.ts` 里组装。挪到 `composeStores` 反而要把 model 相关参数也搬过去。等 Step 7 debug API 出现独立路由时再看是否值得抽提。
- **`MemoryFeatureConfig` 类型放在 persona-flow 而不是 server**：是因为 chat turn service 是 persona-flow 的入口点；server 只是它的一个 consumer。把类型放 persona-flow 让 qq-bot 等其它 consumer 直接复用。

---

## Step 7: Debug API（contracts + server routes）

### 范围

- `packages/contracts/src/apis/memory.api.ts`:
  - `ApiListMemoryCandidates`（GET `/v1/debug/memory-candidates`）
  - `ApiListMemories`（GET `/v1/debug/memories`）
  - `ApiListMemoryDecisions`（GET `/v1/debug/memory-decisions`）
- `apps/server/src/http/memoryDebugRoutes.ts`: 实现这 3 个路由，强制 `userId = req.user.id`，`limit` 默认 100 上限 500

`ApiListMemoryDebugEvents` 留到 Step 8。

### 编译验收

```bash
pnpm run build
```

### 自动测试

新增 `apps/server/test/memoryDebug.test.ts`：

- 未登录 → 401
- 已登录 → 只返回当前用户数据（fixture 注入两个用户，断言隔离）
- `limit` 默认 100、超过 500 被夹紧到 500
- `conversationId` / `assistantMessageId` / `status` / `decision` 等过滤生效
- 现有 80 条 server 测试不回归

### 手工可观察验收

```bash
# 登录拿到 token / cookie 后
curl -s "http://localhost:8999/v1/debug/memory-candidates?limit=20" | jq .
curl -s "http://localhost:8999/v1/debug/memories?characterId=c1" | jq .
curl -s "http://localhost:8999/v1/debug/memory-decisions?decision=needs_judge" | jq .
```

**验收点**：
- 三个 API 都返回 200 + 合理 JSON
- 数据和 Step 6 用 sqlite3 看到的一致
- 不登录请求被拦
- 用另一个用户 token 调，看不到本用户的数据

---

## Step 8（可选）: `memory_debug_events` 表 + Debug Events API

**触发条件**：Step 6 完成后开始调参，发现普通 logger 找过程太繁琐时再做。

### 范围

- SQLite schema 加 `memory_debug_events` 表
- 实现 `SQLiteMemoryDebugEventStore`
- `MemoryCommitService` 的 logger sink 多加一个"落表" sink（保留 console sink）
- contracts + server route 加第 4 个 debug API

### 验收

- 单元测试 + 手工 `curl /v1/debug/memory-debug-events?candidateId=xxx`
- 验证一个 candidate 能看到完整 stage 链

---

## 跨步骤的"安全网"

**每一步做完跑**：

```bash
pnpm run build
pnpm run test
```

当前基线（Batch 1 结束时）：

| Package | 测试数 |
| --- | --- |
| persona-flow | 60 |
| persona-flow-model-client | 16 |
| persona-flow-sqlite | 35 |
| server | 80 |
| qq-bot | 8 |
| **合计** | **199** |

测试数量只能作为参考，不作为唯一通过标准。每一步的真正完成标准是：全量 build/test 通过、本步新增测试通过、手工验收点可观察。

---

## 节奏建议

最小可演示集合（如果时间紧）：**Step 1 + 2 + 3 + 4 + 5 + 6**。可以跳过 Step 7 直接 `sqlite3` 看表。Step 3 不建议跳过，因为它能最早暴露 provider/model/API shape 问题。

完整建议路径：**Step 1 → 2 → 3 → 4 → 5 → 6 → 7**，Step 8 按需。

每一步建议作为一个独立 PR，便于 review 和回滚。

---

## 各步骤之间的依赖

```
Step 1 (纯算法) ──┬─→ Step 4 (recorder + commit service, fake stores)
                  │
Step 2 (purpose) ─┤
                  │
                  ├─→ Step 3 (embedding probe + minimal adapter)
                  │
                  └─→ Step 5 (SQLite stores)

Step 3 + 4 + 5 ────→ Step 6 (chat turn 集成, 端到端)

Step 5 ────────────→ Step 7 (debug API)
```

- Step 1、2 之间无依赖，可并行
- Step 3 依赖 Step 1 + 2
- Step 4 依赖 Step 1，接口形状应与 Step 3 对齐
- Step 5 依赖 Step 1（用领域类型）
- Step 6 依赖 Step 3、4、5
- Step 7 依赖 Step 5
- Step 8 依赖 Step 6 + 7

---

## 实操工具：`try-*.mts` 脚本

Step 1、3、4、5 都会生成一个 `scripts/try-*` 脚本。这些脚本有三个长期价值：

1. **当下手工验收**：每步做完先跑一次脚本看输出。
2. **后期调参**：改 `decisionPolicy` 阈值后，秒级重跑确认效果。
3. **Onboarding**：新人看脚本能快速理解模块边界。

建议留在仓库里，不要做完一步就删。

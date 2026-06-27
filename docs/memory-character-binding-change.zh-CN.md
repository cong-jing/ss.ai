# Memory 绑定 Character 修改说明

## 背景

当前 memory 写入实现里，`scope` 的语义有偏差。

现有实现把 `character` / `conversation` / `relationship` 绑定到当前 `characterId`，但把 `user` / `world` 当成跨 character 的全局记忆，存储时可能出现 `character_id = NULL`。

这不符合当前产品设计。

当前设计是：一个 character 就是一个独立世界。memory 写入、查重、相似度扫描、decision 都必须限定在当前 character 内。

因此，`scope` 不应该决定 memory 是否跨 character。`scope` 只表示当前 character 世界内的记忆分类。

例如：

- `user`: 当前 character 世界里，关于用户的事实或偏好。
- `character`: 当前 character 自身的事实。
- `relationship`: 当前 user 与当前 character 的关系事实。
- `conversation`: 当前 character 下某次 conversation 的状态或事件。
- `world`: 当前 character 的世界观或设定。

所有这些 scope 都必须存储当前 `characterId`。

## 修改目标

把 memory 子系统从“部分 scope 可以跨 character”改成“所有 memory 都绑定当前 character”。

具体要求：

- active memory 必须有 `characterId`。
- memory decision 必须有 `characterId`。
- exact duplicate check 必须按 `userId + characterId + scope + type + normalizedText` 判断。
- similarity scan 必须只扫描同一个 `userId + characterId + scope + type` bucket。
- SQLite 中不再用 `character_id IS NULL` 表示全局 memory。
- 不同 character 下，即使 userId 相同、文本相同，也应该是不同世界中的不同 memory。

## Prompt 是否需要修改

这次不需要大改 prompt。

LLM 只负责输出 `memoryWriteCandidates`，不需要知道最终是否跨 character 存储。character 隔离是后端存储和查询层的职责。

可以保留当前 prompt 里的 `scope` 说明。最多只在以后觉得必要时，补一句“scope 是记忆分类”，不需要强调 character 之间是否共享。

## 需要修改的代码

### 1. 修改 domain types

文件：`packages/persona-flow/src/memory/types.ts`

把 `ActiveMemoryRecord.characterId` 改成必填：

```ts
export interface ActiveMemoryRecord {
    id: string;
    userId: string;
    characterId: string;
    // ...
}
```

把 `MemoryDecisionRecord.characterId` 改成必填：

```ts
export interface MemoryDecisionRecord {
    id: string;
    candidateId: string;
    userId: string;
    characterId: string;
    // ...
}
```

### 2. 修改 memory ports

文件：`packages/persona-flow/src/memory/ports.ts`

把这些输入里的 `characterId` 改成必填 string：

```ts
export interface CreateMemoryInput {
    userId: string;
    characterId: string;
    // ...
}

export interface ListActiveMemoriesInput {
    userId: string;
    characterId: string;
    // ...
}

export interface FindExactActiveMemoryInput {
    userId: string;
    characterId: string;
    // ...
}

export interface AppendMemoryDecisionInput {
    candidateId: string;
    userId: string;
    characterId: string;
    // ...
}
```

同时删除或改写注释里关于 `characterId: null`、`world memories may have no characterId`、`no character filter` 之类的描述。

新的注释重点：`characterId` 是 memory 的隔离边界；所有 memory 查询都必须限定在当前 character。

### 3. 修改 `MemoryCommitService`

文件：`packages/persona-flow/src/memory/commitService.ts`

当前 `scopeCharacterId()` 是核心问题。它现在会让 `user` / `world` 返回 `null`。

需要删除这个语义。

所有地方统一使用：

```ts
candidate.source.characterId
```

需要修改的位置包括：

```ts
await this.deps.memoryStore.findExactActiveMemory({
    userId: candidate.source.userId,
    characterId: candidate.source.characterId,
    scope: candidate.scope,
    type: candidate.type,
    normalizedText: candidate.normalizedText,
});
```

```ts
await this.deps.memoryStore.listActiveMemories({
    userId: candidate.source.userId,
    characterId: candidate.source.characterId,
    scope: candidate.scope,
    type: candidate.type,
    status: "active",
    limit: this.listLimit,
});
```

```ts
await this.deps.memoryStore.createMemory({
    userId: candidate.source.userId,
    characterId: candidate.source.characterId,
    // ...
});
```

```ts
await this.deps.decisionStore.appendDecision({
    candidateId: args.candidate.id,
    userId: args.candidate.source.userId,
    characterId: args.candidate.source.characterId,
    // ...
});
```

删除所有类似下面的写法：

```ts
this.scopeCharacterId(candidate) ?? undefined
```

以及所有把 `user` / `world` scope 转成 `null` 的逻辑。

### 4. 修改 SQLite schema

文件：`packages/persona-flow-sqlite/src/db/schema.ts`

把 `memories.characterId` 改成 not null：

```ts
characterId: text("character_id").notNull(),
```

把 `memoryDecisions.characterId` 改成 not null：

```ts
characterId: text("character_id").notNull(),
```

`memoryCandidates.characterId` 已经是 not null，不需要改。

### 5. 修改 SQLite table creation

文件：`packages/persona-flow-sqlite/src/db/openDatabase.ts`

修改 `memories` 表：

```sql
character_id TEXT NOT NULL,
```

修改 `memory_decisions` 表：

```sql
character_id TEXT NOT NULL,
```

同时改掉注释里关于 `user/world memories transcend a single character`、`characterId is NULL` 等旧描述。

注意：`CREATE TABLE IF NOT EXISTS` 不会自动修改已有表。如果本地 dev DB 已经按旧 schema 建过表，可以先清掉 runtime DB。若要兼容旧 DB，需要另写迁移：优先通过 `source_candidate_id -> memory_candidates.character_id` 回填旧 memory 的 character_id。

### 6. 修改 `SQLiteMemoryStore`

文件：`packages/persona-flow-sqlite/src/db/SQLiteMemoryStore.ts`

去掉三态 `characterId` 语义。

旧语义是：

- `undefined`: 不过滤 character。
- `null`: 查 `character_id IS NULL`。
- `string`: 查指定 character。

新语义是：

- `characterId` 必填。
- 永远按 `character_id = input.characterId` 过滤。

修改 `createMemory()`：

```ts
characterId: input.characterId,
```

不要再写：

```ts
characterId: input.characterId ?? null,
```

修改 `listActiveMemories()`：

```ts
const conditions = [
    eq(memories.userId, input.userId),
    eq(memories.characterId, input.characterId),
];
```

删除 `isNull(memories.characterId)` 分支。

修改 `findExactActiveMemory()`：

```ts
const conditions = [
    eq(memories.userId, input.userId),
    eq(memories.characterId, input.characterId),
    eq(memories.scope, input.scope),
    eq(memories.type, input.type),
    eq(memories.normalizedText, input.normalizedText),
    eq(memories.status, "active"),
];
```

修改 `rowToRecord()`：

```ts
characterId: row.characterId,
```

不要再写：

```ts
characterId: row.characterId ?? undefined,
```

如果 `isNull` 不再使用，移除对应 import。

### 7. 修改 `SQLiteMemoryDecisionStore`

文件：`packages/persona-flow-sqlite/src/db/SQLiteMemoryDecisionStore.ts`

写入时：

```ts
characterId: input.characterId,
```

不要再写：

```ts
characterId: input.characterId ?? null,
```

读出时：

```ts
characterId: row.characterId,
```

不要再写：

```ts
characterId: row.characterId ?? undefined,
```

### 8. 修改 in-memory fakes / test stores

需要检查：

- `packages/persona-flow/test/helpers/memoryFakes.ts`
- `packages/persona-flow/test/helpers/inMemoryStores.ts`
- `apps/server/test/helpers/inMemoryMemoryStores.ts`

原则：

- memory record 必须始终有 `characterId`。
- decision record 必须始终有 `characterId`。
- `listActiveMemories()` 必须按 `characterId` 精确过滤。
- `findExactActiveMemory()` 必须按 `characterId` 精确过滤。
- 不再支持 `characterId: null` 或省略 character filter。

### 9. 修改测试

重点是把旧的跨角色语义反转掉。

#### `packages/persona-flow-sqlite/test/memoryStores.test.ts`

删除或改写：

- `three-way characterId semantics`
- `characterId: null`
- `crossCharacter`
- `characterId omitted -> NULL in DB`

新增或改成：

- `scope: "user"` 的 memory 也必须存 `characterId`。
- `scope: "world"` 的 memory 也必须存 `characterId`。
- 同一个 user、同一个 normalizedText、同一个 scope/type，但不同 character，可以各自存在。
- `listActiveMemories({ userId, characterId: "char-A" })` 不返回 `char-B` 的 memory。
- `findExactActiveMemory()` 只在同 character 命中。

#### `packages/persona-flow/test/memoryCommitService.test.ts`

新增或改成：

- candidate `scope = "user"` 时，创建出的 memory 带 `candidate.source.characterId`。
- candidate `scope = "world"` 时，创建出的 memory 也带 `candidate.source.characterId`。
- exact duplicate 对 `user/world` scope 也只在同 character 内命中。
- similarity scan 对 `user/world` scope 也只扫描同 character memories。

#### `packages/persona-flow/test/personaFlowChatTurnMemoryIntegration.test.ts`

确认 Step 6 集成测试里：

- chat turn 写出的 candidate、memory、decision 都带当前 `characterId`。
- 如果已有断言不足，补一条 `scope: "user"` 写入后 `memory.characterId === currentCharacterId`。

### 10. 修改文档

至少检查并更新：

- `docs/memory-module.zh-CN.md`
- `docs/memory-write-batch2-steps.zh-CN.md`
- `docs/memory-write-batch2.zh-CN.md`
- `docs/project-map.md`

删除或改写所有类似表述：

- `user/world scope 返回 null`
- `跨角色记忆`
- `character_id IS NULL`
- `user/world memories transcend a single character`
- `relationship/world memories may have no characterId`
- `characterId: null`

新的文档语义：

- 所有 memory 都绑定当前 character。
- `scope` 是当前 character 世界内的分类。
- `characterId` 是 memory 查询、查重、相似度扫描和 decision 的隔离边界。
- 不同 character 下，即使 userId 相同、文本相同，也应该视为不同世界中的 memory。

## 验证命令

完成修改后至少运行：

```bash
pnpm --filter @ss-ai/contracts build
pnpm --filter @ss-ai/persona-flow test
pnpm --filter @ss-ai/persona-flow build
pnpm --filter @ss-ai/persona-flow-sqlite test
pnpm --filter @ss-ai/persona-flow-sqlite build
pnpm --filter @ss-ai/server test
pnpm --filter @ss-ai/server build
pnpm run build
```

## 手工验收建议

用临时 SQLite DB 或本地 dev DB 跑一次 chat turn：

1. character A 下发送“请记住：我喜欢咖啡”。
2. character B 下发送同样内容。
3. 查询 `memories`。

```sql
SELECT character_id, scope, type, text, status FROM memories;
```

期望看到两条 memory：

- 一条 `character_id = char-A`。
- 一条 `character_id = char-B`。

即使 `scope = 'user'`，也不能出现 `character_id IS NULL`。

再查：

```sql
SELECT character_id, decision, memory_id FROM memory_decisions;
```

期望：

- 每条 decision 都有非空 `character_id`。
- 不存在 `character_id IS NULL`。

## 暂不建议做的事

- 暂不删除 `scope = "user"` 或 `scope = "world"`。
- 暂不大改 prompt。
- 暂不要求 LLM 理解 character 隔离规则。

这次改动的核心只有一个：`characterId` 从 optional / nullable 变成 memory 系统的必填隔离键。
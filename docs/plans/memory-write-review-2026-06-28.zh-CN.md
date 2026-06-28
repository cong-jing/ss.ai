# Memory Write Review - 2026-06-28

本文档记录 `memory-write` 分支相对 `staging` 的本轮 code review 结果，以及后续逐条分析。

## Review 结论

### 1. P1 - typecheck 当前失败

当前 runtime 测试可以跑过，但 `tsc --noEmit` 不能通过，因此分支不能干净进入常规 CI / build 流程。

复现命令：

```bash
pnpm --filter @ss-ai/persona-flow typecheck
pnpm --filter @ss-ai/persona-flow-sqlite typecheck
```

已观察到的错误：

- `packages/persona-flow/test/personaFlowChatTurnMemoryIntegration.test.ts` 从 `../src/index.js` 导入 `MemoryWriteCandidate`，但 `packages/persona-flow/src/index.ts` 并没有导出这个 contracts 类型。
- `packages/persona-flow-sqlite/test/memoryStores.test.ts` 中测试 logger 的 payload 类型标注为 `Record<string, unknown>`，但 `MemoryLogger` 的 payload 参数是 `unknown`。
- 同一个 SQLite 测试文件中，`base` 对象使用 `as const` 后，`similarity: []` 被推导为 `readonly []`，不能传给 `AppendMemoryDecisionInput.similarity` 所需的可变数组类型。

### 2. P2 - 用户偏好接口缺少 model assignment capability 校验

`apps/server/src/http/apis/userPreference.route.ts` 的 `upsertModelAssignment` 只校验 purpose 合法以及 provider/model 非空，然后直接保存。

风险：

- 客户端可以把 `memory.embed` 保存成 chat 模型。
- 客户端也可以保存一个不在 server config 里的 provider/model 组合。
- 默认配置加载路径已经在 `apps/server/src/util/config.ts` 校验 capability category，但用户覆盖路径没有复用同等规则。
- 结果会在聊天后的 memory commit 阶段表现为 embedding failure；由于 memory pipeline fail-soft，用户看到的是“设置保存成功，但记忆写入长期不可用”。

建议：

- 在 `upsertModelAssignment` 里复用或抽出默认配置的校验逻辑。
- provider 必须存在于 `context.config.models`。
- 如果目标 category 的 `availableModels[category]` 非空，model 必须属于该列表。

### 3. P3 - 删除用户 API key 后前端会清空静态模型列表

`apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts` 在 delete API key 成功后执行：

```ts
p.availableModels = { chat: [], embed: [] };
```

风险：

- 如果 provider 仍有 default API key，或者 server config 静态提供了 `availableModels`，前端会在下一次刷新前把模型选择器置为空。
- 这会让 default assignment 或静态可选模型短暂表现为不可选。

建议：

- delete API 返回最新 `availableModels`，前端用响应覆盖。
- 或前端删除 key 后保留已有静态列表，只更新 `effectiveApiKeySource`。

## 问题 1 分析

问题：当前是否有代码的类型引用还在用 `dist` 输出，没有直接引用 ts 代码？按预定，测试应通过 `tsx` 跑，不需要先 build，也不应依赖 `dist`。

当前结论：这次 P1 失败不像是测试误用了 `dist` 旧产物。它更像是测试源码自身的 type import / type annotation 问题。

依据：

- `packages/persona-flow/package.json` 的 package export 同时声明了：
  - `source: ./src/index.ts`
  - `types: ./src/index.ts`
  - `import: ./dist/index.js`
- `packages/persona-flow-sqlite/package.json`、`packages/persona-flow-model-client/package.json`、`packages/contracts/package.json` 也采用同样模式：运行时 import 指向 `dist`，类型入口指向 `src`。
- `packages/persona-flow` 的测试大多直接从 `../src/**` 引用源码；触发错误的文件也是从 `../src/index.js` 引用源码入口，不是从 package 的 `dist` 入口引用。
- `packages/persona-flow-sqlite` 的测试源码直接从 `../src/index.js` 引用本包源码；它对 `@ss-ai/persona-flow` 的类型引用会通过 package `types` 指到 `packages/persona-flow/src/index.ts`，不是 `dist/index.d.ts`。
- 显式 `dist/` 引用主要存在于各 package 的 `package.json` `main` / `exports.import` / start scripts 中，以及 `ajv/dist/2020.js` 这种第三方库内部 subpath；没有看到测试文件显式引用本仓库包的 `../dist`。

为什么 runtime tests 会过但 typecheck 失败：

- `tsx --test` 执行测试时会转译并运行 TypeScript，但不会像 `tsc --noEmit` 一样完整做类型检查。
- `MemoryWriteCandidate` 在 `personaFlowChatTurnMemoryIntegration.test.ts` 中是 `import type`，运行时会被擦除，所以测试能过。
- SQLite 测试里的 payload / readonly array 问题也是纯类型层面的，不影响 runtime 行为。

建议修复方向：

- `MemoryWriteCandidate` 应该从 `@ss-ai/contracts` 或 `@ss-ai/contracts/memoryCandidates.schema` 对应纯类型来源导入，而不是期待 `@ss-ai/persona-flow` 根入口转出口。
- SQLite 测试 logger 的 payload 数组类型应改成 `unknown`，或在 push 前做窄化。
- SQLite 测试 decision base 不要 `as const` 固化 `similarity: []`，或显式把 `similarity` 标注为 `MemorySimilaritySummaryEntry[]`。

开放判断：

- 是否要让 `@ss-ai/persona-flow` 根入口转出口 `MemoryWriteCandidate`？目前不建议。该类型属于 contracts 边界，测试直接从 contracts 导入更清晰，也避免 persona-flow barrel 变成 contracts 的宽转发层。

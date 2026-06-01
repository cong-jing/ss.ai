# ss.ai 工程 Review（2026-05-31）

范围：除 `apps/qq-bot` / `apps/qq.bot` 外的工程代码与文档。先读了根 `README.md`、`README.zh-CN.md`、`packages/persona-flow/README.md`、`apps/prompt-debug-cli/README.md`，再对 contracts、persona-flow、persona-flow-sqlite、model-client、server、web、prompt-debug-cli 做源码审查，并跑了现有测试/类型检查。

## 已执行验证

- `pnpm --filter @ss-ai/persona-flow test`：通过，10 tests。
- `pnpm --filter @ss-ai/persona-flow-sqlite test`：通过，30 tests。
- `pnpm --filter @ss-ai/server test`：通过，76 tests。
- `pnpm --filter @ss-ai/web typecheck`：通过。
- `pnpm --filter @ss-ai/persona-flow-model-client typecheck`：通过。
- `pnpm --filter @ss-ai/server typecheck`：通过。
- `pnpm --filter @ss-ai/persona-flow-sqlite typecheck`：通过。
- `pnpm --filter @ss-ai/persona-flow typecheck`：通过。

## 本轮数据库修复状态

- 已解决：SQLite 启动删除 `user_provider_credentials`，用户 API key 重启丢失。
- 已解决：分库模式下 actor 编辑/删除写错数据库。
- 已解决：server 传入 stores override 时仍打开 runtime SQLite 文件；现在只为 auth runtime 打开内存 SQLite，不触碰 runtime DB。
- 已解决：per-character DB handles 未关闭；现在 `createSqliteStores()` 暴露 close disposer，server close 时会关闭角色库连接。

现有测试整体健康。本轮已补上数据库重启后的凭据持久化、分库模式 actor 更新覆盖；仍缺少真正 token streaming、生产 cookie 安全配置、prompt-debug 默认模板路径等覆盖。

## 稍后解决

- `single_character_chat` 的真实 streaming 还未完成。README 已改为反映当前 SSE fallback 行为，这项保留为后续功能建设，不作为本轮 bug 修复。
- speaker tag / 多 actor prompt shaping 主要服务后续 interaction modes。README 已改为反映当前 `single_character_chat` 的简化实现，这项保留为后续设计与实现，不作为本轮 bug 修复。
- API key 静态存储保护目前仍是 no-op encrypt/decrypt。README 已改为把它列为低优先级 TODO，等部署方式和密钥管理方案稳定后再处理。

## 高优先级问题

### 1. SQLite 每次启动都会删除用户 API Key（已解决）

证据：

- `packages/persona-flow-sqlite/src/db/openDatabase.ts:109-117` 在启动迁移里执行 `DROP TABLE IF EXISTS user_provider_credentials` 后重新建表。
- README 说 API keys “stored per user/provider in the credential store”，且只提示目前是 plaintext/no-op encryption（`README.md:183`、`README.md:378`），没有说明会在每次启动丢失。

影响：

- 用户在设置页保存的 provider API key 重启服务后全部消失。
- `local-password` 多用户场景下所有用户凭据都会被清空。
- 这会让默认 API key fallback 掩盖问题：有默认 key 时用户可能不知道自己的 key 已丢。

建议：

- 改为 `CREATE TABLE IF NOT EXISTS user_provider_credentials`，保留数据。
- 如果确实要迁移旧字段，写数据迁移而不是 drop。
- 补测试：写入 key、关闭 DB、重新 `openDatabase()`、确认 key 仍在。

修复：

- `openDatabase()` 已改为只在表不存在时创建 `user_provider_credentials`，不再 drop。
- 新增 `packages/persona-flow-sqlite/test/providerCredentials.test.ts` 覆盖重开数据库后的 key 持久化。

### 2. 分库模式下 actor 编辑/删除写错数据库（已解决）

证据：

- `SQLiteConversationActorStore.listConversationActors()` 和 `createActor()` 会通过 `getDbForConversation()` 写入角色库。
- 但 `SQLiteConversationActorStore.updateConversationActor()` 固定使用核心库 `this.db.update(conversationActors)`（`packages/persona-flow-sqlite/src/db/SQLiteConversationActorStore.ts:122`）。
- server 默认开启角色分库：`apps/server/src/http/server.ts:63-68` 创建 `characterDbDir` 并传给 `createSqliteStores()`。

影响：

- 创建 actor 成功写入角色 DB。
- PATCH/DELETE actor 在真实 server 默认路径中可能对 core DB 空表执行 update，HTTP 仍返回成功，但实际 actor 未更新或未 leftAt。
- 现有 server tests 使用 in-memory stores，sqlite tests 未覆盖 `CharacterDbRouter` 分库更新，所以没有暴露。

建议：

- `updateConversationActor` 先定位 actor 所属 conversation，再使用对应 character DB 更新；或给 update input 增加 `conversationId`。
- 补一个分库 sqlite 集成测试：create conversation -> add local actor -> update/delete -> list active actors。

修复：

- `SQLiteConversationActorStore.updateConversationActor()` 已先定位 actor，再通过 conversation 找到对应 per-character DB 写入。
- 新增 `packages/persona-flow-sqlite/test/characterDbRouter.test.ts` 覆盖分库 actor 更新和 soft delete。

### 3. `/v1/chat/stream` 当前是功能未完成项，README 已对齐，稍后解决

证据：

- README：`/v1/chat/stream` defaults to non-structured SSE output and rejects structured mode（`README.md:216`）。
- `ModelRuntime.chatStream()` 已实现非结构化流（`packages/persona-flow/src/modelCall/modelRuntime.ts:260`）。
- 但 `PersonaFlowChatTurnService.streamTurn()` 没调用 `modelRuntime.chatStream()`，而是走 `modelCall.run()`，`singleCharacterChatCall` 又固定把 `llmResponseMode` 设为 `"structured"`（`packages/persona-flow/src/chatTurn/chatTurnService.ts:212`、`packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts:106-115`）。
- `streamTurn()` 最后一次性 `onChunk(fullResponse)`，日志也写着 structured fallback（`packages/persona-flow/src/chatTurn/chatTurnService.ts:278`）。

当前判断：

- 这更像未完成功能，而不是回归 bug。
- README 现已改为说明当前 SSE 接口存在，但 `single_character_chat` 仍是单次完整回复 fallback。
- contract / UI 路径暂时保留，等真正 streaming 实现时再收口。

建议：

- 后续再决定明确方向：
  - 真 streaming：为 `chat.main/singleCharacterChat` 增加 non-structured streaming call，调用 `runtime.chatStream()`。
  - 或继续保留当前接口，但重新命名和收窄预期。
- 补测试断言 stream path 调用 `generateStream`，而不是 `generate`。

### 4. prompt speaker tag 设计在当前阶段是有意留白，README 已对齐，稍后解决

证据：

- README 说会生成 `p1[Name]` speaker tag 并 prepend 到消息内容（`README.md:320`）。
- `buildActorSpeakerTags()` 存在（`packages/persona-flow/src/prompt/speakerTag.ts:37`），但主聊天 `singleCharacterChatCall` 没使用它。
- 当前 `buildConversationMessages()` 只按 actor role 映射 LLM role，并直接使用 `message.content` / `currentUserMessage.content`（`packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts:46-66`）。
- `packages/persona-flow/README.md` 描述了 `data/prompts/<language>.yaml`、`actorTemplates`、`conversationActors` 等，但仓库实际只有 `singleCharacterChat/templates/system.zh-CN.md.hbs`。

当前判断：

- 对 `single_character_chat` 而言，当前简化 prompt 可以视为阶段性取舍。
- speaker tag helper 和 richer multi-actor shaping 更适合放到后续 interaction mode 设计里统一接入。
- README 现已去掉“当前一定会写入 speaker tag”和“其他 mode 会自动 fallback”这类不准确表述。

建议：

- README 已更新为当前真实 prompt 架构。
- 如果 UI 暂时继续暴露多 interaction modes，后端需要后续补 runtime 注册，或前端先禁用未实现项。
- 给 prompt snapshot 加覆盖：多 actor 发言时 LLM messages 必须能区分 speaker。

### 5. 本地配置文件含明文默认 API key，且生产 cookieSecure 为 false

证据：

- `.gitignore` 已忽略 `apps/server/config/config.local.json`，`git ls-files` 显示它未被追踪；但当前工作区存在该文件且包含非空 `models.mistral.ai.apiKey`。
- `apps/server/config/config.prod.json:15` 和 `config.staging.json:18` 都设置 `"cookieSecure": false`。
- Auth cookie 设置支持 `httpOnly` 和 `sameSite: "lax"`，secure 由 config 控制（`apps/server/src/auth/authRuntime.ts:197-199`）。

影响：

- 本地文件不进 git 是对的，但容易被日志、备份、截图或误提交泄漏。
- HTTPS 生产环境下 `Secure=false` 会让 session cookie 可经非 HTTPS 发送，安全基线偏弱。

建议：

- 立即轮换当前本地默认 key；保留 `config.local.json.example`，不要保留真实 key 文件在共享工作区。
- prod/staging 走 HTTPS 时设置 `cookieSecure: true`，必要时加反代/环境说明。

当前处理结论：

- `config.local.json` 中出现真实默认 key 仍然是需要注意的运维/安全事项，但先不作为当前代码修复主线。
- SQLite credential store 里的 API key 仍是明文落库，这一项也先归入低优先级 TODO；README 已同步标注。

## 中优先级问题

### 6. server 即使传入 stores override 也会打开 SQLite（已解决）

证据：

- README 已把它写成维护注意事项（`README.md:381`）。
- `createHttpServer()` 在判断 `overrides?.stores` 前已经 `openDatabase()`（`apps/server/src/http/server.ts:58-68`）。

影响：

- server tests 即使用 in-memory stores 仍创建/迁移 SQLite，影响隔离、速度和权限。
- 真实测试可能误触本地 `.runtime`。

建议：

- 只有未传 stores override 时才 open DB。
- auth runtime 当前仍需要 `sqlite`，可以把 auth store 也纳入 override，或显式传入 test sqlite 路径。

修复：

- `createHttpServer()` 在传入 stores override 时不再打开 runtime `app.db`，只打开 `:memory:` 给 auth runtime 使用。

### 7. Character DB handles 没有在 server close 时关闭（已解决）

证据：

- `CharacterDbRouter.closeAll()` 存在（`packages/persona-flow-sqlite/src/db/CharacterDbRouter.ts:43`）。
- `createSqliteStores()` 没把 router 暴露出来，`createHttpServer().closeDatabase` 只 `sqlite.close()`（`apps/server/src/http/server.ts:111-113`）。

影响：

- 真实 server/test 中打开过的 per-character DB 连接不会随 close 释放。
- Windows 下更容易造成文件锁、临时目录清理失败、测试间状态泄漏。

建议：

- 让 `createSqliteStores()` 返回 `{ stores, close }` 或在 stores 上挂可选 disposer。
- server `closeDatabase` 同时关闭 core DB 和 character DB handles。

修复：

- `createSqliteStores()` 现在在启用 `CharacterDbRouter` 时挂载可选 `close()`。
- server `closeDatabase()` 会先调用 stores disposer，再关闭 core SQLite。

### 8. SSE 错误事件被伪装成 done，前端难以识别失败

证据：

- stream 生成失败时 server 发送 `{ type: "done", requestId, model: "error" }`，HTTP status 已经是 200（`apps/server/src/http/apis/chat/streamService.ts:82-84`）。
- 前端只把 `done` 当成功元信息处理（`apps/web/src/panels/chat/chatApi.ts:97-98`）。

影响：

- 一旦 SSE headers 已发，后续生成失败不会走 `response.ok` 错误路径。
- UI 可能把失败展示成空/正常完成，错误信息丢失。

建议：

- `ChatStreamEvent` 增加 `{ type: "error"; message; code? }`。
- 前端收到 error event 时 throw，让现有失败 UI 生效。

### 9. prompt-debug 默认模板路径指向不存在的位置

证据：

- `apps/prompt-debug-cli/src/index.ts:105-110` 默认查找 `packages/persona-flow/data/prompts/zh-CN/main.md.hbs`。
- 仓库实际没有 `packages/persona-flow/data/prompts`；主聊天模板在 `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs`。
- CLI README 也写了同样的 fallback 路径（`apps/prompt-debug-cli/README.md:52-55`）。

影响：

- README 示例 `pnpm run prompt:debug -- --config ... --render-only` 如果配置目录没有 `main.md.hbs`，会直接找不到模板。
- CLI prompt 实验和主链路 prompt 模板已经分叉。

建议：

- 更新 fallback 到真实模板路径，或把稳定模板资产移动到 README 所说的 `data/prompts`。
- 增加 render-only smoke test。

### 10. Vite dev proxy 指向 `127.0.0.2:8999`，README 示例是 `127.0.0.1:8999`

证据：

- `apps/web/vite.config.ts:4`：`DEV_SERVER_TARGET = "http://127.0.0.2:8999"`。
- README smoke curl 用 `127.0.0.1:8999`（`README.md:398`、`README.md:404`）。
- server 默认 host 是 `0.0.0.0`（`apps/server/config/config.default.json:4`），通常两者都可能可用，但不是所有环境都一致。

影响：

- Windows/macOS/Linux 的 loopback alias 行为、代理、防火墙可能不同；本地 web API 可能莫名连不上。

建议：

- 默认改成 `127.0.0.1`，需要特殊隔离时用环境变量覆盖。

## 设计/文档不一致

### 11. README 中多个“当前架构地图”已落后于代码（本轮已修正文档）

主要不一致：

- `promptRenderer` / `src/prompt/promptRenderer.ts` 在 README key files 中出现（`README.md:117`、`README.md:361`），但当前主路径是 `modelCall/chat.main/singleCharacterChat/*`，没有该文件。
- README 说 interaction modes 会 fallback 到 single-character（`README.md:133`），当前未注册 mode 会 error。
- `packages/persona-flow/README.md` 描述 YAML prompt 配置、sectionLabels、actorTemplates；当前 package 内没有对应 YAML 资产，主模板是单个 `.hbs`。
- README 说 prompt 渲染会使用 speaker tags（`README.md:320`），当前主聊天未使用。

修复：

- 根 README 已改为描述当前真实状态：`modelCallRegistry`、`single_character_chat`、当前 streaming fallback、speaker tag helper 的实际用途。
- `packages/persona-flow/README.md` 已从旧 YAML prompt 设计说明改成当前实现说明，并补上 TODO。

### 12. `user_preferences.current_conversation_id` 是遗留/死字段

证据：

- `openDatabase.ts` 创建 `user_preferences.current_conversation_id`（`packages/persona-flow-sqlite/src/db/openDatabase.ts:59`）。
- Drizzle schema 不再映射该字段，只保留 `currentCharacterId` 和 `modelAssignmentsJson`（`packages/persona-flow-sqlite/src/db/schema.ts:85-91`）。
- 真实活跃 conversation 存在 `user_character_states.current_conversation_id`（`schema.ts:100`）。

影响：

- DB schema 容易误导维护者。
- 如果未来写迁移/导出时看到两个 current conversation 字段，可能用错。

建议：

- 明确标注为 legacy，或写迁移移除。
- README 数据表说明里解释 active conversation 已迁到 `user_character_states`。

### 13. Character `modelConfig` 看似可编辑，但聊天路径完全不使用

证据：

- contract 中 `CharacterModelConfig` 注释说 per-purpose model overrides（`packages/contracts/src/apis/character.api.ts`）。
- server PATCH 接受并保存 `modelConfig`（`apps/server/src/http/apis/character.route.ts:173-176`）。
- `ModelRuntime.resolveProviderModelRuntime()` 只读取 user preferences 和 `defaultModelAssignments`，没有 character override。

影响：

- API 暴露了一个用户以为有效的配置面，但不会影响模型选择。

建议：

- 要么接入优先级：character override > user preference > default。
- 要么从 contract/API 暂时隐藏，等真正实现后再开放。

## 低优先级/可维护性

### 14. 每次聊天请求创建新的 PromptLogger 和 DefaultModelClient

证据：

- `apps/server/src/http/apis/chat/chatUtil.ts:71-84` 每次 `createChatTurnService` 都 new。

影响：

- 目前能工作，但 model client 内部 SDK client promise 无法跨请求复用；日志对象重复创建。

建议：

- 在 app context 初始化单例 model client / prompt logger，chat request 只创建轻量 service 或直接复用 service factory。

### 15. `registerApi` 默认错误状态都是 400

证据：

- `apps/server/src/http/registerApi.ts` fallback status 为 400。
- 有些 route 自己定义了 `handleError`，但遗漏时内部错误也会变 400。

影响：

- 真实 bug 可能被客户端当请求错误处理，监控也不容易区分。

建议：

- 默认 unknown error 用 500；已知 `AppHttpError` / `AuthHttpError` 用其 status。

### 16. `apps/server/config/config.local.json` 被正确忽略，但 README 可以再强调本地密钥卫生

建议补充 README：

- `config.local.json` 不提交，但也不应长期存放共享默认 key。
- 推荐使用部署 secret 或本机私有环境变量生成 local config。
- 如果默认 key 被用于多人共享，应写明 rate-limit/配额/安全后果。

## 建议的下一步顺序

1. 先修 `openDatabase()` 删除凭据表的问题，并补重启持久化测试。
2. 修分库 actor update/delete，并补 `CharacterDbRouter` 集成测试。
3. 决定 chat stream 的产品语义：真 token streaming 或改名/改文档。
4. 对齐 prompt 文档与实现：speaker tag、多 actor、interaction mode fallback 三者需要统一。
5. 清理生产安全配置：轮换本地 key，prod/staging cookieSecure，并在合适时机补上真实 API key 静态存储保护。

## 2026-06-01 update

- Issue 8 moved to [docs/todo.md](/C:/Develop/ss.ai/docs/todo.md): it belongs to the unfinished chat stream / SSE work.
- Issue 9 moved to [docs/todo.md](/C:/Develop/ss.ai/docs/todo.md): the default `prompt-debug` template path will be finished together with the prompt refactor.
- Issue 10 resolved: [apps/web/vite.config.ts](/C:/Develop/ss.ai/apps/web/vite.config.ts:4) now points to `http://127.0.0.1:8999`.
- Issue 12 resolved: fresh SQLite databases no longer create `user_preferences.current_conversation_id`, and legacy databases are migrated to remove it while preserving data.
- Issue 13 moved to [docs/todo.md](/C:/Develop/ss.ai/docs/todo.md): character-level `modelConfig` remains deferred.
- Issue 14 downgraded to low priority in [docs/todo.md](/C:/Develop/ss.ai/docs/todo.md): the SDK client promise reuse is intentionally scoped per request, and prompt logs append to a shared file instead of recreating files.
- Issue 15 resolved: [apps/server/src/http/registerApi.ts](/C:/Develop/ss.ai/apps/server/src/http/registerApi.ts:1) now defaults unexpected errors to HTTP 500 while still respecting explicit `status` and `statusCode` values.

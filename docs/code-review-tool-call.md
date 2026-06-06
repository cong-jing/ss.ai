# Code Review: `tool-call` branch vs `staging`

> 范围：`git diff staging..tool-call`。
> 主线工作：把 `single_character_chat` 的最终输出从 structured JSON 切到 `submit_turn_events` 工具调用，并把 `messages` 表拆成 `messages + turn_events` 的事件存储。
> 评审日期：2026-06-05；2026-06-05 更新：P0/P1 项目已修复；2026-06-05 再更新：已完成部分 P2 收口，本文只保留剩余待讨论/待修项。

## 总体评价

整体落地基本忠实于 [docs/tool-call-instruction.md](tool-call-instruction.md) 的设计：

- `TurnEvent` schema 统一收口到 [packages/contracts/src/turnEvents.ts](../packages/contracts/src/turnEvents.ts)，作为模型工具参数 schema、SQLite 持久化校验和前后端 API 类型的事实源。
- `submit_turn_events` 工具是 provider-neutral 的（[packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts](../packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts)），Mistral 转换专门放在 [packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts](../packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts)。
- `messages.kind + display_text` 和新建 `turn_events` 表都在 [openDatabase.ts](../packages/persona-flow-sqlite/src/db/openDatabase.ts) / [openCharacterDatabase.ts](../packages/persona-flow-sqlite/src/db/openCharacterDatabase.ts) / [schema.ts](../packages/persona-flow-sqlite/src/db/schema.ts) 配齐，并且 `appendAssistantTurn` / `deleteMessage` 都走事务（[SQLiteMessageStore.ts](../packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts)）。
- 测试更新到位（[personaFlowChatTurnService.test.ts](../packages/persona-flow/test/personaFlowChatTurnService.test.ts)、[submitTurnEventsParser.test.ts](../packages/persona-flow/test/submitTurnEventsParser.test.ts)、[messages.test.ts](../packages/persona-flow-sqlite/test/messages.test.ts) 等）。

剩余风险主要在命名/抽象收敛、chat 层输出模式语义、以及 stream 真流化的后续推进，不阻塞主线。

## 已完成项

- Mistral stream tool-call 累积、QQ bot 空回复跳过语义、API key 轮换、dead code 清理、tool-call-instruction 状态块等 P0/P1/P2 项已在前序修复中完成。
- [SQLiteMessageStore.ts](../packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts) 读取 `turn_events` 时已按 `schema_version` 只接受 v1，并对坏 JSON / schema parse 失败 / 未知版本做跳过处理；[messages.test.ts](../packages/persona-flow-sqlite/test/messages.test.ts) 已补覆盖。
- [chatTurnService.ts](../packages/persona-flow/src/chatTurn/chatTurnService.ts) 已注释说明：没有 `replyText` 时仍会持久化 assistant turn，UI / bot 可以跳过空展示文本但保留非文本事件。
- [message.ts](../packages/persona-flow/src/stores/chat/message.ts) 已注释说明 `displayText`、DB `display_text`、API `content` 的命名对应关系。
- [personaFlowChatTurnService.test.ts](../packages/persona-flow/test/personaFlowChatTurnService.test.ts) 的 stream 测试名已改成 “full normalized reply once” 语义，避免误读成已验证真流式。
- [system.zh-CN.md.hbs](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs) 已修正 `replyText` 文案并补齐文件末尾换行。
- [mistralToolAdapter.test.ts](../packages/persona-flow-model-client/test/mistralToolAdapter.test.ts) 已新增，覆盖 `submitTurnEventsTool` 转 Mistral function tool 后的 `parameters.type`、`required.events`、`events` 数组、以及 discriminated union 分支数量。
- contracts / Zod 的 web bundle 边界已收口：[turnEvents.ts](../packages/contracts/src/turnEvents.ts) 现在只导出纯类型和字面量常量，[turnEvents.schema.ts](../packages/contracts/src/turnEvents.schema.ts) 专门导出 Zod schema，并通过 [package.json](../packages/contracts/package.json) 的 `./turnEvents.schema` 子入口暴露。需要运行时校验的 persona-flow / SQLite 代码已改为显式 import schema 子入口；web build 已验证不再包含 `$Zod` / `ZodError` / `TurnEventSchema` 等运行时代码。
- `LlmResponseMode` 已从 chat contracts、server route、chatTurn/modelCall 输入、web / QQ bot 客户端和测试中移除。chat API 现在只有一种输出契约：非 stream 和 stream 都返回 `output + turnEvents`，底层 provider structured response 能力仍通过 `structuredOutputSchema` 留在 `ModelRuntime` / `ModelClient` 层。
- `ModelCallOutcome` / `parsedModelOutput` 已移除。[modelCall.ts](../packages/persona-flow/src/modelCall/modelCall.ts) 现在使用 `ModelCall<TParsedOutput>` / `ModelCallRunResult<TParsedOutput>` 表达各 model call 的解析后业务结果，并保留可选 `parsedToolCalls` 记录中间工具解析结果；[singleCharacterChatCall.ts](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts) 自己解析并处理 `submit_turn_events`，chatTurnService 只消费 `parsedOutput`。
- Mistral non-stream tool-only 响应不再通过吞掉 `extractText` 异常来兼容。[mistralModelClient.ts](../packages/persona-flow-model-client/src/mistral/mistralModelClient.ts) 现在只在消息 content 明确为空且存在 tool calls 时返回空文本，并写 verbose log；未知非空 content 形状仍会抛错。[messageTransforms.test.ts](../packages/persona-flow-model-client/test/messageTransforms.test.ts) 已补覆盖。

## 剩余问题

### 1. `messages.kind` 没有数据库层面的枚举校验

`MessageKind` 在 TS 层是 union（`user_text | assistant_turn_events | system_text`），但 SQLite 列没有 CHECK 约束，写入完全靠应用层。

考虑：

- 历史迁移期间 `kind` 取自 `COALESCE(kind, 'user_text')`，这意味着旧 assistant 消息会被标成 `user_text`，[singleCharacterChatCall.ts](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts) 组 prompt 时会因此把它们当成 user content。tool-call instruction 里允许“破坏性迁移、可删库”，所以这是可接受的取舍，但应该在 PR/CHANGELOG 里明确提示“升级后旧库的历史会被解释错乱，建议删库重建”。
- 长期可以加 SQLite CHECK 约束，或者迁移时根据 `sender_actor_id` 是否对应 `self` actor 来回填 `kind`。

### 2. `getRecentMessages` 事件顺序仍可更防御

[SQLiteMessageStore.ts](../packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts) 目前依赖 SQL `orderBy(asc(messageId), asc(seq))` 保证同一消息内事件顺序。SQLite 下这基本可用，但如果未来换 driver / 改查询形态，可以考虑在分组后对每个 message 的事件按 `seq` 再排一次。

`schema_version` 兼容读取和坏事件跳过已经完成；这里只剩顺序上的防御性增强，优先级较低。

### 3. `mistralToolAdapter` schema 归一化仍可增强

[mistralToolAdapter.ts](../packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts) 已有测试覆盖当前 `submit_turn_events` schema 形状，但 adapter 本身还没有显式处理 `$defs` / `definitions`、`additionalProperties`、或 Mistral 对 `oneOf` / `anyOf` 的偏好。

目前 prompt log 中能跑通，新增测试也能防止 Zod 大版本升级时 schema 形状悄悄回归。后续如果遇到 provider 对 schema 严格度的兼容问题，再考虑在 adapter 层做 provider-specific normalization。

### 4. 旧 prompt-debug 模板路径仍需清理或文档化

仓库还保留了旧版 `data/prompts/zh-CN/main.md.hbs` 模板搜索路径（[apps/prompt-debug-cli/src/index.ts](../apps/prompt-debug-cli/src/index.ts)），但实际主链路不再使用。建议清理，或在 README / project map 中说明“旧 prompt 模板已废弃，仅作回退”。

## 小问题集合

| 位置 | 备注 |
| --- | --- |
| [apps/qq-bot/src/http/serverClient.ts](../apps/qq-bot/src/http/serverClient.ts) | 整段 import 改成混合 `import { value }` + `import type {...}`，部分编辑器显示行尾混了 CRLF（diff 里大量 `\r`）。请确认 `.editorconfig` / `.gitattributes` 行尾配置，不要让 CRLF 进主线。 |
| [packages/persona-flow/src/modelCall/modelRuntime.ts](../packages/persona-flow/src/modelCall/modelRuntime.ts) | prompt log 中 `tools` 只记录 name/terminal/purpose，不记录 args schema。对调试影响不大，可选项。 |
| [packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts](../packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts) | `normalizeToolArguments` 在 `argumentsValue === undefined` 时返回 `undefined`，`SubmitTurnEventsArgsSchema.parse(undefined)` 会抛 Zod 错误，可读性 OK；如果想给出更友好的提示，可以专门 throw `"submit_turn_events arguments missing"`。 |
| [packages/contracts/src/apis/chat.api.ts](../packages/contracts/src/apis/chat.api.ts) | `ChatStructuredOutput` 类型已被删，仓库内搜不到引用。请确认 lightsail / 外部消费方是否也升级。 |
| [apps/server/test/helpers/inMemoryChatStore.ts](../apps/server/test/helpers/inMemoryChatStore.ts) | `appendAssistantTurn` 直接 push 同一对象，相比 SQLite 真实路径不会 throw 也不会校验 schema。生产用 SQLite 测试覆盖到了 schema parse，OK。 |

## 剩余建议优先级

1. **P3**：视需要补 SQLite `messages.kind` CHECK 约束 / 迁移说明，以及事件组内排序防御（第 1、2 节）。
2. **P3**：清理或文档化 `prompt-debug-cli` 中旧 prompt 路径回退（第 4 节）。
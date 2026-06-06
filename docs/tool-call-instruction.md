# 实现任务：为 persona-flow 增加 submit_turn_events 工具调用路径

## 实现状态（2026-06-05）

本文档为原始实现计划，主线已经按设计落地。后续 contributor 阅读时请先看这一块再决定是否还需要参考下面的细节章节。

### 已实现

- **第 1 节 — 通用工具类型**：`ModelFunctionToolDefinition` / `ModelToolDefinition` 已落到 [packages/persona-flow/src/llm/tools/toolDefinition.ts](../packages/persona-flow/src/llm/tools/toolDefinition.ts)（provider-neutral，参数走 Zod schema）。
- **第 2 节 — 共享 TurnEvent schema**：[packages/contracts/src/turnEvents.ts](../packages/contracts/src/turnEvents.ts) 作为唯一事实源，前后端 / 模型工具参数 / SQLite 持久化都从这里派生。
- **第 3 节 — submitTurnEventsTool**：[packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts](../packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts) 已声明为 terminal tool。
- **第 4 节 — ModelClient 输入扩展**：`ModelGenerationInput` 已接受 `tools` / `toolChoice` / `toolRequest`（[packages/persona-flow/src/llm/modelClient.ts](../packages/persona-flow/src/llm/modelClient.ts)）。
- **第 5 节 — API contracts**：`/v1/chat` 与 `/v1/chat/stream` 响应已带上 `turnEvents`（[packages/contracts/src/apis/chat.api.ts](../packages/contracts/src/apis/chat.api.ts)）。
- **第 6 节 — Mistral adapter**：non-stream 路径完整支持 tool call（[packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts](../packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts) + [mistralModelClient.ts](../packages/persona-flow-model-client/src/mistral/mistralModelClient.ts)）。
- **第 8 节 — tool call arguments 解析**：[packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts](../packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts)。
- **第 9 节 — singleCharacterChatCall**：已切换到强制 `submit_turn_events` 工具调用（[singleCharacterChatCall.ts](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts)）。
- **第 10 节 — ModelRuntime**：`chat()` 透传 tool 相关字段并把 provider 返回的 `toolCalls` 收集到 `PersonaModelResponse`。
- **第 11 节 — ChatTurnService**：消费 model call 已处理的 `submit_turn_events` terminal tool 输出，并把 `TurnEvent[]` 回到 service 输出。
- **第 12 节（部分）— 上层 API/前端**：`/v1/chat` 与 `/v1/chat/stream` done event 里都会带 `turnEvents`；web 端 [useChatViewModel.ts](../apps/web/src/panels/chat/useChatViewModel.ts) 已经按 `replyText` 类型渲染。
- **第 13 节（部分）— 持久化**：`messages` 表新增 `kind / display_text`，新建 `turn_events` 表，`appendAssistantTurn` / `deleteMessage` 走事务（[SQLiteMessageStore.ts](../packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts)）。
- **第 14 节 — 中文 prompt**：[templates/system.zh-CN.md.hbs](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs)。

### 跟进项 / 未实现

- **第 7 节 — OpenAI adapter**：尚未实现。
- **第 12 节 — 真正的 token stream**：目前 `/v1/chat/stream` 仍走 non-stream model call 后一次性 emit；`MistralModelClient.generateStream` 暂时直接抛 `Error("not implemented yet")`，等做真流时再补 tool-call delta 累积（按 `index` 合并 arguments 片段）。
- **第 13 节 — stateUpdate 投影 / 状态快照查询**：当前只把 `stateUpdate` 写进 `turn_events`，没有"按事件类型查询当前 expression / sceneAtmosphere"的派生表或 cache。
- **第 15 节 — 完整 agent loop / 非 terminal 工具**：当前只支持 terminal tool `submit_turn_events`，没有 `query_memory` / `query_knowledge` / `get_character_state` 等中间工具及其 loop。

---

## 背景

当前 `persona-flow` 需要支持多种 `ModelClient`，例如 Mistral、OpenAI，以及未来可能加入的其他 provider。

主对话流程希望模型不要直接输出普通 assistant 文本，也不要继续依赖 non-stream 的 structured result。模型应通过一个终结型工具提交本回合的结构化事件列表。这个工具暂定名为 `submit_turn_events`。

这个工具用于表达一个 RP / 对话 turn 中发生的事件，例如：

- 角色台词
- 角色表情变化
- 场景氛围变化
- 状态更新，例如获得道具、设置 flag、关系值变化

目标是让 stream 和 non-stream 模式最终都能统一走 tool call 解析路径，而不是 stream 用 tool call、non-stream 用 structured result。

## 当前项目现状

当前主聊天调用链是：

1. `packages/persona-flow/src/chatTurn/chatTurnService.ts`
2. `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
3. `packages/persona-flow/src/modelCall/modelRuntime.ts`
4. `packages/persona-flow/src/llm/modelClient.ts`
5. `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`

`singleCharacterChatCall.ts` 现在以 `submit_turn_events` tool call 为主输出。chat API 不再暴露 structured / non-structured response mode；stream 与非 stream 只区分传输形态，最终都归一到 `output + turnEvents`。

当前 `ModelRuntime` 已经能收集并记录 `toolCalls`，但只是 TODO 日志，并没有执行或解析：

- non-stream：`ModelRuntime.chat()`
- stream：`ModelRuntime.chatStream()`

第一版可以先不实现完整 agent loop。先支持 terminal tool `submit_turn_events` 的解析和 turn 收束。后续加入 `query_memory`、`query_knowledge` 这类中间工具后，再抽象完整 agent loop。

## 设计原则

### 1. Zod schema 是唯一事实源

不要手写巨大的 JSON Schema，也不要从 JSON 文件读取工具 schema。

事件结构、TypeScript 类型、本地 runtime validation、provider tool parameters 都应该从同一套 Zod schema 派生。

### 2. `ModelFunctionToolDefinition` 保持 provider-neutral

`ModelFunctionToolDefinition` 仍然需要，但它应该很薄。

它不应该保存手写 JSON Schema，而应该保存 provider-neutral 的工具元信息和 Zod args schema。

具体 provider adapter 再把 Zod schema 转成对应 SDK 需要的 JSON Schema / parameters。

### 3. `submit_turn_events` 是终结工具

`submit_turn_events` 不是中间查询工具。调用它表示本回合已经结束。

将来还会有其他工具，例如：

- `query_memory`
- `query_knowledge`
- `get_character_state`

这些是中间工具，调用后需要把 tool result 返回给模型，让模型继续决定下一步。

而 `submit_turn_events` 调用后，当前 turn 应该解析其参数并结束。

### 4. provider adapter 负责转换格式

`persona-flow` core 不应直接依赖 Mistral SDK 或 OpenAI SDK 的 tool 类型。

例如：

- `persona-flow` core 定义 `submitTurnEventsTool`
- Mistral adapter 将它转换成 Mistral SDK 的 tool 格式
- OpenAI adapter 将它转换成 OpenAI function tool 格式

Mistral adapter 不应放在 `persona-flow` core 中，而应放在 `packages/persona-flow-model-client`。

## 推荐文件结构

根据当前项目结构，推荐新增或调整以下文件：

```text
packages/contracts/src/turnEvents.ts

packages/persona-flow/src/llm/tools/modelTool.ts
packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts

packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts
packages/persona-flow/src/chatTurn/events/turnEventText.ts

packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts
```

说明：

- 不建议新增 `packages/persona-flow/src/turn`。当前已经有 `src/chatTurn`，turn 结果事件放在 `src/chatTurn/events` 更贴合现有边界。
- 不建议使用 `src/prompts`。当前项目目录是 `src/prompt`，并且主聊天 prompt 模板在 `modelCall/chat.main/singleCharacterChat/templates` 下。
- 文件名统一使用复数：`submitTurnEventsTool.ts`，对应工具名 `submit_turn_events`。
- `TurnEvent` 类型和 Zod schema 建议放在 `packages/contracts`，因为 API、web、server、persona-flow 都需要引用同一套事件定义。`persona-flow` 已经依赖 `@ss-ai/contracts`，这样不会产生反向依赖。

## 1. 定义通用工具类型

在 `packages/persona-flow/src/llm/tools/modelTool.ts` 中定义 provider-neutral 的工具类型。

要求：

- 不依赖 Mistral SDK
- 不依赖 OpenAI SDK
- 不手写完整 JSON Schema 类型作为源头
- 使用 Zod schema 保存参数结构
- 支持标记 terminal tool

建议类型大致如下：

```ts
import type { z } from "zod";

export type ModelToolPurpose =
    | "final_output"
    | "context_query"
    | "state_query"
    | "side_effect";

export interface ModelFunctionToolDefinition<TArgs = unknown> {
    kind: "function";
    name: string;
    description: string;
    argsSchema: z.ZodType<TArgs>;
    terminal?: boolean;
    purpose?: ModelToolPurpose;
}

export type ModelToolDefinition<TArgs = unknown> =
    ModelFunctionToolDefinition<TArgs>;
```

注意：

- `parameters` 不建议作为 core 定义里的主字段。
- `parameters` 是 provider-facing JSON Schema，应由 adapter 从 `argsSchema` 生成。
- 可以提供 helper，但不要让手写 parameters 成为事实源。

## 2. 定义共享 TurnEvent schema

在 `packages/contracts/src/turnEvents.ts` 中定义事件常量、Zod schema 和 TypeScript 类型。

`@ss-ai/contracts` 当前没有依赖 `zod`，本次改修需要给 `packages/contracts/package.json` 增加 `zod` 依赖。

依赖声明变更后需要运行：

```bash
pnpm install
```

以更新 workspace dependency graph 和 `pnpm-lock.yaml`。

这样可以保证：

- API contract 可以直接导出 `TurnEvent`
- web 可以直接使用 `TurnEvent`
- persona-flow 可以直接使用 `SubmitTurnEventsArgsSchema` 做 runtime validation
- tool parameters 可以从同一套 schema 转成 provider JSON Schema

需要包含：

```ts
export const EXPRESSION_VALUES = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "shy",
    "surprised",
] as const;

export const ATMOSPHERE_VALUES = [
    "neutral",
    "calm",
    "tense",
    "romantic",
    "sad",
    "mysterious",
    "comical",
] as const;
```

这些数组需要使用 `as const`，以便 Zod enum 和 TypeScript literal type 共用同一个来源。

同一个文件中继续定义以下 schema。

### ReplyTextEvent

字段：

- `type: "replyText"`
- `characterId: string`
- `text: string`

语义：

- 角色实际说出口的台词。
- `text` 中只写角色真正说出的话。
- 不要包含角色名、动作说明、表情说明、系统说明。

### ExpressionEvent

字段：

- `type: "expression"`
- `characterId: string`
- `expression: enum EXPRESSION_VALUES`
- `intensity?: number`

约束：

- `intensity` 如果存在，应在 0 到 1 之间。

语义：

- 角色表情变化事件。
- 只有表情确实发生变化时才需要输出。

### SceneAtmosphereEvent

字段：

- `type: "sceneAtmosphere"`
- `atmosphere: enum ATMOSPHERE_VALUES`
- `note?: string`

语义：

- 场景整体氛围变化。
- 只有整体气氛发生明显变化时才输出。
- `note` 是简短原因，不要写成长篇描述。

### StateUpdateEvent

字段：

- `type: "stateUpdate"`
- `update: ItemGrantedUpdate | FlagSetUpdate | RelationshipDeltaUpdate`

### ItemGrantedUpdate

字段：

- `type: "itemGranted"`
- `targetId: string`
- `itemId: string`
- `count: integer`
- `reason: string`

约束：

- `count >= 1`

### FlagSetUpdate

字段：

- `type: "flagSet"`
- `key: string`
- `value: string | number | boolean`
- `reason: string`

### RelationshipDeltaUpdate

字段：

- `type: "relationshipDelta"`
- `characterId: string`
- `targetId: string`
- `value: number`
- `reason: string`

语义：

- 关系值变化。
- 正数表示上升，负数表示下降。

### TurnEventSchema

使用 discriminated union：

- `replyText`
- `expression`
- `sceneAtmosphere`
- `stateUpdate`

### SubmitTurnEventsArgsSchema

字段：

- `events: TurnEvent[]`

约束：

- `events` 至少 1 个元素。
- 数组顺序就是事件播放和处理顺序。

同时导出 TypeScript 类型：

- `ReplyTextEvent`
- `ExpressionEvent`
- `SceneAtmosphereEvent`
- `StateUpdateEvent`
- `TurnEvent`
- `SubmitTurnEventsArgs`

这些类型都通过 `z.infer` 从 Zod schema 推导。

## 3. 定义 submitTurnEventsTool

在 `packages/persona-flow/src/llm/tools/submitTurnEventsTool.ts` 中定义：

- name: `submit_turn_events`
- kind: `"function"`
- purpose: `"final_output"`
- terminal: `true`
- argsSchema: `SubmitTurnEventsArgsSchema`

description 使用中文即可，大意如下：

> 提交本回合最终的有序事件列表。角色台词、表情变化、场景氛围变化、状态更新都必须通过这个工具提交。调用此工具后，本回合结束。

注意：

- 这里不要手写 JSON Schema parameters。
- 只引用 `SubmitTurnEventsArgsSchema`。

## 4. 扩展 ModelClient 输入

在 `packages/persona-flow/src/llm/modelClient.ts` 中扩展 provider-neutral 输入。

`ModelGenerationInput` 建议增加：

```ts
tools?: ModelToolDefinition[];
toolChoice?: "auto" | "required" | {
    type: "function";
    functionName: string;
};
```

如果希望强制模型必须调用 `submit_turn_events`，第一版可以在主聊天请求中使用：

```ts
toolChoice: {
    type: "function",
    functionName: "submit_turn_events",
}
```

也可以先使用 `toolChoice: "required"`，但不同 provider 对 required tool choice 的支持可能不同，因此 provider adapter 需要处理兼容性。

## 5. 更新 API contracts

需要在 `packages/contracts/src/apis/chat.api.ts` 和 `packages/contracts/src/apis/conversation.api.ts` 中使用共享的 `TurnEvent`。

建议：

- `ChatResponse` 增加 `turnEvents?: TurnEvent[]`
- `ChatStreamEvent` 的 `done` 事件增加 `turnEvents?: TurnEvent[]`
- `ConversationMessage` 增加 `kind?: "user_text" | "assistant_turn_events" | "system_text"` 和 `turnEvents?: TurnEvent[]`
- 旧的 `ChatStructuredOutput` / `structuredOutput` 可以移除，本次改修不再把它作为主路径

推荐目标形状：

```ts
export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
    apiKeySource: "user" | "default";
    userMessageId: string;
    assistantMessageId?: string;
    turnEvents?: TurnEvent[];
    assembledMessages?: ChatDryRunMessage[];
}
```

```ts
export type ChatStreamEvent =
    | { type: "chunk"; content: string }
    | { type: "assembledMessages"; messages: ChatDryRunMessage[] }
    | {
        type: "done";
        requestId: string;
        model: string;
        apiKeySource?: "user" | "default";
        turnEvents?: TurnEvent[];
    };
```

```ts
export interface ConversationMessage {
    id: string;
    role: "user" | "assistant";
    senderActorId: string;
    senderDisplayName: string;
    senderSourceType: ConversationActorSourceType;
    content: string;
    kind?: "user_text" | "assistant_turn_events" | "system_text";
    turnEvents?: TurnEvent[];
    createdAt: string;
}
```

`content` 继续表示展示文本。assistant 结构化 turn 的完整事件列表通过 `turnEvents` 返回。

## 6. Mistral adapter

在 `packages/persona-flow-model-client/src/mistral/mistralToolAdapter.ts` 中实现转换函数。

输入：

- `ModelFunctionToolDefinition<TArgs>` 或 `ModelToolDefinition<TArgs>`

输出：

- Mistral SDK 需要的 function tool 格式

转换规则：

- `type` 固定为 `"function"`
- `function.name` 来自 `tool.name`
- `function.description` 来自 `tool.description`
- `function.parameters` 由 `z.toJSONSchema(tool.argsSchema)` 生成

注意：

- 当前项目使用 Zod v4，可以使用 `z.toJSONSchema()`。
- adapter 里可以做 provider-friendly 清洗，例如去掉不必要的 `$schema`。
- 如果 provider 不支持某些复杂 JSON Schema 关键字，可以在 adapter 层降级或清洗。
- 不要把 provider 兼容逻辑写回 core schema。

随后在 `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts` 中把 `input.tools` 转换后传给 Mistral SDK：

- `client.chat.complete({ ..., tools, toolChoice })`
- `client.chat.stream({ ..., tools, toolChoice })`

具体字段名需要按当前 Mistral SDK 类型确认。不要让 `persona-flow` core 直接依赖 SDK 类型。

## 7. OpenAI adapter

如果未来加入 OpenAI client，可用相同方式转换：

- core 使用 `ModelToolDefinition`
- OpenAI adapter 负责生成 OpenAI function tool 格式
- core 不依赖 OpenAI SDK 类型

## 8. tool call arguments 解析

在 `packages/persona-flow/src/chatTurn/events/submitTurnEventsParser.ts` 中提供解析函数。

功能：

- 输入 tool call arguments string 或 unknown。
- 如果是 string，先 `JSON.parse`。
- 再用 `SubmitTurnEventsArgsSchema` 做 runtime validation。
- 返回 `SubmitTurnEventsArgs`。

建议提供两个函数：

- `parseSubmitTurnEventsArgs`
  - 失败时 throw。
- `safeParseSubmitTurnEventsArgs`
  - 返回 safeParse 风格结果。

任何来自模型的 tool call arguments 都必须经过本地 schema 校验。不要因为 provider 声称支持 schema 就直接信任模型输出。

## 9. 修改 singleCharacterChatCall

必须修改 `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`。

旧逻辑是 structured output：创建 `structuredOutputSchema`、调用 `input.runtime.chat(llmRequest)`、再从 `llmResponse.structuredOutput` 解析 `replyText`。当前实现已经改为 terminal tool call。

目标逻辑应改为 tool call：

1. 构造 `llmRequest` 时传入：

```ts
tools: [submitTurnEventsTool],
toolChoice: {
    type: "function",
    functionName: "submit_turn_events",
},
```

2. 不再把 `singleCharacterChatStructuredOutputSchema` 作为主输出路径。

3. 收到 `llmResponse` 后：

- 从 `llmResponse.toolCalls` 中找到 `functionName === "submit_turn_events"` 的 tool call。
- 如果没有找到，当前阶段应视为格式错误。可以直接 throw，也可以后续加一次纠错 retry。
- 用 `parseSubmitTurnEventsArgs(toolCall.arguments)` 校验参数。
- 将解析后的结果作为 `singleCharacterChatCall` 的 `ModelCallRunResult.parsedOutput` 返回。

4. 将事件转成当前 chat 输出：

- 第一版至少把所有 `replyText` 事件按顺序拼接成 assistant message 文本。
- 如果没有任何 `replyText`，`output` 可以为空，但仍保留并持久化非文本 turn events。
- `expression`、`sceneAtmosphere`、`stateUpdate` 随 `turnEvents` 一起返回并持久化。

5. `normalizeSingleCharacterReply()` 仍可用于清理 `replyText.text` 中误加的角色名前缀。

建议新增局部 helper，例如：

- `findSubmitTurnEventsToolCall(toolCalls)`
- `toSingleCharacterChatOutput(args, promptContext)`

## 10. 修改 ModelRuntime

`packages/persona-flow/src/modelCall/modelRuntime.ts` 需要透传工具定义。

建议：

- `PersonaModelRequest` 增加 `tools?` 和 `toolChoice?`。
- `ModelRuntime.chat()` 调用 `modelClient.generate()` 时透传 `tools` / `toolChoice`。
- `ModelRuntime.chatStream()` 调用 `modelClient.generateStream()` 时也透传。
- prompt log 中记录 tool 名称和 tool choice，方便 debug。

第一版不要在 `ModelRuntime` 里执行完整 agent loop。它可以继续负责 provider/model/key 解析、请求日志、调用 `ModelClient` 和返回 `toolCalls`。

## 11. 修改 ChatTurnService

`packages/persona-flow/src/chatTurn/chatTurnService.ts` 从 `ModelCallRunResult.parsedOutput` 读取已经由 model call 解析过的 single-character chat 结果。

但持久化时不应只写最终文本。`chatTurnService` 应把 assistant turn 保存为：

- 一条 `messages` 记录，`kind = "assistant_turn_events"`，`displayText = output`
- 多条 `turn_events` 记录，逐条保存原始事件

建议给 store 增加专门方法，而不是让 service 自己拆多次写入：

```ts
appendAssistantTurn(input: {
    message: Message;
    events: TurnEvent[];
}): Promise<void>;
```

具体实现中可以用事务同时写入 `messages` 和 `turn_events`。

但需要注意：

- `streamTurn()` 当前只是调用 structured fallback，然后一次性 `onChunk(fullResponse)`。
- 改成 tool call 后，如果还没有真正解析 streaming tool call 增量，也可以先保持“一次性返回完整 replyText”的行为。
- 后续如果前端需要收到完整事件列表，API response / SSE event contract 需要另行设计。

## 12. tool call 往上收束到 API 和前端

这一层当前文档还不够具体，需要补充。

推荐的第一版处理方式是：

1. `singleCharacterChatCall.ts` 在解析完 `submit_turn_events` 后，得到完整 `events` 列表。
2. 同时从 `events` 中提取所有 `replyText`，按顺序拼成当前仍需保留的 `output` 文本。
3. `chatTurnService.ts` 将 `output` 写入 `messages.display_text`，并将完整 `events` 逐条写入 `turn_events`。
4. 另外把完整的 `events` 原样带到 API response，提供给前端直接渲染。

这样做的好处是：

- 不需要立即重做聊天主列表的渲染结构。
- 不需要立即重做聊天主列表的渲染结构。
- 前端已经能继续显示普通 assistant 文本。
- 前端也能额外拿到结构化事件，先做平铺显示。

### 推荐的 API 返回结构

第一版建议在 chat API response 中新增字段，而不是复用当前 `structuredOutput.replyText` 语义：

```ts
export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
    apiKeySource: "user" | "default";
    userMessageId: string;
    assistantMessageId?: string;
    turnEvents?: TurnEvent[];
    assembledMessages?: ChatDryRunMessage[];
}
```

本次改修推荐直接使用 `turnEvents`，不要继续沿用 `structuredOutput` 这个旧名字。

### 推荐的服务层处理

建议 `PersonaFlowChatTurnService.chatTurn()` 返回：

- `output`: 所有 `replyText` 合并后的最终展示文本
- `assistantMessageId`: 若 `output` 非空，则照常保存 assistant message 后返回
- `turnEvents`: 原始事件数组，供前端平铺显示

也就是说：

- `output` 负责兼容现有“消息气泡”主路径
- `turnEvents` 负责承载新的结构化表现层数据

这样前端可以先小步演进，而不是被迫一次性全面改造。

### 推荐的前端第一版显示方式

前端暂时不需要重做消息流模型。可以继续：

- 用 `response.output` 生成普通 assistant message
- 如果 `response.turnEvents` 存在，再额外插入一个 debug / event block

这个 event block 可以直接按数组顺序平铺，例如：

- `expression: happy`
- `replyText: 你好呀`
- `sceneAtmosphere: calm`

如果想更贴近你说的“直接按照里面的内容平铺显示”，前端可以把 `turnEvents` 渲染成一个简单列表，而不是先做复杂卡片系统。

第一版不建议后端为了展示专门发明一套 display-only schema，例如：

- `expressionText`
- `replyTextLabel`
- `displayRows`

更稳妥的做法是后端返回原始 `TurnEvent[]`，前端做一层很薄的映射：

- `expression` -> `expression: ${expression}`
- `replyText` -> `replyText: ${text}`
- `sceneAtmosphere` -> `sceneAtmosphere: ${atmosphere}`
- `stateUpdate` -> 按 update.type 做简单字符串展开

这样后续事件类型扩展时，不容易把展示层协议锁死。

### stream 的第一版建议

stream endpoint 第一版可以先不做事件增量流。

建议保持：

- SSE `chunk` 仍然只发送合并后的 `replyText`
- `done` 事件时，额外附带完整 `turnEvents`

例如未来可以扩成：

```ts
type ChatStreamEvent =
    | { type: "chunk"; content: string }
    | { type: "assembledMessages"; messages: ChatDryRunMessage[] }
    | { type: "done"; requestId: string; model: string; apiKeySource?: "user" | "default"; turnEvents?: TurnEvent[] };
```

这样前端 stream 主体验仍然很轻，事件列表可以在结束后一次性显示。

### 第一版边界

第一版建议把边界控制在这里：

- 后端负责解析 tool call 并返回原始 `turnEvents`
- 后端继续产出兼容旧 UI 的 `output`
- 前端只增加一个很薄的 `turnEvents` 平铺显示
- 不在第一版重构消息持久化、SSE 增量事件协议、或复杂事件 UI

这应该是当前性价比最高、风险最低的落地方式。

## 13. 持久化与历史拼接

这一层建议明确采用“`messages` 负责时间轴，`turn_events` 负责结构化事实”的思路。

在当前项目允许破坏性调整、不考虑历史兼容的前提下，主推荐方案不是继续把 JSON 塞进 `messages.content`，而是直接调整表结构。

### 核心原则

- 不废弃 `messages` 表。
- `messages` 保留为对话时间轴和通用元数据表。
- assistant 的结构化输出不直接塞进 `messages.content`。
- 新增 `turn_events` 表，把每个 `submit_turn_events.events[i]` 单独存成一行。

也就是说：

- `message / turn` 表示“对话里在这个时间点发生了一条输入或输出”
- `turn_event` 表示“这条 assistant 输出里具体包含哪些结构化事件”

### 推荐表结构

建议将 `messages` 调整为：

```sql
messages (
  id text primary key,
  conversation_id text not null,
  sender_actor_id text not null,
  kind text not null,          -- "user_text" | "assistant_turn_events" | "system_text"
  display_text text not null,  -- 给现有 UI / transcript / 列表快速使用
  created_at text not null
)
```

新增：

```sql
turn_events (
  id text primary key,
  message_id text not null,
  conversation_id text not null,
  seq integer not null,
  type text not null,
  payload_json text not null,
  schema_version integer not null default 1,
  created_at text not null
)
```

当前项目需要同步调整这些位置：

- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/db/openDatabase.ts`
- `packages/persona-flow-sqlite/src/db/openCharacterDatabase.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteMessageStore.ts`
- `packages/persona-flow-sqlite/src/db/SQLiteConversationStore.ts`

因为当前项目同时存在主 SQLite DB 和 per-character DB router，两个建表入口都要包含 `messages` 和 `turn_events` 的最新结构。

如果本阶段不考虑历史兼容，可以在迁移逻辑中采用破坏性重建策略：

- 检测 `messages` 缺少 `kind` 或 `display_text` 时，重建 `messages`
- 检测 `turn_events` 不存在时，创建 `turn_events`
- 本地开发允许删库时，也可以直接删除 `.runtime` 下旧 DB 后验证 fresh database path

注意：即使允许删库，`openDatabase.ts` / `openCharacterDatabase.ts` 仍然要能创建 fresh database 的完整表结构。

字段职责：

- `messages.kind`
  用于区分普通用户文本、assistant 结构化 turn、system 文本。
- `messages.display_text`
  用于快速展示和兼容现有聊天 UI。
  对 assistant turn，它由所有 `replyText` 按顺序拼接得出。
- `turn_events.seq`
  保证事件回放顺序与模型提交顺序一致。
- `turn_events.type`
  用于按事件类型筛选，例如 `replyText`、`expression`、`sceneAtmosphere`、`stateUpdate`。
- `turn_events.payload_json`
  存完整原始事件对象。
- `turn_events.schema_version`
  用于未来 schema 演进和兼容读取。

### 保存方式

#### user message

user message 只写 `messages`：

```text
messages.kind = "user_text"
messages.display_text = 用户原始文本
```

不写 `turn_events`。

#### assistant turn

assistant 调用 `submit_turn_events` 后：

1. 先将 `events` 用 `SubmitTurnEventsArgsSchema` 完整校验。
2. 新建一条 `messages` 记录：

```text
messages.kind = "assistant_turn_events"
messages.display_text = 所有 replyText 按顺序拼接后的文本
```

3. 将 `events` 中每个事件逐条写入 `turn_events`：

```text
message_id = 这条 assistant message 的 id
conversation_id = 当前会话 id
seq = 事件在数组中的顺序
type = event.type
payload_json = JSON.stringify(event)
schema_version = 1
```

这意味着 assistant 的完整事实源是 `turn_events`，而不是 `messages.display_text`。

写入 assistant turn 时建议使用事务：

1. 插入 `messages`
2. 插入所有 `turn_events`
3. 任一步失败则整个 turn 写入失败

这样可以避免出现“聊天列表里有 assistant message，但事件表缺失”的半写入状态。

### Store 接口建议

`packages/persona-flow/src/stores/chat/message.ts` 建议扩展：

```ts
export type MessageKind =
    | "user_text"
    | "assistant_turn_events"
    | "system_text";

export type Message = {
    id: string;
    conversationId: string;
    senderActorId: string;
    kind: MessageKind;
    displayText: string;
    createdAt: string;
    turnEvents?: TurnEvent[];
};
```

`ChatStore` 建议提供：

```ts
appendMessage(message: Message): Promise<void>;
appendAssistantTurn(input: {
    message: Message;
    events: TurnEvent[];
}): Promise<void>;
getRecentMessages(input: {
    userId?: string;
    conversationId: string;
    limit: number;
}): Promise<Message[]>;
deleteMessage(input: {
    conversationId: string;
    messageId: string;
}): Promise<void>;
```

读取 recent messages 时，建议对 `assistant_turn_events` 附带 `turnEvents`。

这样 `buildConversationMessages()` 可以只依赖 `PromptContext.recentMessages`，不用在 model call 层额外查 SQLite。

`PromptContext` 中的 `recentMessages` 类型也要随 `Message` 类型更新，确保 assistant turn 的 `turnEvents` 能一路传到 `singleCharacterChatCall.ts`。

删除 message 时，需要同步删除对应 `turn_events`。

删除 conversation 时，需要先删除该 conversation 下的 `turn_events`，再删除 `messages`、actors、conversation。

### 读取和历史拼接

#### transcript / 普通聊天历史

普通聊天历史以 `messages` 为主：

- `user_text` 直接使用 `messages.display_text`
- `assistant_turn_events` 也先使用 `messages.display_text`

因此现有聊天列表、SSE chunk fallback、基础 transcript 不需要一开始就重写成事件驱动。

#### prompt 历史拼接

`buildConversationMessages()` 不应直接信任 assistant message 的纯文本字段是完整事实源，而应按 `messages.kind` 做处理。

推荐策略：

- `user_text`：直接拼到历史消息
- `system_text`：直接拼到历史消息
- `assistant_turn_events`：从该 message 关联的 `turn_events` 中，按 `seq` 取出所有 `replyText`，拼成 assistant history text

这一步不要从 `expression`、`sceneAtmosphere`、`stateUpdate` 直接拼进普通 transcript。

#### 当前状态读取

不同事件类型读取策略不同：

- `replyText`
  始终作为 transcript 的一部分保留和回放
- `expression`
  默认取最近一次有效值作为当前表情
- `sceneAtmosphere`
  默认取最近一次有效值作为当前场景氛围
- `stateUpdate`
  保留原始事件日志，并视需要投影到状态快照

更准确地说，不是“只存最新那个”，而是：

- 原始事件全部存
- 常规读取当前状态时只用最新有效值

### `stateUpdate` 的长期位置

`stateUpdate` 最终适合“事件日志 + 当前快照”双轨并存。

推荐：

- `turn_events` 永远保存原始 `stateUpdate` 事件
- 另有状态投影表或现有状态存储承接当前值

例如：

- `itemGranted` 投影到背包 / 物品计数
- `flagSet` 投影到 flag 状态
- `relationshipDelta` 投影到关系值

这样既有审计和回放能力，也有高效查询当前状态的能力。

### prompt 组装的第一版边界

第一版推荐先这样做：

1. 历史对话只拼 user message 和 assistant `replyText`
2. `expression`、`sceneAtmosphere`、`stateUpdate` 暂不注入主 transcript
3. 后续如果需要，再在 prompt view model 中新增单独区域，例如：

```text
当前表情：happy
当前场景氛围：calm
```

也就是说，`replyText` 先解决“会说什么”，状态事件后续再解决“说话时处于什么状态”。

### 未来扩展新 key / 新事件类型

未来如果 `submit_turn_events` 增加新的字段或新的事件类型，这个表结构不需要大改。

#### 在现有事件类型中增加字段

例如 `expression` 增加 `reason`：

- 更新 Zod schema
- `payload_json` 自动承载新字段
- 旧数据没有该字段也能读

#### 增加新的事件类型

例如新增 `gesture`、`innerThought`、`cameraCue`：

- `turn_events.type` 直接写新类型名
- `payload_json` 存完整事件对象
- 不认识该类型的旧读取逻辑可以安全跳过

所以扩展策略应是：

- 表结构保持稳定
- schema 通过 `schema_version` 和读取逻辑逐步演进
- 展示和 prompt 逻辑按需支持新事件类型

### 对当前项目的最终推荐

在“可以删库、可以做破坏性调整”的前提下，推荐直接上：

- 调整 `messages` 表为 `kind + display_text`
- 新增 `turn_events` 表
- assistant 回复保存为一条 message + 多条 turn_event

不推荐把“assistant turn 完整 JSON”长期塞进 `messages.content` 作为主方案。

把 JSON 塞进 `content` 可以作为过渡方案，但长期会让：

- 消息读取语义混杂
- prompt 拼接耦合到 JSON parse
- 未来按事件类型查询和状态投影变得别扭

既然当前阶段可以接受破坏性修改，直接落到事件表会更干净。

## 14. 中文 prompt

当前 prompt 在：

```text
packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs
```

需要检查并保持以下要求：

- 明确要求模型不要输出普通 assistant 文本。
- 明确要求所有台词、表情、场景氛围、状态更新都通过 `submit_turn_events`。
- 明确 `submit_turn_events` 是本回合最终输出工具。
- 明确 `replyText.text` 不要包含角色名、动作说明、表情说明、系统说明。
- 明确 events 数组顺序就是播放和处理顺序。
- 不要在 prompt 中暗示普通 JSON structured output 是可接受结果。

注意：prompt 更新只有在工具定义真正传给 provider 后才有效。否则模型可能按文字要求“想调用工具”，但 API 侧没有可用工具。

## 15. Agent loop 预期行为

后续完整 agent loop 应根据工具的 `terminal` 字段判断是否结束 turn。

逻辑：

- 如果模型调用的是非 terminal 工具，例如 `query_memory`
  - 执行工具。
  - 把 tool result 追加回 messages。
  - 继续调用模型。

- 如果模型调用的是 terminal 工具，例如 `submit_turn_events`
  - 解析并校验 arguments。
  - 返回事件列表。
  - 结束当前 turn。

如果模型直接输出普通文本而没有 tool call：

- 当前阶段可以视为格式错误。
- 可以追加纠正消息或直接重试。
- 不要把普通文本当成合法结果。

## 注意事项

1. 不要把 JSON Schema 写成单独 JSON 文件作为源头。

JSON 文件可以用于配置枚举、prompt 文案、道具定义、状态 key 白名单等，但不适合作为工具参数 schema 的唯一事实源。

2. provider 兼容处理留在 provider adapter。

如果 Zod 生成的 JSON Schema 对某些 provider 太复杂，例如嵌套 union、oneOf、defs 导致模型遵守效果不好，应在 provider adapter 层做降级或清洗。

不要为了迁就某个 provider 修改 core 的业务 schema。

3. 第一版保持事件类型较少。

先实现：

- `replyText`
- `expression`
- `sceneAtmosphere`
- `stateUpdate`

不要一开始加入太多事件类型。

4. `memoryCandidate` 暂时不要放进 `submit_turn_events`。

记忆候选更适合后台总结或单独的 memory extraction 流程。之后如果确实需要实时生成，再新增事件类型。

## 建议执行阶段

建议按下面顺序执行。每个阶段完成后尽量跑对应局部测试，避免最后一次性排查跨层问题。

### 第 1 步：共享事件 schema 和 API contracts

目标：

- 在 `packages/contracts/src/turnEvents.ts` 中定义 `TurnEvent`、`SubmitTurnEventsArgsSchema` 和相关类型
- 更新 `packages/contracts/src/apis/chat.api.ts`
- 更新 `packages/contracts/src/apis/conversation.api.ts`
- 从 contracts 导出新类型

建议测试：

```bash
pnpm --filter @ss-ai/contracts build
```

通过标准：

- contracts 能独立构建
- web / server 可从 `@ss-ai/contracts` 引用 `TurnEvent`

### 第 2 步：persona-flow core 工具定义和解析

目标：

- 新增 provider-neutral `ModelToolDefinition`
- 新增 `submitTurnEventsTool`
- 新增 `parseSubmitTurnEventsArgs`
- 扩展 `ModelGenerationInput`、`PersonaModelRequest` 以支持 `tools` / `toolChoice`
- 更新 `ModelRuntime` 透传 tools

建议测试：

```bash
pnpm --filter @ss-ai/persona-flow typecheck
pnpm --filter @ss-ai/persona-flow test
```

通过标准：

- tool 定义不依赖任何 provider SDK
- parser 能校验合法和非法 tool arguments
- runtime 能把 tools 传给 `ModelClient`

### 第 3 步：SQLite 表结构和 store

目标：

- 调整 `messages` 表为 `kind + display_text`
- 新增 `turn_events` 表
- 更新 `openDatabase.ts` 和 `openCharacterDatabase.ts`
- 更新 `SQLiteMessageStore`
- 删除 message / conversation 时同步删除 `turn_events`
- 更新测试用 in-memory stores

建议测试：

```bash
pnpm --filter @ss-ai/persona-flow-sqlite test
pnpm --filter @ss-ai/persona-flow test
```

通过标准：

- fresh database 可以创建新表结构
- user message 能正常写入和读取
- assistant turn 能写入一条 message 和多条 turn event
- get recent messages 能带回 assistant turn 的 events
- delete message / conversation 不留下孤立 turn event

### 第 4 步：Mistral tool adapter

目标：

- 新增 `mistralToolAdapter.ts`
- 把 `ModelToolDefinition` 转成 Mistral SDK tools 参数
- `MistralModelClient.generate()` 传入 tools / tool choice
- `MistralModelClient.generateStream()` 预留或传入 tools / tool choice

建议测试：

```bash
pnpm --filter @ss-ai/persona-flow-model-client typecheck
```

通过标准：

- model-client package 能 typecheck
- 非结构化和 tool-call 请求路径都能通过类型检查
- provider-specific 类型不泄漏回 `persona-flow` core

### 第 5 步：singleCharacterChatCall 和 ChatTurnService

目标：

- `singleCharacterChatCall.ts` 不再使用 `singleCharacterChatStructuredOutputSchema` 作为主输出
- 请求中传入 `submitTurnEventsTool`
- 解析 `submit_turn_events` tool call
- 将 `replyText` 合并为 `output`
- 将解析后的 submit_turn_events 结果封装为 `parsedOutput`，并由 `ChatTurnService` 作为 `turnEvents` 返回
- `ChatTurnService` 用 store 事务保存 assistant turn

建议测试：

```bash
pnpm --filter @ss-ai/persona-flow test
```

通过标准：

- 模拟 ModelClient 返回 tool call 时，chat turn 能保存 assistant turn
- 没有 `submit_turn_events` 时会报格式错误
- replyText 为空时行为明确
- dry-run 仍能返回 assembled messages

### 第 6 步：server API 和 web 显示

目标：

- non-stream chat response 返回 `turnEvents`
- get messages response 返回 `kind` / `turnEvents`
- stream `done` event 返回 `turnEvents`
- web 移除或停止依赖 `structuredOutput`
- web 对 `turnEvents` 做轻量平铺显示

建议测试：

```bash
pnpm --filter @ss-ai/server typecheck
pnpm --filter @ss-ai/web typecheck
```

通过标准：

- 非 streaming 发送消息后，前端能显示 `output` 和 turn event block
- 刷新历史后，assistant message 仍能显示文本，并可拿到 `turnEvents`
- streaming 结束后，`done` event 可携带完整 `turnEvents`

### 第 7 步：全量验证

目标：

- 确认所有 workspace package 构建和测试通过
- 使用 dry-run / prompt log 检查 prompt 中确实要求 tool call
- 使用实际 provider 做一次手动 chat 验证

建议测试：

```bash
pnpm run build
pnpm -r --if-present test
```

手动验证：

- 启动 server 和 web
- 新建或选择一个 conversation
- 发送一条消息
- 确认数据库中有 `messages` 和 `turn_events`
- 确认前端显示 assistant 文本和事件列表
- 确认后续一轮 prompt 历史中包含上一轮 `replyText`

## 验收标准

1. `persona-flow` core 中存在 provider-neutral 的 `ModelFunctionToolDefinition`。
2. `submitTurnEventsTool` 不依赖 Mistral 或 OpenAI SDK。
3. `submitTurnEventsTool` 使用 Zod args schema，不手写巨大 JSON Schema。
4. `ModelGenerationInput` / `PersonaModelRequest` 能传递 tools 和 tool choice。
5. Mistral adapter 能将 `submitTurnEventsTool` 转换为 Mistral SDK tools 参数。
6. Mistral non-stream 请求能把 tools 传给 provider。
7. Mistral stream 请求预留或实现 tools 传递路径。
8. `singleCharacterChatCall.ts` 不再依赖 `singleCharacterChatStructuredOutputSchema` 作为主输出路径。
9. `singleCharacterChatCall.ts` 能解析 `submit_turn_events` tool call arguments。
10. tool call arguments 能用同一套 Zod schema 做本地校验。
11. chat API response 能返回原始 `turnEvents`，供前端直接平铺显示。
12. `output` 仍由 `replyText` 事件合并得出，用于兼容当前 assistant message 主路径。
13. assistant turn 的原始 `turnEvents` 能被逐条持久化，而不只是最终拼接文本。
14. `messages` 负责时间轴和展示文本，`turn_events` 负责结构化事件事实源。
15. 历史组装时，`replyText` 作为 transcript 保留，`expression` / `sceneAtmosphere` 默认按最近有效值参与当前上下文。
16. 新增事件字段或新事件类型时，不需要大幅修改表结构，只需扩展 schema 和读取逻辑。
17. 中文 prompt 明确要求模型通过 `submit_turn_events` 输出，而不是普通文本。
18. terminal tool 的语义被保留，供后续 agent loop 判断 turn 是否结束。

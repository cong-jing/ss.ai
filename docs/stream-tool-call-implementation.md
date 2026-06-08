# Stream Tool-Call Implementation Plan

本文记录 `single_character_chat` 真正接入 stream 模式时建议采用的数据形状、解析边界和文件修改点。

## 背景

当前 non-stream 已经使用 terminal tool `submit_turn_events` 返回结构化回合事件：

1. `singleCharacterChatCall` 组装 prompt，并强制 `toolChoice = submit_turn_events`。
2. `ModelRuntime.chat()` 只负责解析 provider/model/API key，调用 `ModelClient.generate()`。
3. `singleCharacterChatCall` 从 `llmResponse.toolCalls` 找到 `submit_turn_events`，解析为 `SubmitTurnEventsArgs`。
4. `chatTurnService` 只消费 `parsedOutput = { displayText, events }`，并持久化 assistant message + turn events。

stream 路径目前还没有真正走 provider streaming：`chatTurnService.streamTurn()` 调用的是 `modelCall.run()`，最终仍是 non-stream generate，再把完整 replyText 一次性发成一个 SSE `chunk`。

目标是保持同一套 terminal tool 语义：stream 和 non-stream 最终都以 `submit_turn_events` 的完整 tool call 为准，不让 `chatTurnService` 或 web 直接理解 provider tool-call 格式。

本文选择的方案是：继续使用 `submit_turn_events` tool call，服务端新增一个相对独立的 streaming JSON preview parser。它只负责从 tool-call arguments 的增量 JSON 字符串里提取“已经能安全预览”的语义事件；最终入库和最终响应仍然只信任完整 arguments 的 schema parse 结果。

## 核心约束

强制 terminal tool call 后，模型通常不会输出普通 assistant text。provider stream 里可见的数据主要会是 tool-call arguments 的 JSON 片段，例如：

```json
{"events":[{"type":"replyText","characterId":"c1","text":"你"}
```

因此 stream 模式有两层输出：

1. **最终权威结果**：完整 tool-call arguments 合并完成后，使用 `SubmitTurnEventsArgsSchema` 解析，得到 `turnEvents` 和 canonical `displayText`。
2. **可见流式预览**：在 tool-call arguments 尚未完整 JSON.parse 前，独立 preview parser 可以 best-effort 提取 `replyText.text` 的新增字符，或在完整 event object 闭合后输出非文本事件预览。这个预览不入库，也不作为最终事实。

因为当前设计不允许普通 assistant `content` 作为回复正文，真正的用户可感知 stream 必须来自 tool-call arguments 的增量解析。也就是说，stream 实现的核心任务不是执行 tool，而是解析 `submit_turn_events` arguments 的 JSON 字符流，并把安全的中间结果转换成应用语义事件。

## ModelClient：每次 stream 数据长什么样

建议扩展 provider-neutral stream callback，而不是把 Mistral 的 chunk 直接暴露到上层。

在 `packages/persona-flow/src/llm/modelClient.ts` 增加 delta 类型：

```ts
export interface ModelToolCallDelta {
    id?: string;
    type?: string;
    index?: number;
    functionNameDelta?: string;
    argumentsDelta?: string;
    raw?: unknown;
}

export interface ModelStreamCallbacks {
    onTextDelta?: (delta: string) => void;
    onToolCallDelta?: (delta: ModelToolCallDelta) => void;
    onToolCall?: (toolCall: ModelToolCall) => void;
}
```

`generateStream()` 内部每收到 provider chunk，就归一化成以下几类动作：

```ts
callbacks?.onTextDelta?.("普通 assistant content 增量");
callbacks?.onToolCallDelta?.({
    index: 0,
    id: "call_xxx",
    type: "function",
    functionNameDelta: "submit_turn_events",
    argumentsDelta: "{\"events\":[{\"type\":\"replyText\""
});
```

返回值仍然是完整聚合后的 `ModelStreamResult`：

```ts
{
    output: "普通 assistant content 聚合结果，强制 tool call 时通常为空",
    toolCalls: [
        {
            id: "call_xxx",
            type: "function",
            index: 0,
            functionName: "submit_turn_events",
            arguments: "{\"events\":[...]}"
        }
    ],
    usage,
    completed: true,
    finishReason: "tool_calls"
}
```

### Mistral adapter 合并规则

在 `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts` 实现 `generateStream()`：

1. 调用 `client.chat.stream({ model, messages, ...toolRequest })`。
2. 对每个 event 读取 `event.data ?? event`，再取 `choices[0]`。
3. `choice.delta.content` 经 `extractTextDelta()` 转成 text delta，追加到 `output`，并触发 `onTextDelta`。
4. `choice.delta.toolCalls ?? choice.delta.tool_calls` 按 `index` 合并：
   - `id`、`type` 有值就记录。
   - `function.name` 或 `function.name_delta` 作为 `functionNameDelta`，追加或设置到 accumulator。
   - `function.arguments` 或 `function.arguments_delta` 作为 `argumentsDelta`，按顺序追加。
5. 每个 tool-call delta 都触发 `onToolCallDelta`。
6. stream 结束后，把 accumulator 转成 `ModelToolCall[]`，触发 `onToolCall`，并返回 `ModelStreamResult`。

Mistral SDK 字段可能在 camelCase 和 snake_case 间变化；adapter 应像现有 `extractToolCallsFromMessage()` 一样兼容两套命名。

## ModelRuntime：只透传，不解析业务

`packages/persona-flow/src/modelCall/modelRuntime.ts` 的边界保持不变：

- `chatStream()` 继续解析 provider/model/API key。
- 调用 `modelClient.generateStream()` 时透传 `tools` / `toolChoice`。
- 新增透传 `onToolCallDelta`，并保留日志。
- 不解析 `submit_turn_events`，不 JSON.parse arguments。

建议签名调整：

```ts
async chatStream(request: PersonaModelRequest & {
    onTextDelta?: (delta: string) => void;
    onToolCallDelta?: (delta: ModelToolCallDelta) => void;
}): Promise<PersonaModelResponse & ModelStreamResult>
```

`ModelRuntime` 最终返回的 `llmResponse.toolCalls` 必须已经是完整合并后的 provider-neutral tool calls。

## ModelCall：stream parse 应该在哪里做

`ModelCall` 需要有 stream 入口，否则 `chatTurnService.streamTurn()` 只能继续调用 non-stream `run()`。

建议在 `packages/persona-flow/src/modelCall/modelCall.ts` 增加：

```ts
export type ModelCallStreamRunInput = ModelCallRunInput & {
    onDisplayTextDelta?: (delta: string) => void;
    onTurnEventPreview?: (preview: SubmitTurnEventsTurnEventPreview) => void;
};

export interface ModelCall<TParsedOutput = unknown> {
    purpose: ModelCallPurpose;
    run(input: ModelCallRunInput): Promise<ModelCallRunResult<TParsedOutput>>;
    runStream?(input: ModelCallStreamRunInput): Promise<ModelCallRunResult<TParsedOutput>>;
}
```

`singleCharacterChatCall` 建议拆出三个 helper：

- `buildSingleCharacterChatRequest(input)`：复用 prompt 和 toolChoice 组装。
- `parseSingleCharacterChatResponse(llmResponse, promptContext)`：复用完整 tool-call parse。
- `createSubmitTurnEventsPreviewParser()`：只用于 stream 预览，且不依赖 provider、runtime、store 或 prompt context。

stream 流程：

```ts
const preview = createSubmitTurnEventsPreviewParser();
const llmResponse = await input.runtime.chatStream({
    ...llmRequest,
    onToolCallDelta: (delta) => {
        if (delta.functionNameDelta && delta.functionNameDelta !== "submit_turn_events") return;
        if (!delta.argumentsDelta) return;

        for (const event of preview.push(delta.argumentsDelta)) {
            if (event.type === "replyTextDelta") {
                input.onDisplayTextDelta?.(event.text);
            } else if (event.type === "turnEventPreview") {
                input.onTurnEventPreview?.(event);
            }
        }
    },
});

const parsedOutput = parseSingleCharacterChatResponse(llmResponse, input.promptContext);
return { llmRequestSnapshot: llmRequest, llmResponse, parsedOutput };
```

最终 `parsedOutput` 仍然来自完整 tool call，不来自 preview。

## 独立 JSON preview parser

新增 `packages/persona-flow/src/chatTurn/events/submitTurnEventsStreamPreview.ts`，并把 JSON 增量解析代码集中在这里。这个文件应保持相对独立：

- 输入只有 tool-call `argumentsDelta: string`。
- 输出只有 preview events。
- 不导入 Mistral SDK，不导入 `ModelRuntime`，不访问 stores，不写 SSE。
- 可以导入 `@ss-ai/contracts/turnEvents.schema` 的 `TurnEventSchema` 和 `@ss-ai/contracts` 的 `TurnEvent` 做完整事件校验。
- 任何 preview parse 错误都不能影响最终完整 tool call parse。

建议接口：

```ts
export type SubmitTurnEventsPreviewEvent =
    | {
        type: "replyTextDelta";
        eventIndex: number;
        text: string;
    }
    | {
        type: "turnEventPreview";
        eventIndex: number;
        event: TurnEvent;
    };

export type SubmitTurnEventsTurnEventPreview = Extract<
    SubmitTurnEventsPreviewEvent,
    { type: "turnEventPreview" }
>;

export interface SubmitTurnEventsStreamPreviewParser {
    push(delta: string): SubmitTurnEventsPreviewEvent[];
    getBufferedArguments(): string;
}

export function createSubmitTurnEventsPreviewParser(): SubmitTurnEventsStreamPreviewParser;
```

### Parser 解析策略

Parser 不需要把半截 JSON parse 成完整对象。它应实现一个小型 streaming tokenizer/state machine，只识别当前协议需要的结构：

- 根对象 `{ ... }`。
- `events` 数组。
- 每个 `events[n]` object 的开始和结束。
- object 内的 string key。
- string / number / boolean / null / object / array value 的边界。
- `replyText.text` 字段的 string 内容增量。

第一版建议支持两类 preview：

1. `replyTextDelta`：当 tokenizer 位于 `events[n].text` 且当前事件的 `type` 已确定为 `replyText` 时，持续输出 JSON string 中新增且已完整解码的字符。
2. `turnEventPreview`：当某个 `events[n]` object 已闭合后，取该 object 的完整 JSON 字符串，`JSON.parse` 后用 `TurnEventSchema.safeParse` 校验；通过后发一次完整事件预览。

`replyTextDelta` 解决长文本 token stream；`turnEventPreview` 解决表情、氛围等短事件提前应用。`stateUpdate` 可以先不发 preview，或由上层收到 `turnEventPreview` 后过滤掉，直到最终 `done.turnEvents` 再应用。

### 字符串解码要求

`replyText.text` 的增量不能直接把原始 JSON 字符串片段透传给前端。Parser 需要处理 JSON string escape：

- 普通字符可以立即输出。
- `\"` 输出 `"`。
- `\\` 输出 `\`。
- `\n`、`\r`、`\t` 等转义输出对应字符。
- `\uXXXX` 必须等 4 位 hex 都到齐后再输出。
- 如果 delta 停在 `\` 或半个 `\u` 中间，先缓冲，不输出。

示例：

```text
argumentsDelta: "{\"events\":[{\"type\":\"replyText\",\"text\":\"你"
preview: [{ type: "replyTextDelta", eventIndex: 0, text: "你" }]

argumentsDelta: "好\\n今"
preview: [{ type: "replyTextDelta", eventIndex: 0, text: "好\n今" }]

argumentsDelta: "天\"}]}"
preview: [{ type: "replyTextDelta", eventIndex: 0, text: "天" }]
```

### 完成状态判断

Parser 可以判断“语法完成”，但不能把 preview 当最终事实：

- string value：读到未转义 closing quote 后完成。
- number / boolean / null：读到 `,`、`]`、`}` 或 whitespace 后完成。
- object / array：嵌套深度回到该 value 的起点后完成。
- event object：`events[n]` 对象的 `}` 闭合后完成。

JSON 语法允许重复 key，模型理论上可能先输出 `"expression":"happy"`，后面又输出 `"expression":"sad"`。因此 key/value 完成只适合 preview，不适合入库或最终事实。非文本事件推荐等整个 event object 闭合并通过 schema 后再 preview，而不是看到单个 key 完成就应用。

### Parser 失败策略

Preview parser 是 best-effort：

- 遇到非法 JSON 前缀、深度异常、重复 preview 等问题，只停止继续输出 preview 或记录 debug 日志。
- 不抛出会中断 model stream 的异常。
- 最终完整 arguments 仍由 `parseSubmitTurnEventsArgs()` 统一校验；这里失败才算本次模型输出失败。

## ChatTurnService：接收什么，传出去什么

`packages/persona-flow/src/chatTurn/chatTurnService.ts` 的 `streamTurn()` 应改为：

1. `prepareChatTurnContext(... persistUserMessage: true)`。
2. resolve model call。
3. 如果 `includeAssembledMessages`，在 request 组装完成后触发 `onAssembledMessages`。
4. 调用 `modelCall.runStream({ ..., onDisplayTextDelta: input.onChunk })`。
5. 从 `callResult.parsedOutput` 取 `{ displayText, events }`。
6. 持久化 assistant turn：
   - `messages.display_text = displayText`
   - `turn_events = events`
7. 返回：

```ts
{
    requestId,
    model,
    apiKeySource,
    output: displayText,
    userMessageId,
    assistantMessageId,
    turnEvents: events,
    streamCompleted: llmResponse.streamCompleted,
    streamFinishReason: llmResponse.streamFinishReason
}
```

`chatTurnService` 仍然不接触 `toolCalls`，只消费 model-call 的 `parsedOutput`。

如果 `modelCall.runStream` 不存在，可以临时 fallback 到现有 `run()`，但日志应标明是 non-stream fallback。

## Server SSE 契约

当前 `ChatStreamEvent` 已有 `chunk` / `assembledMessages` / `done`，可以兼容保留。建议增强 `done`：

```ts
export type ChatStreamEvent =
    | { type: "chunk"; content: string }
    | { type: "turnEventPreview"; eventIndex: number; event: TurnEvent }
    | { type: "assembledMessages"; messages: ChatDryRunMessage[] }
    | {
        type: "done";
        requestId: string;
        model: string;
        apiKeySource?: "user" | "default";
        output?: string;
        userMessageId?: string;
        assistantMessageId?: string;
        turnEvents?: TurnEvent[];
        streamCompleted?: boolean;
        streamFinishReason?: string;
    }
    | { type: "error"; requestId: string; message: string };
```

SSE 顺序：

1. `assembledMessages`，仅 debug 请求发送。
2. 0 到 N 个 `chunk`，来自 `replyTextDelta`。
3. 0 到 N 个 `turnEventPreview`，来自完整 event object preview。前端可以用它提前更新表情或氛围，但不能持久化为事实。
4. `done`，携带最终权威 `output`、message ids 和完整 `turnEvents`。
5. 失败时发送 `error`，然后结束连接。

## Web 前端处理

`apps/web/src/panels/chat/chatApi.ts` 可以继续按 `data:` 行解析 SSE。

建议返回结果扩展为：

```ts
Promise<{
    requestId: string;
    model: string;
    apiKeySource: "user" | "default" | null;
    output?: string;
    userMessageId?: string;
    assistantMessageId?: string;
    turnEvents?: TurnEvent[];
}>
```

`useChatViewModel.ts` 的 stream 分支：

1. 发送前创建本地 assistant placeholder，`status = "streaming"`。
2. 每个 `chunk` 继续 append 到 placeholder `content`。
3. 收到 `turnEventPreview` 后，可以提前更新本地消息的 preview state，例如表情、氛围；`stateUpdate` 建议忽略到 `done`。
4. 收到 `done` 后：
   - `status = "normal"`。
   - `id = assistantMessageId ?? requestId ?? localId`，避免本地 id 和数据库消息 id 不一致。
   - `turnEvents = done.turnEvents`。
   - `content = formatTurnEventsForMessage(done.turnEvents, done.output ?? currentContent)`。
5. debug block 仍然展示 assembled messages 和完整 turnEvents。

前端不需要理解 tool-call delta，也不需要处理半截 JSON。前端只消费服务端已经转换好的语义 preview event。

## 建议修改文件

- `packages/persona-flow/src/llm/modelClient.ts`
- `packages/persona-flow-model-client/src/mistral/messageTransforms.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`
- `packages/persona-flow/src/modelCall/modelRuntime.ts`
- `packages/persona-flow/src/modelCall/modelCall.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
- `packages/persona-flow/src/chatTurn/events/submitTurnEventsStreamPreview.ts`（新增）
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
- `packages/contracts/src/apis/chat.api.ts`
- `apps/server/src/http/apis/chat/streamService.ts`
- `apps/web/src/panels/chat/chatApi.ts`
- `apps/web/src/panels/chat/useChatViewModel.ts`

## 测试建议

- `ModelRuntime.chatStream()` 会把 `tools` / `toolChoice` / `onToolCallDelta` 传给 `ModelClient.generateStream()`。
- Mistral stream adapter 能把多个 tool-call argument delta 按 `index` 合并成一个完整 `ModelToolCall`。
- `singleCharacterChatCall.runStream()` 能在最终 tool call 完整后得到与 non-stream 相同的 `parsedOutput`。
- preview parser 对简单 replyText JSON 片段能逐步吐出新增文本；遇到不完整转义时不抛错。
- preview parser 能在完整 event object 闭合后输出 `turnEventPreview`，并过滤 schema 不通过的对象。
- preview parser 单元测试覆盖 `\"`、`\\`、`\n`、半个 `\uXXXX`、跨 delta 的 key/value、重复 key、非法前缀。
- `chatTurnService.streamTurn()` 调用 `runStream()`，按 chunk callback 发预览，最终持久化完整 `turnEvents`。
- `/v1/chat/stream` 的 `done` 带 `turnEvents`、`output` 和 `assistantMessageId`。
- web stream 分支收到 chunk 时显示增量，收到 done 后用 final output/turnEvents 校正内容。

## 推荐实施顺序

1. 先补 `ModelClient` delta 类型和 Mistral stream accumulator，保证最终 `ModelStreamResult.toolCalls` 完整。
2. 给 `ModelCall` 增加 `runStream()`，让 `singleCharacterChatCall` 走 `runtime.chatStream()` 并复用最终 parser。
3. 增加独立 `submitTurnEventsStreamPreview`，先只让单元测试跑通，不接入业务。
4. 改 `chatTurnService.streamTurn()` 和 server SSE，把 preview parser 的 `replyTextDelta` 转成 `chunk`，把完整事件 preview 转成 `turnEventPreview`。
5. 最后增强 web preview/done 处理，用 `assistantMessageId` 和 canonical output 校正本地 placeholder。

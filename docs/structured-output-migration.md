# Single-Character Chat：从 tool_call 迁移到 structured output

## 背景与目的

### 起因

`singleCharacterChat` 的"最终输出"目前走 OpenAI 风格的 `tool_call` 通道：
模型强制调用 `submit_turn_events(events: TurnEvent[])`，
adapter 把 `tool_calls[0].function.arguments` 中的 JSON 字符串解析为
`SingleCharacterChatResult`。

实测发现，Mistral 服务端对 `tool_call` 的 SSE 是**整段缓冲**的：

| 模型 | 模式 | 首 chunk 到达 | chunk 形态 |
|---|---|---|---|
| `mistral-small-latest` | 纯文本 | 525 ms | 79+ 个，逐 token |
| `mistral-small-latest` | tool_call | 3654 ms | 2 个，第一个就是完整 args |
| `mistral-large-latest` | tool_call | 17675 ms | 2 个，第一个就是完整 args |
| `mistral-small-latest` | structured (`json_schema`) | 532 ms | 与纯文本一致，逐 token |

也就是说，Mistral 的 tool_call 在 SSE 层根本没有做到「字一个个出」，
而 `response_format: { type: "json_schema", ... }` 走的是文本通道，按 token 即时 flush。

OpenAI 或其他 provider 未必有同样的 tool-call 缓冲问题，但当前实际接入路径以 Mistral 为主。
为了让当前可用的 stream UX 先变好，本次迁移优先解决 Mistral 的最终输出通道问题。

### 设计取舍重估

最初选用 tool_call 的两个理由现在都不再成立：

1. **"tool_call 的 `arguments` 是结构化，省去 JSON 解析"** —— 实际上
   `arguments` 在 wire 上仍然是 JSON 字符串；要做流式 preview
   就必须做增量 JSON 解析（`createSubmitTurnEventsPreviewParser` 一直在做这件事）。
2. **"tool_call 提供 schema 强约束"** —— `json_schema` 提供同等乃至更强
   （`strict: true`）的约束。

而 tool_call 在 Mistral 上有一个明确缺点：**服务端缓冲**，破坏流式 UX。

更关键的是：当前的 `submit_turn_events` 实际承担的是**最终响应 schema**的职责，
不是 agent loop 中途真正需要调用的能力。它的作用是让模型把本回合台词、表情、
场景氛围、状态更新收束成统一事件列表。

因此，把这个最终输出继续伪装成 tool-call，已经没有明显收益：

- 它没有避开 streaming JSON parse；
- 它没有改善 schema 校验；
- 它在 Mistral 上反而破坏 streaming；
- 它还会让 prompt 绑定在「调用工具」这套机制词上。

### 决策

- **最终面向用户的输出**：改为 structured output（`response_format: json_schema`），
  使用统一的 `events` 输出 schema。这次迁移就是干这件事。
- **未来中途 query tool（查询长期记忆、世界观、状态等）**：
  仍保留真正的 tool_call 抽象用于 query 循环，
  非流式即可（结果是数据不是台词）。
  这次迁移不动 query tool 抽象，保留 `ModelToolDefinition` /
  `ModelToolChoice` / `ModelToolCallDelta` 以备将来。
- **暂不维护 provider 分叉 prompt**：
  理论上未来可以按 provider 选择不同机制，例如 Mistral 用 structured schema，
  OpenAI 继续用 tool call。但这会让 prompt、stream callback、response parser、
  test fixture 都分叉。当前阶段不想维护两套 prompt，所以先统一到 structured schema。

两个 phase 用不同的 LLM API 通道，互不干扰，concern 清晰分离。

---

## 影响面

### 不动的层

#### `@ss-ai/contracts`：wire **0 改动**，注释小改

`ChatStreamEvent` 已经是机制无关的：

```ts
type ChatStreamEvent =
    | { type: "chunk"; content: string }                              // 增量 reply 文本
    | { type: "turnEventPreview"; eventIndex: number; event: TurnEvent } // 完整事件预览
    | { type: "assembledMessages"; messages: ChatDryRunMessage[] }
    | { type: "done"; ...; turnEvents?: TurnEvent[]; output?: string; ... }
    | { type: "error"; requestId: string; message: string };
```

它不感知上游是 tool_call 还是 structured output；
`SubmitTurnEventsArgs` 的 JSON 形状也不变。
所以 `chat.api.ts` 的 SSE wire 格式完全保留。

> 注：`chunk.content` 注释里写的「parsed from streaming tool-call arguments」
> 这一行措辞需要顺手中性化为「parsed from streaming structured output JSON」之类，
> 但这是文档级改动，不破坏 wire 兼容。

#### 前端：**0 改动**

`apps/web` 只消费 `ChatStreamEvent`。SSE 流的事件类型、字段、语义都不变。

#### 抽象层 `@ss-ai/persona-flow` 的 `modelClient.ts`：小改

`StructuredOutputSchema`、`ModelStreamCallbacks.onTextDelta`、
`ModelGenerationResult.structuredOutput` 已经存在并被 `generate()` 用过，
只是 `generateStream()` 链路上一直没接 `responseFormat`，也没有把最终 JSON text
归一成 `structuredOutput`。

建议给 `ModelStreamResult` 增加：

```ts
structuredOutput?: unknown;
```

这样 structured 请求在 non-stream / stream 两条路径上都统一从
`structuredOutput` 读取最终权威结果。`output` 不再承担「面向调用方的展示文本」语义；
展示文本由上层从最终 `TurnEvent[]` 中还原，需要时前端也可以直接消费 `replyText` 事件。

`ModelToolDefinition` / `ModelToolChoice` / `ModelToolCallDelta`
**保留不删**，留给未来的 query tool 循环。

#### 解析器 `createSubmitTurnEventsPreviewParser`：逻辑 **0 改动**

它吃的就是 JSON 字符串增量，不关心来源是 `tool_calls[0].function.arguments`
还是 message text content。

源码注释里仍有 tool-call wording，可以顺手中性化；解析逻辑本身不需要改。

---

### 要动的层

#### 1. system prompt 模板（措辞中性化）

文件：[`packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs`](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs)

把"通过 `submit_turn_events` 工具提交"等机制名称改成结构化输出语言：

| 现在 | 改成 |
|---|---|
| "必须通过 `submit_turn_events` 工具提交" | "必须以结构化事件输出（`events` 数组）提交" |
| "一旦调用 `submit_turn_events`，就表示本回合已经完成" | "一旦输出本回合事件，就表示本回合已经完成" |
| "必须符合 `submit_turn_events` 的参数 schema" | "必须符合事件 schema" |
| "应先调用对应查询工具…在获得必要信息之前，不要调用 `submit_turn_events`" | （目前没有 query tool，可暂时整段移除；future 重写时再加回） |

数据模型规范条款（事件顺序、replyText 的写作规范、expression / sceneAtmosphere / stateUpdate 何时使用、不要暴露内部规则等）**全部保留不动**。

#### 2. `singleCharacterChatCall.ts`

文件：[`packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`](../packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts)

请求构造从 tool_call 切到 structured output：

```ts
// before
return {
    userId, characterId, messages,
    modelCallPurpose: singleCharacterChatCall.purpose,
    tools: [submitTurnEventsTool],
    toolChoice: { type: "function", functionName: SUBMIT_TURN_EVENTS_TOOL_NAME },
};

// after
return {
    userId, characterId, messages,
    modelCallPurpose: singleCharacterChatCall.purpose,
    structuredOutputSchema: {
        type: "json_schema",
        jsonSchema: {
            name: SUBMIT_TURN_EVENTS_TOOL_NAME,                 // 复用现有常量做 schema name
            schemaDefinition: toJSONSchema(submitTurnEventsTool.argsSchema, { io: "input" }),
            strict: false,                                       // 见下文
        },
    },
};
```

流式回调切换：

```ts
// before
onToolCallDelta: (delta) => {
    if (delta.functionNameDelta && delta.functionNameDelta !== SUBMIT_TURN_EVENTS_TOOL_NAME) return;
    if (!delta.argumentsDelta) return;
    for (const event of preview.push(delta.argumentsDelta)) { ... }
}

// after
onTextDelta: (delta) => {
    for (const event of preview.push(delta)) { ... }
}
```

最终解析：

```ts
// before
function parseSingleCharacterChatResponse(llmResponse, promptContext) {
    const toolCall = findSubmitTurnEventsToolCall(llmResponse.toolCalls);
    if (!toolCall) throw new Error(`Model response did not call ${SUBMIT_TURN_EVENTS_TOOL_NAME}.`);
    const submitTurnEventsOutput = parseSubmitTurnEventsArgs(toolCall.arguments);
    ...
}

// after
function parseSingleCharacterChatResponse(llmResponse, promptContext) {
    if (!llmResponse.structuredOutput) {
        throw new Error("Model response did not produce structured output.");
    }
    const submitTurnEventsOutput = parseSubmitTurnEventsArgs(llmResponse.structuredOutput);
    ...
}
```

这里不要再从 `llmResponse.output` 兜底解析。目标边界是：

- non-stream `ModelRuntime.chat()`：provider 已解析的对象落在 `llmResponse.structuredOutput`；
  不再额外从 structured object 中提取展示文本。
- stream `ModelRuntime.chatStream()`：Mistral text channel 的 JSON 字符串先累积为 raw text；
  stream 完成后，在 adapter 或 runtime 边界 parse 成 `llmResponse.structuredOutput`。

`parseSubmitTurnEventsArgs()` 已经支持 object 和 JSON string，但在这个 model-call 边界上，
最终权威结果应统一是 `structuredOutput`。`output` 即使保留，也只作为 raw text/debug 信息，
不参与业务解析。

`submitTurnEventsTool` 本身仍然存在 —— 它的 `argsSchema`（zod）是 JSON schema 的来源，
`SUBMIT_TURN_EVENTS_TOOL_NAME` 复用作 schema name。

#### 3. `modelRuntime.chatStream()`

文件：[`packages/persona-flow/src/modelCall/modelRuntime.ts`](../packages/persona-flow/src/modelCall/modelRuntime.ts)

调用 `modelClient.generateStream(...)` 时把 `structuredOutputSchema` 透传进去。
目前请求构造只透传 `messages` / `tools` / `toolChoice`，要加上 `structuredOutputSchema`。

```ts
streamResult = await this.deps.modelClient.generateStream(
    {
        provider, model, encryptedApiKey,
        messages: request.messages,
        tools: request.tools,
        toolChoice: request.toolChoice,
        structuredOutputSchema: request.structuredOutputSchema,   // <-- add
    },
    callbacks,
);
```

`PersonaModelRequest`（类型）已包含 `structuredOutputSchema`（被 `chat()` 非流式路径用过），无需新增字段。

`chatStream()` 收到 `streamResult.structuredOutput` 后，需要透传到
`PersonaModelResponse.structuredOutput`。structured 请求的最终业务结果只看这个字段。
`PersonaModelResponse.output` 不再负责展示文本；chat service / frontend 从最终
`TurnEvent[]` 自己还原 `replyText`。

#### 4. Mistral adapter

文件：[`packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`](../packages/persona-flow-model-client/src/mistral/mistralModelClient.ts)

`generateStream()` 增加 `responseFormat` 透传，跟现有非流式的 `generate()` 一致：

```ts
const stream = await withTimeout(
    client.chat.stream({
        model: input.model,
        messages: toSdkMessages(input),
        ...(input.structuredOutputSchema ? { responseFormat: input.structuredOutputSchema } : {}),
        ...toolRequest,            // 保留：未来 query tool 仍然有用
    }),
    this.options.timeoutMs,
    "Mistral stream request",
);
```

text content 的累积、`onTextDelta` 派发现在的代码已经支持，无需额外改动。
最后构造 `ModelStreamResult` 时，如果 `input.structuredOutputSchema` 存在，把累积的 text
JSON parse 成 `structuredOutput`。`output` 可以继续保留原始 text 作为 debug/raw content，
但业务解析不依赖它。
`toolCalls` 在 structured 模式下应为空数组（已经是默认行为）。

```ts
const structuredOutput = input.structuredOutputSchema
    ? JSON.parse(output)
    : undefined;

return {
    output,
    structuredOutput,
    toolCalls,
    usage,
    completed,
    finishReason,
};
```

##### Mistral SDK 字段名注意

Mistral SDK 的 outbound schema 用 `schemaDefinition`，会被自动映射到 wire 上的 `schema`：

```ts
// 我们的 StructuredOutputSchema 类型本身就用 schemaDefinition，跟 SDK 期望对齐
{
    type: "json_schema",
    jsonSchema: { name, schemaDefinition, strict },
}
```

建议 structured output 的 JSON schema 也走一个 provider-friendly 的清洗 helper，
至少去掉 `$schema`，并和 `mistralToolAdapter.ts` 中 tool parameters 的清洗逻辑保持一致。
不要把 Mistral 兼容性细节写回 contracts 的业务 schema。

##### `strict` 的取舍

建议初版用 `strict: false`：

- `zod → JSON schema` 转换可能附带 `additionalProperties: false` 之类，
  在 strict 模式下 Mistral 会更严，偶尔报 422。
- 我们本来就靠 `parseSubmitTurnEventsArgs`（zod safeParse）做后置校验，
  schema 级强约束的边际收益不高。
- 实测稳定后再考虑切到 `strict: true`。

#### 5. 测试

`packages/persona-flow/test/` 下涉及流式 tool_call 的 mock 需要更新：

- `submitTurnEventsStreamPreview.test.ts`：parser 单测不变（它本来就吃字符串）。
- `personaFlowChatTurnService.test.ts` 等用 mock model client 模拟 `onToolCallDelta`
  的 case，改成模拟 `onTextDelta`。
- 新增 non-stream structured case：mock `ModelRuntime.chat()` 或 `ModelClient.generate()`
  返回 `structuredOutput: { events: [...] }`，确认能解析、归一化展示文本并持久化。
- 新增 stream structured case：mock `generateStream()` 通过 `onTextDelta` 分片吐出
  `{ "events": [...] }` JSON 字符串，确认 text → preview parser → chunk / event preview →
  final events 链路。
- 保留或调整一个工具接口透传测试，确认 `ModelToolDefinition` / `ModelToolChoice`
  未来仍可用于非最终输出的 query tool。

Mistral adapter 没有现成 e2e 测试就先不补，手动跑 dev server 验证即可。

#### 6. 文档同步

迁移完成后同步更新 `docs/project-map.md` / `docs/project-map.zh-CN.md`：

- main chat flow 不再写「要求模型调用 terminal `submit_turn_events` tool」；
- maintenance notes 改成「single-character chat 最终输出走 structured schema」；
- streaming 备注改成「SSE 可以从 structured JSON text channel 解析 preview」；
- 保留 tool-call 抽象的说明移动到 future agent loop / query tool 语境。

---

## 落地步骤

1. **prompt 中性化** —— 改 `system.zh-CN.md.hbs`，独立提交。
2. **抽象层透传** —— `modelRuntime.chatStream()` 把 `structuredOutputSchema` 接进去。
3. **Mistral adapter** —— `generateStream()` 透传 `responseFormat`。
4. **切换 `singleCharacterChatCall`** —— 请求构造 + 流式回调 + 响应解析。
   解析时只读 `llmResponse.structuredOutput`，确保 non-stream / stream 在 model-call
   边界已经统一。
5. **更新单测** —— `singleCharacterChat` 系列、`chatTurnService` 系列。
6. **同步文档** —— 更新 `project-map` 中当前主输出路径、streaming 状态和维护备注。
7. **手动验证** —— 跑 `pnpm dev:server` + `pnpm dev:web`，发一段长回复，
   确认前端能看到字一个个出。

## 不在本次迁移范围

- 中途 query tool（查询长期记忆 / 世界观 / 状态）。
  保留 `ModelToolDefinition` 等抽象，等真要做 query 循环时再用。
- OpenAI / Anthropic / Gemini adapter 接入。本次只动 Mistral；
  未来 adapter 各自实现 `generateStream` 时把 `responseFormat` 接好即可。
- provider-specific 最终输出策略。本次不维护「Mistral structured schema、其他 provider tool-call」
  两套 prompt / parser / test fixture。未来如果有明确收益，再把机制选择抽象到 model-call
  或 provider adapter 层。
- API 层的 `done.output` / `ChatResponse.output` 可以继续作为兼容字段存在，
  但它应由 chat service 从最终 `TurnEvent[]` 重组，不能混入 LLM 原始 JSON。

## 风险与回退

- **风险**：Mistral 在 `response_format: json_schema` 下偶尔在 JSON 前后插入解释文本，
  导致 preview parser 失败。
  - 缓解：prompt 中性化后这类风险降低；parser 已经能容忍少量前导空白，
    必要时加一段裁剪到首个 `{` 的预处理。
- **风险**：non-stream 与 stream 的 structured 输出落点不同。
  - 缓解：在 `ModelStreamResult` 增加 `structuredOutput`，让 runtime / adapter
    在返回 model-call 前完成归一；最终解析只读 `structuredOutput`，并用同一个
    `parseSubmitTurnEventsArgs()` 做后置 schema 校验。
- **回退**：若 structured output 出现稳定性问题，恢复 `singleCharacterChatCall`
  的 tools/toolChoice 写法 + 旧的 `onToolCallDelta` 路径即可，
  其他文件（contracts、前端、抽象层）零回退成本。

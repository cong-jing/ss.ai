# Prompt Debug CLI

用于调试当前 `single_character_chat` prompt 和 `submit_turn_events` 工具调用输出的命令行工具。

它会读取 YAML 配置，渲染系统 prompt，组装最终发给模型的 messages；非 `--render-only` 模式下还会调用模型，并解析模型返回的 `submit_turn_events` tool call。

## 当前行为

CLI 现在尽量贴近生产路径：

- 默认使用 `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs`
- 发送给模型的输出模式是非 structured response
- 请求里会携带 `submit_turn_events` tool
- `toolChoice` 会强制模型调用 `submit_turn_events`
- 返回后会展示 raw tool calls、解析后的 turn events，以及从 `replyText` 聚合出的文本

消息历史拼接方式也和当前生产路径一致：system prompt 后接一组 `{ role, content }` 消息，不会自动加 `speakerTag`、角色名前缀或 `p3[...]` 标签。

## 配置示例

见 [examples/shishi-basic.yaml](./examples/shishi-basic.yaml)。

最小示例：

```yaml
name: shishi-basic

provider: mistral
model: mistral-small-latest

character:
  name: 诗诗
  displayName: 诗诗
  description: 一个开朗热情的女孩
  personaPrompt: |
    说话活泼，喜欢主动参与对话。
    有一点少女感，会吐槽，但本质上很关心别人。

userProfile:
  name: Satoshi
  bio: An engineer

messages:
  - role: user
    content: 诗诗，你觉得罗兰这个人怎么样？
  - role: assistant
    content: 嗯？突然问我这个
  - role: user
    content: 我只是路过。
```

`messages` 表示最终发给模型的历史消息数组。当前 production 的 `single_character_chat` 也是这样传：

- `self` actor -> `assistant`
- `system` actor -> `system`
- 其他 actor -> `user`
- assistant 历史如果有 `turnEvents`，只取其中 `replyText` 事件拼成 content
- 非文本 turn events 会持久化，但当前不会注入 prompt history

## 命令

在仓库根目录执行：

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml
```

只渲染 prompt 和 messages，不调用模型：

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --render-only --no-log
```

指定输出文件：

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --out apps/prompt-debug-cli/dist/shishi.chat.log.md
```

导出组装后的 messages JSON：

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --dump-messages
```

## 参数

- `--config`, `-c`: YAML 配置文件路径，必填
- `--template`, `-t`: 指定 Handlebars 模板路径，可选
- `--out`, `-o`: 指定报告输出路径，可选
- `--dump-messages`, `-d`: 额外导出组装后的 messages JSON
- `--render-only`, `-r`: 只渲染，不调用模型
- `--no-log`, `-n`: 只打印到控制台，不写报告文件

## API Key

调用模型时按以下优先级读取 API key：

1. YAML 中的 `apiKey`
2. 环境变量 `MISTRAL_API_KEY`
3. 环境变量 `MODEL_API_KEY`

`--render-only` 不需要 API key。

## 默认输出

不传 `--out` 时，CLI 会在配置文件同目录生成：

- `<config-name>.render.log.md`: `--render-only` 模式
- `<config-name>.chat.log.md`: 模型调用模式

启用 `--dump-messages` 时，还会生成 `<config-name>.messages.json`，或跟随 `--out` 生成 `<out-name>.messages.json`。

## 模板查找顺序

未传 `--template` 时，CLI 会按顺序查找：

1. 配置文件同目录的 `main.md.hbs`
2. 启动目录的 `main.md.hbs`
3. 当前进程目录的 `main.md.hbs`
4. `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/templates/system.zh-CN.md.hbs`

通常不需要指定 `--template`。

# Prompt Debug CLI

一个用于调试 prompt 的命令行工具。读取 YAML 配置，渲染模板，并可选调用模型执行一轮 chat。

## 配置文件

示例见：

- `examples/shishi-basic.yaml`

最小可用 YAML：

```yaml
provider: mistral
model: mistral-small-latest

character:
	displayName: 诗诗
	description: 一个开朗热情的女孩
	personaPrompt: |
		说话活泼，喜欢主动参与对话。

actors:
	- sourceType: logged_user
		displayName: Satoshi
		profile: An engineer

messages:
	- role: user
		speakerTag: p3[Satoshi]
		content: 诗诗，你觉得罗兰这个人怎么样？
```

配置建议：

- `p1.speakerTag` 可省略，会自动生成 `p1[character.displayName]`
- `actors[]` 只放 p3+（`logged_user` / `local_actor`）
- `actors[].speakerTag` 可省略，会自动按顺序生成 `p3/p4/...`
- `p2` 不需要配置，固定为 `p2[system]`

兼容旧字段（建议逐步迁移）：

- `self.alias` -> `p1.speakerTag`
- `actors[].alias` -> `actors[].speakerTag`
- `actors[].info` -> `actors[].profile`
- `messages[].speakerAlias` -> `messages[].speakerTag`

路径规则：

- 程序优先使用启动命令所在目录（`INIT_CWD`）解析相对配置路径；没有 `INIT_CWD` 时使用当前进程目录。
- 渲染模板按以下顺序查找：
1. 配置文件同目录下 `main.md.hbs`
2. 启动目录下 `main.md.hbs`
3. 当前进程目录下 `main.md.hbs`
4. 启动目录下 `packages/persona-flow/data/prompts/zh-CN/main.md.hbs`（本仓库开发回退）
- 推荐运行目录结构：`.runtime/prompt-debug/`，并在调用命令时传入配置文件路径。

## 命令

在仓库根目录执行：

```bash
npm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml
```

也支持短参数：

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml
```

指定模板文件：

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml -t .runtime/prompt-debug/main.md.hbs
```

### 仅渲染，不调用模型

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml -r
```

`-r` 模式除了输出 system prompt，还会输出“组装后的消息数组（system + history）”，便于对照最终发给模型的输入。

### 指定输出文件

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml -o apps/prompt-debug-cli/dist/my-run.log.md
```

### 不写日志文件（只打印控制台）

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml --no-log
```

## 参数说明

- `--config`, `-c`：配置文件路径（必填）
- `--template`, `-t`：模板文件路径（可选）
- `--out`, `-o`：输出日志文件路径（可选）
- `--render-only`, `-r`：仅渲染 prompt，不调用模型
- `--no-log`, `-n`：不写日志文件，仅控制台输出

## 默认输出文件规则

如果不传 `--out`，会自动在配置文件同目录生成日志：

- 渲染模式（`-r`）：`<配置文件名>.render.log.md`
- chat 模式：`<配置文件名>.chat.log.md`

例如输入：

- `apps/prompt-debug-cli/examples/shishi-basic.yaml`

默认输出：

- `apps/prompt-debug-cli/examples/shishi-basic.render.log.md`（渲染模式）
- `apps/prompt-debug-cli/examples/shishi-basic.chat.log.md`（chat 模式）

## API Key

调用模型时需要 API Key，优先级：

1. 配置里的 `apiKey`
2. 环境变量 `MISTRAL_API_KEY`
3. 环境变量 `MODEL_API_KEY`

## Q/A

Q: 输出文件参数必须给吗？
A: 不必须。不传 `--out` 会按默认规则写到配置文件同目录。

Q: 模板必须写 `-t` 吗？
A: 不必须。CLI 会按“路径规则”自动查找 `main.md.hbs`。需要固定模板时再用 `-t`。

Q: 参数有短写吗？
A: 有，支持 `-c/-t/-o/-r/-n`。

## 后续功能建议

1. `--dump-messages`
- 把最终发给 LLM 的完整 messages JSON 一并落盘，便于比对。

2. `--stream`
- 支持流式输出，观察中间 token 行为与前缀清理效果。

3. `--temperature` / `--topP` / `--maxTokens`
- 允许在配置或命令行覆盖采样参数，便于实验。

4. `--repeat N`
- 同一配置多次执行，观察输出波动。

5. `--template`
- 可切换模板文件路径，方便 A/B prompt 版本。

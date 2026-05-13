# Prompt Debug CLI

一个用于调试 prompt 的命令行工具。

它会读取 YAML 配置文件，构造 PromptViewModel，渲染 `main.md.hbs`，并可选直接调用模型完成一次 chat，最后将结果输出到控制台和日志文件。

## 适用场景

- 快速验证模板变量映射是否正确
- 对比不同角色/actor/消息组合下的 prompt 渲染结果
- 在不经过 server API 的情况下直接做 prompt + 模型联调

## 为什么不走 server API

当前是 prompt 调试工具，建议直接调用 persona-flow + 模型 SDK：

1. 链路短，排查更快
2. 不受 HTTP 层鉴权、路由和中间件干扰
3. 更容易构造“脱离数据库”的测试数据

后续如果要给前端共享或做远程联调，再考虑补 server API。

## 配置文件

示例见：

- `examples/shishi-basic.yaml`

核心字段：

- `provider` / `model`
- `character`
- `self`
- `actors`
- `relationshipState`
- `memories`
- `messages`
- `structuredOutput`（可选，默认 `true`）

## 命令

在仓库根目录执行：

```bash
npm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml
```

也支持短参数：

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml
```

### 仅渲染，不调用模型

```bash
npm run prompt:debug -- -c apps/prompt-debug-cli/examples/shishi-basic.yaml -r
```

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

## 你现在问的三个点（结论）

1. 必须加输出参数吗？
- 不必须。

2. 默认能否跟输入文件同目录同名加后缀？
- 可以，已经实现。

3. 参数能不能更短？
- 可以，已经支持 `-c/-o/-r/-n`。

## 建议下一步追加功能

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

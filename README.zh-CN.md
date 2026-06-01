# ss.ai

[English](README.md) | 简体中文 | [日本語](README.ja.md)

`ss.ai` 是一个围绕 LLM 驱动的角色对话与 TRPG 风格交互而构建的 TypeScript 实验项目。项目核心是 `packages/persona-flow`：它负责组装 prompt 上下文、渲染 prompt 模板、按模型调用目的选择模型、通过注入的客户端调用 LLM，并把一轮聊天结果写回注入的 stores。

这份 README 是后续维护时的项目地图。如果你是第一次打开这个仓库，建议先读这里，再去看后面列出的 “Key Files”。

## 项目状态

这个仓库主要作为个人作品集与研究项目存在。

它主要用于展示以下技术和设计实践：

- TypeScript / Node.js 应用设计
- LLM API 集成
- 基于 SSE 的流式聊天
- prompt template 的组织与管理
- structured output 与类 tool-call 事件设计
- 使用 SQLite 持久化对话与角色数据
- 角色对话与 TRPG 风格交互设计
- LLM provider 抽象层设计

现阶段它并不是一个面向通用场景的成熟 OSS 框架。
我不保证 API 稳定性、后向兼容性、生产可用级别的质量，或持续的外部维护支持。

## 工作区

仓库使用 pnpm workspace，定义在 `pnpm-workspace.yaml`：

- `packages/*`
- `apps/*`

常用命令：

```bash
npm run setup
pnpm install
pnpm run dev:server
pnpm run dev:web
pnpm run build
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run start:server:staging
pnpm run start:server:prod
pnpm run test
pnpm run prompt:debug -- --help
```

本地默认 HTTP 端口来自 `apps/server/config/config.default.json`，当前是 `8999`。

## 安装与部署

首次初始化会安装并激活项目固定版本的 pnpm：

```bash
npm run setup
```

初始化后只使用 pnpm 命令：

```bash
pnpm install
pnpm run build:server
pnpm run build:web
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run deploy:server:staging
pnpm run deploy:server:prod
pnpm run deploy:web:staging
pnpm run deploy:web:prod
```

部署输出根目录是 `.deploy-staging` 和 `.deploy-prod`。

每个部署目录都包含：

- `server`：Node.js 服务包，包含 `config/*` 和 `schemas/config.schema.json`
- `web`：由 `apps/web/dist` 构建出的静态资源

部署后的服务会从 server 包根目录读取配置资源：

- `.deploy-staging/server/config/config.default.json`
- `.deploy-staging/server/config/config.staging.json`
- `.deploy-staging/server/config/config.local.json.example`
- `.deploy-staging/server/schemas/config.schema.json`
- `.deploy-prod/server/config/config.default.json`
- `.deploy-prod/server/config/config.prod.json`
- `.deploy-prod/server/config/config.local.json.example`
- `.deploy-prod/server/schemas/config.schema.json`

Lightsail 部署还可以在 release activation 阶段创建 `server/config/config.local.json`。当前流程通过 CI secret `LIGHTSAIL_DEFAULT_API_KEY` 和 `scripts/activate-lightsail-release.mjs` 在目标机器写入本机覆盖文件。

web 部署输出位于：

- `.deploy-staging/web/*`
- `.deploy-prod/web/*`

部署后的服务启动命令：

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

本地开发命令默认都从仓库根目录启动。也就是说，`pnpm run dev:server`、`pnpm run dev:web`、`pnpm run dev:qq-bot` 会把仓库根目录作为 `process.cwd()`，因此运行时文件会落到 `./.runtime/`。在部署布局下，`pnpm run start:server:staging`、`pnpm run start:server:prod` 或 `pnpm --dir ./.deploy-prod/server start` 会以 `.deploy-*/server` 作为工作目录，因此运行时文件会落在对应的 server 包目录中。

示例：

```bash
pnpm --filter @ss-ai/server start
pnpm --dir ./.deploy-prod/server start
```

如果你需要手工覆盖运行时文件根目录，可以设置 `RUNTIME_HOME`。

如果任意 workspace 包的依赖声明发生变化，包括 `dependencies`、`devDependencies`、`peerDependencies` 或 workspace 链接，请重新执行 `pnpm install`，以保持 `pnpm-lock.yaml` 和部署依赖图同步。

## Packages

### `packages/persona-flow`

核心领域包，尽量保持不依赖具体框架和具体持久化实现。

主要职责：

- 在 `src/stores/**` 中定义领域 store interface。
- 定义 `AppStores`，作为应用层注入的聚合存储边界。
- 通过 `PromptContextBuilder` 从 stores 构建 prompt 上下文。
- 通过 `modelCallRegistry` 解析模型调用 handler。
- 实现当前 `chat.main/single_character_chat` 的 prompt 组装和输出归一化流程。
- 通过 `PersonaFlowChatTurnService` 编排一轮聊天。
- 通过 `ModelRuntime` 解析模型运行时配置并调用注入的 `ModelClient`。
- 在 `src/llm/modelClient.ts` 定义 LLM client interface。

主聊天流程：

1. `PersonaFlowChatTurnService.chatTurn()` 接收用户、角色、对话和消息输入。
2. `prepareChatTurnContext()` 校验角色和对话、解析 sender actor、按需追加用户消息，并构建 `PromptContext`。
3. `resolveModelCall()` 根据请求的 purpose 和 interaction mode 选择已注册的 handler。目前实际使用的是 `chat.main:single_character_chat`。
4. handler 组装 LLM messages，`ModelRuntime.chat()` 再从 `userPreferences.modelAssignments[modelCallPurpose]` 解析 provider 和 model，从 `providerCredential` 解析 API key，最后调用 `ModelClient`。
5. structured 输出会做归一化处理；如果 structured 输出为空，就不追加 assistant 消息。
6. 非跳过回复会作为 conversation 的 `self` actor 消息写入 chat store。

`single_character_chat` 的真实 streaming 还没有完成。虽然 `/v1/chat/stream` 和前端 SSE 路径已经存在，但当前实现仍会回退到一次 structured model call，再把完整回复作为单个 SSE chunk 发出。

interaction mode 定义来自 `@ss-ai/contracts`。当前只有 `single_character_chat` 真正注册到运行时；其他 mode 在 contracts 和 UI 中已经存在，但还没有接入 prompt 和 model-call dispatch。

### `packages/contracts`

前后端共享契约包。

主要职责：

- 通过 `ApiDefine` 定义 HTTP API。
- 在 `src/apis/*.api.ts` 中定义请求和响应类型。
- 定义 `INTERACTION_MODES`、`DEFAULT_INTERACTION_MODE` 和 `InteractionMode`。
- 定义 `MODEL_CALL_PURPOSES`、`ModelCallPurpose` 以及模型分配相关类型。

模型调用配置使用 `MODEL_CALL_PURPOSES` / `ModelCallPurpose`，以及 `ModelAssignment` / `ModelAssignmentMap`。

### `packages/persona-flow-sqlite`

`AppStores` 的 SQLite 实现。

主要职责：

- 用 Drizzle 打开 `better-sqlite3` 数据库。
- 在 `src/db/schema.ts` 中定义 schema。
- 实现角色、对话、actor、消息、用户资料、偏好和 provider credential 等 stores。
- 通过 `createSqliteStores()` 创建完整的 `AppStores`。

重要表：

- `characters`
- `conversations`
- `conversation_actors`
- `messages`
- `user_profiles`
- `user_preferences`
- `user_character_states`
- `user_provider_credentials`

`user_preferences.model_assignments_json` 用来保存从 model-call purpose 到 `{ provider, model }` 的映射。

### `packages/persona-flow-model-client`

模型供应商接入包。

主要职责：

- 实现 `persona-flow` 中定义的 `ModelClient` interface。
- 由 `DefaultModelClient` 按 provider 分发。
- 当前实际 provider 是通过 `MistralModelClient` 接入的 Mistral。
- 支持普通生成、非结构化流式生成、structured 输出和模型列表获取。

provider 列表和 API URL 来自 runtime config。API key 按用户和 provider 存在 credential store 中。SQLite 目前仍然使用空实现的 encrypt/decrypt helper，因此落库值仍是明文，直到后续补上真实加密为止。

### `packages/persona-flow-logger`

给 server 和 bot 运行时使用的小型文件 logger。

主要职责：

- 日志等级：`verbose`、`debug`、`info`、`warn`、`error`
- 可选源码位置和堆栈信息
- 全局 logger helper

## Apps

### `apps/server`

Express HTTP 服务。

主要职责：

- 读取 `apps/server/config/config.default.json`、可选的 `apps/server/config/config.{APP_ENV}.json` 和可选的 `apps/server/config/config.local.json`
- 打开位于 `runtimeFiles.userDataDir/app.db` 的 SQLite 数据库
- 通过 `createSqliteStores` 创建 `AppStores`
- 注册 chat、user preferences、profiles、characters、conversations 和 conversation actors 的 HTTP 路由
- 在每次 chat 请求中创建 `PersonaFlowChatTurnService`，并注入 stores、logger、prompt logger 和 `DefaultModelClient`

当前行为：

- 目前基本按单用户应用运行：除部分 chat 路径允许显式传入 `userId` 外，API 代码默认使用 `DEFAULT_USER_ID = "default"`
- Auth 通过 `config.auth.mode` 支持两种模式：`default-user` 和 `local-password`
- `default-user` 不做真实登录，所有请求都视为配置中的默认用户
- `local-password` 提供一个轻量的用户名密码加 session-cookie 登录流程
- `/v1/chat` 默认使用 structured 输出
- `/v1/chat/stream` 仍保持 SSE 响应形状，并在 HTTP 层拒绝 structured mode，但当前 `single_character_chat` 仍然只会一次性返回完整回复
- `/v1/chat/dry-run` 只组装 prompt messages，不调用 LLM，也不做持久化
- prompt log 由 `promptLog` 配置控制

### `apps/web`

Vue 3 + Vite 前端。

主要职责：

- 三栏主界面：左侧 workspace sidebar，中间 chat panel，右侧 context inspector 和 settings
- 复用 `@ss-ai/contracts` 中的 API 类型和常量
- 允许用户配置 provider API key 和模型分配
- 发送 chat、stream、dry-run 和消息删除请求

重要状态：

- `src/shared/state/appState.ts` 中的 `contextVersion` 会在角色或对话上下文变化后触发聊天历史刷新
- 当前 active character、conversation、actor 状态分布在各个 panel 的 view-model 中
- 当前稳定可用的是 structured 非流式路径。非结构化流式 UI 和 SSE 路径已经接好，但 `single_character_chat` 后端仍会返回单个完整回复 chunk

当前设置行为：

- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts` 负责按 purpose 加载和保存 `modelAssignments`
- 对应 API 是 `/v1/user-preference/model-assignment`

### `apps/prompt-debug-cli`

用于 prompt 实验的 CLI。

主要职责：

- 读取 YAML prompt-debug 配置
- 渲染 Handlebars prompt 模板
- 支持只渲染不调用模型
- 导出最终组装的 messages

示例：

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --render-only
```

### `apps/qq-bot`

QQ bot 集成。

主要职责：

- 接收 QQ 私聊和群聊消息
- 解析或创建服务端 conversation
- 调用 server chat API，并根据服务端输出记录或跳过回复

它依赖 HTTP server 已可用且配置正确。

## 运行时配置

配置加载逻辑位于 `apps/server/src/util/config.ts`。

加载顺序：

1. `apps/server/config/config.default.json`
2. 如果设置了 `APP_ENV` 且对应文件存在，则读取 `apps/server/config/config.{APP_ENV}.json`
3. 如果存在，则读取 `apps/server/config/config.local.json`

合并后的配置会由 `apps/server/schemas/config.schema.json` 校验。

源码模式下，配置始终从 `apps/server/config` 读取；部署模式下，始终从 `server/config` 读取。`logger.logFilePath`、`runtimeFiles.tempDir`、`runtimeFiles.userDataDir`、`promptLog.filePath` 这类相对运行时路径默认都相对于当前工作目录解析；如果需要覆盖，可以设置 `RUNTIME_HOME`。

`apps/server/config/config.local.json` 用于本机覆盖，不提交到仓库；需要本地覆盖时，可以从 `apps/server/config/config.local.json.example` 复制一份。

在当前 Lightsail 部署流程中，`config.local.json` 不需要预先包含在发布包里。它可以在 release activation 阶段于服务器上生成，并作为优先级最高的运行时覆盖。

当前提交到仓库中的环境覆盖文件是 `apps/server/config/config.staging.json` 和 `apps/server/config/config.prod.json`。

`apps/qq-bot` 默认从 `apps/qq-bot/.env` 读取 bot 环境变量。通过仓库根目录执行 `pnpm run dev:qq-bot` 时，它的运行时输出也会落到仓库根目录的 `.runtime/`。

重要配置段：

- `http`：host 和 port
- `logger`：文件路径、日志等级、源码和堆栈选项
- `runtimeFiles`：临时目录和用户数据目录
- `agent`：模型客户端超时和重试配置
- `promptLog`：prompt 日志开关和路径
- `models`：provider 配置、API URL、可选默认 API key、默认模型，以及可选静态 `availableModels`
- `defaultModelAssignments`：按 `ModelCallPurpose` 提供的 provider/model 回退映射
- `auth`：认证模式、默认用户 id、注册开关、session 生命周期和 cookie 配置

默认配置当前定义了 provider key `mistral.ai`，并包含 Mistral API URL 和静态模型列表。

## 数据与 Actor 模型

Conversation 不是简单的 user/assistant transcript，而是显式 actor 驱动的：

- `self`：当前对话中负责回复的 AI 角色
- `other`：登录用户或本地参与者
- `system`：保留的系统 actor

消息只保存 `senderActorId`、`conversationId`、内容和时间戳。渲染 prompt 时，actor 会映射为 LLM role：

- `self` -> `assistant`
- `system` -> `system`
- 其他 -> `user`

仓库中有一个共享的 speaker-tag helper，位于 `packages/persona-flow/src/prompt/speakerTag.ts`，主要为后续更复杂的 interaction mode 预留。当前 `single_character_chat` prompt 路径不会把 speaker tag 直接前置到发给模型的消息内容中。为了避免回复里重复出现名字，assistant 风格的名字前缀仍会在输出归一化时被清理。

## 模型分配

模型分配是按调用目的进行的，共享定义位于 `packages/contracts/src/modelCallPurpose.ts`。

当前 purpose：

- `chat.main`
- `memory.summarize`

当前聊天路径调用模型时使用 `modelCallPurpose: "chat.main"`。

解析顺序是“用户优先，配置回退”：

1. 用户模型分配
2. `defaultModelAssignments[modelCallPurpose]`
3. 报错

API key 解析顺序也是“用户优先”：

1. 用户 provider credential
2. `models[provider].apiKey`
3. 报错

一次调用要成功，当前用户必须满足：

1. 在用户偏好中为该 purpose 配置了模型分配，或者配置文件中有对应的 `defaultModelAssignments`
2. 为该 provider 配置了用户 credential，或者 runtime config 中提供了默认 API key
3. runtime config 中存在该 provider 的配置

## Key Files

如果你要 review 或修改行为，优先从这里开始：

- `packages/contracts/src/modelCallPurpose.ts`
- `packages/contracts/src/interactionMode.ts`
- `packages/contracts/src/apis/*.api.ts`
- `packages/persona-flow/src/chatTurn/chatTurnService.ts`
- `packages/persona-flow/src/chatTurn/chatTurnPreparation.ts`
- `packages/persona-flow/src/modelCall/modelRuntime.ts`
- `packages/persona-flow/src/modelCall/modelCallRegistry.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatCall.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/promptViewModel.ts`
- `packages/persona-flow/src/modelCall/chat.main/singleCharacterChat/singleCharacterChatOutput.ts`
- `packages/persona-flow/src/stores/appStores.ts`
- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/db/CharacterDbRouter.ts`
- `packages/persona-flow-sqlite/src/createSqliteStores.ts`
- `packages/persona-flow-model-client/src/defaultModelClient.ts`
- `packages/persona-flow-model-client/src/mistral/mistralModelClient.ts`
- `apps/server/src/http/apis/chat/*.ts`
- `apps/server/src/http/apis/userPreference.route.ts`
- `apps/web/src/panels/chat/useChatViewModel.ts`
- `apps/web/src/panels/userPreference/useUserPreferenceViewModel.ts`

## 当前维护说明

- `AI_FUNCTIONS` / `AiFunction` 到 `MODEL_CALL_PURPOSES` / `ModelCallPurpose` 的重命名已经在 contracts、web、server、store 各层完成
- SQLite 中模型分配字段现在是 `model_assignments_json`，旧的模型分配存储兼容已移除
- SQLite credential store 中已经预留 API key 加密 hook，但当前仍是原样返回
- 低优先级 TODO：等部署方式和密钥管理预期更明确后，再把当前空实现的 API key 静态加密补齐
- tool call 当前只会被识别和记录为 TODO，还不会执行
- `single_character_chat` 的 streaming 还没补完，目前 SSE 路由仍会退化成单个完整回复 chunk
- `single_character_chat` 之外的 interaction mode 已声明，但还没有接入运行时 model-call dispatch
- speaker-tag helper 和更丰富的多 actor prompt shaping 预留给后续 interaction mode，当前 `single_character_chat` 仍保持较简单路径
- TODO：web 组件中的 i18n 目前仍依赖共享模块级 helper；如果未来需要 SSR、每应用独立实例或更严格的测试隔离，再迁移到 `useI18n` 风格的 hook 或 provider

## 快速冒烟路径

常用检查：

```bash
pnpm run build
pnpm run test
pnpm run dev:server
pnpm run dev:web
```

HTTP 健康检查：

```bash
curl http://127.0.0.1:8999/health
```

调试模型行为前，可以先看 dry-run 的 prompt 组装结果：

```bash
curl -X POST http://127.0.0.1:8999/v1/chat/dry-run \
	-H "Content-Type: application/json" \
	-d '{"characterId":"<character-id>","conversationId":"<conversation-id>","userMessageText":"hello","llmResponseMode":"structured"}'
```


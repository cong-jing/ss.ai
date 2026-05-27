# ss.ai 项目说明

`ss.ai` 是一个 TypeScript monorepo，目标是做角色扮演 / persona chat。项目核心是 `packages/persona-flow`：它负责从存储中组装上下文、渲染 prompt、根据模型调用目的选择模型、通过注入的模型客户端调用大模型，并把一轮对话结果写回存储。

这份文档用于后续新会话快速接手项目。英文版项目地图见 `README.md`。

## 工作区结构

仓库使用 pnpm workspace，定义在根目录 `pnpm-workspace.yaml`：

- `packages/*`
- `apps/*`

常用命令：

```bash
npm run setup
pnpm install
pnpm run dev:server
pnpm run dev:web
pnpm run dev:all
pnpm run build
pnpm run deploy:staging
pnpm run deploy:prod
pnpm run deploy:server:staging
pnpm run deploy:server:prod
pnpm run deploy:web:staging
pnpm run deploy:web:prod
pnpm run start:server:staging
pnpm run start:server:prod
pnpm run test
pnpm run prompt:debug -- --help
```

当前默认 HTTP 端口来自 `config/config.default.json`，是 `8999`。

## 安装与部署

首次初始化（安装并激活项目固定版本的 pnpm）：

```bash
npm run setup
```

初始化完成后，仅使用 pnpm 命令：

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

部署产物的顶层目录为 `.deploy-staging` 和 `.deploy-prod`。

每个顶层目录下固定有两个子目录：

- `server`：Node.js 服务包和运行时配置
- `web`：由 `apps/web/dist` 生成的静态资源

部署步骤会把运行时配置资源复制到部署根目录本身：

- `.deploy-staging/server/config/config.default.json`
- `.deploy-staging/server/config/config.staging.json`
- `.deploy-staging/server/config/config.local.json.example`
- `.deploy-staging/server/schemas/config.schema.json`
- `.deploy-prod/server/config/config.default.json`
- `.deploy-prod/server/config/config.prod.json`
- `.deploy-prod/server/config/config.local.json.example`
- `.deploy-prod/server/schemas/config.schema.json`

web 部署输出目录：

- `.deploy-staging/web/*`
- `.deploy-prod/web/*`

运行部署后的服务：

```bash
pnpm run start:server:staging
pnpm run start:server:prod
```

手工启动也可以：

```bash
cd .deploy-staging/server
pnpm start

cd .deploy-prod/server
pnpm start
```

`APP_HOME` 默认取当前工作目录。在部署布局里，这就意味着 `.deploy-staging/server` 或 `.deploy-prod/server` 本身，因此在这些目录下启动时不需要额外设置 `APP_HOME`。如果你不是在运行根目录下启动服务，请显式设置 `APP_HOME`，这样配置文件查找和配置内的相对运行路径都会以期望的运行根目录为基准。

示例：

```bash
APP_HOME=/absolute/path/to/runtime-root APP_ENV=staging node /absolute/path/to/runtime-root/dist/index.js
APP_HOME=../.. pnpm --filter @ss-ai/server start
```

如果你修改了任意 workspace 包的依赖声明（`dependencies`、`devDependencies`、`peerDependencies` 或 workspace 依赖关系），需要重新执行 `pnpm install`，以同步 `pnpm-lock.yaml` 与部署依赖图。

## 核心包

### `packages/persona-flow`

核心领域包，尽量保持不依赖具体框架和具体数据库。

主要职责：

- 定义角色、对话、消息、用户设置等 store interface。
- 定义 `AppStores`，作为应用层注入的存储边界。
- 用 `PromptContextBuilder` 从 stores 构建 prompt 上下文。
- 用 `promptRenderer` 渲染最终发给模型的 messages。
- 用 `PersonaFlowChatTurnService` 编排一轮聊天。
- 用 `ModelCallExecutor` 解析模型运行时配置并调用注入的 `ModelClient`。
- 定义 `ModelClient` 接口，具体供应商由其他包实现。

聊天主流程：

1. `PersonaFlowChatTurnService.chatTurn()` 接收用户、角色、对话和消息输入。
2. `prepareChatTurnContext()` 校验角色和对话，解析 sender actor，按需写入用户消息，构建 `PromptContext`，渲染 LLM messages。
3. `ModelCallExecutor.chat()` 根据 `modelCallPurpose` 读取用户模型配置，再读取 provider credential，最后调用 `ModelClient`。
4. structured 输出如果是 `skip` 或空回复，就不写入 assistant 消息。
5. 正常回复会作为当前 conversation 的 `self` actor 消息写入 chat store。

流式流程类似，但目前只支持 `llmResponseMode = "non-structured"`。

### `packages/contracts`

前后端共享契约包。

主要职责：

- HTTP API 定义和请求/响应类型。
- `INTERACTION_MODES` / `DEFAULT_INTERACTION_MODE` / `InteractionMode`。
- `MODEL_CALL_PURPOSES` / `ModelCallPurpose`。
- `ModelAssignment` / `ModelAssignmentMap`，用于模型配置和用户偏好层。

模型调用配置现在使用 `MODEL_CALL_PURPOSES` / `ModelCallPurpose`，配置值使用 `ModelAssignment` / `ModelAssignmentMap`。

### `packages/persona-flow-sqlite`

`AppStores` 的 SQLite 实现。

主要职责：

- 使用 `better-sqlite3` 和 Drizzle。
- 在 `src/db/schema.ts` 定义数据库表。
- 实现 character、conversation、actor、message、user profile、user preferences、provider credentials 等 stores。
- 通过 `createSqliteStores()` 创建完整 `AppStores`。

重要表：

- `characters`
- `conversations`
- `conversation_actors`
- `messages`
- `user_profiles`
- `user_preferences`
- `user_character_states`
- `user_provider_credentials`

用户模型分配存放在 `user_preferences.model_assignments_json` 字段中，代码层语义使用 `modelAssignments` / `ModelAssignmentMap`。

### `packages/persona-flow-model-client`

模型供应商适配包。

主要职责：

- 实现 `persona-flow` 中定义的 `ModelClient`。
- `DefaultModelClient` 根据 provider 分发。
- 当前实际 provider 是 Mistral。
- 支持普通生成、流式生成、structured 输出和模型列表获取。

provider 列表和 API URL 来自 runtime config；API key 来自用户 provider credential store。SQLite 目前会经过空实现的 encrypt/decrypt helper，因此落库值仍是明文，后续可替换为真实加密。

### `packages/persona-flow-logger`

文件 logger。

支持 `verbose`、`debug`、`info`、`warn`、`error` 等级，以及可选源码位置和堆栈。

## 应用

### `apps/server`

Express HTTP 服务。

主要职责：

- 读取 `config/config.default.json`、可选的 `config/config.{APP_ENV}.json` 和可选的 `config/config.local.json`。
- 打开 SQLite 数据库：`runtimeFiles.userDataDir/app.db`。
- 创建 SQLite stores。
- 注册 chat、user preference、user profile、character、conversation、actor 等 API。
- 每次聊天请求创建 `PersonaFlowChatTurnService`，注入 stores、logger、prompt logger 和 `DefaultModelClient`。

目前服务端基本按单用户模型工作，默认用户是 `DEFAULT_USER_ID = "default"`。

关键接口：

- `/health`
- `/v1/chat`
- `/v1/chat/stream`
- `/v1/chat/dry-run`
- `/v1/user-preference`
- `/v1/characters`
- `/v1/conversations`

### `apps/web`

Vue 3 + Vite 前端。

主要职责：

- 左侧 workspace sidebar，中间聊天区，右侧 context inspector 和 settings。
- 复用 `@ss-ai/contracts` 的 API 类型和常量。
- 配置 provider API key 和模型分配。
- 发送普通聊天、流式聊天、dry-run、消息删除等请求。

重要状态：

- `contextVersion` 用于角色或对话切换后刷新聊天历史。
- active character / conversation / actor 分别在各 panel view-model 中维护。
- 当前聊天支持 structured 非流式与 non-structured 流式两种路径。

### `apps/prompt-debug-cli`

Prompt 调试 CLI。

主要职责：

- 读取 YAML 配置。
- 渲染 Handlebars prompt 模板。
- 可只渲染不调用模型。
- 可导出最终组装的 messages。

示例：

```bash
pnpm run prompt:debug -- --config apps/prompt-debug-cli/examples/shishi-basic.yaml --render-only
```

### `apps/qq-bot`

QQ bot 集成。

主要职责：

- 接收私聊 / 群聊消息。
- 为 QQ 会话解析或创建 server conversation。
- 调 server chat API，按 structured decision 处理跳过回复。

## 运行时配置

配置加载逻辑位于 `apps/server/src/util/config.ts`。

加载顺序：

1. `config/config.default.json`
2. 如果设置了 `APP_ENV` 且文件存在，则读取 `config/config.{APP_ENV}.json`
3. 如果存在，则读取 `config/config.local.json`

合并后的配置会使用 `schemas/config.schema.json` 做校验。

`APP_HOME` 同时决定两件事：

- 去哪里查找这些配置文件
- `logger.logFilePath`、`runtimeFiles.tempDir`、`runtimeFiles.userDataDir`、`promptLog.filePath` 这类相对路径以谁为基准展开

这些配置文件统一从 `APP_HOME/config/*` 下读取。如果省略 `APP_HOME`，服务端会使用 `process.cwd()`。

`config/config.local.json` 用于本机覆盖，不提交到仓库；需要本地覆盖时，从 `config/config.local.json.example` 复制一份即可。

当前已提交到仓库的环境覆盖文件是 `config/config.staging.json` 和 `config/config.prod.json`。

## 数据和 Actor 模型

Conversation 不是简单的 user/assistant transcript，而是由 actor 驱动：

- `self`：当前 AI 角色。
- `other`：登录用户或本地参与者。
- `system`：系统参与者。

消息只保存 `senderActorId`、`conversationId`、内容和时间。Prompt 渲染时再把 actor role 映射到 LLM role：

- `self` -> `assistant`
- `system` -> `system`
- 其他 -> `user`

渲染时会生成 `p1[Name]` 这类 speaker tag，并写入消息内容。为了避免模型输出重复名字，assistant 历史和模型输出都会做前缀清理。

## 模型分配

模型分配按调用目的进行。共享定义在 `packages/contracts/src/modelCallPurpose.ts`。

当前目的：

- `chat.main`
- `memory.summarize`

一次模型调用需要满足：

1. 当前用户为该 `ModelCallPurpose` 配置了 `ModelAssignment`。
2. 该 assignment 的 provider 有 credential。
3. runtime config 中存在该 provider。

## 后续维护重点

- `AI_FUNCTIONS` / `AiFunction` 到 `MODEL_CALL_PURPOSES` / `ModelCallPurpose` 的迁移已在 contracts、web、server、store 层完成。
- 配置层类型已统一使用 `ModelAssignment` / `ModelAssignmentMap`。
- SQLite 模型分配列已改为 `model_assignments_json`，旧模型分配存储兼容已移除。
- API key 加密/解密 hook 已放在 SQLite credential store，目前为空实现。
- 实现或移除尚未接入的 tool call TODO。
- 补齐非 `single_character_chat` prompt mode 的 renderer。

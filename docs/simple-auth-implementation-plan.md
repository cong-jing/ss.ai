# 简单用户管理改修文档

## 目标

为 `apps/server` 和 `apps/web` 增加一套极简的本地用户管理，用于少量朋友测试，满足以下要求：

- 支持两种启动模式：
  - `default-user`：沿用当前行为，所有请求都使用固定 `userId = "default"`。
  - `local-password`：必须登录后才能访问业务接口。
- 不追求复杂权限系统，只要求不同用户之间的数据隔离。
- 设计上保持独立，后续可以替换成其他开源用户系统或外部认证服务。
- 前端补充登录页和注册页。

## 非目标

- 不做邮箱验证。
- 不做找回密码。
- 不做角色权限、管理员后台、邀请制。
- 不做第三方登录。
- 不做跨服务单点登录。

## 现状结论

当前项目的领域层和存储层大多已经按 `userId` 隔离：

- `packages/persona-flow` 的 store 接口普遍要求 `userId`
- `packages/persona-flow-sqlite` 的表结构中已有 `user_id`
- `CharacterDbRouter` 也已经按 `userId/characterId` 分目录

主要问题在于 HTTP 层把用户固定成了 `DEFAULT_USER_ID = "default"`，前端也没有身份状态。

因此这次改修应把重点放在：

1. 为 HTTP 请求解析“当前用户”
2. 在登录模式下阻止未登录访问
3. 让前端具备登录态和登录入口

## 总体设计

建议新增一个独立的认证边界，放在 `apps/server/src/auth` 下，不把认证逻辑散落到 persona-flow 或各业务 store 中。

### 建议目录

```text
apps/server/src/auth/
  authTypes.ts
  authConfig.ts
  localAuthStore.ts
  passwordHasher.ts
  sessionToken.ts
  authRuntime.ts
  authMiddleware.ts
  auth.route.ts
```

核心思路：

- `default-user` 模式：认证运行时永远返回固定用户 `default`
- `local-password` 模式：认证运行时从 HttpOnly cookie 中解析 session
- 业务路由只依赖“拿到当前 userId”的能力，不直接知道登录实现细节

建议抽象一个最小接口：

```ts
export interface AuthenticatedUser {
    userId: string;
    username?: string;
}

export interface AuthRuntime {
    getOptionalUser(req: Request): Promise<AuthenticatedUser | null>;
    requireUser(req: Request): Promise<AuthenticatedUser>;
}
```

后续若替换成别的用户系统，只需要替换 `AuthRuntime` 的实现和 auth 路由即可。

## 配置改动

在服务端配置中新增：

```json
{
  "auth": {
    "mode": "default-user",
    "defaultUserId": "default",
    "allowRegistration": true,
    "sessionDays": 30,
    "cookieName": "ss_ai_session"
  }
}
```

### 字段说明

- `mode`
  - `default-user`
  - `local-password`
- `defaultUserId`
  - 仅 `default-user` 模式使用
- `allowRegistration`
  - 是否允许自助注册
- `sessionDays`
  - session 过期天数
- `cookieName`
  - session cookie 名称

### 默认建议

- 开发默认：`mode = "default-user"`
- 给朋友测试时：`mode = "local-password"`

## 数据库改动

建议新增两张表，保持与业务表分离。

### `app_users`

```sql
CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### `app_sessions`

```sql
CREATE TABLE IF NOT EXISTS app_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

建议补充索引：

```sql
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
    ON app_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at
    ON app_sessions(expires_at);
```

### 说明

- `app_users.id` 作为系统内部真实 `userId`
- `username` 用于登录，要求唯一
- 不存明文密码
- 不在 cookie 中直接存 `userId`
- session 独立建表，后续替换认证方案时比较容易迁移

## Token 管理方案

这里的 token 指登录 session token，不是 JWT。

### 为什么不建议这次用 JWT

这次需求很简单，而且希望未来容易替换。对当前项目来说，数据库 session 比 JWT 更合适：

- 更容易强制登出
- 更容易做服务端失效控制
- 不需要处理 JWT 吊销问题
- 不需要在前端保存 access token
- 和当前同源前后端结构更匹配

### 推荐做法

登录成功后：

1. 服务端生成一个高随机性的原始 token，例如 32 字节随机值
2. 把原始 token 返回前先写入 HttpOnly cookie
3. 数据库中只保存 `token_hash`，不保存原始 token
4. 每次请求从 cookie 取 token，hash 后查 `app_sessions`

### 生成方式

建议使用 Node 内置 `crypto`：

```ts
const rawToken = crypto.randomBytes(32).toString("base64url");
const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
```

### Cookie 属性建议

- `HttpOnly: true`
- `SameSite: "lax"`
- `Path: "/"`
- `Max-Age`: 与 `sessionDays` 对齐
- `Secure`: 生产环境建议开启；本地开发可按环境决定

### 生命周期

- 注册成功后可直接创建 session 并登录
- 登录成功后创建新 session
- 登出时删除当前 session 记录并清 cookie
- 请求时若发现 session 过期，则删除该 session 并返回 `401`

### 存储位置

- 浏览器：仅 cookie 中保存原始 token
- 服务端 DB：仅保存 `token_hash`

这样即使数据库泄露，也不会直接拿到可用 session token。

### 是否要做 session 轮换

这次第一版可以不做每次请求轮换。

足够的方案是：

- 登录时创建 session
- 登出时删除 session
- 到期后失效

如果后面需要再增强，可以在登录、修改密码、敏感操作后轮换 token。

### 是否支持多端登录

第一版建议支持。每次登录创建一条新 session，不强制踢掉旧 session。

原因：

- 实现简单
- 对测试用户更友好
- 与“少量朋友测试”的场景足够匹配

如果想限制单设备登录，再加“登录时删除该用户旧 session”即可。

## 密码管理方案

建议用 Node 内置 `crypto.scrypt`，不引入额外依赖。

### 存储格式建议

密码哈希字段可保存如下格式：

```text
scrypt$<salt>$<hash>
```

例如：

```text
scrypt$base64url-salt$base64url-hash
```

### 原因

- 不增加三方依赖
- 对当前“小而简单”的需求足够
- 未来替换认证系统时可整体迁移，不会深度绑死

## HTTP API 设计

建议新增以下接口：

### `GET /v1/auth/me`

返回当前登录状态和当前用户信息。

示例返回：

```json
{
  "authMode": "local-password",
  "authenticated": true,
  "user": {
    "id": "user_xxx",
    "username": "alice",
    "displayName": "Alice"
  }
}
```

若未登录：

```json
{
  "authMode": "local-password",
  "authenticated": false,
  "user": null
}
```

### `POST /v1/auth/register`

请求：

```json
{
  "username": "alice",
  "password": "example-password",
  "displayName": "Alice"
}
```

行为：

- 创建 `app_users`
- 初始化该用户的最小业务数据可延迟到首次业务操作，不必强行预建
- 创建 session
- 写 cookie

### `POST /v1/auth/login`

请求：

```json
{
  "username": "alice",
  "password": "example-password"
}
```

行为：

- 校验用户名和密码
- 创建 session
- 写 cookie

### `POST /v1/auth/logout`

行为：

- 删除当前 session
- 清空 cookie

## 中间件策略

### 不需要登录的接口

- `/health`
- `/v1/auth/me`
- `/v1/auth/login`
- `/v1/auth/register`

### `default-user` 模式

- 所有业务接口都自动映射到 `defaultUserId`
- `/v1/auth/me` 返回已认证，用户为默认用户
- 前端无需出现登录页

### `local-password` 模式

- 除 auth 公共接口外，所有 `/v1/*` 业务接口都要求已登录
- 未登录返回 `401`

## 服务端代码改造点

### 1. 配置层

需要修改：

- `apps/server/src/util/config.ts`
- `schemas/config.schema.json`
- `config/config.default.json`

目标：

- 增加 `auth` 配置结构

### 2. Server 启动和上下文

需要修改：

- `apps/server/src/http/server.ts`
- `apps/server/src/http/apis/apiContext.ts`

目标：

- 在 `HttpApiContext` 中注入 `authRuntime`
- 注册 auth 路由
- 在业务路由中能统一读取当前用户

### 3. 数据库初始化

需要修改：

- `packages/persona-flow-sqlite/src/db/schema.ts`
- `packages/persona-flow-sqlite/src/db/openDatabase.ts`

目标：

- 新增 `app_users`
- 新增 `app_sessions`

备注：

这两张表可以只在 server 使用，不一定要并入 `AppStores`，因为它们属于认证基础设施，不属于 persona-flow 领域模型。

### 4. 业务路由

需要修改：

- `apps/server/src/http/apis/character.route.ts`
- `apps/server/src/http/apis/conversation.route.ts`
- `apps/server/src/http/apis/conversationActor.route.ts`
- `apps/server/src/http/apis/userProfile.route.ts`
- `apps/server/src/http/apis/userPreference.route.ts`
- `apps/server/src/http/apis/chat/nonStreamService.ts`
- `apps/server/src/http/apis/chat/streamService.ts`
- `apps/server/src/http/apis/chat/dryRunService.ts`
- `apps/server/src/http/apis/chat/messageService.ts`

目标：

- 不再直接使用 `DEFAULT_USER_ID`
- 改为从 request 或 auth runtime 解析真实 userId

### 5. 一个必须修的小坑

前端现在把默认 logged user actor 写死成了：

```ts
actor.sourceType === "logged_user" && actor.userProfileId === "default"
```

需要改成：

- 基于当前登录用户 id 判断

否则切换到多用户后，默认发言人选择会错。

## 前端改造方案

建议新增简单 auth 状态模块：

```text
apps/web/src/auth/
  authApi.ts
  useAuthState.ts
  AuthPage.vue
  LoginForm.vue
  RegisterForm.vue
```

### 页面切换逻辑

`App.vue` 启动时先请求 `/v1/auth/me`：

- 若 `authMode = "default-user"`：直接进入现有 `HomePage`
- 若 `authMode = "local-password"` 且未登录：显示 `AuthPage`
- 若已登录：显示 `HomePage`

### 前端状态建议

最小状态即可：

```ts
type AuthState = {
    loading: boolean;
    authenticated: boolean;
    authMode: "default-user" | "local-password";
    user: { id: string; username: string; displayName: string | null } | null;
};
```

### `fetch` 调整

建议统一在 `apps/web/src/shared/api/httpClient.ts` 中加：

```ts
credentials: "same-origin"
```

同时把前端所有手写 `fetch` 的地方也补上同样设置。

原因：

- 登录态依赖 cookie
- 不统一加上会导致部分接口拿不到 session

### 登录页范围

第一版足够的内容：

- 用户名
- 密码
- 登录按钮
- 注册入口
- 注册页含用户名、密码、显示名

不需要：

- 忘记密码
- 图形验证码
- 复杂安全文案

## 建议的实施顺序

1. 先补配置和数据库表
2. 实现 `AuthRuntime` 与 session cookie
3. 补 `/v1/auth/*` 接口
4. 改造 server 业务路由，统一通过当前用户取 `userId`
5. 改造前端 auth 状态与登录页
6. 修复 actor 默认用户判断
7. 补测试

## 测试建议

### 服务端单测

建议新增覆盖：

- `default-user` 模式下无需登录即可访问角色和聊天接口
- `local-password` 模式下未登录访问业务接口返回 `401`
- 注册后可访问自己的角色列表
- 用户 A 创建的数据，用户 B 不可见
- 登出后访问业务接口返回 `401`
- 过期 session 返回 `401`

### 前端验收

至少手动验证：

1. `default-user` 模式下页面行为与现在一致
2. `local-password` 模式下打开页面先看到登录页
3. 注册后自动进入主界面
4. 登出后回到登录页
5. 两个不同账号登录后看到的数据彼此隔离

## 验收标准

做到以下几点就算这一版完成：

- 支持 `default-user` 和 `local-password` 两种模式
- `local-password` 模式下能注册、登录、登出
- 所有业务接口都按当前登录用户进行数据隔离
- 前端在登录模式下有完整登录/注册入口
- 认证逻辑集中在独立模块，业务层不直接依赖具体登录实现

## 可以后续再做的增强

- 修改密码
- session 管理页
- 登录设备列表
- 邀请码注册
- 接入第三方 auth 服务
- 把 `app_users/app_sessions` 抽成独立 store 接口

## 实现时的注意点

- 登录模式下不要再信任请求体里的 `userId`
- cookie 中保存原始 token，数据库中只保存 hash
- 过期 session 可在读取时顺手清理，不必一开始就做定时清理任务
- `default-user` 模式要保证对现有开发流程几乎无感
- 认证逻辑不要下沉到 `packages/persona-flow`，避免把领域层绑死到当前实现

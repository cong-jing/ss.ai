# @ss-ai/persona-flow 提示词配置说明

本包会从 `data/prompts/<language>.yaml` 加载本地化提示词配置。

## `zh-CN.yaml` 结构

- `sectionLabels`: 系统提示中各分段标题文本。
- `fieldLabels`: 预留的字段标签（当前版本未实际渲染到 prompt）。
- `actorTemplates`: 会话成员与 self 角色说明的模板。
- `baseRules`: 基础行为规则。
- `sectionDivider`: 分段拼接分隔符。

## `actorTemplates` 占位符

模板变量格式为 `{{变量名}}`。

- `actorLine`
  - `{{alias}}`: 成员别名，例如 `p1[SS]`
  - `{{role}}`: 成员角色类型（`self` / `system` / `other`）
  - `{{sourceType}}`: 成员来源（`ai_character` / `system` / `logged_user` / `local_actor`）
- `actorInfoLine`
  - `{{info}}`: 成员信息文本
- `selfIdentityLine`
  - `{{name}}`: self 角色名（优先 `displayName`，其次 `name`）
- `selfDescriptionLine`
  - `{{description}}`: 角色描述
- `selfPersonaLine`
  - `{{personaPrompt}}`: 角色人设

## 生效范围

- `actorLine`、`actorInfoLine`：对“当前对话成员”列表中的所有成员生效。
- `selfIdentityLine`、`selfDescriptionLine`、`selfPersonaLine`：仅对 `role === "self"` 生效，并渲染到独立的“角色扮演说明”分段。

## 当前使用状态（基于 `src/prompt` 代码）

### `sectionLabels`

已使用：
- `characterName`
- `characterDescription`
- `characterPersona`
- `selfRoleIntro`
- `conversationActors`
- `relationshipState`
- `memories`
- `rules`

当前未使用：
- `userProfile`

### `fieldLabels`

当前未使用：
- `userName`
- `preferredAddress`
- `userBio`

说明：未使用字段会先保留，便于后续 prompt 布局扩展或兼容旧配置。

## 示例

```yaml
sectionLabels:
  selfRoleIntro: "【角色扮演说明】"

actorTemplates:
  actorLine: "{{alias}}（{{role}} / {{sourceType}}）"
  actorInfoLine: "  人物信息：{{info}}"
  selfIdentityLine: "  你所扮演的角色是{{name}}。"
  selfDescriptionLine: "  角色描述：{{description}}"
  selfPersonaLine: "  角色人设：{{personaPrompt}}"
```

## 兼容性注意

如果你重命名或删除 `sectionLabels` / `fieldLabels` / `actorTemplates` 的键，请同步更新 `src/prompt/` 中的构建逻辑。

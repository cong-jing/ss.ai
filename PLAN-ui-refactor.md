# UI 重构计划

## 目标布局

```
┌──────────────┬──────────────────────┬──────────────┐
│  左侧栏       │       聊天区          │  右侧栏       │
│  Conversation │                      │  Character    │
│  列表         │                      │  当前角色卡    │
│              │                      │              │
│  + New Chat   │                      │  [⚙] 按钮    │
└──────────────┴──────────────────────┴──────────────┘
```

- 左侧：对话列表（含新建/切换/删除/重命名标题）
- 右侧：当前角色摘要 + 切换/编辑入口（通过 Popup）
- 设定（API Key 等）：右侧底部的齿轮图标，打开模态 Popup

---

## Phase 1 — 用户设定转移到 Popup

### 目的
把当前左侧栏的 `UserPreferencePanel`（API Key + 功能模型分配）从固定侧边栏移到模态 Popup，释放侧边栏空间给对话列表。

### 变更内容

#### `apps/web/src/shared/ui/`
- 无需变更（`PopupWindow` 已就绪）

#### `apps/web/src/panels/userPreference/`
- `UserPreferencePanel.vue` 保持不变（内容组件，不含布局定位逻辑）
- 新建 `UserPreferencePopup.vue`：包裹 `<PopupWindow modal>` + `<UserPreferencePanel>`，接受 `v-model` 控制显示

#### `apps/web/src/pages/HomePage.vue`
- 移除左侧 `<aside class="settings-area">` 和 `<UserPreferencePanel />`
- 左侧 `<aside>` 改为 ConversationList（Phase 3 实现，此阶段可留空占位）
- 右侧 `<aside>` 保留，改造为 Character + 设定入口

#### `apps/web/src/panels/settings/`（新目录）
- `SettingsButton.vue`：右下角或右侧栏底部的齿轮按钮，点击打开 `UserPreferencePopup`

---

## Phase 2 — 角色面板重构

### 目的
将角色列表/创建/编辑分离成专用 Popup，右侧栏仅显示当前角色摘要。

### 变更内容

#### `apps/web/src/panels/character/`（新目录）
- `CharacterCard.vue`：当前角色摘要卡（头像字母、名称、描述摘要），含 `[Change]` / `[Edit]` 按钮
- `CharacterPickerPopup.vue`：非模态 Popup，展示所有角色列表 + `[+ Create]` 按钮
  - 选中角色后自动关闭并调用 `selectCharacter`
- `CharacterEditPopup.vue`：模态 Popup，完整编辑表单（复用原 ScenarioPanel 内的编辑 UI）
  - 支持新建和编辑两种模式（通过 prop `mode: 'create' | 'edit'`）

#### `apps/web/src/panels/scenario/`
- `useScenarioViewModel.ts`：用户信息（User Info）部分保留在右侧栏
- `ScenarioPanel.vue`：移除角色相关 UI，改为引用 `CharacterCard`
- 角色相关 state/actions 拆出到独立的 `useCharacterViewModel.ts`（可复用于 Picker 和 Edit Popup）

#### `apps/web/src/pages/HomePage.vue`
- 右侧 `<aside>` 改为：
  - 上部：`CharacterCard`（含 Picker/Edit Popup 触发）
  - 下部：User Info（保留现有 CollapsibleSection）
  - 底部：`SettingsButton`（Phase 1 产物）

---

## Phase 3 — 对话列表

### 前提
Contracts 层已有：
- `ApiListConversations` GET
- `ApiCreateConversation` POST
- `ApiSelectConversation` POST
- `ApiDeleteConversation` DELETE
- ⚠️ **缺少标题更新接口** → 需要在 contracts + server 各新增一个 PATCH 端点

### 缺少的合约（需补充）

**`packages/contracts/src/apis/conversation.api.ts`**

```ts
export interface UpdateConversationRequest {
    title: string | null;
}
export interface UpdateConversationResponse {
    conversation: ConversationInfo;
}
// PATCH /v1/characters/:id/conversations/:convId
export const ApiUpdateConversation = new ApiDefine<UpdateConversationRequest, UpdateConversationResponse>(
    "/v1/characters/:id/conversations/:convId",
    "PATCH",
);
```

**`apps/server/src/http/apis/`** — 需补充对应路由实现。

### 变更内容

#### `apps/web/src/panels/conversation/`（新目录）
- `conversationApi.ts`：封装上述 5 个 API 调用
- `useConversationViewModel.ts`：管理对话列表 state（list、activeId、loading）
- `ConversationList.vue`：左侧栏主组件
  - 顶部：`[+ New conversation]` 按钮
  - 列表：每条 `ConversationItem.vue`（标题/占位符 + 日期 + hover 删除按钮）
  - 标题：双击进入内联编辑，blur 后自动保存（调用 PATCH）

#### `apps/web/src/pages/HomePage.vue`
- 左侧 `<aside>` 替换为 `<ConversationList>`

#### `apps/web/src/panels/chat/useChatViewModel.ts`
- 切换对话时重新加载消息（需联动 `useConversationViewModel`）

---

## 实施顺序

1. **Phase 1**：UserPreferencePopup + 侧边栏占位（最小改动，独立可测试）
2. **Phase 2**：CharacterCard + Picker/Edit Popup（复用现有 ViewModel 逻辑）
3. **补合约**：PATCH conversation title（contracts + server，独立 PR）
4. **Phase 3**：ConversationList + 联动 ChatPanel

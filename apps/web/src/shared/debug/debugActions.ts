import { reactive } from 'vue'

export interface DebugAction {
    label: string
    run: () => void
}

/**
 * 全局 debug 动作注册表。
 * 任何模块都可以调用 registerDebugAction() 向 Debug 菜单追加按钮。
 *
 * 示例：
 *   import { registerDebugAction } from '@/shared/debug/debugActions'
 *   registerDebugAction({ label: 'Open user settings', run: () => showUserSettings.value = true })
 */
export const debugActions = reactive<DebugAction[]>([])

export function registerDebugAction(action: DebugAction): void {
    debugActions.push(action)
}

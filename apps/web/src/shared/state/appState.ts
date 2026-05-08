import { ref } from 'vue'

/**
 * 全局上下文版本号。
 * 每当角色切换或对话切换时递增。
 * ChatPanel 通过 watch 监听此值，变化时清空消息列表。
 */
export const contextVersion = ref(0)

export function bumpContextVersion(): void {
    contextVersion.value++
}

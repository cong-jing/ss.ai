import { reactive } from 'vue'

export type ToastType = 'error' | 'success' | 'info'

export interface ToastItem {
    id: number
    message: string
    type: ToastType
}

let nextId = 0

/** Module-level singleton – shared across all composable calls. */
export const toasts = reactive<ToastItem[]>([])

export function useToast() {
    function dismiss(id: number): void {
        const idx = toasts.findIndex(t => t.id === id)
        if (idx !== -1) toasts.splice(idx, 1)
    }

    function show(message: string, type: ToastType, duration = 4000): void {
        const id = ++nextId
        toasts.push({ id, message, type })
        setTimeout(() => dismiss(id), duration)
    }

    return {
        error: (msg: string) => show(msg, 'error'),
        success: (msg: string) => show(msg, 'success', 3000),
        info: (msg: string) => show(msg, 'info', 3000),
        dismiss,
    }
}

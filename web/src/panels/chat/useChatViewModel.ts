import { ref } from "vue";
import { sendChatMessage } from "./chatApi";
import type { ChatMessage } from "./chatTypes";

function createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useChatViewModel() {
    const messages = ref<ChatMessage[]>([]);
    const isSending = ref(false);
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    async function sendMessage(text: string) {
        const prompt = text.trim();
        if (!prompt) {
            return;
        }

        messages.value.push({
            id: createId("user"),
            role: "user",
            content: prompt,
            createdAt: new Date().toISOString(),
            status: "normal"
        });

        isSending.value = true;
        error.value = null;

        try {
            const response = await sendChatMessage(prompt);
            messages.value.push({
                id: response.requestId,
                role: "assistant",
                content: response.output,
                createdAt: new Date().toISOString(),
                status: "normal"
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            error.value = message;
            messages.value.push({
                id: createId("assistant-error"),
                role: "assistant",
                content: message,
                createdAt: new Date().toISOString(),
                status: "failed"
            });
        } finally {
            isSending.value = false;
        }
    }

    function clearMessages() {
        messages.value = [];
    }

    return {
        messages,
        isSending,
        isLoading,
        error,
        sendMessage,
        clearMessages
    };
}

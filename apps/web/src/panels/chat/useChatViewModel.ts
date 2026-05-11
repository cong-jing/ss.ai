import { ref, watch } from "vue";
import { apiDryRunChat, apiSendChatMessage, apiStreamChatMessage, apiGetMessages } from "./chatApi";
import type { ChatMessage } from "./chatTypes";
import { contextVersion } from "../../shared/state/appState";
import { activeConversationId } from "../conversation/useConversationViewModel";
import { activeCharacterId } from "../character/useCharacterViewModel";
import { useToast } from "../../shared/ui/useToast";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";

function createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useChatViewModel() {
    const toast = useToast();
    const messages = ref<ChatMessage[]>([]);
    const isSending = ref(false);
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    async function sendMessage(text: string, stream = false) {
        const prompt = text.trim();
        if (!prompt) {
            return;
        }

        const characterId = activeCharacterId.value;
        const conversationId = activeConversationId.value;
        if (!characterId || !conversationId) {
            const message = "Please select a character and conversation before sending a message.";
            error.value = message;
            toast.error(message);
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

        if (stream) {
            const msgId = createId("assistant");
            messages.value.push({
                id: msgId,
                role: "assistant",
                content: "",
                createdAt: new Date().toISOString(),
                status: "streaming"
            });

            try {
                let capturedPromptMessages: import("./chatTypes").DebugMessage[] | undefined;
                const result = await apiStreamChatMessage(
                    characterId,
                    conversationId,
                    prompt,
                    (chunk) => {
                        const msg = messages.value.find(m => m.id === msgId);
                        if (msg) msg.content += chunk;
                    },
                    undefined,
                    showDebug.value,
                    (msgs) => { capturedPromptMessages = msgs; }
                );

                const msg = messages.value.find(m => m.id === msgId);
                if (msg) {
                    msg.status = "normal";
                    msg.id = result.requestId || msgId;
                    if (capturedPromptMessages) msg.promptMessages = capturedPromptMessages;
                }
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.error("[chat/stream] error:", e);
                error.value = message;
                const msg = messages.value.find(m => m.id === msgId);
                if (msg) {
                    msg.content = message;
                    msg.status = "failed";
                }
            } finally {
                isSending.value = false;
            }
            return;
        }

        try {
            const response = await apiSendChatMessage(characterId, conversationId, prompt, showDebug.value);
            messages.value.push({
                id: response.requestId,
                role: "assistant",
                content: response.output,
                createdAt: new Date().toISOString(),
                status: "normal",
                ...(response.promptMessages ? { promptMessages: response.promptMessages } : {}),
            });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("[chat] error:", e);
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

    const showDebug = useLocalStorage("chat.showDebug", false);

    async function dryRunPrompt(text: string) {
        const prompt = text.trim();
        if (!prompt) return;

        const characterId = activeCharacterId.value;
        const conversationId = activeConversationId.value;
        if (!characterId || !conversationId) {
            toast.error("Please select a character and conversation before dry-run.");
            return;
        }

        try {
            const result = await apiDryRunChat(characterId, conversationId, prompt);
            console.group("[dry-run] Assembled prompt messages");
            for (const msg of result.messages) {
                console.log(`--- [${msg.role}] ---`);
                console.log(msg.content);
            }
            console.groupEnd();
            messages.value.push({
                id: createId("debug"),
                role: "debug",
                content: "",
                createdAt: new Date().toISOString(),
                status: "normal",
                debugMessages: result.messages,
            });
            showDebug.value = true;
        } catch (e) {
            console.error("[dry-run] error:", e);
        }
    }

    // Clear messages whenever character or conversation context changes
    watch(contextVersion, () => {
        void loadHistory();
        error.value = null;
    })

    async function loadHistory() {
        const convId = activeConversationId.value;
        if (!convId) {
            messages.value = [];
            return;
        }
        isLoading.value = true;
        try {
            const res = await apiGetMessages(convId);
            messages.value = res.messages.map(m => ({
                id: m.id,
                role: m.role,
                content: m.content,
                createdAt: m.createdAt,
                status: "normal" as const,
            }));
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
            messages.value = [];
        } finally {
            isLoading.value = false;
        }
    }

    return {
        messages,
        isSending,
        isLoading,
        error,
        showDebug,
        sendMessage,
        clearMessages,
        loadHistory,
        dryRunPrompt,
    };
}

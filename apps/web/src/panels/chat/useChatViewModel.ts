import { ref, watch } from "vue";
import { apiDryRunChat, apiSendChatMessage, apiStreamChatMessage, apiGetMessages, apiDeleteMessage } from "./chatApi";
import type { ChatMessage } from "./chatTypes";
import { contextVersion } from "../../shared/state/appState";
import { activeConversationId } from "../sidebar/viewmodels/useConversationViewModel";
import { activeCharacter, activeCharacterId } from "../character/useCharacterViewModel";
import { actors, selectedActorId } from "../sidebar/viewmodels/useActorViewModel";
import { useToast } from "../../shared/ui/useToast";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";

export const chatDraftInput = ref("");

function createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toStructuredDecisionDebugMessages(structuredOutput: {
    action: "reply" | "skip";
    replyText: string;
    control: {
        summarizeSuggested: boolean;
        summarizeReason: string;
        summarizeUrgency: "none" | "low" | "normal" | "high";
    };
    skip: {
        reasonCode: "none" | "not_addressed" | "low_value" | "rate_control" | "character_busy" | "waiting_for_others" | "other";
        reason: string;
    };
}): import("./chatTypes").DebugMessage[] {
    return [
        {
            role: "decision",
            content: JSON.stringify(
                {
                    action: structuredOutput.action,
                    replyText: structuredOutput.replyText,
                },
                null,
                2,
            ),
        },
        {
            role: "control",
            content: JSON.stringify(structuredOutput.control, null, 2),
        },
        {
            role: "skip",
            content: JSON.stringify(structuredOutput.skip, null, 2),
        },
    ];
}

export function useChatViewModel() {
    const toast = useToast();
    const messages = ref<ChatMessage[]>([]);
    const isSending = ref(false);
    const isLoading = ref(false);
    const error = ref<string | null>(null);
    const streamMode = useLocalStorage("chat.streamMode", false);

    async function sendMessage(text: string, stream = false) {
        const userMessageText = text.trim();
        if (!userMessageText) {
            return;
        }

        const characterId = activeCharacterId.value;
        const conversationId = activeConversationId.value;
        const senderActorId = selectedActorId.value;
        if (!characterId || !conversationId || !senderActorId) {
            const message = "Please select a character, conversation, and actor before sending a message.";
            error.value = message;
            toast.error(message);
            return;
        }

        const selectedActor = actors.value.find(a => a.id === senderActorId);
        const assistantDisplayName = activeCharacter.value?.displayName ?? activeCharacter.value?.name;

        messages.value.push({
            id: createId("user"),
            role: "user",
            senderActorId,
            senderDisplayName: selectedActor?.displayName,
            senderSourceType: selectedActor?.sourceType,
            content: userMessageText,
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
                senderDisplayName: assistantDisplayName,
                senderSourceType: "ai_character",
                content: "",
                createdAt: new Date().toISOString(),
                status: "streaming"
            });

            try {
                let capturedAssembledMessages: import("./chatTypes").DebugMessage[] | undefined;
                const result = await apiStreamChatMessage(
                    characterId,
                    conversationId,
                    userMessageText,
                    senderActorId,
                    "non-structured",
                    (chunk) => {
                        const msg = messages.value.find(m => m.id === msgId);
                        if (msg) msg.content += chunk;
                    },
                    undefined,
                    true,
                    (msgs) => { capturedAssembledMessages = msgs; }
                );

                const msg = messages.value.find(m => m.id === msgId);
                if (msg) {
                    msg.status = "normal";
                    msg.id = result.requestId || msgId;
                    if (capturedAssembledMessages) msg.assembledMessages = capturedAssembledMessages;
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
            const response = await apiSendChatMessage(
                characterId,
                conversationId,
                userMessageText,
                senderActorId,
                "structured",
                true,
            );

            if (response.structuredOutput) {
                messages.value.push({
                    role: "debug",
                    content: "",
                    createdAt: new Date().toISOString(),
                    status: "normal",
                    debugMessages: toStructuredDecisionDebugMessages(response.structuredOutput),
                    structuredDecision: response.structuredOutput,
                });
                showDebug.value = true;
            }

            if (response.assistantMessageId || response.output.trim().length > 0) {
                messages.value.push({
                    id: response.assistantMessageId || response.requestId,
                    role: "assistant",
                    senderDisplayName: assistantDisplayName,
                    senderSourceType: "ai_character",
                    content: response.output,
                    createdAt: new Date().toISOString(),
                    status: "normal",
                    ...(response.assembledMessages ? { assembledMessages: response.assembledMessages } : {}),
                });
            }
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

    async function removeMessage(messageId: string) {
        const conversationId = activeConversationId.value;
        if (!conversationId) return;

        const target = messages.value.find(message => message.id === messageId);
        if (!target || target.deleting) return;

        const confirmed = window.confirm("删除这条消息？");
        if (!confirmed) return;

        target.deleting = true;
        try {
            await apiDeleteMessage(conversationId, messageId);
            messages.value = messages.value.filter(message => message.id !== messageId);
        } catch (e) {
            target.deleting = false;
            toast.error(e instanceof Error ? e.message : String(e));
        }
    }

    const showDebug = useLocalStorage("chat.showDebug", false);

    async function dryRunPrompt(text: string) {
        const userMessageText = text.trim();
        if (!userMessageText) return;

        const characterId = activeCharacterId.value;
        const conversationId = activeConversationId.value;
        const senderActorId = selectedActorId.value;
        if (!characterId || !conversationId || !senderActorId) {
            toast.error("Please select a character, conversation, and actor before dry-run.");
            return;
        }

        try {
            const llmResponseMode = streamMode.value ? "non-structured" : "structured";
            const result = await apiDryRunChat(characterId, conversationId, userMessageText, senderActorId, llmResponseMode);
            console.group("[dry-run] Assembled LLM input messages");
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
                senderActorId: m.senderActorId,
                senderDisplayName: m.senderDisplayName,
                senderSourceType: m.senderSourceType,
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
        chatDraftInput,
        sendMessage,
        clearMessages,
        loadHistory,
        dryRunPrompt,
        removeMessage,
    };
}

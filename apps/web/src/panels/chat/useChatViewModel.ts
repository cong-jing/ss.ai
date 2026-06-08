import { ref, watch } from "vue";
import { DEFAULT_INTERACTION_MODE, type TurnEvent } from "@ss-ai/contracts";
import { apiDryRunChat, apiSendChatMessage, apiStreamChatMessage, apiGetMessages, apiDeleteMessage } from "./chatApi";
import type { ChatMessage } from "./chatTypes";
import { contextVersion } from "../../shared/state/appState";
import { activeConversationId } from "../sidebar/viewmodels/useConversationViewModel";
import { activeCharacter, activeCharacterId } from "../character/useCharacterViewModel";
import { actors, selectedActorId } from "../sidebar/viewmodels/useActorViewModel";
import { useToast } from "../../shared/ui/useToast";
import { useLocalStorage } from "../../shared/ui/useLocalStorage";
import { t } from "../../shared/i18n/i18n";
import { localizeApiError } from "../../shared/api/localizeApiError";

export const chatDraftInput = ref("");
export const chatReplyNotice = ref<string | null>(null);
const STREAM_RENDER_INTERVAL_MS = 28;

function createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRawDebugMessages(input?: { role: string; content: string }[], turnEvents?: TurnEvent[]): import("./chatTypes").DebugMessage[] {
    const debugMessages: import("./chatTypes").DebugMessage[] = [];
    if (input) {
        debugMessages.push({
            role: "assembledInput",
            content: JSON.stringify(input, null, 2),
        });
    }
    if (turnEvents) {
        debugMessages.push({
            role: "turnEvents",
            content: JSON.stringify(turnEvents, null, 2),
        });
    }
    return debugMessages;
}

function formatTurnEventsForMessage(turnEvents: TurnEvent[] | undefined, fallback: string): string {
    if (!turnEvents?.length) return fallback;

    return turnEvents.map(event => {
        switch (event.type) {
            case "replyText":
                return `replyText: ${event.text}`;
            case "expression": {
                const fields = [`expression: ${event.expression}`];
                if (event.intensity !== undefined) fields.push(`intensity: ${event.intensity}`);
                return fields.join("\n");
            }
            case "sceneAtmosphere": {
                const fields = [`sceneAtmosphere: ${event.atmosphere}`];
                if (event.note) fields.push(`note: ${event.note}`);
                return fields.join("\n");
            }
            case "stateUpdate":
                return `stateUpdate: ${JSON.stringify(event.update)}`;
            default:
                return JSON.stringify(event);
        }
    }).join("\n");
}

function isAsciiWordChar(char: string): boolean {
    return /[A-Za-z0-9]/.test(char);
}

function isCjkLikeChar(char: string): boolean {
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

function tokenizeStreamChunk(chunk: string): string[] {
    const tokens: string[] = [];
    const chars = Array.from(chunk);
    let index = 0;

    while (index < chars.length) {
        const char = chars[index];
        if (!char) {
            index++;
            continue;
        }

        if (isAsciiWordChar(char)) {
            let token = char;
            index++;
            while (index < chars.length && isAsciiWordChar(chars[index] ?? "")) {
                token += chars[index];
                index++;
            }
            while (index < chars.length && /\s/u.test(chars[index] ?? "")) {
                token += chars[index];
                index++;
            }
            tokens.push(token);
            continue;
        }

        if (isCjkLikeChar(char)) {
            let token = char;
            index++;
            while (index < chars.length && /\s/u.test(chars[index] ?? "")) {
                token += chars[index];
                index++;
            }
            tokens.push(token);
            continue;
        }

        tokens.push(char);
        index++;
    }

    return tokens;
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
            const message = t("chat.error.selectContextBeforeSend");
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
        chatReplyNotice.value = null;

        if (stream) {
            const msgId = createId("assistant");
            const pendingTokens: string[] = [];
            let renderTimer: number | undefined;

            const stopRenderTimer = () => {
                if (renderTimer !== undefined) {
                    window.clearInterval(renderTimer);
                    renderTimer = undefined;
                }
            };

            const ensureRenderTimer = () => {
                if (renderTimer !== undefined) return;
                renderTimer = window.setInterval(() => {
                    const msg = messages.value.find(m => m.id === msgId);
                    if (!msg) {
                        stopRenderTimer();
                        pendingTokens.length = 0;
                        return;
                    }
                    const nextToken = pendingTokens.shift();
                    if (!nextToken) {
                        stopRenderTimer();
                        return;
                    }
                    msg.content += nextToken;
                }, STREAM_RENDER_INTERVAL_MS);
            };

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
                    {
                        onChunk: (chunk) => {
                            pendingTokens.push(...tokenizeStreamChunk(chunk));
                            ensureRenderTimer();
                        },
                        onAssembledMessages: (msgs) => { capturedAssembledMessages = msgs; },
                        // Preview events are best-effort speculative updates; the
                        // canonical turnEvents come on `done`. Skip stateUpdate
                        // previews to avoid showing transient/duplicated state.
                        onTurnEventPreview: (preview) => {
                            if (preview.event.type === "stateUpdate") return;
                            const msg = messages.value.find(m => m.id === msgId);
                            if (!msg) return;
                            const previews = msg.turnEvents ? [...msg.turnEvents] : [];
                            previews[preview.eventIndex] = preview.event;
                            msg.turnEvents = previews;
                        },
                    },
                    undefined,
                    true,
                    activeCharacter.value?.interactionMode ?? DEFAULT_INTERACTION_MODE,
                );

                const msg = messages.value.find(m => m.id === msgId);
                if (msg) {
                    stopRenderTimer();
                    pendingTokens.length = 0;
                    msg.status = "normal";
                    // Prefer the assistant message id from the database so later
                    // edits/deletes target the same row across reloads.
                    msg.id = result.assistantMessageId || result.requestId || msgId;
                    if (result.turnEvents) msg.turnEvents = result.turnEvents;
                    msg.content = formatTurnEventsForMessage(result.turnEvents, result.output ?? msg.content);
                }
                const debugMessages = toRawDebugMessages(capturedAssembledMessages, result.turnEvents);
                if (debugMessages.length > 0) {
                    const finalId = result.assistantMessageId || result.requestId || msgId;
                    const assistantIndex = messages.value.findIndex(m => m.id === finalId);
                    const insertIndex = assistantIndex >= 0 ? assistantIndex : messages.value.length;
                    messages.value.splice(insertIndex, 0, {
                        role: "debug",
                        content: "",
                        createdAt: new Date().toISOString(),
                        status: "normal",
                        debugMessages,
                        turnEvents: result.turnEvents,
                    });
                    showDebug.value = true;
                }
                if (result.apiKeySource === "default") {
                    chatReplyNotice.value = t("chat.defaultApiKeyReplyNotice");
                }
            } catch (e) {
                const message = localizeApiError(e);
                console.error("[chat/stream] error:", e);
                error.value = message;
                stopRenderTimer();
                pendingTokens.length = 0;
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
                true,
                activeCharacter.value?.interactionMode ?? DEFAULT_INTERACTION_MODE,
            );

            const debugMessages = toRawDebugMessages(response.assembledMessages, response.turnEvents);
            let assistantInsertIndex = messages.value.length;
            if (response.assistantMessageId || response.output.trim().length > 0) {
                assistantInsertIndex = messages.value.length;
                messages.value.push({
                    id: response.assistantMessageId || response.requestId,
                    role: "assistant",
                    senderDisplayName: assistantDisplayName,
                    senderSourceType: "ai_character",
                    content: formatTurnEventsForMessage(response.turnEvents, response.output),
                    createdAt: new Date().toISOString(),
                    status: "normal",
                    ...(response.turnEvents ? { turnEvents: response.turnEvents } : {}),
                });
            }

            if (debugMessages.length > 0) {
                messages.value.splice(assistantInsertIndex, 0, {
                    role: "debug",
                    content: "",
                    createdAt: new Date().toISOString(),
                    status: "normal",
                    debugMessages,
                    turnEvents: response.turnEvents,
                });
                showDebug.value = true;
            }
            if (response.apiKeySource === "default") {
                chatReplyNotice.value = t("chat.defaultApiKeyReplyNotice");
            }
        } catch (e) {
            const message = localizeApiError(e);
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
        chatReplyNotice.value = null;
    }

    async function removeMessage(messageId: string) {
        const conversationId = activeConversationId.value;
        if (!conversationId) return;

        const target = messages.value.find(message => message.id === messageId);
        if (!target || target.deleting) return;

        const confirmed = window.confirm(t("chat.confirmDeleteMessage"));
        if (!confirmed) return;

        target.deleting = true;
        try {
            await apiDeleteMessage(conversationId, messageId);
            messages.value = messages.value.filter(message => message.id !== messageId);
        } catch (e) {
            target.deleting = false;
            toast.error(localizeApiError(e));
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
            toast.error(t("chat.error.selectContextBeforeDryRun"));
            return;
        }

        try {
            const result = await apiDryRunChat(characterId, conversationId, userMessageText, senderActorId, activeCharacter.value?.interactionMode ?? DEFAULT_INTERACTION_MODE);
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
                debugMessages: toRawDebugMessages(result.messages),
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
        chatReplyNotice.value = null;
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
                content: formatTurnEventsForMessage(m.turnEvents, m.content),
                createdAt: m.createdAt,
                turnEvents: m.turnEvents,
                status: "normal" as const,
            }));
        } catch (e) {
            toast.error(localizeApiError(e));
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
        chatReplyNotice,
        showDebug,
        chatDraftInput,
        sendMessage,
        clearMessages,
        loadHistory,
        dryRunPrompt,
        removeMessage,
    };
}

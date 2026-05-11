export type MessageHandlerContext = {
    getCharacterId: () => string | null;
    getBotSelfId: () => string | number | null;
    resolveConversationId: (
        type: "user" | "group",
        id: string | number,
    ) => Promise<string | null>;
    createLocalActor: (
        conversationId: string,
        displayName: string,
        profileSnapshotJson?: string | null,
    ) => Promise<string>;
    chat: (
        conversationId: string,
        prompt: string,
        speakerActorId?: string,
    ) => Promise<string | null>;
    sendAction: (action: string, params: Record<string, unknown>) => void;
};

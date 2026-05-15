export type MessageHandlerContext = {
    getCharacterId: () => string | null;
    getBotSelfId: () => string | number | null;
    getConfig: () => MessageHandlerConfig;
    sendAction: (action: string, params: Record<string, unknown>) => void;
};

export type MessageHandlerConfig = {
    isDryRun: boolean;
};

export type MessageHandlerRuntimeContext = MessageHandlerContext & {
    getCharacterName: () => string | null;
    setCharacter: (characterId: string | null, characterName: string | null) => void;
    setBotSelfId: (id: string | number | null) => void;
};

export type MessageHandlerRuntimeDeps = {
    config?: MessageHandlerConfig;
    sendAction: (action: string, params: Record<string, unknown>) => void;
};

export function createMessageHandlerContext(
    deps: MessageHandlerRuntimeDeps,
): MessageHandlerRuntimeContext {
    let selectedCharacterId: string | null = null;
    let selectedCharacterName: string | null = null;
    let botSelfId: string | number | null = null;

    return {
        getCharacterId: () => selectedCharacterId,
        getCharacterName: () => selectedCharacterName,
        setCharacter: (characterId, characterName) => {
            selectedCharacterId = characterId;
            selectedCharacterName = characterName;
        },
        getBotSelfId: () => botSelfId,
        setBotSelfId: (id) => {
            botSelfId = id;
        },
        getConfig: () => deps.config ?? { isDryRun: false },
        sendAction: deps.sendAction,
    };
}

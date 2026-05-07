import type { Character } from "../stores/character.js";
import type { CharacterStore } from "../stores/characterStore.js";
import type { Message } from "../stores/message.js";
import type { MessageStore } from "../stores/messageStore.js";
import type { UserProfile } from "../stores/userProfile.js";
import type { UserProfileStore } from "../stores/userProfileStore.js";

export type PromptContext = {
    userProfile: UserProfile | null;
    character: Character | null;
    recentMessages: Message[];
    currentUserMessage: Message;
};

export const PromptContextBuilder = {
    build: async (input: {
        userId: string;
        characterId: string | null | undefined;
        conversationId: string;
        currentUserMessage: Message;
        messageStore: MessageStore;
        userProfileStore: UserProfileStore;
        characterStore: CharacterStore;
        historyLimit?: number;
    }): Promise<PromptContext> => {
        const [userProfile, character, allRecentMessages] = await Promise.all([
            input.userProfileStore.getUserProfile(input.userId),
            input.characterId
                ? input.characterStore.getCharacterById({ userId: input.userId, characterId: input.characterId })
                : Promise.resolve(null),
            input.messageStore.getRecentMessages({
                userId: input.userId,
                conversationId: input.conversationId,
                limit: input.historyLimit ?? 20,
            }),
        ]);

        // Exclude the currentUserMessage (last appended entry) from history
        const recentMessages = allRecentMessages.slice(0, -1);

        return { userProfile, character, recentMessages, currentUserMessage: input.currentUserMessage };
    },
};

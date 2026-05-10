import type { Character } from "../stores/character/character.js";
import type { CharacterStore } from "../stores/character/characterStore.js";
import type { Message } from "../stores/chat/message.js";
import type { ChatStore } from "../stores/chat/chatStore.js";
import type { UserProfile } from "../stores/user/userProfile.js";
import type { UserProfileStore } from "../stores/user/userProfileStore.js";
import type { ConversationParticipant } from "../stores/character/conversationParticipant.js";
import type { ConversationParticipantStore } from "../stores/character/conversationParticipantStore.js";

export type PromptContext = {
    userProfile: UserProfile | null;
    character: Character | null;
    /** All active (leftAt=null) participants in this conversation. */
    participants: ConversationParticipant[];
    /** Quick lookup map: participant id -> participant. */
    participantMap: Map<string, ConversationParticipant>;
    recentMessages: Message[];
    currentUserMessage: Message;
};

export const PromptContextBuilder = {
    build: async (input: {
        userId: string;
        characterId: string | null | undefined;
        conversationId: string;
        currentUserMessage: Message;
        messageStore: Pick<ChatStore, "getRecentMessages">;
        userProfileStore: UserProfileStore;
        characterStore: CharacterStore;
        conversationParticipantStore: ConversationParticipantStore;
        historyLimit?: number;
    }): Promise<PromptContext> => {
        const [userProfile, character, allRecentMessages, participants] = await Promise.all([
            input.userProfileStore.getUserProfile(input.userId),
            input.characterId
                ? input.characterStore.getCharacterById({ userId: input.userId, characterId: input.characterId })
                : Promise.resolve(null),
            input.messageStore.getRecentMessages({
                userId: input.userId,
                conversationId: input.conversationId,
                limit: input.historyLimit ?? 20,
            }),
            input.conversationParticipantStore.listConversationParticipants({
                conversationId: input.conversationId,
                activeOnly: true,
            }),
        ]);

        // Exclude the currentUserMessage (last appended entry) from history
        const recentMessages = allRecentMessages.slice(0, -1);

        const participantMap = new Map<string, ConversationParticipant>(
            participants.map(p => [p.id, p]),
        );

        return { userProfile, character, participants, participantMap, recentMessages, currentUserMessage: input.currentUserMessage };
    },
};

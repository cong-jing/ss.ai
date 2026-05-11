import type { Character } from "../stores/character/character.js";
import type { CharacterStore } from "../stores/character/characterStore.js";
import type { Message } from "../stores/chat/message.js";
import type { ChatStore } from "../stores/chat/chatStore.js";
import type { UserProfile } from "../stores/user/userProfile.js";
import type { UserProfileStore } from "../stores/user/userProfileStore.js";
import type { ConversationActor } from "../stores/character/conversationActor.js";
import type { ConversationActorStore } from "../stores/character/conversationActorStore.js";

export type PromptContext = {
    userProfile: UserProfile | null;
    character: Character | null;
    /** All active (leftAt=null) actors in this conversation. */
    actors: ConversationActor[];
    /** Quick lookup map: actor id -> actor. */
    actorMap: Map<string, ConversationActor>;
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
        conversationActorStore: ConversationActorStore;
        historyLimit?: number;
    }): Promise<PromptContext> => {
        const [userProfile, character, allRecentMessages, actors] = await Promise.all([
            input.userProfileStore.getUserProfile(input.userId),
            input.characterId
                ? input.characterStore.getCharacterById({ userId: input.userId, characterId: input.characterId })
                : Promise.resolve(null),
            input.messageStore.getRecentMessages({
                userId: input.userId,
                conversationId: input.conversationId,
                limit: input.historyLimit ?? 20,
            }),
            input.conversationActorStore.listConversationActors({
                conversationId: input.conversationId,
                activeOnly: true,
            }),
        ]);

        // Exclude currentUserMessage only when it is actually present in fetched history.
        // In dry-run flows currentUserMessage is transient (not persisted), so history must stay intact.
        const recentMessages = allRecentMessages.filter(
            message => message.id !== input.currentUserMessage.id,
        );

        const actorMap = new Map<string, ConversationActor>(
            actors.map(actor => [actor.id, actor]),
        );

        return { userProfile, character, actors, actorMap, recentMessages, currentUserMessage: input.currentUserMessage };
    },
};

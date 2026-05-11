import type { ConversationActor } from "./conversationActor.js";

/** Input for adding an actor to a conversation. */
export interface AddConversationActorInput {
    conversationId: string;
    role: ConversationActor["role"];
    sourceType: ConversationActor["sourceType"];
    displayName: string;
    userProfileId?: string | null;
    characterId?: string | null;
    profileSnapshotJson?: string | null;
}

/** Input for updating a conversation actor. */
export interface UpdateConversationActorInput {
    id: string;
    displayName?: string;
    profileSnapshotJson?: string | null;
    leftAt?: string | null;
}

/** Persistence interface for ConversationActor records. */
export interface ConversationActorStore {
    getActorById(id: string): Promise<ConversationActor | null>;
    listConversationActors(input: {
        conversationId: string;
        activeOnly?: boolean;
    }): Promise<ConversationActor[]>;
    addConversationActor(input: AddConversationActorInput): Promise<ConversationActor>;
    updateConversationActor(input: UpdateConversationActorInput): Promise<void>;
    createActor(actor: ConversationActor): Promise<void>;
}

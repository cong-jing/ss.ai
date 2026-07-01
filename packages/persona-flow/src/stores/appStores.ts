import type { CharacterStore } from "./character/characterStore.js";
import type { UserProfileStore } from "./user/userProfileStore.js";
import type { UserPreferencesStore } from "./user/userPreferencesStore.js";
import type { UserProviderCredentialStore } from "./user/userProviderCredentialStore.js";
import type { ChatStore } from "./chat/chatStore.js";
import type { ConversationStore } from "./character/conversationStore.js";
import type { ConversationActorStore } from "./character/conversationActorStore.js";
import type {
    MemoryCandidateStore,
    MemoryConsolidationDecisionStore,
    MemoryRetainedStore,
    MemoryStagingStore,
} from "../memory/index.js";

/**
 * Grouped collection of all application stores.
 *
 * Design rules:
 * - Add a new top-level store only when introducing a genuinely new business domain.
 * - Internal SQLite tables that support existing domains (summaries, tags, embeddings,
 *   etc.) should be hidden inside the relevant concrete store, not exposed here.
 */
export interface AppStores {
    character: CharacterStore;
    userProfile: UserProfileStore;
    userPreferences: UserPreferencesStore;
    conversation: ConversationStore;
    conversationActor: ConversationActorStore;
    chat: ChatStore;
    providerCredential: UserProviderCredentialStore;
    memoryCandidate: MemoryCandidateStore;
    memoryStaging: MemoryStagingStore;
    memoryRetained: MemoryRetainedStore;
    memoryConsolidationDecision: MemoryConsolidationDecisionStore;
}


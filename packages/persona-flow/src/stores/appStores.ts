import type { CharacterStore } from "./characterStore.js";
import type { UserProfileStore } from "./userProfileStore.js";
import type { UserPreferencesStore } from "./userPreferencesStore.js";
import type { UserProviderCredentialStore } from "./userProviderCredentialStore.js";
import type { ChatStore } from "./chatStore.js";

/**
 * Grouped collection of all application stores.
 *
 * Design rules:
 * - Add a new top-level store only when introducing a genuinely new business domain.
 * - Internal SQLite tables that support existing domains (conversations, summaries,
 *   tags, embeddings, etc.) should be hidden inside the relevant concrete store,
 *   not exposed here as separate store slots.
 */
export interface AppStores {
    character: CharacterStore;
    userProfile: UserProfileStore;
    userPreferences: UserPreferencesStore;
    chat: ChatStore;
    providerCredential: UserProviderCredentialStore;
}

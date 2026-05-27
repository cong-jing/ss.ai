import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";
import { DEFAULT_INTERACTION_MODE } from "@ss-ai/contracts";

// ── conversation_actors ───────────────────────────────────────────────────────
export const conversationActors = sqliteTable("conversation_actors", {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(), // "self" | "system" | "other"
    sourceType: text("source_type").notNull(), // "ai_character" | "system" | "logged_user" | "local_actor"
    displayName: text("display_name").notNull(),
    userProfileId: text("user_profile_id"),
    characterId: text("character_id"),
    profileSnapshotJson: text("profile_snapshot_json"),
    leftAt: text("left_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type ConversationActorRow = typeof conversationActors.$inferSelect;
export type NewConversationActorRow = typeof conversationActors.$inferInsert;

// ── messages ──────────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    senderActorId: text("sender_actor_id").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
});

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

// ── conversations ─────────────────────────────────────────────────────────────
export const conversations = sqliteTable("conversations", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    title: text("title"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type ConversationRow = typeof conversations.$inferSelect;
export type NewConversationRow = typeof conversations.$inferInsert;

// ── characters ────────────────────────────────────────────────────────────────
export const characters = sqliteTable("characters", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    personaPrompt: text("persona_prompt").notNull(),
    greetingMessage: text("greeting_message"),
    avatarUrl: text("avatar_url"),
    modelConfigJson: text("model_config_json").notNull().default("{}"),
    interactionMode: text("interaction_mode").notNull().default(DEFAULT_INTERACTION_MODE),
    generationConfigJson: text("generation_config_json").notNull().default("{}"),
    memoryConfigJson: text("memory_config_json").notNull().default("{}"),
    language: text("language").default("zh-CN"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type CharacterRow = typeof characters.$inferSelect;
export type NewCharacterRow = typeof characters.$inferInsert;

// ── user_profiles ─────────────────────────────────────────────────────────────
export const userProfiles = sqliteTable("user_profiles", {
    userId: text("user_id").primaryKey(),
    name: text("name").notNull(),
    preferredAddress: text("preferred_address"),
    bio: text("bio").notNull().default(""),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type UserProfileRow = typeof userProfiles.$inferSelect;
export type NewUserProfileRow = typeof userProfiles.$inferInsert;

// ── user_preferences ──────────────────────────────────────────────────────────
export const userPreferences = sqliteTable("user_preferences", {
    userId: text("user_id").primaryKey(),
    currentCharacterId: text("current_character_id"),
    modelAssignmentsJson: text("model_assignments_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type UserPreferencesRow = typeof userPreferences.$inferSelect;
export type NewUserPreferencesRow = typeof userPreferences.$inferInsert;

// ── user_character_states ─────────────────────────────────────────────────────
export const userCharacterStates = sqliteTable("user_character_states", {
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    currentConversationId: text("current_conversation_id").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.userId, t.characterId] }),
}));

export type UserCharacterStateRow = typeof userCharacterStates.$inferSelect;
export type NewUserCharacterStateRow = typeof userCharacterStates.$inferInsert;

// ── user_provider_credentials ─────────────────────────────────────────────────
export const userProviderCredentials = sqliteTable("user_provider_credentials", {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.userId, t.provider] }),
}));

export type UserProviderCredentialRow = typeof userProviderCredentials.$inferSelect;
export type NewUserProviderCredentialRow = typeof userProviderCredentials.$inferInsert;

// ── app_users ────────────────────────────────────────────────────────────────
export const appUsers = sqliteTable("app_users", {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type AppUserRow = typeof appUsers.$inferSelect;
export type NewAppUserRow = typeof appUsers.$inferInsert;

// ── app_sessions ─────────────────────────────────────────────────────────────
export const appSessions = sqliteTable("app_sessions", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
});

export type AppSessionRow = typeof appSessions.$inferSelect;
export type NewAppSessionRow = typeof appSessions.$inferInsert;

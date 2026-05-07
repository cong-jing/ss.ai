import { sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

// ── messages ──────────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
});

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

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
    currentConversationId: text("current_conversation_id"),
    functionModelsJson: text("function_models_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type UserPreferencesRow = typeof userPreferences.$inferSelect;
export type NewUserPreferencesRow = typeof userPreferences.$inferInsert;

// ── user_provider_credentials ─────────────────────────────────────────────────
export const userProviderCredentials = sqliteTable("user_provider_credentials", {
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.userId, t.provider] }),
}));

export type UserProviderCredentialRow = typeof userProviderCredentials.$inferSelect;
export type NewUserProviderCredentialRow = typeof userProviderCredentials.$inferInsert;

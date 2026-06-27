import { integer, real, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";
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
    kind: text("kind").notNull(),
    displayText: text("display_text").notNull(),
    createdAt: text("created_at").notNull(),
});

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

export const turnEvents = sqliteTable("turn_events", {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
});

export type TurnEventRow = typeof turnEvents.$inferSelect;
export type NewTurnEventRow = typeof turnEvents.$inferInsert;

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
    username: text("username").notNull().unique(),
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
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
});

export type AppSessionRow = typeof appSessions.$inferSelect;
export type NewAppSessionRow = typeof appSessions.$inferInsert;

// ── memory_candidates ─────────────────────────────────────────────────────────
// Per-turn candidates that the model proposed during a chat turn.
// Lifecycle: pending -> embedded -> committed | ignored_* | needs_judge |
// embedding_failed | commit_failed. See `MemoryCandidateStatus` in
// `@ss-ai/persona-flow/memory`.
//
// `embedding_json` stores the full `MemoryEmbedding` shape (vector +
// signature + createdAt) as JSON. We keep the vector in JSON for
// Batch 2/3 because SQLite has no native vector type and the
// candidate volume is bounded by chat turns; if we ever want ANN
// search over candidates (we don't today), this row becomes a join
// target rather than the storage format.
export const memoryCandidates = sqliteTable("memory_candidates", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    assistantMessageId: text("assistant_message_id").notNull(),
    requestId: text("request_id").notNull(),
    modelCallPurpose: text("model_call_purpose").notNull(),
    seq: integer("seq").notNull(),
    scope: text("scope").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    reason: text("reason"),
    status: text("status").notNull(),
    embeddingJson: text("embedding_json"),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type MemoryCandidateRow = typeof memoryCandidates.$inferSelect;
export type NewMemoryCandidateRow = typeof memoryCandidates.$inferInsert;

// ── memories ─────────────────────────────────────────────────────────────────
// Active long-term memories. `character_id` is NULL for cross-character
// scopes (user, world); `findExactActiveMemory` relies on
// `IS NULL` semantics when callers pass `characterId: null`.
//
// `embedding_json` shape and rationale mirrors `memory_candidates`.
// Brute-force cosine ranking happens in JS today; the row layout
// only needs to keep enough metadata to validate the signature
// before computing similarity.
export const memories = sqliteTable("memories", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id"),
    scope: text("scope").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    sourceCandidateId: text("source_candidate_id"),
    sourceConversationId: text("source_conversation_id"),
    sourceUserMessageId: text("source_user_message_id"),
    sourceAssistantMessageId: text("source_assistant_message_id"),
    status: text("status").notNull(),
    importance: real("importance").notNull(),
    embeddingJson: text("embedding_json"),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemoryRow = typeof memories.$inferInsert;

// ── memory_decisions ──────────────────────────────────────────────────────────
// Audit trail: one row per decision the commit service made for a
// candidate. Includes the top-K similarity summary as JSON so we
// can reproduce the reasoning without re-running embeddings.
//
// `memory_id` is set only for `decision = "create"`. `reason` is a
// short token from `decisionPolicy.ts` (or an error message for
// failure branches).
export const memoryDecisions = sqliteTable("memory_decisions", {
    id: text("id").primaryKey(),
    candidateId: text("candidate_id").notNull(),
    userId: text("user_id").notNull(),
    characterId: text("character_id"),
    decision: text("decision").notNull(),
    memoryId: text("memory_id"),
    reason: text("reason"),
    similarityJson: text("similarity_json").notNull().default("[]"),
    policyVersion: integer("policy_version").notNull(),
    createdAt: text("created_at").notNull(),
});

export type MemoryDecisionRow = typeof memoryDecisions.$inferSelect;
export type NewMemoryDecisionRow = typeof memoryDecisions.$inferInsert;

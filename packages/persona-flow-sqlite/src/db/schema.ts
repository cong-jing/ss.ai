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
// Lifecycle (Batch 3.5): pending -> processed | rejected_by_rule |
// failed. (`processing` is reserved for the Batch 4 async worker
// and is not currently written by inline processing.)
// Downstream evidence — normalized text, embedding, occurrence
// aggregation — now lives on `memory_staging` and is no longer
// folded back onto the candidate row.
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
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    candidateReason: text("candidate_reason"),
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type MemoryCandidateRow = typeof memoryCandidates.$inferSelect;
export type NewMemoryCandidateRow = typeof memoryCandidates.$inferInsert;

// ── memory_staging ────────────────────────────────────────────────────────────
// Staging rows aggregate one or more candidates that say the same
// thing. Created/updated by the Batch 3.5 staging processor.
// `embedding_json` stores the full MemoryEmbedding shape (vector +
// signature + createdAt) as JSON, mirroring how candidates used to
// carry embeddings. The consolidation pass into `memory_retained`
// ships in Batch 4.
export const memoryStaging = sqliteTable("memory_staging", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    scope: text("scope").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    embeddingJson: text("embedding_json"),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type MemoryStagingRow = typeof memoryStaging.$inferSelect;
export type NewMemoryStagingRow = typeof memoryStaging.$inferInsert;

// ── memory_staging_sources ────────────────────────────────────────────────────
// Link rows: which candidates contributed evidence to which staging
// row. Composite primary key on (memory_staging_id, candidate_id).
// `candidate_id` is UNIQUE so a single candidate can only ever
// contribute to one staging row — retries detect the existing link
// and short-circuit instead of double-counting `occurrence_count`.
export const memoryStagingSources = sqliteTable("memory_staging_sources", {
    memoryStagingId: text("memory_staging_id").notNull(),
    candidateId: text("candidate_id").notNull().unique(),
    candidateSeq: integer("candidate_seq").notNull(),
    createdAt: text("created_at").notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.memoryStagingId, t.candidateId] }),
}));

export type MemoryStagingSourceRow = typeof memoryStagingSources.$inferSelect;
export type NewMemoryStagingSourceRow = typeof memoryStagingSources.$inferInsert;

// ── memory_retained ───────────────────────────────────────────────────────────
// Consolidated long-term memory. Batch 3.5 ships the empty table
// + read-only port so the debug surface and storage adapter can be
// wired now; the consolidation pass that writes into this table
// lives in Batch 4. `source_staging_id` is the staging row this
// memory was promoted from (null for manual / judge-driven insertions).
export const memoryRetained = sqliteTable("memory_retained", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    scope: text("scope").notNull(),
    type: text("type").notNull(),
    text: text("text").notNull(),
    normalizedText: text("normalized_text").notNull(),
    relatedEntitiesJson: text("related_entities_json").notNull().default("[]"),
    tagsJson: text("tags_json").notNull().default("[]"),
    sourceStagingId: text("source_staging_id"),
    status: text("status").notNull(),
    importance: real("importance").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    embeddingJson: text("embedding_json"),
    schemaVersion: integer("schema_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type MemoryRetainedRow = typeof memoryRetained.$inferSelect;
export type NewMemoryRetainedRow = typeof memoryRetained.$inferInsert;

// ── memory_consolidation_decisions ─────────────────────────────────────────────
// Audit log for the Batch 4 consolidation judge. One row per staging
// row processed, capturing the judge request/response, the validated
// action, and the applied outcome. `find applied` enforces at most
// one `applied` decision per staging row (idempotency).
export const memoryConsolidationDecisions = sqliteTable("memory_consolidation_decisions", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    characterId: text("character_id").notNull(),
    memoryStagingId: text("memory_staging_id").notNull(),
    action: text("action").notNull(),
    targetRetainedMemoryId: text("target_retained_memory_id"),
    createdRetainedMemoryId: text("created_retained_memory_id"),
    archivedRetainedMemoryIdsJson: text("archived_retained_memory_ids_json").notNull().default("[]"),
    judgeRequestJson: text("judge_request_json"),
    judgeResponseJson: text("judge_response_json"),
    validatedActionJson: text("validated_action_json"),
    status: text("status").notNull(),
    statusReason: text("status_reason"),
    modelCallPurpose: text("model_call_purpose").notNull(),
    model: text("model"),
    requestId: text("request_id"),
    createdAt: text("created_at").notNull(),
});

export type MemoryConsolidationDecisionRow = typeof memoryConsolidationDecisions.$inferSelect;
export type NewMemoryConsolidationDecisionRow = typeof memoryConsolidationDecisions.$inferInsert;

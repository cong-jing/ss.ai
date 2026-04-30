import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// ── messages ──────────────────────────────────────────────────────────────────
// 列名用 snake_case（数据库惯例），TypeScript 属性名用 camelCase（Drizzle 自动映射）
export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
});

export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

// ── characters ────────────────────────────────────────────────────────────────
// Stores the character card and generation configuration.
// Does NOT store user↔character relationship state, memory, or chat history.
export const characters = sqliteTable("characters", {
    id:   text("id").primaryKey(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    description: text("description"),
    personaPrompt:   text("persona_prompt").notNull(),
    greetingMessage: text("greeting_message"),
    avatarUrl:       text("avatar_url"),
    // Unstable / extensible configs stored as JSON to avoid frequent migrations
    modelConfigJson:      text("model_config_json").notNull().default("{}"),
    generationConfigJson: text("generation_config_json").notNull().default("{}"),
    memoryConfigJson:     text("memory_config_json").notNull().default("{}"),
    status:    text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
});

export type CharacterRow = typeof characters.$inferSelect;
export type NewCharacterRow = typeof characters.$inferInsert;

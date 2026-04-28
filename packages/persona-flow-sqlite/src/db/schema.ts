import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// messages 表定义
// 列名用 snake_case（数据库惯例），TypeScript 属性名用 camelCase（Drizzle 自动映射）
export const messages = sqliteTable("messages", {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
});

// 从 schema 推导类型，避免手写 interface 与表定义不同步
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;

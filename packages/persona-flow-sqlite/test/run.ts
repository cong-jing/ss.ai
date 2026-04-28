/**
 * 手动集成测试 —— 验证 SQLite 读写是否正常
 *
 * 运行: npm test
 *
 * DB 路径模拟从外部配置传入（正式代码中来自 config.local.json 的 userDataDir）
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, SQLiteMessageStore } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userDataDir = path.resolve(__dirname, "data");
const dbPath = path.join(userDataDir, "persona-flow-dev.db");

async function run() {
    // 1. 打开数据库 —— 路径由外部决定，openDatabase 只负责打开
    const { db } = openDatabase(dbPath);

    // 2. 依赖注入 SQLiteMessageStore
    const store = new SQLiteMessageStore(db);

    const conversationId = "conv_1";

    // 3. 写入测试消息
    await store.appendMessage({
        id: crypto.randomUUID(),
        conversationId,
        role: "user",
        content: "你好",
        createdAt: new Date().toISOString(),
    });

    await store.appendMessage({
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content: "你好，我在。",
        createdAt: new Date().toISOString(),
    });

    // 4. 查询并打印（时间升序）
    const recent = await store.getRecentMessages({ conversationId, limit: 20 });
    console.log(`Recent messages (dbPath: ${dbPath}):`);
    for (const msg of recent) {
        console.log(`  [${msg.role}] ${msg.content}  (${msg.createdAt})`);
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});

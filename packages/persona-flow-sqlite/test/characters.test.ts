/**
 * Character store integration tests — SQLiteCharacterStore
 *
 * Uses a fresh in-memory SQLite database per test so the tests are hermetic
 * and leave no files on disk.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, SQLiteCharacterStore } from "../src/index.js";
import type { Character } from "@ss-ai/persona-flow";

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeRinrin(overrides?: Partial<Character>): Character {
    return {
        id: "char_rinrin",
        name: "Rinrin",
        displayName: "凛凛",
        description: "活泼亲近、略带少女感的 AI 助手",
        personaPrompt:
            "你是凛凛，一个活泼、亲近、略带少女感的 AI 助手。" +
            "你说话自然、温柔，偶尔俏皮，会主动关心用户的状态。" +
            `你喜欢用"呀""呢""哦"等语气词，但不会用力过度。`,
        greetingMessage: "嗨～我是凛凛，有什么想聊的呀？",
        avatarUrl: null,
        modelConfig: { provider: "mistral", model: "mistral-large-latest" },
        generationConfig: { temperature: 0.8, maxTokens: 1200 },
        memoryConfig: { recentMessageLimit: 20, enableMemorySearch: true, memorySearchLimit: 8 },
        status: "active",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeHana(overrides?: Partial<Character>): Character {
    return {
        id: "char_hana",
        name: "Hana",
        displayName: "花花",
        description: "温柔知性的 AI 书友",
        personaPrompt:
            "你是花花，一位温柔知性的 AI 书友。" +
            "你热爱文学，说话沉稳，引用典故时恰到好处。",
        greetingMessage: "你好，今天读了什么好书？",
        avatarUrl: null,
        modelConfig: { provider: "mistral", model: "mistral-small-latest" },
        generationConfig: { temperature: 0.6, maxTokens: 800 },
        memoryConfig: { recentMessageLimit: 15, enableMemorySearch: false },
        status: "active",
        createdAt: "2025-01-02T00:00:00.000Z",
        updatedAt: "2025-01-02T00:00:00.000Z",
        ...overrides,
    };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("SQLiteCharacterStore", () => {
    let store: SQLiteCharacterStore;

    before(() => {
        // ":memory:" gives us an isolated, ephemeral database per test run
        const { db } = openDatabase(":memory:");
        store = new SQLiteCharacterStore(db);
    });

    it("createCharacter — insert and retrieve by id", async () => {
        const rinrin = makeRinrin();
        await store.createCharacter(rinrin);

        const result = await store.getCharacterById("char_rinrin");
        assert.ok(result !== null, "should find the character");
        assert.equal(result.id, rinrin.id);
        assert.equal(result.name, rinrin.name);
        assert.equal(result.displayName, rinrin.displayName);
        assert.equal(result.personaPrompt, rinrin.personaPrompt);
        assert.equal(result.status, "active");
    });

    it("getCharacterById — returns null for unknown id", async () => {
        const result = await store.getCharacterById("char_does_not_exist");
        assert.equal(result, null);
    });

    it("createCharacter — JSON config round-trips correctly", async () => {
        // Rinrin was already inserted above; just check the config
        const result = await store.getCharacterById("char_rinrin");
        assert.ok(result !== null);
        assert.deepEqual(result.modelConfig, { provider: "mistral", model: "mistral-large-latest" });
        assert.deepEqual(result.generationConfig, { temperature: 0.8, maxTokens: 1200 });
        assert.deepEqual(result.memoryConfig, { recentMessageLimit: 20, enableMemorySearch: true, memorySearchLimit: 8 });
    });

    it("listCharacters — returns all active characters sorted by updatedAt DESC", async () => {
        // Insert a second character with a later timestamp
        const hana = makeHana();
        await store.createCharacter(hana);

        const list = await store.listCharacters({ status: "active" });
        // hana has updatedAt 2025-01-02 > rinrin 2025-01-01
        assert.equal(list.length >= 2, true);
        assert.equal(list[0].id, "char_hana");
        assert.equal(list[1].id, "char_rinrin");
    });

    it("listCharacters — no filter returns all statuses", async () => {
        const all = await store.listCharacters();
        assert.ok(all.length >= 2, "should return at least the two inserted characters");
    });

    it("updateCharacter — patches selected fields, leaves others unchanged", async () => {
        await store.updateCharacter({
            id: "char_rinrin",
            patch: {
                displayName: "凛凛（更新）",
                generationConfig: { temperature: 0.9, maxTokens: 1500 },
                updatedAt: "2025-06-01T00:00:00.000Z",
            },
        });

        const updated = await store.getCharacterById("char_rinrin");
        assert.ok(updated !== null);
        assert.equal(updated.displayName, "凛凛（更新）");
        assert.equal(updated.updatedAt, "2025-06-01T00:00:00.000Z");
        // Untouched fields must not change
        assert.equal(updated.name, "Rinrin");
        assert.equal(updated.personaPrompt.startsWith("你是凛凛"), true);
        assert.deepEqual(updated.generationConfig, { temperature: 0.9, maxTokens: 1500 });
        // modelConfig was not patched
        assert.deepEqual(updated.modelConfig, { provider: "mistral", model: "mistral-large-latest" });
    });

    it("archiveCharacter — sets status to archived", async () => {
        await store.archiveCharacter({
            id: "char_hana",
            updatedAt: "2025-07-01T00:00:00.000Z",
        });

        const archived = await store.getCharacterById("char_hana");
        assert.ok(archived !== null);
        assert.equal(archived.status, "archived");
        assert.equal(archived.updatedAt, "2025-07-01T00:00:00.000Z");
    });

    it("listCharacters — status:active excludes archived characters", async () => {
        const active = await store.listCharacters({ status: "active" });
        const ids = active.map(c => c.id);
        assert.ok(!ids.includes("char_hana"), "archived char_hana must not appear in active list");
        assert.ok(ids.includes("char_rinrin"), "active char_rinrin should appear");
    });

    it("listCharacters — status:archived shows only archived", async () => {
        const archived = await store.listCharacters({ status: "archived" });
        assert.ok(archived.every(c => c.status === "archived"));
        assert.ok(archived.some(c => c.id === "char_hana"));
    });

    it("listCharacters — limit is respected", async () => {
        const list = await store.listCharacters({ limit: 1 });
        assert.equal(list.length, 1);
    });

    it("createCharacter — null optional fields are preserved as null", async () => {
        const minimal: Character = {
            id: "char_minimal",
            name: "Minimal",
            displayName: null,
            description: null,
            personaPrompt: "A bare-bones character.",
            greetingMessage: null,
            avatarUrl: null,
            modelConfig: {},
            generationConfig: {},
            memoryConfig: {},
            status: "active",
            createdAt: "2025-01-03T00:00:00.000Z",
            updatedAt: "2025-01-03T00:00:00.000Z",
        };
        await store.createCharacter(minimal);

        const result = await store.getCharacterById("char_minimal");
        assert.ok(result !== null);
        assert.equal(result.displayName, null);
        assert.equal(result.description, null);
        assert.equal(result.greetingMessage, null);
        assert.equal(result.avatarUrl, null);
        assert.deepEqual(result.modelConfig, {});
        assert.deepEqual(result.generationConfig, {});
        assert.deepEqual(result.memoryConfig, {});
    });
});

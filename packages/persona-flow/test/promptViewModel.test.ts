import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Character, UserProfile } from "../src/index.js";
import { buildPromptViewModel } from "../src/index.js";

function fixedIso(offset = 0): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, offset)).toISOString();
}

function createCharacter(): Character {
    return {
        id: "char-1",
        userId: "user-1",
        name: "Shishi",
        displayName: "诗诗",
        description: "开朗热情",
        personaPrompt: "活泼说话风格",
        modelConfig: {},
        generationConfig: {},
        memoryConfig: {},
        status: "active",
        createdAt: fixedIso(0),
        updatedAt: fixedIso(1),
    };
}

function createUserProfile(): UserProfile {
    return {
        userId: "user-1",
        name: "Satoshi",
        bio: "An engineer",
        metadata: {},
        createdAt: fixedIso(0),
        updatedAt: fixedIso(0),
    };
}

describe("single-character chat prompt view model", () => {
    it("builds character and user profile fields", () => {
        const result = buildPromptViewModel({
            character: createCharacter(),
            userProfile: createUserProfile(),
        });

        assert.equal(result.character.displayName, "诗诗");
        assert.equal(result.character.description, "开朗热情");
        assert.equal(result.character.personaPrompt, "活泼说话风格");
        assert.equal(result.userProfile.name, "Satoshi");
        assert.equal(result.userProfile.bio, "An engineer");
    });

    it("uses fallback values when optional profile fields are empty", () => {
        const character = createCharacter();
        character.displayName = null;
        character.description = undefined;
        character.personaPrompt = "";

        const result = buildPromptViewModel({
            character,
            userProfile: null,
        });

        assert.equal(result.character.displayName, "Shishi");
        assert.equal(result.character.description, "");
        assert.equal(result.character.personaPrompt, "");
        assert.equal(result.userProfile.name, "User");
        assert.equal(result.userProfile.bio, "");
    });
});

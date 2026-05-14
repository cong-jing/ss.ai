import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Character, ConversationActor, UserProfile } from "../src/index.js";
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

function createBaseActors(): ConversationActor[] {
    return [
        {
            id: "actor-self",
            conversationId: "conv-1",
            role: "self",
            sourceType: "ai_character",
            displayName: "SelfOriginal",
            userProfileId: null,
            characterId: "char-1",
            profileSnapshotJson: null,
            leftAt: null,
            createdAt: fixedIso(0),
            updatedAt: fixedIso(0),
        },
        {
            id: "actor-system",
            conversationId: "conv-1",
            role: "system",
            sourceType: "system",
            displayName: "系统",
            userProfileId: null,
            characterId: null,
            profileSnapshotJson: null,
            leftAt: null,
            createdAt: fixedIso(1),
            updatedAt: fixedIso(1),
        },
        {
            id: "actor-user",
            conversationId: "conv-1",
            role: "other",
            sourceType: "logged_user",
            displayName: "Satoshi",
            userProfileId: "user-1",
            characterId: null,
            profileSnapshotJson: null,
            leftAt: null,
            createdAt: fixedIso(2),
            updatedAt: fixedIso(2),
        },
        {
            id: "actor-local",
            conversationId: "conv-1",
            role: "other",
            sourceType: "local_actor",
            displayName: "罗兰",
            userProfileId: null,
            characterId: null,
            profileSnapshotJson: JSON.stringify({ description: "剑圣" }),
            leftAt: null,
            createdAt: fixedIso(3),
            updatedAt: fixedIso(3),
        },
    ];
}

describe("prompt view model", () => {
    it("builds fixed p1/p2 and loops actors from p3", () => {
        const result = buildPromptViewModel({
            character: createCharacter(),
            userProfile: {
                userId: "user-1",
                name: "Satoshi",
                bio: "An engineer",
                metadata: {},
                createdAt: fixedIso(0),
                updatedAt: fixedIso(0),
            },
            actors: createBaseActors(),
        });

        assert.equal(result.p1.speakerTag, "p1[诗诗]");
        assert.equal(result.p1.displayName, "诗诗");
        assert.equal(result.p2.speakerTag, "p2[system]");

        assert.equal(result.actors.length, 2);
        assert.equal(result.actors[0].speakerTag, "p3[Satoshi]");
        assert.equal(result.actors[0].sourceType, "logged_user");
        assert.equal(result.actors[1].speakerTag, "p4[罗兰]");
        assert.equal(result.actors[1].sourceType, "local_actor");
    });

    it("uses user profile bio fallback and default profile marker", () => {
        const profile: UserProfile = {
            userId: "user-1",
            name: "Satoshi",
            bio: "An engineer",
            metadata: {},
            createdAt: fixedIso(0),
            updatedAt: fixedIso(0),
        };

        const actors = createBaseActors();
        actors[2] = {
            ...actors[2],
            profileSnapshotJson: null,
        };
        actors[3] = {
            ...actors[3],
            profileSnapshotJson: JSON.stringify({}),
        };

        const result = buildPromptViewModel({
            character: createCharacter(),
            userProfile: profile,
            actors,
        });

        const loggedUser = result.actors.find(actor => actor.sourceType === "logged_user");
        const localActor = result.actors.find(actor => actor.sourceType === "local_actor");

        assert.ok(loggedUser);
        assert.ok(localActor);
        assert.equal(loggedUser.profile, "An engineer");
        assert.equal(localActor.profile, "（无）");
    });
});

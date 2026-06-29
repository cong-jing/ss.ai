// Usage:
//   pnpm tsx --conditions=source packages/persona-flow-model-client/mistral-embed-similarity-probe.mts [model]
//
// Reads API key from, in order:
//   1. apps/prompt-debug-cli/.apikey.yaml (apiKey / mistralApiKey / MISTRAL_API_KEY / MODEL_API_KEY)
//   2. .apikey.yaml at repo root, with the same formats
//   3. MISTRAL_API_KEY / MODEL_API_KEY environment variables
//   4. apps/server/config/config.local.json models["mistral.ai"].apiKey
//
// The key is never printed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { DefaultModelClient } from "./src/defaultModelClient.js";
import {
    decideBySimilarity,
    defaultMemoryDecisionPolicy,
    normalizeMemoryText,
    rankSimilarMemories,
    type MemoryRetainedRecord,
} from "@ss-ai/persona-flow";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const provider = "mistral.ai";
const model = process.argv[2] ?? "mistral-embed";
const embeddingVersion = 1;

const candidateText = "用户喜欢玩开放世界游戏，尤其喜欢和朋友一起探索地图。";
const memoryTexts = [
    "用户喜欢玩游戏，也喜欢探索开放世界。",
    "用户住在东京，经常坐电车通勤。",
    "用户不喜欢咖啡，更偏好热茶。",
    "用户最近在学习 TypeScript 和 Vue。",
];
const inputs = [candidateText, ...memoryTexts];

function stripYamlScalar(rawValue: string): string {
    const withoutComment = rawValue.replace(/\s+#.*$/, "").trim();
    if ((withoutComment.startsWith('"') && withoutComment.endsWith('"'))
        || (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
        return withoutComment.slice(1, -1).trim();
    }
    return withoutComment;
}

function readApiKeyFromYaml(filePath: string): string | undefined {
    if (!existsSync(filePath)) return undefined;
    const raw = readFileSync(filePath, "utf8");
    const match = raw.match(/^\s*(apiKey|mistralApiKey|MISTRAL_API_KEY|MODEL_API_KEY)\s*:\s*(.+?)\s*$/m);
    const value = match ? stripYamlScalar(match[2] ?? "") : stripYamlScalar(raw);
    return value.length > 0 ? value : undefined;
}

function readApiKeyFromServerLocalConfig(filePath: string): string | undefined {
    if (!existsSync(filePath)) return undefined;
    const raw = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw) as {
        models?: Record<string, { apiKey?: string }>;
    };
    const value = parsed.models?.[provider]?.apiKey?.trim() ?? "";
    return value.length > 0 ? value : undefined;
}

function resolveApiKey(): { apiKey: string; source: string } {
    const yamlPath = path.join(repoRoot, "apps", "prompt-debug-cli", ".apikey.yaml");
    const yamlKey = readApiKeyFromYaml(yamlPath);
    if (yamlKey) return { apiKey: yamlKey, source: "apps/prompt-debug-cli/.apikey.yaml" };

    const rootYamlPath = path.join(repoRoot, ".apikey.yaml");
    const rootYamlKey = readApiKeyFromYaml(rootYamlPath);
    if (rootYamlKey) return { apiKey: rootYamlKey, source: ".apikey.yaml" };

    const envKey = process.env.MISTRAL_API_KEY?.trim() || process.env.MODEL_API_KEY?.trim();
    if (envKey) return { apiKey: envKey, source: "environment" };

    const localConfigPath = path.join(repoRoot, "apps", "server", "config", "config.local.json");
    const localConfigKey = readApiKeyFromServerLocalConfig(localConfigPath);
    if (localConfigKey) return { apiKey: localConfigKey, source: "apps/server/config/config.local.json" };

    throw new Error("Missing API key. Set apps/prompt-debug-cli/.apikey.yaml, .apikey.yaml, MISTRAL_API_KEY, or apps/server/config/config.local.json models['mistral.ai'].apiKey.");
}

function toMemoryRecord(text: string, vector: number[], index: number, responseModel: string): MemoryRetainedRecord {
    const now = new Date().toISOString();
    return {
        id: `probe-memory-${index + 1}`,
        userId: "probe-user",
        characterId: "probe-character",
        scope: "user",
        type: "preference",
        text,
        normalizedText: normalizeMemoryText(text),
        relatedEntities: [],
        tags: ["probe"],
        status: "active",
        importance: 1,
        embedding: {
            vector,
            provider,
            model: responseModel,
            dim: vector.length,
            version: embeddingVersion,
            createdAt: now,
        },
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
    };
}

const { apiKey, source } = resolveApiKey();
const client = new DefaultModelClient({
    providerConfigs: {
        [provider]: {
            provider,
            apiUrl: "https://api.mistral.ai",
        },
    },
    timeoutMs: 60_000,
    maxRetries: 0,
});

console.log("Mistral embed similarity probe");
console.log(`keySource: ${source}`);
console.log(`model: ${model}`);
console.log(`inputCount: ${inputs.length}`);
console.log(`candidate: ${candidateText}`);

const startedAt = performance.now();
try {
    const result = await client.embed({
        provider,
        model,
        encryptedApiKey: apiKey,
        inputs,
    });
    const elapsedMs = Math.round(performance.now() - startedAt);
    const candidateVector = result.vectors[0];
    const memoryVectors = result.vectors.slice(1);
    if (!candidateVector || memoryVectors.length !== memoryTexts.length) {
        throw new Error(`Unexpected embedding count: got ${result.vectors.length}, expected ${inputs.length}`);
    }

    const dim = candidateVector.length;
    const memories = memoryTexts.map((text, index) => toMemoryRecord(text, memoryVectors[index]!, index, result.model));
    const ranked = rankSimilarMemories(candidateVector, memories, {
        topK: defaultMemoryDecisionPolicy.topK,
        requireSignature: {
            provider,
            model: result.model,
            dim,
            version: embeddingVersion,
        },
    });
    const decision = decideBySimilarity(ranked, defaultMemoryDecisionPolicy);
    const rankedWithoutClosest = rankSimilarMemories(candidateVector, memories.slice(1), {
        topK: defaultMemoryDecisionPolicy.topK,
        requireSignature: {
            provider,
            model: result.model,
            dim,
            version: embeddingVersion,
        },
    });
    const decisionWithoutClosest = decideBySimilarity(rankedWithoutClosest, defaultMemoryDecisionPolicy);

    console.log(`elapsedMs: ${elapsedMs}`);
    console.log(`returnedModel: ${result.model}`);
    console.log(`dim: ${dim}`);
    console.log(`usagePromptTokens: ${result.usage?.promptTokens ?? "n/a"}`);
    console.log(`usageTotalTokens: ${result.usage?.totalTokens ?? "n/a"}`);
    console.log("ranked:");
    for (const entry of ranked) {
        console.log(`  ${entry.similarity.toFixed(4)}  ${entry.memory.id}  ${entry.memory.text}`);
    }
    console.log("decision:", JSON.stringify(decision));
    console.log("decisionWithoutClosest:", JSON.stringify(decisionWithoutClosest));
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Probe failed:", message);
    process.exitCode = 1;
}

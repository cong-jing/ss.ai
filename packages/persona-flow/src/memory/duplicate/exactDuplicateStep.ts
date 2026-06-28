import type { MemoryCandidateRecord } from "../candidate/candidateTypes.js";
import type {
    ActiveMemoryRecord,
    MemoryStore,
} from "../stores/activeMemoryStorePort.js";

/**
 * Exact-duplicate detection stage.
 *
 * Runs before embedding so we can avoid burning embedding budget on
 * inputs whose `normalizedText` already matches a live memory in
 * the same (user, character, scope, type) bucket. Uses
 * `findExactActiveMemory` on the store so the deduplication policy
 * lives in one place (here) instead of leaking into every store
 * adapter.
 */
export async function checkExactDuplicate(
    candidate: MemoryCandidateRecord,
    memoryStore: MemoryStore,
): Promise<ActiveMemoryRecord | undefined> {
    const match = await memoryStore.findExactActiveMemory({
        userId: candidate.source.userId,
        characterId: candidate.source.characterId,
        scope: candidate.scope,
        type: candidate.type,
        normalizedText: candidate.normalizedText,
    });
    return match;
}

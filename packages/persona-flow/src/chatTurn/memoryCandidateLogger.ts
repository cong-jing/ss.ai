import type { MemoryWriteCandidate, ModelCallPurpose } from "@ss-ai/contracts";
import type { PersonaFlowLogger } from "./personaFlowLogger.js";

export interface LogMemoryCandidatesInput {
    requestId: string;
    userId: string;
    characterId: string;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    modelCallPurpose: ModelCallPurpose;
    candidates: MemoryWriteCandidate[];
}

/**
 * Batch 1 memory candidate handling: log only. Storage, judge, dedup,
 * and downstream API surfacing are intentionally out of scope.
 *
 * The caller is expected to wrap this in try/catch so that logging
 * failures never roll back the persisted assistant turn or fail the
 * chat HTTP response.
 */
export function logMemoryWriteCandidates(
    logger: PersonaFlowLogger,
    input: LogMemoryCandidatesInput,
): void {
    if (input.candidates.length === 0) {
        return;
    }

    logger.info("persona-flow/memory: candidates logged", {
        requestId: input.requestId,
        userId: input.userId,
        characterId: input.characterId,
        conversationId: input.conversationId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        modelCallPurpose: input.modelCallPurpose,
        candidateCount: input.candidates.length,
        candidates: input.candidates,
        decision: "logged_only",
        todo: "memory judge and persistence are not implemented yet",
    });
}

import type {
    MemoryCandidateRecord,
    MemoryCandidateStatus,
} from "../candidate/candidateTypes.js";
import type { MemoryCandidateStore } from "../candidate/candidatePorts.js";
import type { MemoryClock } from "../types.js";
import type {
    MemoryDecisionKind,
    MemoryDecisionRecord,
    MemoryDecisionStore,
    MemorySimilaritySummaryEntry,
} from "./decisionPorts.js";

/**
 * Atomic-from-the-caller's-perspective "transition this candidate
 * and write a decision row" helper.
 *
 * Split out of the processor so every decision branch (low-value,
 * duplicate, embedding-failed, needs-judge, create, error) flows
 * through one helper with the same arguments and the same write
 * order. That makes accidental drift between branches â€?e.g. one
 * branch forgetting to bump `updatedAt`, or another forgetting to
 * persist `similarity` â€?impossible.
 */
export interface RecordDecisionInput {
    candidate: MemoryCandidateRecord;
    decision: MemoryDecisionKind;
    candidateStatus: MemoryCandidateStatus;
    memoryId?: string;
    reason?: string;
    similarity?: MemorySimilaritySummaryEntry[];
    policyVersion: number;
}

export interface MemoryDecisionRecorderDeps {
    candidateStore: MemoryCandidateStore;
    decisionStore: MemoryDecisionStore;
    clock: MemoryClock;
}

export class MemoryDecisionRecorder {
    constructor(private readonly deps: MemoryDecisionRecorderDeps) { }

    async record(input: RecordDecisionInput): Promise<MemoryDecisionRecord> {
        const now = this.deps.clock.nowIso();
        await this.deps.candidateStore.updateCandidateStatus({
            candidateId: input.candidate.id,
            status: input.candidateStatus,
            reason: input.reason,
            updatedAt: now,
        });
        return await this.deps.decisionStore.appendDecision({
            candidateId: input.candidate.id,
            userId: input.candidate.source.userId,
            characterId: input.candidate.source.characterId,
            decision: input.decision,
            memoryId: input.memoryId,
            reason: input.reason,
            similarity: input.similarity ?? [],
            policyVersion: input.policyVersion,
            createdAt: now,
        });
    }
}

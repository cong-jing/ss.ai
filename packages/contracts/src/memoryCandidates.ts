export const MEMORY_SCOPES = [
    "user",
    "character",
    "relationship",
    "conversation",
    "world",
] as const;

export type MemoryScope = typeof MEMORY_SCOPES[number];

export const MEMORY_CANDIDATE_TYPES = [
    "fact",
    "preference",
    "event",
    "relationship",
    "task_state",
    "setting",
    "instruction",
    "summary",
] as const;

export type MemoryCandidateType = typeof MEMORY_CANDIDATE_TYPES[number];

export interface MemoryWriteCandidate {
    text: string;
    scope: MemoryScope;
    type: MemoryCandidateType;
    relatedEntities?: string[];
    tags?: string[];
    reason?: string;
}

export interface SubmitMemoryCandidatesArgs {
    candidates: MemoryWriteCandidate[];
}

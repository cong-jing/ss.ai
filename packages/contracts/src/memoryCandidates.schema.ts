import { z } from "zod";
import {
    MEMORY_CANDIDATE_TYPES,
    MEMORY_SCOPES,
} from "./memoryCandidates.js";

export type {
    MemoryCandidateType,
    MemoryScope,
    MemoryWriteCandidate,
    SubmitMemoryCandidatesArgs,
} from "./memoryCandidates.js";

export const MemoryWriteCandidateSchema = z.object({
    text: z.string().trim().min(1),
    scope: z.enum(MEMORY_SCOPES),
    type: z.enum(MEMORY_CANDIDATE_TYPES),
    relatedEntities: z.array(z.string().trim().min(1)).optional(),
    tags: z.array(z.string().trim().min(1)).optional(),
    reason: z.string().trim().min(1).optional(),
});

export const SubmitMemoryCandidatesArgsSchema = z.object({
    candidates: z.array(MemoryWriteCandidateSchema).max(5),
});

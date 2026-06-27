/**
 * Memory write subsystem — public entrypoint.
 *
 * Re-exports all types, ports, and pure algorithms in Step 1. As
 * later steps add `MemoryCandidateRecorder` and `MemoryCommitService`
 * they should be re-exported from here as well so the rest of the
 * codebase only ever imports from `"@ss-ai/persona-flow/memory"` via
 * the package root barrel.
 */

export * from "./types.js";
export * from "./ports.js";
export * from "./textNormalization.js";
export * from "./similarity.js";
export * from "./decisionPolicy.js";

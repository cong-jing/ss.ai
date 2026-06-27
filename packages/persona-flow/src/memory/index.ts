/**
 * Memory write subsystem — public entrypoint.
 *
 * Re-exports all types, ports, pure algorithms, and the services
 * built on top of them. The rest of the codebase should import only
 * from `"@ss-ai/persona-flow/memory"` (via the package root barrel)
 * so we never depend on internal file layout.
 */

export * from "./types.js";
export * from "./ports.js";
export * from "./textNormalization.js";
export * from "./similarity.js";
export * from "./decisionPolicy.js";
export * from "./candidateRecorder.js";
export * from "./commitService.js";
export * from "./featureConfig.js";

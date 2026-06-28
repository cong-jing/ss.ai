/**
 * Memory write subsystem — public entrypoint.
 *
 * The implementation lives under `./memoryPipeline/**`. This file
 * exists only as the stable import path the rest of the codebase
 * and dependent packages target (`@ss-ai/persona-flow` re-exports
 * everything from here through the package barrel).
 *
 * Internal layout under `memoryPipeline/` may move freely; consumers
 * must never reach past this barrel.
 */

export * from "./memoryPipeline/index.js";

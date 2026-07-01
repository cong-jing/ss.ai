import type { ModelRuntime } from "../modelRuntime.js";
import type { MemoryConsolidationJudgeProvider } from "../../memory/consolidation/consolidationPorts.js";
import type {
    MemoryConsolidationJudgeInput,
    MemoryConsolidationJudgeResult,
} from "../../memory/consolidation/consolidationTypes.js";
import { memoryConsolidateCall } from "./memoryConsolidateCall.js";

export interface MemoryConsolidationJudgeProviderAdapterOptions {
    runtime: ModelRuntime;
    userId: string;
    characterId: string;
}

/**
 * Composition-layer adapter: implements the memory core's
 * `MemoryConsolidationJudgeProvider` port by delegating to the
 * `memory.consolidate` model call. Memory core stays provider-free;
 * this adapter binds a runtime + identity to the call.
 */
export function createMemoryConsolidationJudgeProvider(
    options: MemoryConsolidationJudgeProviderAdapterOptions,
): MemoryConsolidationJudgeProvider {
    return {
        async judge(input: MemoryConsolidationJudgeInput): Promise<MemoryConsolidationJudgeResult> {
            return memoryConsolidateCall.run({
                runtime: options.runtime,
                userId: options.userId,
                characterId: options.characterId,
                judgeInput: input,
            });
        },
    };
}

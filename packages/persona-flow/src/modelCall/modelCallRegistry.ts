import type { InteractionMode, ModelCallPurpose } from "@ss-ai/contracts";
import { DEFAULT_INTERACTION_MODE } from "@ss-ai/contracts";
import type { ModelCall } from "./modelCall.js";
import { singleCharacterChatCall } from "./chat.main/singleCharacterChat/singleCharacterChatCall.js";

type ModeSelector = InteractionMode | "*";
export type ModelCallKey = `${ModelCallPurpose}:${ModeSelector}`;

const modelCallRegistry: Partial<Record<ModelCallKey, ModelCall>> = {
    "chat.main:single_character_chat": singleCharacterChatCall,
};

export function resolveModelCall(input: {
    purpose: ModelCallPurpose;
    interactionMode?: InteractionMode;
}): ModelCall {
    const resolvedMode = input.interactionMode ?? DEFAULT_INTERACTION_MODE;
    const exactKey = `${input.purpose}:${resolvedMode}` as ModelCallKey;
    const wildcardKey = `${input.purpose}:*` as ModelCallKey;

    const resolved = modelCallRegistry[exactKey] ?? modelCallRegistry[wildcardKey];
    if (!resolved) {
        throw new Error(`Model call is not registered for ${input.purpose} / ${resolvedMode}.`);
    }
    return resolved;
}

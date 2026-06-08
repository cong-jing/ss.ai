import type {
    ModelGenerationInput,
    ModelStreamCallbacks,
    ModelStreamResult,
    ModelToolCall,
} from "@ss-ai/persona-flow";

export async function generateFakeSubmitTurnEventsStream(
    _input: ModelGenerationInput,
    callbacks?: ModelStreamCallbacks,
): Promise<ModelStreamResult> {
    const functionName = "submit_turn_events";
    const toolCallId = "fake-submit-turn-events";
    const text = [
        "这是一个本地 fake stream 回复，用来确认前端是不是会平滑地一点点吐字。",
        "We are mixing English words on purpose so the UI can reveal them word by word.",
        "日本語の文も入れて、かなと漢字が一文字ずつ自然に見えるかを確認します。",
        "最后 done 事件仍然会回传完整的 turnEvents and the canonical final output.",
    ].join(" ");
    const argumentsText = JSON.stringify({
        events: [
            {
                type: "replyText",
                characterId: "fake-character",
                text,
            },
            {
                type: "expression",
                characterId: "fake-character",
                expression: "happy",
                intensity: 0.7,
            },
        ],
    });
    const chunkCount = 20;
    const delayMs = 500;
    const chunkSize = Math.ceil(argumentsText.length / chunkCount);
    let argumentsBuffer = "";

    for (let index = 0; index < argumentsText.length; index += chunkSize) {
        const argumentsDelta = argumentsText.slice(index, index + chunkSize);
        argumentsBuffer += argumentsDelta;
        callbacks?.onToolCallDelta?.({
            id: index === 0 ? toolCallId : undefined,
            type: index === 0 ? "function" : undefined,
            index: 0,
            functionNameDelta: index === 0 ? functionName : undefined,
            argumentsDelta,
        });
        await delay(delayMs);
    }

    const toolCall: ModelToolCall = {
        id: toolCallId,
        type: "function",
        index: 0,
        functionName,
        arguments: argumentsBuffer,
    };
    callbacks?.onToolCall?.(toolCall);

    return {
        output: "",
        toolCalls: [toolCall],
        completed: true,
        finishReason: "tool_calls",
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

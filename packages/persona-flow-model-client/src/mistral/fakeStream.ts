import type {
    ModelGenerationInput,
    ModelStreamCallbacks,
    ModelStreamResult,
} from "@ss-ai/persona-flow";

export async function generateFakeSubmitTurnEventsStream(
    _input: ModelGenerationInput,
    callbacks?: ModelStreamCallbacks,
): Promise<ModelStreamResult> {
    const text = [
        "这是一个本地 fake stream 回复，用来确认前端是不是会平滑地一点点吐字。",
        "We are mixing English words on purpose so the UI can reveal them word by word.",
        "日本語の文も入れて、かなと漢字が一文字ずつ自然に見えるかを確認します。",
        "最后 done 事件仍然会回传完整的 turnEvents and the canonical final output.",
    ].join(" ");
    const structuredObject = {
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
    };
    const jsonText = JSON.stringify(structuredObject);
    const chunkCount = 20;
    const delayMs = 500;
    const chunkSize = Math.ceil(jsonText.length / chunkCount);
    let output = "";

    for (let index = 0; index < jsonText.length; index += chunkSize) {
        const textDelta = jsonText.slice(index, index + chunkSize);
        output += textDelta;
        callbacks?.onTextDelta?.(textDelta);
        await delay(delayMs);
    }

    return {
        output,
        structuredOutput: structuredObject,
        toolCalls: [],
        completed: true,
        finishReason: "stop",
    };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

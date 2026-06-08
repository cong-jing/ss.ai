// Usage: node mistral-stream-probe.mjs [model] [mode]
// mode: tool | text | structured

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const cfg = JSON.parse(readFileSync(new URL("../../apps/server/config/config.local.json", import.meta.url), "utf8"));
const apiKey = cfg.models["mistral.ai"].apiKey;

const { Mistral } = await import("@mistralai/mistralai");
const client = new Mistral({ apiKey });

const MODEL = process.argv[2] ?? "mistral-small-latest";
const MODE = process.argv[3] ?? "structured";

const tools = [{
    type: "function",
    function: {
        name: "submit_turn_events",
        description: "Submit turn events.",
        parameters: {
            type: "object",
            properties: {
                events: { type: "array", items: { type: "object", properties: { type: { type: "string" }, text: { type: "string" } }, required: ["type", "text"] } }
            },
            required: ["events"],
        },
    },
}];

// The SDK's outbound schema maps `schemaDefinition` → `schema` on the wire
const structuredSchema = {
    type: "json_schema",
    jsonSchema: {
        name: "submit_turn_events",
        schemaDefinition: {
            type: "object",
            properties: {
                events: { type: "array", items: { type: "object", properties: { type: { type: "string" }, text: { type: "string" } }, required: ["type", "text"] } }
            },
            required: ["events"],
        },
        strict: true,
    },
};

const systemMsg = MODE === "structured"
    ? "You output JSON matching the schema. Put the full Chinese text split into 5 events."
    : MODE === "tool"
        ? "You MUST call submit_turn_events with at least 5 events whose text fields together form a long Chinese paragraph."
        : "You are a helpful assistant.";

const messages = [
    { role: "system", content: systemMsg },
    { role: "user", content: "请背诵诸葛亮的出师表前段（约300字），拆成5个 events，每个 event 的 type 填 replyText。" },
];

console.log(`Probe: model=${MODEL}, mode=${MODE}`);
const t0 = performance.now();

const requestParams = {
    model: MODEL,
    messages,
    ...(MODE === "tool" ? { tools, toolChoice: "any" } : {}),
    ...(MODE === "structured" ? { responseFormat: structuredSchema } : {}),
};

const stream = await client.chat.stream(requestParams);

let chunkIdx = 0;
let firstChunkAt = null;
let totalArgBytes = 0;
let totalTextBytes = 0;
for await (const event of stream) {
    const now = performance.now();
    if (firstChunkAt == null) firstChunkAt = now;
    const data = event.data ?? event;
    const choice = data?.choices?.[0];
    const delta = choice?.delta;
    const text = typeof delta?.content === "string" ? delta.content : "";
    const toolCalls = delta?.toolCalls ?? delta?.tool_calls ?? [];
    let argBytes = 0;
    for (const tc of toolCalls) {
        const a = tc?.function?.arguments;
        if (typeof a === "string") argBytes += a.length;
    }
    totalArgBytes += argBytes;
    totalTextBytes += text.length;
    if (text || argBytes) {
        console.log(`[chunk ${chunkIdx}] +${(now - t0).toFixed(0)}ms  text=${text.length}b  args=${argBytes}b`);
    }
    chunkIdx++;
}

const tEnd = performance.now();
console.log(`\nDone. totalChunks=${chunkIdx} totalTextBytes=${totalTextBytes} totalArgBytes=${totalArgBytes}`);
console.log(`Timing: msToFirstChunk=${firstChunkAt ? (firstChunkAt - t0).toFixed(0) : "null"}  msTotal=${(tEnd - t0).toFixed(0)}`);

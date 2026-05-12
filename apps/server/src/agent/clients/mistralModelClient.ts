import type { CommonRoleplayTurnOutput } from "@ss-ai/persona-flow";
import { z } from "zod";
import type { ModelClient, ModelGenerationInput } from "../types.js";
import type { Mistral as MistralSDKClient } from "@mistralai/mistralai";

type MistralSDKModule = typeof import("@mistralai/mistralai");

interface MistralModelClientOptions {
    apiKey: string;
    apiUrl: string;
    model: string;
}

const mistralStructuredOutputSchema = z.object({
    action: z.enum(["reply", "skip"]),
    replyText: z.string(),
    control: z.object({
        summarizeSuggested: z.boolean(),
        summarizeReason: z.string(),
        summarizeUrgency: z.enum(["none", "low", "normal", "high"]),
    }),
    skip: z.object({
        reasonCode: z.enum([
            "none",
            "not_addressed",
            "low_value",
            "rate_control",
            "character_busy",
            "waiting_for_others",
            "other",
        ]),
        reason: z.string(),
    }),
}).strict();

export class MistralModelClient implements ModelClient {
    private clientPromise: Promise<MistralSDKClient> | null = null;

    constructor(private readonly options: MistralModelClientOptions) { }

    private async getClient(): Promise<MistralSDKClient> {
        if (!this.clientPromise) {
            const dynamicImport = new Function("modulePath", "return import(modulePath)") as (modulePath: string) => Promise<MistralSDKModule>;

            this.clientPromise = dynamicImport("@mistralai/mistralai").then((sdkModule) => {
                const mistral = new sdkModule.Mistral({
                    apiKey: this.options.apiKey,
                    serverURL: this.options.apiUrl
                });

                return mistral;
            });
        }

        return this.clientPromise;
    }

    private extractText(response: unknown): string {
        const responseWithChoices = response as {
            choices?: Array<{
                message?: {
                    content?: unknown;
                };
            }>;
        };

        const content = responseWithChoices.choices?.[0]?.message?.content;

        if (typeof content === "string" && content.trim()) {
            return content;
        }

        if (Array.isArray(content)) {
            const text = content
                .map((item) => {
                    if (typeof item === "string") {
                        return item;
                    }

                    if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
                        return item.text;
                    }

                    return "";
                })
                .join("")
                .trim();

            if (text) {
                return text;
            }
        }

        throw new Error("Mistral response did not contain text content.");
    }

    private toSdkMessages(input: ModelGenerationInput) {
        return input.messages.map(m => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
        }));
    }

    private async withTimeout<T>(work: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> {
        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([work, timeoutPromise]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }

    private extractStructuredOutput(response: unknown): CommonRoleplayTurnOutput {
        const responseWithChoices = response as {
            choices?: Array<{
                message?: {
                    parsed?: unknown;
                    content?: unknown;
                };
            }>;
        };

        const message = responseWithChoices.choices?.[0]?.message;
        const parsedCandidate = message?.parsed;
        if (parsedCandidate) {
            const parsed = mistralStructuredOutputSchema.safeParse(parsedCandidate);
            if (parsed.success) {
                return parsed.data;
            }
        }

        const content = message?.content;
        if (typeof content === "string" && content.trim()) {
            const parsedJson = JSON.parse(content);
            return mistralStructuredOutputSchema.parse(parsedJson);
        }

        throw new Error("Mistral structured response did not contain parsable JSON content.");
    }

    async generateNonStructured(input: ModelGenerationInput): Promise<string> {
        const client = await this.getClient();

        const response = await this.withTimeout(
            client.chat.complete({
                model: this.options.model,
                messages: this.toSdkMessages(input),
                responseFormat: { type: "text" },
            }),
            input.timeoutMs,
            "Mistral non-structured request",
        );

        return this.extractText(response);
    }

    async generateStructured(input: ModelGenerationInput): Promise<CommonRoleplayTurnOutput> {
        const client = await this.getClient();

        const response = await this.withTimeout(
            client.chat.parse({
                model: this.options.model,
                messages: this.toSdkMessages(input),
                responseFormat: mistralStructuredOutputSchema,
            }),
            input.timeoutMs,
            "Mistral structured request",
        );

        return this.extractStructuredOutput(response);
    }

    async listModels(): Promise<string[]> {
        const client = await this.getClient();
        const response = await client.models.list();
        const items = Array.isArray(response?.data) ? response.data : [];

        const names = items
            .map((item) => {
                if (item && typeof item === "object" && "id" in item) {
                    const idValue = (item as { id?: unknown }).id;
                    return typeof idValue === "string" ? idValue : "";
                }

                return "";
            })
            .filter((name) => Boolean(name));

        return names;
    }
}
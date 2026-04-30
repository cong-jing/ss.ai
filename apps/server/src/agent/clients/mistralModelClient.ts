import { ModelClient, HistoryMessage } from "../types.js";
import type { Mistral as MistralSDKClient } from "@mistralai/mistralai";

type MistralSDKModule = typeof import("@mistralai/mistralai");

interface MistralModelClientOptions {
    apiKey: string;
    apiUrl: string;
    model: string;
}

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

    async generate(input: {
        prompt: string;
        history?: HistoryMessage[];
        timeoutMs: number;
    }): Promise<string> {
        const client = await this.getClient();

        let timeoutHandle: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`Mistral request timed out after ${input.timeoutMs}ms`));
            }, input.timeoutMs);
        });

        try {
            const historyMessages = (input.history ?? []).map(m => ({
                role: m.role as "user" | "assistant",
                content: m.content
            }));

            const completionPromise = client.chat.complete({
                model: this.options.model,
                messages: [
                    ...historyMessages,
                    {
                        role: "user",
                        content: input.prompt
                    }
                ],
                responseFormat: {
                    type: "text"
                }
            });

            const response = await Promise.race([completionPromise, timeoutPromise]);
            return this.extractText(response);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
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
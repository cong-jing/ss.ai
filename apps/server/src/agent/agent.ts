import { getGlobalLogger } from "../util/logger.js";
import { PromptLogger } from "../util/promptLog.js";
import { PlaceholderModelClient } from "./clients/placeholderModelClient.js";
import { AgentConfig, ChatRequest, ChatResponse, GenerationMode, ModelClient } from "./types.js";

export interface AgentDependencies {
    modelClient?: ModelClient;
    promptLogger?: PromptLogger;
}

export class AgentService {
    private readonly logger = getGlobalLogger();
    private readonly modelClient: ModelClient;
    private readonly promptLogger: PromptLogger;

    constructor(
        private readonly config: AgentConfig,
        dependencies: AgentDependencies = {}
    ) {
        this.modelClient = dependencies.modelClient ?? new PlaceholderModelClient();
        this.promptLogger = dependencies.promptLogger ?? PromptLogger.disabled();
    }

    async chat(request: ChatRequest): Promise<ChatResponse> {
        const requestId = crypto.randomUUID();
        const mode: GenerationMode = request.mode ?? "non-structured";

        this.logger.verbose("Agent chat: sending messages to LLM", {
            requestId,
            mode,
            messages: request.messages,
        });

        let output = "";
        let structuredOutput: ChatResponse["structuredOutput"];

        if (mode === "structured") {
            structuredOutput = await this.modelClient.generateStructured({
                messages: request.messages,
                timeoutMs: this.config.timeoutMs,
            });

            output = structuredOutput.action === "reply"
                ? structuredOutput.replyText
                : "";
        } else {
            output = await this.modelClient.generateNonStructured({
                messages: request.messages,
                timeoutMs: this.config.timeoutMs,
            });
        }

        this.logger.verbose("Agent chat: completed", { requestId, mode, output, structuredOutput });

        const loggedOutput = structuredOutput
            ? JSON.stringify(structuredOutput, null, 2)
            : output;

        this.promptLogger.write({
            timestamp: new Date().toISOString(),
            requestId,
            model: this.config.model,
            messages: request.messages,
            output: loggedOutput,
        });

        return {
            output,
            model: this.config.model,
            requestId,
            mode,
            ...(structuredOutput ? { structuredOutput } : {}),
        };
    }

    async listModels(): Promise<string[]> {
        return this.modelClient.listModels();
    }
}

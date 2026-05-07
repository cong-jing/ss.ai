import { getGlobalLogger } from "../util/logger.js";
import { PromptLogger } from "../util/promptLog.js";
import { PlaceholderModelClient } from "./clients/placeholderModelClient.js";
import { AgentConfig, ChatRequest, ChatResponse, ModelClient } from "./types.js";

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

        this.logger.verbose("Agent chat: sending messages to LLM", {
            requestId,
            messages: request.messages,
        });

        const output = await this.modelClient.generate({
            messages: request.messages,
            timeoutMs: this.config.timeoutMs,
        });

        this.logger.verbose("Agent chat: completed", { requestId, output });

        this.promptLogger.write({
            timestamp: new Date().toISOString(),
            requestId,
            model: this.config.model,
            messages: request.messages,
            output,
        });

        return {
            output,
            model: this.config.model,
            requestId,
        };
    }

    async listModels(): Promise<string[]> {
        return this.modelClient.listModels();
    }
}

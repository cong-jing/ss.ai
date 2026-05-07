import { getGlobalLogger } from "../util/logger.js";
import { PlaceholderModelClient } from "./clients/placeholderModelClient.js";
import { AgentConfig, ChatRequest, ChatResponse, ModelClient } from "./types.js";

export interface AgentDependencies {
    modelClient?: ModelClient;
}

export class AgentService {
    private readonly logger = getGlobalLogger();
    private readonly modelClient: ModelClient;

    constructor(
        private readonly config: AgentConfig,
        dependencies: AgentDependencies = {}
    ) {
        this.modelClient = dependencies.modelClient ?? new PlaceholderModelClient();
    }

    async chat(request: ChatRequest): Promise<ChatResponse> {
        const requestId = crypto.randomUUID();

        this.logger.debug("Agent chat: sending messages to LLM", {
            requestId,
            messages: request.messages,
        });

        const output = await this.modelClient.generate({
            messages: request.messages,
            timeoutMs: this.config.timeoutMs,
        });

        this.logger.debug("Agent chat: completed", { requestId, output });

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

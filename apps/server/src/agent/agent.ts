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
        if (!request.prompt?.trim()) {
            throw new Error("Prompt must not be empty");
        }

        const requestId = crypto.randomUUID();
        const output = await this.modelClient.generate({
            prompt: request.prompt,
            history: request.history,
            timeoutMs: this.config.timeoutMs
        });

        this.logger.debug("Agent chat request completed", {
            requestId,
            prompt: request.prompt,
            output,
            history: request.history
        });

        return {
            output,
            model: this.config.model,
            requestId
        };
    }

    async listModels(): Promise<string[]> {
        return this.modelClient.listModels();
    }
}

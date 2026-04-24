import { noopLogger, PlaceholderModelClient } from "./defaults";
import { AgentConfig, ChatRequest, ChatResponse, Logger, ModelClient } from "./types";

export interface AgentDependencies {
    logger?: Logger;
    modelClient?: ModelClient;
}

export class AgentService {
    private readonly logger: Logger;
    private readonly modelClient: ModelClient;

    constructor(
        private readonly config: AgentConfig,
        dependencies: AgentDependencies = {}
    ) {
        this.logger = dependencies.logger ?? noopLogger;
        this.modelClient = dependencies.modelClient ?? new PlaceholderModelClient();
    }

    async chat(request: ChatRequest): Promise<ChatResponse> {
        if (!request.prompt?.trim()) {
            throw new Error("Prompt must not be empty");
        }

        const requestId = crypto.randomUUID();
        this.logger.info("Agent chat request received", {
            requestId,
            model: this.config.model,
            sessionId: request.sessionId
        });

        const output = await this.modelClient.generate({
            prompt: request.prompt,
            sessionId: request.sessionId,
            timeoutMs: this.config.timeoutMs
        });

        this.logger.info("Agent chat request completed", { requestId });

        return {
            output,
            model: this.config.model,
            requestId
        };
    }
}

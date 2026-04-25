import { ApiChat } from "../../../shared/contracts/httpApi";
import { registerApi } from "../registerApi";
import { toErrorResponse, type HttpApiContext } from "./apiContext";

export function registerChatRoute(context: HttpApiContext): void {
    registerApi(context.app, ApiChat, async ({ body }) => {
        const prompt = body?.prompt;
        const sessionId = body?.sessionId;

        context.logger.info("chat: request received", {
            promptLength: typeof prompt === "string" ? prompt.length : 0,
            hasSessionId: Boolean(sessionId)
        });

        const runtimeAgentService = context.createAgentServiceFromUserSettings();
        context.logger.info("chat: runtime agent created from user settings");

        const response = await runtimeAgentService.chat({
            prompt,
            sessionId
        });

        context.logger.info("chat: completed", {
            requestPromptLength: typeof prompt === "string" ? prompt.length : 0,
            model: response.model,
            requestId: response.requestId
        });

        return response;
    }, {
        onError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat: failed", {
                message: response.message
            });

            return {
                status: 400,
                body: response
            };
        }
    });
}

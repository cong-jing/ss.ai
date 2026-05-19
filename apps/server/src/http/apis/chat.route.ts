import {
    ApiChat,
    ApiChatDryRun,
    ApiDeleteMessage,
    ApiChatStream,
    ApiGetMessages,
    type ChatDryRunRequest,
    type ChatRequest,
} from "@ss-ai/contracts";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, type HttpApiContext } from "./apiContext.js";
import { handleDryRunChatRequest } from "./chat/dryRunService.js";
import { handleDeleteConversationMessage, handleGetConversationMessages } from "./chat/messageService.js";
import { handleNonStreamChatRequest } from "./chat/nonStreamService.js";
import { getStatusCode } from "./chat/chatUtil.js";
import { handleStreamChatRequest } from "./chat/streamService.js";

export function registerChatRoute(context: HttpApiContext): void {
    registerApi(context.app, ApiChat, {
        handleRequest: (_, body) => handleNonStreamChatRequest(context, body as ChatRequest & { userId?: string }),
        handleError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat: failed", { message: response.message });
            return { status: getStatusCode(error), body: response };
        }
    });

    context.app.post(ApiChatStream.apiUrl, (req, res) => handleStreamChatRequest(context, req, res));

    // Dry-run endpoint: assembles the prompt without calling the LLM or persisting anything
    registerApi(context.app, ApiChatDryRun, {
        handleRequest: (_, body) => handleDryRunChatRequest(context, body as ChatDryRunRequest & { userId?: string }),
        handleError: (error) => {
            const response = toErrorResponse(error);
            context.logger.error("chat/dry-run: failed", { message: response.message });
            return { status: getStatusCode(error), body: response };
        }
    });

    // GET /v1/conversations/:id/messages
    registerApi(context.app, ApiGetMessages, {
        handleRequest: (req) => handleGetConversationMessages(context, req.params.id),
        handleError: (error) => ({ status: 404, body: toErrorResponse(error) }),
    });

    // DELETE /v1/conversations/:id/messages/:messageId
    registerApi(context.app, ApiDeleteMessage, {
        handleRequest: (req) => handleDeleteConversationMessage(context, req.params.id, req.params.messageId),
        handleError: (error) => ({ status: getStatusCode(error, 404), body: toErrorResponse(error) }),
    });
}

import { ApiDefine } from "../apiBase";

export interface ChatRequest {
    prompt: string;
    sessionId?: string;
}

export interface ChatResponse {
    output: string;
    model: string;
    requestId: string;
}

export const ApiChat = new ApiDefine<ChatRequest, ChatResponse>("/v1/chat", "POST");

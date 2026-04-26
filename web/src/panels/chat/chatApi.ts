import { ApiChat } from "../../../../shared/contracts/httpApi";
import { callApi } from "../../shared/api/httpClient";

export async function sendChatMessage(prompt: string, sessionId?: string) {
    return callApi(ApiChat, { prompt, sessionId });
}

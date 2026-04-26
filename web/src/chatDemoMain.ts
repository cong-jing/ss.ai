import "./styles.css";
import type { ChatScrollItem } from "./ui/components/chatScrollView";
import { createDummyMessages } from "./dummy/createDummyMessages";
import { ChatView } from "./ui/chatView";

function createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createAssistantReply(source: string): string {
    return `你刚才输入的是：${source}。这是用于演示 streaming 更新的假回复文本，内容会逐步出现。`;
}

function bootstrap(): void {
    const app = document.getElementById("app");
    if (!app) {
        throw new Error("#app not found");
    }

    let oldestSeed = 1000;
    const initialMessages = createDummyMessages(500, oldestSeed);
    oldestSeed -= 20;

    const chatView = new ChatView({
        container: app,
        initialItems: initialMessages,
        onReachTop: () => {
            console.log("reach top");
            const older = createDummyMessages(20, oldestSeed);
            oldestSeed -= 20;
            chatView.prependItems(older);
        },
        onReachBottom: () => {
            console.log("reach bottom");
        },
        onSend: (content, view) => {
            const now = new Date().toISOString();
            const userMessage: ChatScrollItem = {
                id: createId("user"),
                role: "user",
                content,
                createdAt: now,
                status: "normal"
            };
            view.appendItem(userMessage);

            const replyId = createId("assistant");
            const replyText = createAssistantReply(content);
            const assistantMessage: ChatScrollItem = {
                id: replyId,
                role: "assistant",
                content: "",
                createdAt: new Date().toISOString(),
                status: "streaming"
            };
            view.appendItem(assistantMessage);

            let cursor = 0;
            const timer = window.setInterval(() => {
                const step = Math.max(1, Math.floor(Math.random() * 4));
                cursor = Math.min(replyText.length, cursor + step);

                const done = cursor >= replyText.length;
                view.updateItem(replyId, {
                    content: replyText.slice(0, cursor),
                    status: done ? "normal" : "streaming"
                });

                if (done) {
                    window.clearInterval(timer);
                }
            }, 48);
        }
    });

    chatView.scrollToBottom();
}

bootstrap();

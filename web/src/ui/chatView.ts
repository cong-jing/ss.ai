import { ChatInput } from "../components/ChatInput";
import {
    ChatScrollView,
    createDefaultChatBlockTemplate,
    type ChatScrollItem
} from "./components/chatScrollView";

/**
 * ChatView：组装层（UI Facade）。
 *
 * 职责：
 * - 组装 toolbar / ChatScrollView / ChatInput
 * - 转发交互回调（onSend / onReachTop / onReachBottom）
 * - 对外暴露少量控制方法，屏蔽内部 DOM 细节
 */
export interface ChatViewOptions {
    container: HTMLElement;
    initialItems: ChatScrollItem[];
    onSend: (content: string, view: ChatView) => void;
    onReachTop?: () => void;
    onReachBottom?: () => void;
}

export class ChatView {
    private readonly chatScrollView: ChatScrollView<ChatScrollItem>;

    constructor(options: ChatViewOptions) {
        const page = document.createElement("div");
        page.className = "demo-page";

        const toolbar = document.createElement("div");
        toolbar.className = "demo-toolbar";

        const topButton = document.createElement("button");
        topButton.type = "button";
        topButton.textContent = "滚动到顶部";

        const bottomButton = document.createElement("button");
        bottomButton.type = "button";
        bottomButton.textContent = "滚动到底部";

        const backLink = document.createElement("a");
        backLink.href = "./";
        backLink.className = "demo-back-link";
        backLink.textContent = "返回模型设置";

        toolbar.appendChild(topButton);
        toolbar.appendChild(bottomButton);
        toolbar.appendChild(backLink);

        const chatArea = document.createElement("div");
        chatArea.className = "demo-chat-area";

        const inputHost = document.createElement("div");
        inputHost.className = "demo-input-area";

        page.appendChild(toolbar);
        page.appendChild(chatArea);
        page.appendChild(inputHost);

        options.container.innerHTML = "";
        options.container.appendChild(page);

        this.chatScrollView = new ChatScrollView<ChatScrollItem>({
            container: chatArea,
            items: options.initialItems,
            getItemId: (item) => item.id,
            template: createDefaultChatBlockTemplate(),
            estimatedItemHeight: 96,
            overscanCount: 10,
            onReachTop: options.onReachTop,
            onReachBottom: options.onReachBottom
        });

        topButton.addEventListener("click", () => {
            this.chatScrollView.scrollToTop();
        });

        bottomButton.addEventListener("click", () => {
            this.chatScrollView.scrollToBottom();
        });

        const chatInput = new ChatInput({
            onSend: (content) => {
                options.onSend(content, this);
            }
        });
        inputHost.appendChild(chatInput.getElement());
    }

    appendItem(item: ChatScrollItem): void {
        this.chatScrollView.appendItem(item);
    }

    prependItems(items: ChatScrollItem[]): void {
        this.chatScrollView.prependItems(items);
    }

    updateItem(id: string, patch: Partial<ChatScrollItem>): void {
        this.chatScrollView.updateItem(id, patch);
    }

    scrollToBottom(): void {
        this.chatScrollView.scrollToBottom();
    }

    scrollToTop(): void {
        this.chatScrollView.scrollToTop();
    }
}

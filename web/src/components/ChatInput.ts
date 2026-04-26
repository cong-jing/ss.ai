/**
 * ChatInput：独立输入组件。
 * - Enter 发送
 * - Shift+Enter 换行
 * - 仅通过 onSend 向外抛出输入内容
 */
export interface ChatInputOptions {
    onSend: (content: string) => void;
}

export class ChatInput {
    private readonly root: HTMLDivElement;
    private readonly textArea: HTMLTextAreaElement;
    private readonly sendButton: HTMLButtonElement;

    constructor(options: ChatInputOptions) {
        this.root = document.createElement("div");
        this.root.className = "chat-input";

        this.textArea = document.createElement("textarea");
        this.textArea.className = "chat-input-textarea";
        this.textArea.placeholder = "输入消息，Enter 发送，Shift+Enter 换行";

        this.sendButton = document.createElement("button");
        this.sendButton.className = "chat-input-send";
        this.sendButton.type = "button";
        this.sendButton.textContent = "发送";

        const submit = () => {
            const value = this.textArea.value.trim();
            if (!value) {
                return;
            }

            options.onSend(value);
            this.textArea.value = "";
            this.textArea.focus();
        };

        this.sendButton.addEventListener("click", submit);
        this.textArea.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
            }
        });

        this.root.appendChild(this.textArea);
        this.root.appendChild(this.sendButton);
    }

    getElement(): HTMLElement {
        return this.root;
    }
}

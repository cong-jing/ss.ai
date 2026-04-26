import type { ChatScrollItem } from "../ui/components/chatScrollView";

const SENTENCES = [
    "这是一条用于虚拟滚动测试的消息。",
    "消息长度会有所不同，用于测试动态高度。",
    "纯前端 demo，不依赖任何后端通信。",
    "当你滚动到顶部时可以触发加载更旧数据。",
    "streaming 消息会通过 updateItem 持续更新。",
    "这是一个较长文本：为了更明显地观察虚拟列表高度缓存效果，这里故意增加一些描述内容。"
];

function getRole(index: number): ChatScrollItem["role"] {
    if (index % 17 === 0) {
        return "system";
    }

    return index % 2 === 0 ? "assistant" : "user";
}

function createContent(index: number): string {
    const seed = SENTENCES[index % SENTENCES.length];
    const repeat = (index % 4) + 1;
    return Array.from({ length: repeat }, () => seed).join(" ");
}

export function createDummyMessages(count: number, startIndex = 0): ChatScrollItem[] {
    const now = Date.now();

    return Array.from({ length: count }, (_, offset) => {
        const index = startIndex + offset;
        return {
            id: `dummy-${index}`,
            role: getRole(index),
            content: createContent(index),
            createdAt: new Date(now + index * 1000).toISOString(),
            status: "normal"
        } satisfies ChatScrollItem;
    });
}

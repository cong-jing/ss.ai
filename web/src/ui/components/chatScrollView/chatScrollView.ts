/**
 * ChatScrollView 可复用组件（单文件版）
 *
 * 结构关系：
 * - ChatScrollView<T>: 虚拟滚动核心控件（泛型，不关心业务字段）
 * - ChatBlockTemplate<T>: 外部注入的渲染模板协议
 * - createDefaultChatBlockTemplate(): Demo 模板（面向 ChatScrollItem）
 * - ChatScrollItem: Demo 数据结构，仅供示例，不是控件强依赖
 *
 * 最小使用示例：
 * ```ts
 * const view = new ChatScrollView<Message>({
 *   container: host,
 *   items: initialItems,
 *   getItemId: (item) => item.id,
 *   template: customTemplate,
 *   estimatedItemHeight: 96,
 *   overscanCount: 10,
 *   onReachTop: () => loadMore()
 * });
 *
 * view.appendItem(newItem);
 * view.updateItem(newItem.id, { content: "updated" });
 * view.scrollToBottom();
 * ```
 */

export interface ChatScrollItem {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAt: string;
    status?: "normal" | "streaming" | "failed";
    metadata?: Record<string, unknown>;
}

export interface ChatScrollState {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    isNearTop: boolean;
    isNearBottom: boolean;
}

export interface ChatBlockTemplate<T> {
    createBlock: (item: T) => HTMLElement;
    updateBlock: (element: HTMLElement, item: T) => void;
    destroyBlock?: (element: HTMLElement, item: T) => void;
}

/**
 * options 说明：
 * - container: 控件挂载容器。
 * - items: 初始数据。
 * - getItemId: item 唯一 id 获取函数。
 * - template: 渲染模板（create/update/destroy）。
 * - estimatedItemHeight: 未测量 item 的估算高度，默认 88。
 * - overscanCount: 可见区前后额外渲染条数，默认 8。
 * - overscanPx: 像素级 overscan，默认 0。
 * - onReachTop/onReachBottom: 接近顶部/底部触发。
 * - onScrollStateChange: 滚动状态更新回调。
 */
export interface ChatScrollViewOptions<T> {
    container: HTMLElement;
    items: T[];
    getItemId: (item: T) => string;
    template: ChatBlockTemplate<T>;
    estimatedItemHeight?: number;
    overscanCount?: number;
    overscanPx?: number;
    onReachTop?: () => void;
    onReachBottom?: () => void;
    onScrollStateChange?: (state: ChatScrollState) => void;
}

interface VisibleRange {
    start: number;
    end: number;
}

export class ChatScrollView<T extends object> {
    private readonly container: HTMLElement;
    private readonly root: HTMLDivElement;
    private readonly spacer: HTMLDivElement;
    private readonly getItemId: (item: T) => string;
    private readonly template: ChatBlockTemplate<T>;
    private readonly estimatedItemHeight: number;
    private readonly overscanCount: number;
    private readonly overscanPx: number;
    private readonly onReachTop?: () => void;
    private readonly onReachBottom?: () => void;
    private readonly onScrollStateChange?: (state: ChatScrollState) => void;

    private items: T[] = [];
    private offsets: number[] = [];
    private totalHeight = 0;

    private readonly heightCache = new Map<string, number>();
    private readonly mountedElements = new Map<string, HTMLElement>();
    private readonly mountedWrappers = new Map<string, HTMLElement>();

    private rafId: number | null = null;
    private readonly topThreshold = 48;
    private readonly bottomThreshold = 64;
    private readonly topReachCooldownMs = 300;
    private lastTopReachAt = 0;
    private destroyed = false;

    private readonly onScrollBound: () => void;
    private readonly resizeObserver: ResizeObserver;

    constructor(options: ChatScrollViewOptions<T>) {
        this.container = options.container;
        this.getItemId = options.getItemId;
        this.template = options.template;
        this.estimatedItemHeight = options.estimatedItemHeight ?? 88;
        this.overscanCount = options.overscanCount ?? 8;
        this.overscanPx = options.overscanPx ?? 0;
        this.onReachTop = options.onReachTop;
        this.onReachBottom = options.onReachBottom;
        this.onScrollStateChange = options.onScrollStateChange;

        this.root = document.createElement("div");
        this.root.className = "chat-scroll-view";

        this.spacer = document.createElement("div");
        this.spacer.className = "chat-scroll-spacer";
        this.root.appendChild(this.spacer);

        this.container.innerHTML = "";
        this.container.appendChild(this.root);

        this.onScrollBound = this.handleScroll.bind(this);
        this.root.addEventListener("scroll", this.onScrollBound, { passive: true });

        this.resizeObserver = new ResizeObserver((entries) => {
            if (this.destroyed) {
                return;
            }

            let changed = false;
            for (const entry of entries) {
                const target = entry.target as HTMLElement;
                const id = target.dataset.virtualItemId;
                if (!id) {
                    continue;
                }

                const measured = Math.ceil(entry.contentRect.height);
                const prev = this.heightCache.get(id);
                if (!prev || Math.abs(prev - measured) > 1) {
                    this.heightCache.set(id, measured);
                    changed = true;
                }
            }

            if (changed) {
                this.refresh();
            }
        });

        this.setItems(options.items);
    }

    setItems(items: T[]): void {
        this.items = [...items];
        this.pruneHeightCache();
        this.calculateOffsets();
        this.renderVisibleItems();
    }

    appendItem(item: T): void {
        this.appendItems([item]);
    }

    appendItems(items: T[]): void {
        if (items.length === 0) {
            return;
        }

        const shouldStickBottom = this.isNearBottom();
        this.items.push(...items);
        this.calculateOffsets();
        this.renderVisibleItems();

        if (shouldStickBottom) {
            this.scrollToBottom();
        }
    }

    prependItems(items: T[]): void {
        if (items.length === 0) {
            return;
        }

        const beforeHeight = this.root.scrollHeight;
        const beforeTop = this.root.scrollTop;

        this.items = [...items, ...this.items];
        this.calculateOffsets();
        this.renderVisibleItems();

        const afterHeight = this.root.scrollHeight;
        const delta = afterHeight - beforeHeight;
        this.root.scrollTop = beforeTop + delta;
    }

    updateItem(id: string, patch: Partial<T>): void {
        const index = this.items.findIndex((item) => this.getItemId(item) === id);
        if (index < 0) {
            return;
        }

        const shouldStickBottom = this.isNearBottom();
        const next = { ...this.items[index], ...patch } as T;
        this.items[index] = next;

        const mounted = this.mountedElements.get(id);
        if (mounted) {
            this.template.updateBlock(mounted, next);
            this.measureItem(id, mounted);
        }

        this.calculateOffsets();
        this.renderVisibleItems();

        if (shouldStickBottom) {
            this.scrollToBottom();
        }
    }

    removeItem(id: string): void {
        const index = this.items.findIndex((item) => this.getItemId(item) === id);
        if (index < 0) {
            return;
        }

        const shouldStickBottom = this.isNearBottom();
        const removedItem = this.items[index];
        this.items.splice(index, 1);
        this.heightCache.delete(id);

        const mounted = this.mountedElements.get(id);
        if (mounted) {
            this.resizeObserver.unobserve(mounted);
            this.template.destroyBlock?.(mounted, removedItem);
        }

        const wrapper = this.mountedWrappers.get(id);
        wrapper?.remove();
        this.mountedElements.delete(id);
        this.mountedWrappers.delete(id);

        this.calculateOffsets();
        this.renderVisibleItems();

        if (shouldStickBottom) {
            this.scrollToBottom();
        }
    }

    scrollToBottom(): void {
        this.root.scrollTop = Math.max(0, this.root.scrollHeight - this.root.clientHeight);
    }

    scrollToTop(): void {
        this.root.scrollTop = 0;
    }

    isNearBottom(threshold = this.bottomThreshold): boolean {
        return this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < threshold;
    }

    isNearTop(threshold = this.topThreshold): boolean {
        return this.root.scrollTop < threshold;
    }

    refresh(): void {
        this.calculateOffsets();
        this.renderVisibleItems();
    }

    destroy(): void {
        this.destroyed = true;
        this.root.removeEventListener("scroll", this.onScrollBound);
        this.resizeObserver.disconnect();

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        for (const [id, element] of this.mountedElements) {
            this.template.destroyBlock?.(element, this.items.find((it) => this.getItemId(it) === id) ?? ({} as T));
        }

        this.mountedElements.clear();
        this.mountedWrappers.clear();
        this.container.innerHTML = "";
    }

    private handleScroll(): void {
        this.scheduleRender();
        const state = this.getScrollState();
        this.onScrollStateChange?.(state);

        if (state.isNearBottom) {
            this.onReachBottom?.();
        }

        if (state.isNearTop) {
            const now = Date.now();
            if (now - this.lastTopReachAt > this.topReachCooldownMs) {
                this.lastTopReachAt = now;
                this.onReachTop?.();
            }
        }
    }

    private scheduleRender(): void {
        if (this.rafId !== null) {
            return;
        }

        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.renderVisibleItems();
        });
    }

    private getScrollState(): ChatScrollState {
        return {
            scrollTop: this.root.scrollTop,
            scrollHeight: this.root.scrollHeight,
            clientHeight: this.root.clientHeight,
            isNearTop: this.isNearTop(),
            isNearBottom: this.isNearBottom()
        };
    }

    private pruneHeightCache(): void {
        const validIds = new Set(this.items.map((item) => this.getItemId(item)));
        for (const id of this.heightCache.keys()) {
            if (!validIds.has(id)) {
                this.heightCache.delete(id);
            }
        }
    }

    private calculateOffsets(): void {
        this.offsets = new Array(this.items.length);
        let acc = 0;

        for (let i = 0; i < this.items.length; i += 1) {
            this.offsets[i] = acc;
            const id = this.getItemId(this.items[i]);
            acc += this.heightCache.get(id) ?? this.estimatedItemHeight;
        }

        this.totalHeight = acc;
        this.spacer.style.height = `${this.totalHeight}px`;
    }

    private getTotalHeight(): number {
        return this.totalHeight;
    }

    private getVisibleRange(): VisibleRange {
        if (this.items.length === 0) {
            return { start: 0, end: -1 };
        }

        const viewportTop = this.root.scrollTop - this.overscanPx;
        const viewportBottom = this.root.scrollTop + this.root.clientHeight + this.overscanPx;

        let start = -1;
        let end = -1;

        for (let i = 0; i < this.items.length; i += 1) {
            const top = this.offsets[i];
            const id = this.getItemId(this.items[i]);
            const height = this.heightCache.get(id) ?? this.estimatedItemHeight;
            const bottom = top + height;

            if (bottom >= viewportTop && top <= viewportBottom) {
                if (start === -1) {
                    start = i;
                }
                end = i;
            }
        }

        if (start === -1 || end === -1) {
            const fallback = Math.min(
                this.items.length - 1,
                Math.max(0, Math.floor(this.root.scrollTop / this.estimatedItemHeight))
            );
            start = fallback;
            end = fallback;
        }

        start = Math.max(0, start - this.overscanCount);
        end = Math.min(this.items.length - 1, end + this.overscanCount);

        return { start, end };
    }

    private renderVisibleItems(): void {
        if (this.destroyed) {
            return;
        }

        this.spacer.style.height = `${this.getTotalHeight()}px`;
        const range = this.getVisibleRange();
        const visibleIds = new Set<string>();

        for (let index = range.start; index <= range.end; index += 1) {
            const item = this.items[index];
            if (!item) {
                continue;
            }

            const id = this.getItemId(item);
            visibleIds.add(id);

            let wrapper = this.mountedWrappers.get(id);
            let block = this.mountedElements.get(id);

            if (!wrapper || !block) {
                wrapper = document.createElement("div");
                wrapper.className = "chat-virtual-item";

                block = this.template.createBlock(item);
                block.dataset.virtualItemId = id;
                wrapper.appendChild(block);
                this.spacer.appendChild(wrapper);

                this.mountedWrappers.set(id, wrapper);
                this.mountedElements.set(id, block);
                this.resizeObserver.observe(block);
            } else {
                this.template.updateBlock(block, item);
            }

            const top = this.offsets[index] ?? 0;
            wrapper.style.transform = `translateY(${top}px)`;
            this.measureItem(id, block);
        }

        this.recycleUnmountedItems(visibleIds);
    }

    private measureItem(id: string, element: HTMLElement): void {
        const measured = Math.ceil(element.getBoundingClientRect().height);
        if (measured <= 0) {
            return;
        }

        const prev = this.heightCache.get(id);
        if (!prev || Math.abs(prev - measured) > 1) {
            this.heightCache.set(id, measured);
        }
    }

    private recycleUnmountedItems(visibleIds: Set<string>): void {
        for (const [id, wrapper] of this.mountedWrappers) {
            if (visibleIds.has(id)) {
                continue;
            }

            const element = this.mountedElements.get(id);
            if (element) {
                this.resizeObserver.unobserve(element);
                const item = this.items.find((entry) => this.getItemId(entry) === id);
                if (item) {
                    this.template.destroyBlock?.(element, item);
                }
            }

            wrapper.remove();
            this.mountedWrappers.delete(id);
            this.mountedElements.delete(id);
        }
    }
}

function toLocalTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateRoleClass(element: HTMLElement, role: ChatScrollItem["role"]): void {
    element.classList.remove("chat-role-user", "chat-role-assistant", "chat-role-system");
    element.classList.add(`chat-role-${role}`);
}

/**
 * 默认模板（demo 用）。
 * 业务项目可直接实现自己的 template 并替换。
 */
export function createDefaultChatBlockTemplate(): ChatBlockTemplate<ChatScrollItem> {
    const updateBlock: ChatBlockTemplate<ChatScrollItem>["updateBlock"] = (element, item) => {
        updateRoleClass(element, item.role);

        const meta = element.querySelector(".chat-block-meta") as HTMLDivElement;
        const content = element.querySelector(".chat-block-content") as HTMLDivElement;
        const status = element.querySelector(".chat-block-status") as HTMLDivElement;

        meta.textContent = `${item.role} · ${toLocalTime(item.createdAt)}`;
        content.textContent = item.content;

        element.classList.toggle("chat-block-failed", item.status === "failed");
        element.classList.toggle("chat-block-streaming", item.status === "streaming");

        if (item.status === "streaming") {
            status.textContent = "streaming...";
        } else if (item.status === "failed") {
            status.textContent = "发送失败";
        } else {
            status.textContent = "";
        }
    };

    return {
        createBlock: (item) => {
            const root = document.createElement("div");
            root.className = "chat-block";

            const meta = document.createElement("div");
            meta.className = "chat-block-meta";

            const content = document.createElement("div");
            content.className = "chat-block-content";

            const status = document.createElement("div");
            status.className = "chat-block-status";

            root.appendChild(meta);
            root.appendChild(content);
            root.appendChild(status);

            updateRoleClass(root, item.role);
            updateBlock(root, item);

            return root;
        },
        updateBlock
    };
}
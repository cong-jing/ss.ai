import type { Ref } from "vue";
import { useLocalStorage } from "../ui/useLocalStorage";
import { MESSAGES, type Locale, type MessageKey, SUPPORTED_LOCALES } from "./messages";

function detectInitialLocale(): Locale {
    const language = navigator.language.toLowerCase();
    if (language.startsWith("zh")) {
        return "zh-CN";
    }
    return "en-US";
}

export const locale = useLocalStorage("ui.locale", detectInitialLocale()) as Ref<Locale>;

export function setLocale(next: Locale): void {
    locale.value = next;
}

export function isSupportedLocale(value: string): value is Locale {
    return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
    const dict = MESSAGES[locale.value] ?? MESSAGES["en-US"];
    const template = dict[key] ?? MESSAGES["en-US"][key] ?? key;
    if (!params) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (_match: string, token: string) => String(params[token] ?? ""));
}

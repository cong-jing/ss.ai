import type { Ref } from "vue";
import { useLocalStorage } from "../ui/useLocalStorage";
import { useToast } from "../ui/useToast";
import { MESSAGES, type Locale, type MessageKey, SUPPORTED_LOCALES } from "./messages";

function detectInitialLocale(): Locale {
    const language = navigator.language.toLowerCase();
    if (language.startsWith("zh")) {
        return "zh-CN";
    }
    if (language.startsWith("ja")) {
        return "ja-JP";
    }
    return "en-US";
}

export const locale = useLocalStorage("ui.locale", detectInitialLocale()) as Ref<Locale>;
const reportedMissingKeys = new Set<string>();
const toast = useToast();

export function setLocale(next: Locale): void {
    locale.value = next;
}

export function isSupportedLocale(value: string): value is Locale {
    return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function reportMissingKey(key: MessageKey, targetLocale: Locale): void {
    const id = `${targetLocale}:${key}`;
    if (reportedMissingKeys.has(id)) {
        return;
    }
    reportedMissingKeys.add(id);
    const message = `[i18n] Missing key "${key}" for locale "${targetLocale}"`;
    console.error(message);
    toast.error(message);
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
    const currentLocale = locale.value;
    const dict = MESSAGES[currentLocale] ?? MESSAGES["en-US"];
    let template = dict[key];

    if (template === undefined) {
        reportMissingKey(key, currentLocale);
        template = MESSAGES["en-US"][key];
    }

    if (template === undefined) {
        reportMissingKey(key, "en-US");
        template = key;
    }

    if (!params) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (_match: string, token: string) => String(params[token] ?? ""));
}

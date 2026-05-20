import { enUS } from "./locales/en-US";
import { jaJP } from "./locales/ja-JP";
import { zhCN } from "./locales/zh-CN";

export const SUPPORTED_LOCALES = ["zh-CN", "en-US", "ja-JP"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type MessageKey = keyof typeof enUS;

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
    "zh-CN": zhCN,
    "en-US": enUS,
    "ja-JP": jaJP,
};

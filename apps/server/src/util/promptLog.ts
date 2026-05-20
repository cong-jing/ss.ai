import fs from "node:fs";
import path from "node:path";
import type { PersonaFlowPromptLogEntry, PersonaFlowPromptLogger, RenderedMessage } from "@ss-ai/persona-flow";

export interface PromptLogConfig {
    enabled: boolean;
    filePath: string;
}
export class PromptLogger implements PersonaFlowPromptLogger {
    constructor(private readonly config: PromptLogConfig) {
        if (config.enabled) {
            fs.mkdirSync(path.dirname(path.resolve(config.filePath)), { recursive: true });
        }
    }

    static disabled(): PromptLogger {
        return new PromptLogger({ enabled: false, filePath: "" });
    }

    async writePromptLog(entry: PersonaFlowPromptLogEntry): Promise<void> {
        if (!this.config.enabled) return;

        const lines: string[] = [];
        lines.push(`\n${"─".repeat(72)}`);
        lines.push(`[${entry.timestamp}] requestId=${entry.requestId} model=${entry.model}`);
        lines.push("");

        for (const msg of entry.messages) {
            lines.push(`### ${msg.role.toUpperCase()}`);
            lines.push(msg.content);
            lines.push("");
        }

        lines.push(`### OUTPUT`);
        lines.push(entry.output);
        lines.push("");

        fs.appendFileSync(
            path.resolve(this.config.filePath),
            lines.join("\n"),
            "utf-8"
        );
    }
}

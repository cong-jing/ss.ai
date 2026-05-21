import { info } from "node:console";
import { RenderedMessage } from "../prompt/promptTypes.js";

export interface PersonaFlowLogger {
    debug(message: string, payload?: unknown): void;
    verbose(message: string, payload?: unknown): void;
    info(message: string, payload?: unknown): void;
    warn(message: string, payload?: unknown): void;
    error(message: string, payload?: unknown): void;
}

const NOOP = () => {
    // no-op
};

export function createNoopPersonaFlowLogger(): PersonaFlowLogger {
    return {
        debug: NOOP,
        verbose: NOOP,
        info: NOOP,
        warn: NOOP,
        error: NOOP,
    };
}

export interface PersonaFlowPromptLogEntry {
    timestamp: string;
    requestId: string;
    model: string;
    messages: RenderedMessage[];
    output: string;
}

export interface PersonaFlowPromptLogger {
    writePromptLog: (log: PersonaFlowPromptLogEntry) => Promise<void>;
}
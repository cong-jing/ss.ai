export interface PersonaFlowLogger {
    debug(message: string, payload?: unknown): void;
    verbose(message: string, payload?: unknown): void;
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
        warn: NOOP,
        error: NOOP,
    };
}

import fs from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Mistral } from "@mistralai/mistralai";
import { renderPromptTemplate, type PromptViewModel } from "@ss-ai/persona-flow";
import { parse as parseYaml } from "yaml";

type CliConfig = {
    name?: string;
    provider: string;
    model: string;
    apiKey?: string;
    character?: {
        name?: string;
        displayName?: string;
        description?: string;
        personaPrompt?: string;
    };
    self?: {
        alias?: string;
    };
    p1?: {
        speakerTag?: string;
    };
    actors?: Array<{
        alias?: string;
        role?: string;
        sourceType?: string;
        displayName?: string;
        info?: string;
        profile?: string;
        speakerTag?: string;
    }>;
    relationshipState?: string;
    memories?: string[];
    messages?: Array<{
        role?: "system" | "user" | "assistant";
        speakerAlias?: string;
        content?: string;
    }>;
    structuredOutput?: boolean;
};

type CliArgs = {
    configPath: string;
    outputPath: string | null;
    renderOnly: boolean;
};

const __dir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dir, "../../../");
const packageRoot = resolve(__dir, "../");
const defaultTemplatePath = resolve(workspaceRoot, "packages/persona-flow/data/prompts/zh-CN/main.md.hbs");

async function resolveExistingInputPath(inputPath: string): Promise<string> {
    if (inputPath.startsWith("/")) {
        return inputPath;
    }

    const candidates = [
        resolve(process.cwd(), inputPath),
        resolve(packageRoot, inputPath),
        resolve(workspaceRoot, inputPath),
    ];

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // try next candidate
        }
    }

    // Fall back to workspace root based path for clearer project-level behavior.
    return resolve(workspaceRoot, inputPath);
}

function resolveOutputPath(outputPath: string): string {
    if (outputPath.startsWith("/")) {
        return outputPath;
    }

    // Prefer workspace-root relative output so logs end up in predictable locations.
    return resolve(workspaceRoot, outputPath);
}

function buildDefaultOutputPath(configPath: string, renderOnly: boolean): string {
    const fileDir = dirname(configPath);
    const ext = extname(configPath);
    const base = basename(configPath, ext || undefined);
    const suffix = renderOnly ? ".render.log.md" : ".chat.log.md";
    return resolve(fileDir, `${base}${suffix}`);
}

async function parseArgs(argv: string[]): Promise<CliArgs> {
    let configPath = "";
    let outputPath: string | undefined;
    let renderOnly = false;
    let noLog = false;
    const positional: string[] = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if ((arg === "--config" || arg === "-c") && argv[i + 1]) {
            configPath = argv[i + 1];
            i += 1;
            continue;
        }
        if ((arg === "--out" || arg === "-o") && argv[i + 1]) {
            outputPath = argv[i + 1];
            i += 1;
            continue;
        }
        if (arg === "--render-only" || arg === "-r") {
            renderOnly = true;
            continue;
        }
        if (arg === "--no-log" || arg === "-n") {
            noLog = true;
            continue;
        }
        positional.push(arg);
    }

    if (!configPath && positional[0]) {
        configPath = positional[0];
    }
    if (!outputPath && positional[1]) {
        outputPath = positional[1];
    }

    if (!configPath) {
        throw new Error("Missing required argument: --config|-c <path-to-yaml>");
    }

    const resolvedConfigPath = await resolveExistingInputPath(configPath);
    let resolvedOutputPath: string | null;
    if (noLog) {
        resolvedOutputPath = null;
    } else if (outputPath) {
        resolvedOutputPath = resolveOutputPath(outputPath);
    } else {
        resolvedOutputPath = buildDefaultOutputPath(resolvedConfigPath, renderOnly);
    }

    return {
        configPath: resolvedConfigPath,
        outputPath: resolvedOutputPath,
        renderOnly,
    };
}

function toPromptViewModel(config: CliConfig): PromptViewModel {
    const normalizedActors = (config.actors ?? [])
        .filter(actor => actor.role !== "self" && actor.role !== "system")
        .map((actor, index) => {
            const sourceType: PromptViewModel["actors"][number]["sourceType"] = actor.sourceType === "logged_user"
                ? "logged_user"
                : "local_actor";
            const displayName = (actor.displayName ?? "").trim() || "unknown";
            const speakerTag = actor.speakerTag
                ?? actor.alias
                ?? `p${index + 3}[${displayName}]`;
            const profile = (actor.profile ?? actor.info ?? "").trim() || "（无）";

            return {
                speakerTag,
                displayName,
                sourceType,
                profile,
            };
        });

    const selfDisplayName = (config.character?.displayName || config.character?.name || "").trim() || "self";
    const selfSpeakerTag = config.p1?.speakerTag
        ?? config.self?.alias
        ?? `p1[${selfDisplayName}]`;

    return {
        p1: {
            speakerTag: selfSpeakerTag,
            displayName: selfDisplayName,
            description: config.character?.description ?? "",
            personaPrompt: config.character?.personaPrompt ?? "",
        },
        p2: {
            speakerTag: "p2[system]",
        },
        actors: normalizedActors,
        relationshipState: config.relationshipState ?? "",
        memories: config.memories ?? [],
        structuredOutput: config.structuredOutput ?? true,
    };
}

function toChatMessages(config: CliConfig, systemPrompt: string): Array<{
    role: "system" | "user" | "assistant";
    content: string;
}> {
    const history = (config.messages ?? []).map((message) => {
        const role = message.role ?? "user";
        const content = message.content ?? "";

        if (role === "system" || !message.speakerAlias) {
            return { role, content };
        }

        return {
            role,
            content: `${message.speakerAlias}: ${content}`,
        };
    });

    return [
        { role: "system", content: systemPrompt },
        ...history,
    ];
}

async function render(configPath: string): Promise<{
    config: CliConfig;
    systemPrompt: string;
}> {
    const raw = await fs.readFile(configPath, "utf-8");
    const config = parseYaml(raw) as CliConfig;
    const viewModel = toPromptViewModel(config);
    const systemPrompt = await renderPromptTemplate(defaultTemplatePath, viewModel);

    return { config, systemPrompt };
}

async function runChat(config: CliConfig, systemPrompt: string): Promise<string> {
    const provider = (config.provider ?? "").toLowerCase();
    if (provider !== "mistral" && provider !== "mistral.ai") {
        throw new Error(`Unsupported provider in prompt-debug-cli: ${config.provider}`);
    }

    const apiKey = config.apiKey || process.env.MISTRAL_API_KEY || process.env.MODEL_API_KEY;
    if (!apiKey) {
        throw new Error("Missing API key. Set config.apiKey or env MISTRAL_API_KEY / MODEL_API_KEY.");
    }

    const client = new Mistral({ apiKey });
    const response = await client.chat.complete({
        model: config.model,
        messages: toChatMessages(config, systemPrompt),
        responseFormat: { type: "text" },
    });

    const output = response.choices?.[0]?.message?.content;
    if (typeof output === "string") {
        return output;
    }
    if (Array.isArray(output)) {
        return output
            .map((part) => {
                if (typeof part === "string") return part;
                if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
                    return part.text;
                }
                return "";
            })
            .join("");
    }
    return "";
}

async function maybeWriteLog(outputPath: string | null, content: string): Promise<void> {
    if (!outputPath) return;
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, "utf-8");
}

async function main(): Promise<void> {
    const args = await parseArgs(process.argv.slice(2));
    const { config, systemPrompt } = await render(args.configPath);

    const sections: string[] = [];
    sections.push(`# Prompt Debug Run: ${config.name ?? "unnamed"}`);
    sections.push(`- provider: ${config.provider}`);
    sections.push(`- model: ${config.model}`);
    sections.push("\n## Rendered System Prompt\n");
    sections.push(systemPrompt);

    if (!args.renderOnly) {
        const output = await runChat(config, systemPrompt);
        sections.push("\n## Chat Output\n");
        sections.push(output || "(empty)");
    }

    const report = sections.join("\n");
    console.log(report);
    await maybeWriteLog(args.outputPath, report);
    if (args.outputPath) {
        console.log(`\n[prompt-debug-cli] 日志已写入: ${args.outputPath}`);
    }
}

void main().catch((error) => {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    console.error(`[prompt-debug-cli] ${message}`);
    process.exitCode = 1;
});

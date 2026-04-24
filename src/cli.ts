import { Command } from "commander";
import { AgentService } from "../packages/agent/src";
import { RuntimeConfig } from "./config";

export async function runCli(input: {
    agentService: AgentService;
    config: RuntimeConfig;
    argv?: string[];
}): Promise<void> {
    const program = new Command();

    program
        .name("ss-ai")
        .description("CLI launcher for ss.ai agent")
        .version("0.1.0");

    program
        .command("chat [prompt]")
        .description("Send one prompt to the agent")
        .option("-p, --prompt <text>", "prompt text")
        .option("-s, --session <id>", "session id")
        .action(async (promptArg: string | undefined, options: { prompt?: string; session?: string }) => {
            const prompt = options.prompt ?? promptArg;

            if (!prompt || !prompt.trim()) {
                throw new Error("Prompt is required. Use: chat <prompt> or chat -p <text>");
            }

            const response = await input.agentService.chat({
                prompt,
                sessionId: options.session
            });

            process.stdout.write(`${response.output}\n`);
        });

    // TODO: add stream mode and interactive REPL support.
    await program.parseAsync(input.argv ?? process.argv);
}

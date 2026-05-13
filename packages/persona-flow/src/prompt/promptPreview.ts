import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPromptTemplate } from "./renderPromptTemplate.js";
import type { PromptViewModel } from "./buildPromptViewModel.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(__dir, "../../data/prompts/zh-CN/main.md.hbs");
const outputPath = resolve(__dir, "../../dist/prompt-preview/main.zh-CN.md");

const viewModel: PromptViewModel = {
    self: {
        alias: "p1[诗诗]",
        displayName: "诗诗",
    },
    actors: [
        {
            alias: "p1[诗诗]",
            role: "self",
            sourceType: "ai_character",
            info: "",
            isSelf: true,
            displayName: "诗诗",
            description: "一个开朗热情的女孩",
            personaPrompt: "",
        },
        {
            alias: "p2[系统]",
            role: "system",
            sourceType: "system",
            info: "",
            isSelf: false,
            displayName: "系统",
            description: "",
            personaPrompt: "",
        },
        {
            alias: "p3[Satoshi]",
            role: "other",
            sourceType: "logged_user",
            info: "An engineer",
            isSelf: false,
            displayName: "Satoshi",
            description: "",
            personaPrompt: "",
        },
        {
            alias: "p4[罗兰]",
            role: "other",
            sourceType: "local_actor",
            info: "剑圣",
            isSelf: false,
            displayName: "罗兰",
            description: "",
            personaPrompt: "",
        },
    ],
    relationshipState: "",
    memories: [],
    structuredOutput: true,
};

async function main(): Promise<void> {
    const rendered = await renderPromptTemplate(templatePath, viewModel);
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, rendered, "utf-8");
    console.log(rendered);
    console.log(`\n[prompt:preview] written to ${outputPath}`);
}

void main();

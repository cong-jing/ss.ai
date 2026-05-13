import fs from "node:fs/promises";
import Handlebars from "handlebars";

export async function renderPromptTemplate(
    templatePath: string,
    viewModel: unknown,
): Promise<string> {
    const source = await fs.readFile(templatePath, "utf-8");

    const template = Handlebars.compile(source, {
        noEscape: true,
        strict: true,
    });

    return template(viewModel);
}

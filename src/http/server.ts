import express from "express";
import { AgentService } from "../../packages/agent/src";
import { RuntimeConfig } from "../config";

export function createHttpServer(agentService: AgentService) {
    const app = express();

    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({ status: "ok" });
    });

    app.post("/v1/chat", async (req, res) => {
        try {
            const prompt = req.body?.prompt;
            const sessionId = req.body?.sessionId;

            const response = await agentService.chat({
                prompt,
                sessionId
            });

            res.json(response);
        } catch (error) {
            res.status(400).json({
                message: error instanceof Error ? error.message : "Unknown error"
            });
        }
    });

    return app;
}

export async function startHttpServer(input: {
    agentService: AgentService;
    config: RuntimeConfig;
}): Promise<void> {
    const app = createHttpServer(input.agentService);

    await new Promise<void>((resolve) => {
        app.listen(input.config.http.port, input.config.http.host, () => {
            resolve();
        });
    });
}

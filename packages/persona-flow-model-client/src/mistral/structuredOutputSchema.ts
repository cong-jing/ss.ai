import { z } from "zod";

export const mistralStructuredOutputSchema = z.object({
    replyText: z.string().min(1),
}).strict();

import { z } from "zod";

export const mistralStructuredOutputSchema = z.object({
    action: z.enum(["reply", "skip"]),
    replyText: z.string(),
    skip: z.object({
        reasonCode: z.enum([
            "none",
            "not_addressed",
            "low_value",
            "rate_control",
            "character_busy",
            "waiting_for_others",
            "other",
        ]),
        reason: z.string(),
    }),
}).strict();

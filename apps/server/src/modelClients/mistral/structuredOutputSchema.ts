import { z } from "zod";

export const mistralStructuredOutputSchema = z.object({
    action: z.enum(["reply", "skip"]),
    replyText: z.string(),
    control: z.object({
        summarizeSuggested: z.boolean(),
        summarizeReason: z.string(),
        summarizeUrgency: z.enum(["none", "low", "normal", "high"]),
    }),
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

export type CommonRoleplayTurnOutput = {
    action: "reply" | "skip";

    replyText: string;

    control: {
        summarizeSuggested: boolean;
        summarizeReason: string;
        summarizeUrgency: "none" | "low" | "normal" | "high";
    };

    skip: {
        reasonCode:
        | "none"
        | "not_addressed"
        | "low_value"
        | "rate_control"
        | "character_busy"
        | "waiting_for_others"
        | "other";
        reason: string;
    };
};
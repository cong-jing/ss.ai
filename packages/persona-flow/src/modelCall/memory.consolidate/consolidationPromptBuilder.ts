import type { RenderedMessage } from "../../prompt/promptTypes.js";
import type { MemoryConsolidationJudgeInput } from "../../memory/consolidation/consolidationTypes.js";

/**
 * Builds the consolidation judge prompt. This is a system-level
 * curation task: it never inherits the character's roleplay voice.
 * The judge may only suggest; the system applies. It must reference
 * retained ids only from the provided list and never invent facts.
 */
const SYSTEM_PROMPT = [
    "You are a conservative long-term memory curator.",
    "Staging evidence is a candidate fact; it is not automatically worth keeping.",
    "Retained memories are stable, concise, neutral facts usable long term.",
    "Do not invent facts. Do not invent ids. Only reference retained memory ids from the provided list.",
    "Prefer ignore or uncertain when evidence is weak, redundant, or speculative.",
    "When evidence reinforces or refines an existing retained memory, update it. When it supersedes several, merge and list the redundant ids to archive.",
    "Importance is an integer in the allowed range. When unsure, output uncertain.",
    "Respond only with the structured decision.",
].join(" ");

export function buildConsolidationMessages(input: MemoryConsolidationJudgeInput): RenderedMessage[] {
    const cap = input.policy;
    const lines: string[] = [];
    lines.push(`Character: ${input.character.displayName || "(unknown)"}`);
    if (input.character.personaSummary) {
        lines.push(`Persona summary: ${input.character.personaSummary}`);
    }
    lines.push(`Allowed actions: ${cap.allowedActions.join(", ")}`);
    lines.push(`Importance range: ${cap.importanceMin}..${cap.importanceMax} (integer)`);
    lines.push("");
    lines.push("Staging evidence:");
    lines.push(`- scope: ${input.staging.scope} / type: ${input.staging.type}`);
    lines.push(`- text: ${input.staging.text}`);
    lines.push(`- occurrenceCount: ${input.staging.occurrenceCount}`);
    lines.push(`- firstSeenAt: ${input.staging.firstSeenAt}, lastSeenAt: ${input.staging.lastSeenAt}`);
    if (input.staging.relatedEntities.length) lines.push(`- relatedEntities: ${input.staging.relatedEntities.join(", ")}`);
    if (input.staging.tags.length) lines.push(`- tags: ${input.staging.tags.join(", ")}`);
    lines.push("");
    lines.push("Source candidates:");
    if (input.sourceCandidates.length === 0) lines.push("- (none)");
    for (const s of input.sourceCandidates) {
        lines.push(`- [${s.candidateId}] ${s.text}${s.reason ? ` (reason: ${s.reason})` : ""}`);
    }
    lines.push("");
    lines.push("Related retained memories (only these ids may be referenced):");
    if (input.relatedRetained.length === 0) lines.push("- (none)");
    for (const r of input.relatedRetained) {
        const sim = r.similarity !== undefined ? ` sim=${r.similarity.toFixed(3)}` : "";
        lines.push(`- [${r.id}] importance=${r.importance} occ=${r.occurrenceCount}${sim}: ${r.text}`);
    }

    return [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: lines.join("\n") },
    ];
}

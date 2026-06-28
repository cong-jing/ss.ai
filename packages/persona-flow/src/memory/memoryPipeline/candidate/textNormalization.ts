/**
 * Text normalization for memory candidates and active memories.
 *
 * Purpose: produce a deterministic "comparison key" that survives
 * trivial wording differences so exact-duplicate detection works
 * across slightly different phrasings ("Hello." vs "  hello !").
 *
 * Design rules:
 *  - Deterministic: same input → same output, no Date / RNG / locale.
 *  - Conservative: only collapse differences a human would consider
 *    cosmetic. Never strip content words, never stem, never lower
 *    semantic precision. The goal is a key, not a summary.
 *  - Lossy by design: the normalized form is NOT for display. Always
 *    keep the original `text` alongside.
 *  - Stable across releases unless we bump `MEMORY_SCHEMA_VERSION`;
 *    re-normalizing existing rows is a migration, not a hotfix.
 */

/**
 * Mapping of common full-width / curly punctuation to their plain
 * ASCII counterparts. NFKC handles most of the heavy lifting but a
 * few characters (e.g. CJK middle dots) are not folded; we keep the
 * table small and explicit so behaviour is auditable.
 */
const PUNCTUATION_FOLDING: Record<string, string> = {
    "\u3000": " ", // ideographic space
    "\u00A0": " ", // non-breaking space
    "\u200B": "", // zero-width space
    "\uFEFF": "", // BOM
    "“": "\"",
    "”": "\"",
    "„": "\"",
    "「": "\"",
    "」": "\"",
    "『": "\"",
    "』": "\"",
    "‘": "'",
    "’": "'",
    "‚": "'",
    "—": "-",
    "–": "-",
    "‐": "-",
    "−": "-",
    "・": "·",
};

const FOLDABLE_CHARS = new RegExp(
    `[${Object.keys(PUNCTUATION_FOLDING)
        .map((ch) => ch.replace(/[\\^\]\-]/g, "\\$&"))
        .join("")}]`,
    "g",
);

/**
 * Normalize text for similarity / exact-match comparisons.
 *
 * Steps (in order):
 *  1. Unicode NFKC fold (e.g. full-width digits → ASCII).
 *  2. Replace a small allow-listed set of punctuation/whitespace
 *     characters that NFKC leaves alone.
 *  3. Lowercase (locale-independent `String.prototype.toLowerCase`).
 *  4. Collapse runs of ASCII whitespace into a single space.
 *  5. Trim leading / trailing whitespace.
 *
 * Returns an empty string for empty / whitespace-only input rather
 * than throwing, so callers can use the return value as a duplicate
 * filter directly.
 */
export function normalizeMemoryText(text: string): string {
    if (typeof text !== "string" || text.length === 0) {
        return "";
    }
    const folded = text
        .normalize("NFKC")
        .replace(FOLDABLE_CHARS, (ch) => PUNCTUATION_FOLDING[ch] ?? ch)
        .toLowerCase()
        .replace(/[\s]+/g, " ")
        .trim();
    return folded;
}

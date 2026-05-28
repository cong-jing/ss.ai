import crypto from "node:crypto";

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
    return crypto.randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

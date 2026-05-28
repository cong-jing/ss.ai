import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const PASSWORD_KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(SALT_BYTES).toString("base64url");
    const hash = await scryptAsync(password, salt, PASSWORD_KEYLEN) as Buffer;
    return `scrypt$${salt}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    const parts = encodedHash.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") {
        return false;
    }

    const salt = parts[1];
    const hashText = parts[2];
    const expected = Buffer.from(hashText, "base64url");
    const actual = await scryptAsync(password, salt, expected.length) as Buffer;

    if (expected.length !== actual.length) {
        return false;
    }
    return crypto.timingSafeEqual(expected, actual);
}

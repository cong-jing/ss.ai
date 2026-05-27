import crypto from "node:crypto";
import type { Request, Response } from "express";
import type { AuthMode, AuthUserInfo } from "@ss-ai/contracts";
import type { RuntimeConfig } from "../util/config.js";
import type { SqliteDb } from "@ss-ai/persona-flow-sqlite";
import { AuthHttpError } from "./errors.js";
import { LocalAuthStore } from "./localAuthStore.js";
import { hashPassword, verifyPassword } from "./passwordHasher.js";
import { generateSessionToken, hashSessionToken } from "./sessionToken.js";

const COOKIE_MAX_AGE_MS_MULTIPLIER = 24 * 60 * 60 * 1000;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
const DISPLAY_NAME_MAX_LENGTH = 80;
const REQUEST_USER_CACHE_KEY = Symbol.for("ss-ai.auth.request-user");

export interface RequestUser {
    userId: string;
    username: string;
    displayName: string | null;
}

interface SessionIssueResult {
    user: RequestUser;
    rawToken: string;
    expiresAt: Date;
}

export interface AuthRuntime {
    readonly mode: AuthMode;
    readonly allowRegistration: boolean;
    getOptionalUser(req: Request): Promise<RequestUser | null>;
    requireUser(req: Request): Promise<RequestUser>;
    getMe(req: Request): Promise<{ authenticated: boolean; user: AuthUserInfo | null }>;
    register(input: { username: string; password: string; displayName?: string | null }): Promise<SessionIssueResult>;
    login(input: { username: string; password: string }): Promise<SessionIssueResult>;
    logout(req: Request): Promise<void>;
    writeSessionCookie(res: Response, rawToken: string, expiresAt: Date): void;
    clearSessionCookie(res: Response): void;
}

export function createAuthRuntime(input: {
    config: RuntimeConfig["auth"];
    sqlite: SqliteDb;
}): AuthRuntime {
    const mode = input.config.mode;
    const allowRegistration = input.config.allowRegistration;
    const cookieName = input.config.cookieName;
    const sessionDays = input.config.sessionDays;
    const runtimeEnv = (process.env["APP_ENV"] ?? process.env["NODE_ENV"] ?? "").toLowerCase();
    const secureCookie = !["", "dev", "development", "local", "test"].includes(runtimeEnv);
    const store = new LocalAuthStore(input.sqlite);
    const defaultUser: RequestUser = {
        userId: input.config.defaultUserId,
        username: input.config.defaultUserId,
        displayName: null,
    };

    // Keep this boundary small. Future auth replacements should only change the
    // credential-to-user resolution inside this runtime, while business routes
    // continue consuming `requireUser().userId` unchanged.
    async function getOptionalUser(req: Request): Promise<RequestUser | null> {
        const cached = (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY];
        if (cached !== undefined) {
            return cached;
        }

        if (mode === "default-user") {
            (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY] = defaultUser;
            return defaultUser;
        }

        const rawToken = getCookie(req, cookieName);
        if (!rawToken) {
            (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY] = null;
            return null;
        }

        const nowIso = new Date().toISOString();
        store.deleteExpiredSessions(nowIso);

        const session = store.getSessionByTokenHash(hashSessionToken(rawToken));
        if (!session) {
            (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY] = null;
            return null;
        }
        if (session.expiresAt <= nowIso) {
            store.deleteSessionByTokenHash(session.tokenHash);
            (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY] = null;
            return null;
        }

        const user = store.getUserById(session.userId);
        if (!user) {
            store.deleteSessionByTokenHash(session.tokenHash);
            (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY] = null;
            return null;
        }

        const resolved: RequestUser = {
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
        };
        (req as Request & { [REQUEST_USER_CACHE_KEY]?: RequestUser | null })[REQUEST_USER_CACHE_KEY] = resolved;
        return resolved;
    }

    async function requireUser(req: Request): Promise<RequestUser> {
        const user = await getOptionalUser(req);
        if (!user) {
            throw new AuthHttpError(401, "Authentication required.");
        }
        return user;
    }

    async function register(payload: { username: string; password: string; displayName?: string | null }): Promise<SessionIssueResult> {
        if (mode !== "local-password") {
            throw new AuthHttpError(400, "Registration is only available in local-password mode.");
        }
        if (!allowRegistration) {
            throw new AuthHttpError(403, "Registration is disabled.");
        }

        const username = normalizeUsername(payload.username);
        const password = validatePassword(payload.password);
        const displayName = normalizeDisplayName(payload.displayName);

        if (!USERNAME_PATTERN.test(username)) {
            throw new AuthHttpError(400, "username must match [a-z0-9._-] and be 3-32 chars.");
        }
        if (store.getUserByUsername(username)) {
            throw new AuthHttpError(409, "username already exists");
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const passwordHash = await hashPassword(password);
        const userId = crypto.randomUUID();
        store.createUser({
            id: userId,
            username,
            passwordHash,
            displayName,
            createdAt: nowIso,
            updatedAt: nowIso,
        });

        return issueSessionForUser({
            userId,
            username,
            displayName,
        });
    }

    async function login(payload: { username: string; password: string }): Promise<SessionIssueResult> {
        if (mode !== "local-password") {
            throw new AuthHttpError(400, "Login is only available in local-password mode.");
        }

        const username = normalizeUsername(payload.username);
        const password = validatePassword(payload.password);
        const user = store.getUserByUsername(username);
        if (!user) {
            throw new AuthHttpError(401, "Invalid username or password.");
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) {
            throw new AuthHttpError(401, "Invalid username or password.");
        }

        return issueSessionForUser({
            userId: user.id,
            username: user.username,
            displayName: user.displayName,
        });
    }

    async function logout(req: Request): Promise<void> {
        if (mode !== "local-password") {
            return;
        }
        const rawToken = getCookie(req, cookieName);
        if (!rawToken) {
            return;
        }
        store.deleteSessionByTokenHash(hashSessionToken(rawToken));
    }

    function writeSessionCookie(res: Response, rawToken: string, expiresAt: Date): void {
        res.cookie(cookieName, rawToken, {
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookie,
            path: "/",
            expires: expiresAt,
        });
    }

    function clearSessionCookie(res: Response): void {
        res.clearCookie(cookieName, {
            httpOnly: true,
            sameSite: "lax",
            secure: secureCookie,
            path: "/",
        });
    }

    async function getMe(req: Request): Promise<{ authenticated: boolean; user: AuthUserInfo | null }> {
        const user = await getOptionalUser(req);
        if (!user) {
            return { authenticated: false, user: null };
        }
        return { authenticated: true, user: toAuthUserInfo(user) };
    }

    function issueSessionForUser(user: RequestUser): SessionIssueResult {
        const now = new Date();
        const rawToken = generateSessionToken();
        const expiresAt = new Date(now.getTime() + (sessionDays * COOKIE_MAX_AGE_MS_MULTIPLIER));
        store.createSession({
            id: crypto.randomUUID(),
            userId: user.userId,
            tokenHash: hashSessionToken(rawToken),
            expiresAt: expiresAt.toISOString(),
            createdAt: now.toISOString(),
        });

        return {
            user,
            rawToken,
            expiresAt,
        };
    }

    return {
        mode,
        allowRegistration,
        getOptionalUser,
        requireUser,
        getMe,
        register,
        login,
        logout,
        writeSessionCookie,
        clearSessionCookie,
    };
}

export function toAuthUserInfo(user: RequestUser): AuthUserInfo {
    return {
        id: user.userId,
        username: user.username,
        displayName: user.displayName,
    };
}

function getCookie(req: Request, name: string): string | null {
    const rawCookie = req.headers.cookie;
    if (!rawCookie) return null;

    const segments = rawCookie.split(";");
    for (const segment of segments) {
        const [keyRaw, ...valueParts] = segment.split("=");
        if (!keyRaw) continue;
        const key = keyRaw.trim();
        if (key !== name) continue;
        const value = valueParts.join("=").trim();
        if (!value) return null;
        return decodeURIComponent(value);
    }
    return null;
}

function normalizeUsername(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeDisplayName(value: string | null | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
        throw new AuthHttpError(400, `displayName must be <= ${DISPLAY_NAME_MAX_LENGTH} chars.`);
    }
    return trimmed;
}

function validatePassword(value: string): string {
    const password = value.trim();
    if (password.length < PASSWORD_MIN_LENGTH) {
        throw new AuthHttpError(400, `password must be at least ${PASSWORD_MIN_LENGTH} chars.`);
    }
    return password;
}

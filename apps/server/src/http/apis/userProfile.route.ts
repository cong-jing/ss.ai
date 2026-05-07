import {
    ApiGetUserProfile,
    ApiUpsertUserProfile
} from "@ss-ai/contracts";
import { registerApi } from "../registerApi.js";
import { toErrorResponse, DEFAULT_USER_ID, type HttpApiContext } from "./apiContext.js";

export function registerUserProfileRoutes(context: HttpApiContext): void {
    registerApi(context.app, ApiGetUserProfile, {
        handleRequest: async () => {
            const profile = await context.stores.userProfile.getUserProfile(DEFAULT_USER_ID);
            return {
                name: profile?.name ?? "",
                bio: profile?.bio ?? "",
                preferredAddress: profile?.preferredAddress ?? null,
            };
        },
    });

    registerApi(context.app, ApiUpsertUserProfile, {
        handleRequest: async (_, body) => {
            const name = typeof body?.name === "string" ? body.name : "";
            const bio = typeof body?.bio === "string" ? body.bio : "";
            const preferredAddress = typeof body?.preferredAddress === "string"
                ? body.preferredAddress.trim() || null
                : null;

            const now = new Date().toISOString();
            const existing = await context.stores.userProfile.getUserProfile(DEFAULT_USER_ID);
            await context.stores.userProfile.upsertUserProfile({
                userId: DEFAULT_USER_ID,
                name,
                bio,
                preferredAddress,
                metadata: existing?.metadata ?? {},
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            });
            return { name, bio, preferredAddress };
        },
        handleError: (error) => {
            const response = toErrorResponse(error);
            return { status: 400, body: response };
        },
    });
}

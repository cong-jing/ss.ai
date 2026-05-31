import { ApiAuthMe, type AuthSessionResponse } from "@ss-ai/contracts";
import type { HttpApiContext } from "../http/apis/apiContext.js";
import { registerApi } from "../http/registerApi.js";
import { getErrorStatusCode, toAuthErrorResponse } from "./errors.js";
import { toAuthUserInfo } from "./authRuntime.js";

export function registerAuthRoutes(context: HttpApiContext): void {
    registerApi(context.app, ApiAuthMe, {
        handleRequest: async (req) => {
            const me = await context.authRuntime.getMe(req);
            return {
                authMode: context.authRuntime.mode,
                allowRegistration: context.authRuntime.allowRegistration,
                authenticated: me.authenticated,
                user: me.user,
            };
        },
        handleError: (error) => ({ status: getErrorStatusCode(error, 401), body: toAuthErrorResponse(error) }),
    });

    context.app.post("/v1/auth/register", async (req, res) => {
        try {
            const issued = await context.authRuntime.register({
                username: req.body?.username ?? "",
                password: req.body?.password ?? "",
                displayName: req.body?.displayName ?? null,
            });
            context.authRuntime.writeSessionCookie(res, issued.rawToken, issued.expiresAt);
            const response: AuthSessionResponse = {
                authMode: context.authRuntime.mode,
                authenticated: true,
                user: toAuthUserInfo(issued.user),
            };
            res.json(response);
        } catch (error) {
            res.status(getErrorStatusCode(error, 400)).json(toAuthErrorResponse(error));
        }
    });

    context.app.post("/v1/auth/login", async (req, res) => {
        try {
            const issued = await context.authRuntime.login({
                username: req.body?.username ?? "",
                password: req.body?.password ?? "",
            });
            context.authRuntime.writeSessionCookie(res, issued.rawToken, issued.expiresAt);
            const response: AuthSessionResponse = {
                authMode: context.authRuntime.mode,
                authenticated: true,
                user: toAuthUserInfo(issued.user),
            };
            res.json(response);
        } catch (error) {
            res.status(getErrorStatusCode(error, 400)).json(toAuthErrorResponse(error));
        }
    });

    context.app.post("/v1/auth/logout", async (req, res) => {
        try {
            await context.authRuntime.logout(req);
            context.authRuntime.clearSessionCookie(res);
            res.status(204).send();
        } catch (error) {
            res.status(getErrorStatusCode(error, 400)).json(toAuthErrorResponse(error));
        }
    });
}

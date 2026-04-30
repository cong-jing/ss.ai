/**
 * Thin wrapper around `fetch` for tests.
 * Returns both the HTTP status and parsed JSON body.
 */
export async function httpRequest<T>(
    base: string,
    method: string,
    urlPath: string,
    body?: unknown
): Promise<{ status: number; data: T }> {
    const res = await fetch(`${base}${urlPath}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : (undefined as T);
    return { status: res.status, data };
}

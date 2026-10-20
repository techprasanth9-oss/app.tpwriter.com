/**
 * Minimal typed fetch wrapper used by the auth and document API clients.
 * Always sends `credentials: "include"` so the session cookie flows.
 *
 * Base URL resolution:
 *   1. `VITE_API_URL` env var — set this in .env.dev / .env.prod when the
 *      FE is deployed to a different origin than the BE.
 *   2. Fallback `/api` — in local dev, Vite's proxy (see vite.config.ts)
 *      rewrites `/api/*` → `http://localhost:3001/*`, so a bare path works.
 *
 * Vite inlines `import.meta.env` at build time, so the base is frozen per
 * build — set the env var before `pnpm build` / `pnpm dev`.
 */

const BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ||
  "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = opts;
  const init: RequestInit = {
    method,
    credentials: "include",
    signal,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, init);
  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let code = "unknown_error";
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      if (typeof data.error === "string") code = data.error;
      if (typeof data.message === "string") message = data.message;
    } catch {
      /* body not JSON */
    }
    throw new ApiError(res.status, code, message);
  }

  return (await res.json()) as T;
}

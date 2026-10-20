/**
 * Minimal typed fetch wrapper used by the auth and document API clients.
 * Always sends `credentials: "include"` so the session cookie flows. Routes
 * go through the Vite proxy at `/api` → `http://localhost:3001` (new BE).
 */

const BASE = "/api";

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

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

/** Absolute-or-proxied URL for an API path, e.g. `apiUrl("/uploads/x.png")`. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/**
 * Share-link token for documents opened through a link (`?share=…`).
 * Kept per tab, sent as `X-Share-Token` on every request; the API only
 * honours it for the document it belongs to.
 */
const SHARE_KEY = "tp.shareTokens";

function shareTokens(): Record<string, string> {
  try {
    return JSON.parse(sessionStorage.getItem(SHARE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function setShareToken(documentId: string, token: string): void {
  try {
    sessionStorage.setItem(SHARE_KEY, JSON.stringify({ ...shareTokens(), [documentId]: token }));
  } catch {
    /* storage unavailable — the link works for this page load only */
  }
}

/** Token for the document a request path targets, if one was stored. */
function shareTokenFor(path: string): string | undefined {
  const id = /^\/documents\/([A-Za-z0-9]+)/.exec(path)?.[1];
  return id ? shareTokens()[id] : undefined;
}

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
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(shareTokenFor(path) ? { "x-share-token": shareTokenFor(path)! } : {}),
    },
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

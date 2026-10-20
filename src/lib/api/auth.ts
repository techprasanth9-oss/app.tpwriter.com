import { api } from "./client";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export function fetchMe(signal?: AbortSignal): Promise<AuthUser> {
  return api<AuthUser>("/auth/me", { signal });
}

export function login(email: string, password: string): Promise<AuthUser> {
  return api<AuthUser>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function signup(
  email: string,
  password: string,
  displayName?: string,
): Promise<AuthUser> {
  return api<AuthUser>("/auth/signup", {
    method: "POST",
    body: { email, password, displayName },
  });
}

export function logout(): Promise<void> {
  return api<void>("/auth/logout", { method: "POST" });
}

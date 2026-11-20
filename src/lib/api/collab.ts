import { api } from "./client";
import type { DocumentMeta, EditorBlock } from "./documents";

/**
 * Collaboration API (Phase 6). Mirrors tp-writer-api 1:1 — don't drift.
 *
 * Roles, weakest to strongest: viewer < commenter < editor < owner.
 *   viewer    — read the document and its comments
 *   commenter — + create / reply / resolve comments
 *   editor    — + edit content and metadata, version history, restore
 *   owner     — + sharing, delete
 *
 * Link sharing: a document can be opened by any signed-in user holding its
 * link token (sent as the `X-Share-Token` header, see client.ts), with the
 * link's role. People invited by email who don't have an account yet get
 * access when they sign up with that email.
 */

export type Role = "viewer" | "commenter" | "editor" | "owner";

export const ROLE_RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

export function canAtLeast(role: Role | null | undefined, needed: Role): boolean {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[needed];
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
}

// ── Sharing ─────────────────────────────────────────────────────────────

export interface ShareMember extends PublicUser {
  role: Exclude<Role, "owner">;
}

export interface ShareInvite {
  email: string;
  role: Exclude<Role, "owner">;
}

export interface ShareLink {
  enabled: boolean;
  role: Exclude<Role, "owner">;
  /** Present when enabled. */
  token?: string;
}

export interface Shares {
  owner: PublicUser;
  members: ShareMember[];
  invites: ShareInvite[];
  link: ShareLink;
}

/** GET /documents/:id/shares (editor+). */
export function getShares(id: string): Promise<Shares> {
  return api(`/documents/${id}/shares`);
}

/** GET /documents/:id/people (commenter+) — owner + members, for
 *  @mentions (no invites, roles or link token). */
export function listPeople(id: string): Promise<PublicUser[]> {
  return api(`/documents/${id}/people`);
}

/** PUT /documents/:id/shares (owner) — add or change someone by email. */
export function shareWith(id: string, email: string, role: ShareMember["role"]): Promise<Shares> {
  return api(`/documents/${id}/shares`, { method: "PUT", body: { email, role } });
}

/** DELETE /documents/:id/shares/:who (owner) — `who` is a user id or an
 *  invited email. */
export function unshare(id: string, who: string): Promise<Shares> {
  return api(`/documents/${id}/shares/${encodeURIComponent(who)}`, { method: "DELETE" });
}

/** PUT /documents/:id/link (owner). Enabling after disabling issues a new
 *  token (old links stop working). */
export function setShareLink(id: string, link: { enabled: boolean; role: ShareLink["role"] }): Promise<Shares> {
  return api(`/documents/${id}/link`, { method: "PUT", body: link });
}

// ── Live changes & presence ─────────────────────────────────────────────

/**
 * GET /documents/:id/changes?since=R — everything that changed after
 * revision R. `reset: true` means R is too old to diff from (reload).
 * Comments are signalled by a counter so clients refetch them.
 */
export interface DocumentChanges {
  revision: number;
  reset?: boolean;
  upserts: EditorBlock[];
  deletes: string[];
  /** Present when the block order changed after R. */
  order?: string[];
  /** Present when title / layout / page setup / styles changed after R. */
  meta?: DocumentMeta;
  /** Bumps on every comment change. */
  commentsVersion: number;
}

export function getChanges(id: string, since: number, signal?: AbortSignal): Promise<DocumentChanges> {
  return api(`/documents/${id}/changes?since=${since}`, { signal });
}

export interface Presence extends PublicUser {
  state: "viewing" | "editing";
  /** Block the user's caret is in, if editing. */
  blockId: string | null;
  /** Stable colour per user (hex). */
  color: string;
  lastSeen: string;
}

/** POST /documents/:id/presence — heartbeat (every few seconds); returns
 *  everyone else currently on the document. */
export function heartbeat(
  id: string,
  body: { state: Presence["state"]; blockId: string | null },
): Promise<{ present: Presence[] }> {
  return api(`/documents/${id}/presence`, { method: "POST", body });
}

// ── Comments ────────────────────────────────────────────────────────────

/** Where a thread is attached: a quote inside one block, with a little
 *  context on either side to re-find it after edits (W3C text quote). */
export interface CommentAnchor {
  blockId: string;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface Comment {
  id: string;
  author: PublicUser;
  /** Plain text. Mentions are written as @[Display Name](userId). */
  body: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  resolved: boolean;
  resolvedBy: PublicUser | null;
  comments: Comment[];
  createdAt: string;
}

export function listComments(id: string, signal?: AbortSignal): Promise<CommentThread[]> {
  return api(`/documents/${id}/comments`, { signal });
}

export function createThread(id: string, anchor: CommentAnchor, body: string): Promise<CommentThread> {
  return api(`/documents/${id}/comments`, { method: "POST", body: { anchor, body } });
}

export function replyToThread(id: string, threadId: string, body: string): Promise<CommentThread> {
  return api(`/documents/${id}/comments/${threadId}/replies`, { method: "POST", body: { body } });
}

export function setThreadResolved(id: string, threadId: string, resolved: boolean): Promise<CommentThread> {
  return api(`/documents/${id}/comments/${threadId}`, { method: "PATCH", body: { resolved } });
}

export function editComment(id: string, threadId: string, commentId: string, body: string): Promise<CommentThread> {
  return api(`/documents/${id}/comments/${threadId}/replies/${commentId}`, { method: "PATCH", body: { body } });
}

/** Deleting a thread's first comment deletes the thread. */
export function deleteComment(id: string, threadId: string, commentId: string): Promise<void> {
  return api(`/documents/${id}/comments/${threadId}/replies/${commentId}`, { method: "DELETE" });
}

export interface MentionNotification {
  id: string;
  documentId: string;
  documentTitle: string;
  threadId: string;
  from: PublicUser;
  excerpt: string;
  read: boolean;
  createdAt: string;
}

/** GET /notifications — mentions of the current user, newest first. */
export function listNotifications(): Promise<MentionNotification[]> {
  return api(`/notifications`);
}

export function markNotificationsRead(ids: string[]): Promise<void> {
  return api(`/notifications/read`, { method: "POST", body: { ids } });
}

// ── Version history ─────────────────────────────────────────────────────

export interface VersionSummary {
  id: string;
  revision: number;
  /** Named versions have a label; automatic ones don't. */
  label: string | null;
  auto: boolean;
  createdAt: string;
  createdBy: PublicUser | null;
}

export interface VersionContent extends VersionSummary {
  title: string;
  blocks: EditorBlock[];
  defaultLayout: DocumentMeta["defaultLayout"];
  pageSetup: Record<string, unknown>;
  styles: Record<string, unknown>;
}

/** GET /documents/:id/versions (editor+), newest first. */
export function listVersions(id: string): Promise<VersionSummary[]> {
  return api(`/documents/${id}/versions`);
}

export function getVersion(id: string, versionId: string): Promise<VersionContent> {
  return api(`/documents/${id}/versions/${versionId}`);
}

/** POST /documents/:id/versions — name the current state. */
export function createNamedVersion(id: string, label: string): Promise<VersionSummary> {
  return api(`/documents/${id}/versions`, { method: "POST", body: { label } });
}

/** POST /documents/:id/versions/:vid/restore — the current state is saved
 *  as an automatic version first; returns the new revision. */
export function restoreVersion(id: string, versionId: string): Promise<{ revision: number }> {
  return api(`/documents/${id}/versions/${versionId}/restore`, { method: "POST" });
}

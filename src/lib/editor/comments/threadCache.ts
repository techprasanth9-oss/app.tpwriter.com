/**
 * Immutable updates to the cached thread list (TanStack Query data) used
 * for optimistic comment mutations.
 */
import type { Comment, CommentAnchor, CommentThread, PublicUser } from "~/lib/api/collab";
import { mentionedIds } from "./mentions";

export const TEMP_PREFIX = "tmp-";
let seq = 0;
export function tempId(): string {
  seq += 1;
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${seq}`;
}
export const isTemp = (id: string) => id.startsWith(TEMP_PREFIX);

export function draftComment(author: PublicUser, body: string, now = new Date()): Comment {
  return {
    id: tempId(),
    author,
    body,
    mentions: mentionedIds(body),
    createdAt: now.toISOString(),
    editedAt: null,
  };
}

export function draftThread(author: PublicUser, anchor: CommentAnchor, body: string, now = new Date()): CommentThread {
  return {
    id: tempId(),
    anchor,
    resolved: false,
    resolvedBy: null,
    comments: [draftComment(author, body, now)],
    createdAt: now.toISOString(),
  };
}

type List = CommentThread[] | undefined;

export function addThread(list: List, thread: CommentThread): CommentThread[] {
  return [...(list ?? []).filter((t) => t.id !== thread.id), thread];
}

/** Swap `id` (e.g. a temp thread) for the server's copy. */
export function replaceThread(list: List, id: string, thread: CommentThread): CommentThread[] {
  const items = list ?? [];
  if (!items.some((t) => t.id === id)) return addThread(items, thread);
  return items.filter((t) => t.id !== thread.id || t.id === id).map((t) => (t.id === id ? thread : t));
}

export function removeThread(list: List, id: string): CommentThread[] {
  return (list ?? []).filter((t) => t.id !== id);
}

export function addReply(list: List, threadId: string, comment: Comment): CommentThread[] {
  return (list ?? []).map((t) => (t.id === threadId ? { ...t, comments: [...t.comments, comment] } : t));
}

export function setResolved(list: List, threadId: string, resolved: boolean, by: PublicUser | null): CommentThread[] {
  return (list ?? []).map((t) =>
    t.id === threadId ? { ...t, resolved, resolvedBy: resolved ? by : null } : t,
  );
}

export function updateComment(list: List, threadId: string, commentId: string, body: string, now = new Date()): CommentThread[] {
  return (list ?? []).map((t) =>
    t.id === threadId
      ? {
          ...t,
          comments: t.comments.map((c) =>
            c.id === commentId ? { ...c, body, mentions: mentionedIds(body), editedAt: now.toISOString() } : c,
          ),
        }
      : t,
  );
}

/** Deleting a thread's first comment deletes the thread (API semantics). */
export function removeComment(list: List, threadId: string, commentId: string): CommentThread[] {
  const items = list ?? [];
  const thread = items.find((t) => t.id === threadId);
  if (!thread) return items;
  if (thread.comments[0]?.id === commentId) return removeThread(items, threadId);
  return items.map((t) => (t.id === threadId ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) } : t));
}

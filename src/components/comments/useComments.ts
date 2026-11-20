import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createThread,
  deleteComment,
  editComment,
  listComments,
  replyToThread,
  setThreadResolved,
  type Comment,
  type CommentAnchor,
  type CommentThread,
  type PublicUser,
} from "~/lib/api/collab";
import { anchorFromSelection } from "~/lib/editor/comments/anchor";
import {
  addReply,
  addThread,
  draftComment,
  draftThread,
  removeComment,
  removeThread,
  replaceThread,
  setResolved,
  updateComment,
} from "~/lib/editor/comments/threadCache";

export const commentsKey = (documentId: string) => ["comments", documentId] as const;

/** Threads of a document; refetches whenever `commentsVersion` changes
 *  (the live-changes feed bumps it on every comment change). */
export function useCommentThreads(documentId: string, commentsVersion: number, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: commentsKey(documentId),
    queryFn: ({ signal }) => listComments(documentId, signal),
    enabled,
    staleTime: 10_000,
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void qc.invalidateQueries({ queryKey: commentsKey(documentId) });
  }, [commentsVersion, documentId, qc]);
  return query;
}

type Snapshot = { prev: CommentThread[] | undefined };

async function snapshot(qc: QueryClient, key: readonly unknown[]): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: key });
  return { prev: qc.getQueryData<CommentThread[]>(key) };
}

function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

/**
 * Comment mutations with optimistic cache updates; every failure rolls the
 * cache back and sets `error` (cleared by `clearError` or the next success).
 */
export function useCommentMutations(documentId: string, currentUser: PublicUser | null) {
  const qc = useQueryClient();
  const key = commentsKey(documentId);
  const [error, setError] = useState<string | null>(null);
  const set = (fn: (l: CommentThread[] | undefined) => CommentThread[]) =>
    qc.setQueryData<CommentThread[]>(key, (l) => fn(l));
  const rollback = (ctx: Snapshot | undefined, err: unknown, what: string) => {
    if (ctx) qc.setQueryData(key, ctx.prev);
    setError(`${what}: ${errorText(err)}`);
  };

  const create = useMutation({
    mutationFn: (v: { anchor: CommentAnchor; body: string; temp: CommentThread }) =>
      createThread(documentId, v.anchor, v.body),
    onMutate: async (v) => {
      const ctx = await snapshot(qc, key);
      set((l) => addThread(l, v.temp));
      return ctx;
    },
    onError: (err, _v, ctx) => rollback(ctx, err, "Couldn't post comment"),
    onSuccess: (thread, v) => {
      setError(null);
      set((l) => replaceThread(l, v.temp.id, thread));
    },
  });

  const reply = useMutation({
    mutationFn: (v: { threadId: string; body: string; temp: Comment }) => replyToThread(documentId, v.threadId, v.body),
    onMutate: async (v) => {
      const ctx = await snapshot(qc, key);
      set((l) => addReply(l, v.threadId, v.temp));
      return ctx;
    },
    onError: (err, _v, ctx) => rollback(ctx, err, "Couldn't post reply"),
    onSuccess: (thread, v) => {
      setError(null);
      set((l) => replaceThread(l, v.threadId, thread));
    },
  });

  const resolve = useMutation({
    mutationFn: (v: { threadId: string; resolved: boolean }) => setThreadResolved(documentId, v.threadId, v.resolved),
    onMutate: async (v) => {
      const ctx = await snapshot(qc, key);
      set((l) => setResolved(l, v.threadId, v.resolved, currentUser));
      return ctx;
    },
    onError: (err, v, ctx) => rollback(ctx, err, v.resolved ? "Couldn't resolve" : "Couldn't reopen"),
    onSuccess: (thread, v) => {
      setError(null);
      set((l) => replaceThread(l, v.threadId, thread));
    },
  });

  const edit = useMutation({
    mutationFn: (v: { threadId: string; commentId: string; body: string }) =>
      editComment(documentId, v.threadId, v.commentId, v.body),
    onMutate: async (v) => {
      const ctx = await snapshot(qc, key);
      set((l) => updateComment(l, v.threadId, v.commentId, v.body));
      return ctx;
    },
    onError: (err, _v, ctx) => rollback(ctx, err, "Couldn't save edit"),
    onSuccess: (thread, v) => {
      setError(null);
      set((l) => replaceThread(l, v.threadId, thread));
    },
  });

  const remove = useMutation({
    mutationFn: (v: { threadId: string; commentId: string }) => deleteComment(documentId, v.threadId, v.commentId),
    onMutate: async (v) => {
      const ctx = await snapshot(qc, key);
      set((l) => removeComment(l, v.threadId, v.commentId));
      return ctx;
    },
    onError: (err, _v, ctx) => rollback(ctx, err, "Couldn't delete"),
    onSuccess: () => setError(null),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    error,
    clearError: () => setError(null),
    /** Posts a new thread. `temp` is in the cache immediately; `done`
     *  resolves to the server's thread (its id replaces the temp one), or
     *  null after a rollback. */
    createThread(anchor: CommentAnchor, body: string): { temp: CommentThread; done: Promise<CommentThread | null> } | null {
      if (!currentUser) return null;
      const temp = draftThread(currentUser, anchor, body);
      const done = create.mutateAsync({ anchor, body, temp }).catch(() => null);
      return { temp, done };
    },
    reply(threadId: string, body: string) {
      if (!currentUser) return;
      reply.mutate({ threadId, body, temp: draftComment(currentUser, body) });
    },
    setResolved(threadId: string, resolved: boolean) {
      resolve.mutate({ threadId, resolved });
    },
    edit(threadId: string, commentId: string, body: string) {
      edit.mutate({ threadId, commentId, body });
    },
    remove(threadId: string, commentId: string) {
      remove.mutate({ threadId, commentId });
    },
    /** Remove a thread from the cache only (e.g. a failed temp). */
    forget(threadId: string) {
      set((l) => removeThread(l, threadId));
    },
  };
}

export type CommentMutations = ReturnType<typeof useCommentMutations>;

// ── Panel UI state ──────────────────────────────────────────────────────

export interface CommentDraft {
  anchor: CommentAnchor;
  /** Changes per draft so the composer remounts. */
  key: number;
}

export interface CommentsUi {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  activeThreadId: string | null;
  setActiveThreadId(id: string | null): void;
  /** Open the panel on a thread (e.g. from `?thread=` or a notification). */
  showThread(id: string): void;
  draft: CommentDraft | null;
  /** Capture the document selection as a new comment's anchor and open the
   *  composer. Returns false (and does nothing) when there's no usable
   *  selection — non-empty, inside one block's text. */
  beginComment(root: HTMLElement | null): boolean;
  cancelDraft(): void;
}

let draftSeq = 0;

export function useCommentsUi(initialOpen = false): CommentsUi {
  const [open, setOpen] = useState(initialOpen);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);

  const beginComment = useCallback((root: HTMLElement | null) => {
    if (!root) return false;
    const anchor = anchorFromSelection(root);
    if (!anchor) return false;
    draftSeq += 1;
    setDraft({ anchor, key: draftSeq });
    setActiveThreadId(null);
    setOpen(true);
    return true;
  }, []);

  const showThread = useCallback((id: string) => {
    setActiveThreadId(id);
    setOpen(true);
  }, []);

  return {
    open,
    setOpen,
    toggle: useCallback(() => setOpen((o) => !o), []),
    activeThreadId,
    setActiveThreadId,
    showThread,
    draft,
    beginComment,
    cancelDraft: useCallback(() => setDraft(null), []),
  };
}

/** `matchMedia` state (false where unsupported). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, [query]);
  return matches;
}

/** Re-render every `ms` (relative timestamps). */
export function useNow(ms = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

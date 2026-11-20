import { useCallback, useEffect, useRef, useState } from "react";
import * as docsApi from "~/lib/api/documents";
import { ApiError } from "~/lib/api/client";
import {
  applyDiff,
  diffContent,
  isEmptyDiff,
  stateFromBlocks,
  type DiffBlock,
  type SavedState,
} from "~/lib/editor/contentDiff";
import { deleteDraft, saveDraft } from "~/lib/editor/drafts";
import { getChanges, type DocumentChanges } from "~/lib/api/collab";
import { mergeRemote } from "~/lib/editor/collab/mergeRemote";

export type AutosaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  /** Network / server failure — retrying automatically. */
  | "error"
  /** We're too far behind the server to merge; autosave is paused. */
  | "conflict";

/** What live sync hands the editor after merging others' changes. */
export interface RemoteUpdate {
  /** Editor content the merge was computed from. */
  current: DiffBlock[];
  /** Merged content the editor should now show. */
  next: DiffBlock[];
}

interface Options {
  documentId: string;
  /** Server state the editor was loaded from. */
  initialRevision: number;
  initialBlocks: DiffBlock[];
  /** Current editor content, or null if the editor isn't ready. */
  getBlocks: () => Promise<DiffBlock[] | null>;
  debounceMs?: number;
  /** Viewers / commenters: pull others' changes, never save. */
  readOnly?: boolean;
  /** How often to pull others' changes (0 = off). */
  liveIntervalMs?: number;
  /** Put merged content into the editor. */
  onRemoteContent?: (update: RemoteUpdate) => Promise<void>;
  /** Blocks both this editor and someone else changed (ours was kept). */
  onCollisions?: (blockIds: string[]) => void;
  /** Title / layout / page setup / styles changed elsewhere. */
  onRemoteMeta?: (meta: NonNullable<DocumentChanges["meta"]>) => void;
  /** The server's comment counter (refetch comments when it moves). */
  onCommentsVersion?: (version: number) => void;
}

interface Result {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  error: string | null;
  /** Call on every content change. */
  markDirty: () => void;
  saveNow: () => Promise<void>;
  /** After a conflict: make the server match this editor ("keep mine"). */
  overwriteServer: () => Promise<void>;
}

const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

/**
 * Debounced, block-level autosave. Each save sends only the blocks that
 * changed since the last successful save (plus the order when it changed),
 * guarded by the document revision so two tabs can't silently overwrite
 * each other.
 *
 * Before each attempt the full content is also written to a local draft
 * (IndexedDB); it's deleted once the server has everything, so a crash or
 * a closed tab while offline doesn't lose work.
 */
export function useAutosave({
  documentId,
  initialRevision,
  initialBlocks,
  getBlocks,
  debounceMs = 1200,
  readOnly = false,
  liveIntervalMs = 3000,
  ...callbacks
}: Options): Result {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savedRef = useRef<SavedState>(stateFromBlocks(initialBlocks));
  const revisionRef = useRef(initialRevision);
  const timerRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryDelayRef = useRef(MIN_RETRY_MS);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const getBlocksRef = useRef(getBlocks);
  getBlocksRef.current = getBlocks;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const conflictStreakRef = useRef(0);
  const everSavedRef = useRef(false);

  /**
   * Merge everything saved elsewhere since our revision into the editor
   * and the baseline. Caller holds the lock (`inFlightRef`).
   */
  const pullLocked = useCallback(async (): Promise<void> => {
    const changes = await getChanges(documentId, revisionRef.current);
    const cb = callbacksRef.current;
    cb.onCommentsVersion?.(changes.commentsVersion);
    if (changes.reset) {
      conflictRef.current = true;
      setStatus("conflict");
      setError("This document changed too much elsewhere to merge.");
      return;
    }
    if (changes.revision === revisionRef.current) return;
    const blocks = await getBlocksRef.current();
    if (!blocks) return;
    const merged = mergeRemote(savedRef.current, blocks, changes);
    if (merged.changed) await cb.onRemoteContent?.({ current: blocks, next: merged.local });
    savedRef.current = merged.base;
    revisionRef.current = changes.revision;
    if (changes.meta) cb.onRemoteMeta?.(changes.meta);
    if (merged.collisions.length > 0) {
      cb.onCollisions?.(merged.collisions);
      // Our version of those blocks still has to be written back.
      dirtyRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const clearTimers = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (retryRef.current !== null) window.clearTimeout(retryRef.current);
    timerRef.current = null;
    retryRef.current = null;
  };

  const doSave = useCallback(async (): Promise<void> => {
    if (conflictRef.current || readOnly) return;
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    clearTimers();
    inFlightRef.current = true;
    dirtyRef.current = false;

    try {
      const blocks = await getBlocksRef.current();
      if (!blocks) return;
      const diff = diffContent(savedRef.current, blocks);
      if (isEmptyDiff(diff)) {
        // Nothing actually changed (e.g. a chart re-rendered): back to how
        // it was — don't announce a save that didn't happen.
        setStatus((s) => (s === "pending" || s === "saving" ? (everSavedRef.current ? "saved" : "idle") : s));
        if (!dirtyRef.current) await deleteDraft(documentId);
        return;
      }
      setStatus("saving");
      await saveDraft({
        documentId,
        baseRevision: revisionRef.current,
        blocks,
        savedAt: Date.now(),
      });
      const res = await docsApi.saveContent(documentId, {
        baseRevision: revisionRef.current,
        ...diff,
      });
      savedRef.current = applyDiff(savedRef.current, diff);
      conflictStreakRef.current = 0;
      if (res.merged) {
        // Others saved in between and the server merged around them: catch
        // up from our old revision (their blocks + an echo of ours).
        await pullLocked().catch(() => undefined);
      } else {
        revisionRef.current = res.revision;
      }
      retryDelayRef.current = MIN_RETRY_MS;
      // Edits made during the request will write a fresh draft next round.
      if (!dirtyRef.current) await deleteDraft(documentId);
      setError(null);
      // Edits that arrived during the request are still queued — don't
      // claim "Saved" until they're in too.
      setStatus(dirtyRef.current ? "pending" : "saved");
      setLastSavedAt(new Date());
      everSavedRef.current = true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && conflictStreakRef.current < 3) {
        // Someone changed the same blocks (or the block order): merge their
        // version in, then save ours on top of it straight away.
        conflictStreakRef.current++;
        try {
          await pullLocked();
        } catch {
          /* fall through to a normal retry */
        }
        dirtyRef.current = true;
        setStatus("pending");
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        conflictRef.current = true;
        setStatus("conflict");
        setError("This document was changed somewhere else.");
        return;
      }
      if (err instanceof ApiError && err.status === 400) {
        // Our idea of the server state drifted (e.g. a save whose response
        // was lost). Re-read it so the next diff is computed correctly.
        await resync().catch(() => undefined);
      }
      dirtyRef.current = true;
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, MAX_RETRY_MS);
      retryRef.current = window.setTimeout(() => void doSave(), delay);
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current && !conflictRef.current && retryRef.current === null) {
        timerRef.current = window.setTimeout(() => void doSave(), debounceMs);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, debounceMs, readOnly, pullLocked]);

  /** Replace our saved-state baseline with what the server has now. */
  const resync = useCallback(async () => {
    const doc = await docsApi.getDocument(documentId);
    savedRef.current = stateFromBlocks(doc.blocks);
    revisionRef.current = doc.revision;
  }, [documentId]);

  const markDirty = useCallback(() => {
    if (readOnly) return;
    dirtyRef.current = true;
    if (conflictRef.current) return;
    setStatus((s) => (s === "saving" ? s : "pending"));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void doSave(), debounceMs);
  }, [debounceMs, doSave, readOnly]);

  // Live: pull others' changes every few seconds while the tab is visible.
  useEffect(() => {
    if (!liveIntervalMs) return;
    const tick = async () => {
      if (document.hidden || inFlightRef.current || conflictRef.current) return;
      inFlightRef.current = true;
      try {
        await pullLocked();
      } catch {
        /* offline / transient — next tick */
      } finally {
        inFlightRef.current = false;
        if (dirtyRef.current && !conflictRef.current && timerRef.current === null && retryRef.current === null) {
          timerRef.current = window.setTimeout(() => void doSave(), debounceMs);
        }
      }
    };
    const timer = window.setInterval(() => void tick(), liveIntervalMs);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [liveIntervalMs, pullLocked, doSave, debounceMs]);

  const saveNow = useCallback(() => doSave(), [doSave]);

  const overwriteServer = useCallback(async () => {
    await resync();
    conflictRef.current = false;
    setError(null);
    await doSave();
  }, [doSave, resync]);

  // Retry as soon as the network comes back.
  useEffect(() => {
    const onOnline = () => {
      if (dirtyRef.current && !conflictRef.current) void doSave();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [doSave]);

  // Warn before closing the tab with unsaved edits (an unload can't wait
  // for a save to finish).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !inFlightRef.current && timerRef.current === null) return;
      void doSave();
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [doSave]);

  // Flush on unmount (navigating back to the list).
  useEffect(
    () => () => {
      const pending = timerRef.current !== null || dirtyRef.current;
      clearTimers();
      if (pending) void doSave();
    },
    [doSave],
  );

  return { status, lastSavedAt, error, markDirty, saveNow, overwriteServer };
}

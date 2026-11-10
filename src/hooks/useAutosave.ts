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

export type AutosaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  /** Network / server failure — retrying automatically. */
  | "error"
  /** Someone else saved a newer revision; autosave is paused. */
  | "conflict";

interface Options {
  documentId: string;
  /** Server state the editor was loaded from. */
  initialRevision: number;
  initialBlocks: DiffBlock[];
  /** Current editor content, or null if the editor isn't ready. */
  getBlocks: () => Promise<DiffBlock[] | null>;
  debounceMs?: number;
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
 */
export function useAutosave({
  documentId,
  initialRevision,
  initialBlocks,
  getBlocks,
  debounceMs = 1200,
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

  const clearTimers = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (retryRef.current !== null) window.clearTimeout(retryRef.current);
    timerRef.current = null;
    retryRef.current = null;
  };

  const doSave = useCallback(async (): Promise<void> => {
    if (conflictRef.current) return;
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
        setStatus((s) => (s === "pending" || s === "saving" ? "saved" : s));
        return;
      }
      setStatus("saving");
      const res = await docsApi.saveContent(documentId, {
        baseRevision: revisionRef.current,
        ...diff,
      });
      savedRef.current = applyDiff(savedRef.current, diff);
      revisionRef.current = res.revision;
      retryDelayRef.current = MIN_RETRY_MS;
      setError(null);
      setStatus("saved");
      setLastSavedAt(new Date());
    } catch (err) {
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
  }, [documentId, debounceMs]);

  /** Replace our saved-state baseline with what the server has now. */
  const resync = useCallback(async () => {
    const doc = await docsApi.getDocument(documentId);
    savedRef.current = stateFromBlocks(doc.blocks);
    revisionRef.current = doc.revision;
  }, [documentId]);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (conflictRef.current) return;
    setStatus((s) => (s === "saving" ? s : "pending"));
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void doSave(), debounceMs);
  }, [debounceMs, doSave]);

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

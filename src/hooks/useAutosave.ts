import { useCallback, useEffect, useRef, useState } from "react";
import * as docsApi from "~/lib/api/documents";
import type {
  EditorOutput,
  PageLayoutOverride,
} from "~/lib/api/documents";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

interface PagePatch {
  pageId: string;
  content: EditorOutput;
  layoutOverride?: PageLayoutOverride | null;
}

interface Options {
  documentId: string | undefined;
  /**
   * Called by the hook once per debounce window to fetch the full snapshot
   * to send: title + per-page block arrays. The hook will PATCH the doc
   * metadata (title) and PUT each page in parallel.
   */
  getSnapshot: () => Promise<{
    title: string;
    pages: PagePatch[];
  }>;
  changeSignal: unknown;
  debounceMs?: number;
  enabled?: boolean;
}

interface Result {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  error: string | null;
  saveNow: () => Promise<void>;
}

/**
 * Per-page debounced autosave. Watches `changeSignal`; after `debounceMs`
 * of quiet, calls `getSnapshot()` and persists the title + every page in
 * parallel. Coalesces rapid edits into a single save round.
 */
export function useAutosave({
  documentId,
  getSnapshot,
  changeSignal,
  debounceMs = 1500,
  enabled = true,
}: Options): Result {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const dirtyAfterSaveRef = useRef(false);
  const firstRunRef = useRef(true);

  const doSave = useCallback(async () => {
    if (!documentId) return;
    if (inFlightRef.current) {
      dirtyAfterSaveRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setStatus("saving");
    setError(null);
    try {
      const snapshot = await getSnapshot();
      await docsApi.updateDocument(documentId, { title: snapshot.title });
      await Promise.all(
        snapshot.pages.map((p) =>
          docsApi.upsertPage(
            documentId,
            p.pageId,
            p.content,
            p.layoutOverride ?? null,
          ),
        ),
      );
      setStatus("saved");
      setLastSavedAt(new Date());
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      if (dirtyAfterSaveRef.current) {
        dirtyAfterSaveRef.current = false;
        void doSave();
      }
    }
  }, [documentId, getSnapshot]);

  useEffect(() => {
    if (!enabled || !documentId) return;
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, debounceMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [changeSignal, debounceMs, doSave, documentId, enabled]);

  // Flush pending save on unmount so last-window edits don't get lost.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        void doSave();
      }
    };
  }, [doSave]);

  const saveNow = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await doSave();
  }, [doSave]);

  return { status, lastSavedAt, error, saveNow };
}

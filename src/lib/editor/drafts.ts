import type { DiffBlock } from "./contentDiff";

/**
 * Local copies of unsaved edits, kept in IndexedDB so a crash, a closed tab
 * or a long offline spell doesn't lose them. Autosave writes the draft
 * before each save attempt and deletes it once the server has the content.
 *
 * Every call degrades to a no-op where IndexedDB is unavailable (private
 * browsing in some browsers, blocked storage).
 */

export interface Draft {
  documentId: string;
  /** Server revision the edits were based on. */
  baseRevision: number;
  blocks: DiffBlock[];
  savedAt: number;
}

const DB_NAME = "tp-writer";
const STORE = "drafts";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "documentId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function saveDraft(draft: Draft): Promise<void> {
  await withStore("readwrite", (s) => s.put(draft));
}

export async function loadDraft(documentId: string): Promise<Draft | null> {
  const draft = await withStore<Draft | undefined>("readonly", (s) => s.get(documentId));
  return draft ?? null;
}

export async function deleteDraft(documentId: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(documentId));
}

/** For tests: forget the cached connection. */
export function resetDraftsConnection(): void {
  dbPromise = null;
}

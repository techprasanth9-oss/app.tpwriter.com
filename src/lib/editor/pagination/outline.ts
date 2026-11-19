/**
 * Live document outline (headings with their page numbers), published by
 * the paginator after each layout pass. The table-of-contents block
 * subscribes to it; it's derived data, never saved.
 */

export interface OutlineEntry {
  blockId: string;
  text: string;
  level: number;
  /** 1-based page number. */
  page: number;
}

type Listener = (entries: OutlineEntry[]) => void;

let current: OutlineEntry[] = [];
const listeners = new Set<Listener>();

export function publishOutline(entries: OutlineEntry[]): void {
  const same =
    entries.length === current.length &&
    entries.every(
      (e, i) =>
        e.blockId === current[i]!.blockId &&
        e.text === current[i]!.text &&
        e.level === current[i]!.level &&
        e.page === current[i]!.page,
    );
  if (same) return;
  current = entries;
  listeners.forEach((l) => l(entries));
}

export function getOutline(): OutlineEntry[] {
  return current;
}

export function subscribeOutline(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the surface to scroll a block into view (TOC entry clicks). */
export function requestScrollToBlock(blockId: string): void {
  document
    .querySelector(`.ce-block[data-id="${CSS.escape(blockId)}"]`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

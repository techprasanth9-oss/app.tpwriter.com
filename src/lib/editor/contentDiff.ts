/**
 * Block-level diff between the last saved state and the editor's current
 * output — what autosave sends to `PUT /documents/:id/content`.
 */

export interface DiffBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

export interface SavedState {
  /** Canonical JSON of each saved block, by id. */
  blocks: Map<string, string>;
  order: string[];
}

export interface ContentDiff {
  upserts: DiffBlock[];
  deletes: string[];
  /** Present only when the block order (or block set) changed. */
  order?: string[];
}

/** Stable serialisation of a block's persisted fields. */
export function blockKey(block: DiffBlock): string {
  return JSON.stringify([block.type, block.data ?? {}, block.tunes ?? {}]);
}

export function stateFromBlocks(blocks: DiffBlock[]): SavedState {
  return {
    blocks: new Map(blocks.map((b) => [b.id, blockKey(b)])),
    order: blocks.map((b) => b.id),
  };
}

export function diffContent(saved: SavedState, current: DiffBlock[]): ContentDiff {
  const upserts: DiffBlock[] = [];
  const seen = new Set<string>();
  for (const block of current) {
    seen.add(block.id);
    if (saved.blocks.get(block.id) !== blockKey(block)) upserts.push(block);
  }
  const deletes = saved.order.filter((id) => !seen.has(id));

  const order = current.map((b) => b.id);
  const orderChanged =
    order.length !== saved.order.length || order.some((id, i) => id !== saved.order[i]);

  return orderChanged ? { upserts, deletes, order } : { upserts, deletes };
}

export function isEmptyDiff(diff: ContentDiff): boolean {
  return diff.upserts.length === 0 && diff.deletes.length === 0 && !diff.order;
}

/** The saved state after `diff` was accepted by the server. */
export function applyDiff(saved: SavedState, diff: ContentDiff): SavedState {
  const blocks = new Map(saved.blocks);
  for (const id of diff.deletes) blocks.delete(id);
  for (const b of diff.upserts) blocks.set(b.id, blockKey(b));
  return { blocks, order: diff.order ?? saved.order };
}

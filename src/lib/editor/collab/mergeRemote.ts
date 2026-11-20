/**
 * Three-way merge of other people's saved changes into this editor.
 *
 *   base   — the server state this editor last synced with
 *   local  — what the editor holds now (may include unsaved edits)
 *   remote — what changed on the server since `base`
 *
 * Granularity is the block (paragraph, table, …). A block only one side
 * touched takes that side's version; a block both sides changed keeps the
 * local version (the person is probably typing in it) and is reported as a
 * collision — the next save then writes it over the remote edit.
 */
import { blockKey, type DiffBlock, type SavedState } from "../contentDiff";

export interface RemoteChanges {
  upserts: DiffBlock[];
  deletes: string[];
  order?: string[];
}

export interface MergeResult {
  /** Server state after the remote changes (the new autosave baseline). */
  base: SavedState;
  /** Editor content after merging. */
  local: DiffBlock[];
  /** Blocks both sides changed — local kept. */
  collisions: string[];
  /** Whether the editor content needs to change at all. */
  changed: boolean;
}

export function mergeRemote(base: SavedState, local: DiffBlock[], remote: RemoteChanges): MergeResult {
  // ── New baseline: the server's view ────────────────────────────────────
  const baseBlocks = new Map(base.blocks);
  for (const id of remote.deletes) baseBlocks.delete(id);
  for (const b of remote.upserts) baseBlocks.set(b.id, blockKey(b));
  const deleted = new Set(remote.deletes);
  let baseOrder = remote.order ?? base.order.filter((id) => !deleted.has(id));
  for (const b of remote.upserts) if (!baseOrder.includes(b.id)) baseOrder = [...baseOrder, b.id];
  const nextBase: SavedState = { blocks: baseBlocks, order: baseOrder };

  // ── Content ───────────────────────────────────────────────────────────
  const localById = new Map(local.map((b) => [b.id, b]));
  const isDirty = (b: DiffBlock) => base.blocks.get(b.id) !== blockKey(b);
  const final = new Map(localById);
  const collisions: string[] = [];

  for (const u of remote.upserts) {
    const mine = localById.get(u.id);
    if (mine) {
      if (blockKey(mine) === blockKey(u)) continue;
      if (isDirty(mine)) collisions.push(u.id);
      else final.set(u.id, u);
    } else if (base.blocks.has(u.id)) {
      // Deleted here, edited there: the deletion stands.
      collisions.push(u.id);
    } else {
      final.set(u.id, u);
    }
  }
  for (const id of remote.deletes) {
    const mine = localById.get(id);
    if (!mine) continue;
    // Edited here, deleted there: keep the edit (it'll be saved back).
    if (isDirty(mine)) collisions.push(id);
    else final.delete(id);
  }

  // ── Order ─────────────────────────────────────────────────────────────
  const localOrder = local.map((b) => b.id);
  let order: string[];
  if (!remote.order) {
    order = [...localOrder.filter((id) => final.has(id))];
    // Remote blocks with no order change can only be edits of known
    // blocks, but be safe: append anything new.
    for (const id of final.keys()) if (!order.includes(id)) order.push(id);
  } else {
    // Their order, with blocks that only exist here slotted in after the
    // block they follow locally.
    order = remote.order.filter((id) => final.has(id));
    const placed = new Set(order);
    let prev: string | null = null;
    for (const id of localOrder) {
      if (!final.has(id)) continue;
      if (!placed.has(id)) {
        const at = prev === null ? 0 : order.indexOf(prev) + 1;
        order.splice(at, 0, id);
        placed.add(id);
      }
      prev = id;
    }
    for (const id of final.keys()) if (!placed.has(id)) order.push(id);
  }

  const next = order.map((id) => final.get(id)!);
  const changed =
    next.length !== local.length ||
    next.some((b, i) => b.id !== local[i]!.id || (b !== local[i] && blockKey(b) !== blockKey(local[i]!)));
  return { base: nextBase, local: next, collisions: [...new Set(collisions)], changed };
}

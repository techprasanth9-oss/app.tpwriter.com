import type EditorJS from "@editorjs/editorjs";
import { blockKey, type DiffBlock } from "./contentDiff";
import { applyToEditor } from "./collab/applyToEditor";

/**
 * Document-level undo/redo. EditorJS has none, and the browser's native
 * undo is per-contenteditable (one block), so it can't undo block inserts,
 * deletes, moves or format changes.
 *
 * Snapshots are the editor's saved block list. Unchanged blocks reuse the
 * previous snapshot's objects, so N snapshots of a large document cost
 * roughly N × (changed blocks), not N × (document).
 *
 * Undo/redo applies the difference between the live editor and the target
 * snapshot through the blocks API (delete / insert / update / move), so
 * untouched blocks — and the caret position in them — are left alone.
 */

interface SnapBlock extends DiffBlock {
  key: string;
}

type Snapshot = SnapBlock[];

export class EditorHistory {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private current: Snapshot | null = null;
  private applying = false;
  /** Serialises record/undo/redo — they all read then mutate the editor. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly editor: EditorJS,
    private readonly limit = 100,
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Capture the current state as a new undo step if anything changed. */
  record(): Promise<void> {
    return this.enqueue(() => this.recordNow());
  }

  undo(): Promise<void> {
    return this.enqueue(async () => {
      await this.recordNow();
      const target = this.undoStack.pop();
      if (!target || !this.current) return;
      this.redoStack.push(this.current);
      await this.apply(target);
    });
  }

  redo(): Promise<void> {
    return this.enqueue(async () => {
      await this.recordNow();
      const target = this.redoStack.pop();
      if (!target || !this.current) return;
      this.undoStack.push(this.current);
      await this.apply(target);
    });
  }

  /**
   * Bring in someone else's changes (`current` → `next`) without making
   * them undoable: the same change is replayed into every snapshot, so
   * undo / redo only ever move this person's own edits.
   */
  applyRemote({ current, next }: { current: DiffBlock[]; next: DiffBlock[] }): Promise<void> {
    return this.enqueue(async () => {
      await this.recordNow();
      this.applying = true;
      try {
        await applyToEditor(this.editor, current, next);
      } finally {
        this.applying = false;
      }
      const before = new Map(current.map((b) => [b.id, blockKey(b)]));
      const after = new Map(next.map((b) => [b.id, b]));
      const changed = next.filter((b) => before.has(b.id) && before.get(b.id) !== blockKey(b));
      const removed = new Set(current.filter((b) => !after.has(b.id)).map((b) => b.id));
      const added = next.map((b, i) => ({ b, prev: i > 0 ? next[i - 1]!.id : null })).filter(({ b }) => !before.has(b.id));
      const rebase = (snap: Snapshot): Snapshot => {
        const out: Snapshot = snap
          .filter((b) => !removed.has(b.id))
          .map((b) => {
            const c = changed.find((x) => x.id === b.id);
            return c ? { ...c, key: blockKey(c) } : b;
          });
        for (const { b, prev } of added) {
          if (out.some((x) => x.id === b.id)) continue;
          const at = prev === null ? 0 : out.findIndex((x) => x.id === prev) + 1;
          out.splice(at, 0, { ...b, key: blockKey(b) });
        }
        return out;
      };
      this.undoStack = this.undoStack.map(rebase);
      this.redoStack = this.redoStack.map(rebase);
      this.current = await this.capture();
    });
  }

  /** Forget all history (e.g. after replacing the whole document). */
  reset(): Promise<void> {
    return this.enqueue(async () => {
      this.undoStack = [];
      this.redoStack = [];
      this.current = await this.capture();
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch((err) => console.warn("[history]", err));
    return run;
  }

  private async recordNow(): Promise<void> {
    if (this.applying) return;
    const next = await this.capture();
    if (!this.current) {
      this.current = next;
      return;
    }
    if (sameSnapshot(this.current, next)) return;
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = next;
  }

  private async capture(): Promise<Snapshot> {
    const out = await this.editor.save();
    const previous = new Map((this.current ?? []).map((b) => [b.id, b]));
    return out.blocks.map((raw) => {
      const block: DiffBlock = {
        id: raw.id!,
        type: raw.type,
        data: raw.data,
        ...(raw.tunes ? { tunes: raw.tunes as Record<string, unknown> } : {}),
      };
      const key = blockKey(block);
      const prev = previous.get(block.id);
      return prev && prev.key === key ? prev : { ...block, key };
    });
  }

  private async apply(target: Snapshot): Promise<void> {
    this.applying = true;
    try {
      const blocks = this.editor.blocks;
      const live = await this.capture();
      const targetIds = new Set(target.map((b) => b.id));
      let lastTouched = -1;

      for (let i = live.length - 1; i >= 0; i--) {
        const id = live[i]!.id;
        if (!targetIds.has(id)) {
          blocks.delete(blocks.getBlockIndex(id));
          lastTouched = Math.max(lastTouched, i - 1);
        }
      }

      const liveById = new Map(live.map((b) => [b.id, b]));
      for (let i = 0; i < target.length; i++) {
        const want = target[i]!;
        const have = liveById.get(want.id);
        if (have && have.key === want.key) {
          const at = blocks.getBlockIndex(want.id);
          if (at !== i) blocks.move(i, at);
          continue;
        }
        if (have && have.type === want.type) {
          const at = blocks.getBlockIndex(want.id);
          if (at !== i) blocks.move(i, at);
          await blocks.update(want.id, want.data, want.tunes ?? {});
        } else {
          if (have) blocks.delete(blocks.getBlockIndex(want.id));
          blocks.insert(want.type, want.data, undefined, i, false, false, want.id);
          if (want.tunes) await blocks.update(want.id, want.data, want.tunes);
        }
        lastTouched = i;
      }

      // Every block was removed: EditorJS keeps one empty paragraph.
      this.current = target;
      if (lastTouched >= 0 && target.length > 0) {
        this.editor.caret.setToBlock(Math.min(lastTouched, target.length - 1), "end");
      }
    } finally {
      this.applying = false;
    }
  }
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.id !== b[i]!.id || a[i]!.key !== b[i]!.key) return false;
  }
  return true;
}

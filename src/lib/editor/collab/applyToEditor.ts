import type EditorJS from "@editorjs/editorjs";
import { blockKey, type DiffBlock } from "../contentDiff";

/**
 * Turn the editor's content from `current` into `next` with block-level
 * operations — no full re-render, so the caret, scroll position and any
 * block the person is typing in are left alone.
 */
export async function applyToEditor(editor: EditorJS, current: DiffBlock[], next: DiffBlock[]): Promise<void> {
  const nextById = new Map(next.map((b) => [b.id, b]));
  const currentById = new Map(current.map((b) => [b.id, b]));

  // Removed blocks, and blocks whose type changed (re-inserted below).
  for (const b of current) {
    const target = nextById.get(b.id);
    if (target && target.type === b.type) continue;
    const index = editor.blocks.getBlockIndex(b.id);
    if (index >= 0) editor.blocks.delete(index);
    currentById.delete(b.id);
  }

  for (let i = 0; i < next.length; i++) {
    const b = next[i]!;
    const have = currentById.get(b.id);
    if (!have) {
      editor.blocks.insert(b.type, b.data, undefined, i, false, false, b.id);
      if (b.tunes) await editor.blocks.update(b.id, undefined, b.tunes as never);
      continue;
    }
    if (blockKey(have) !== blockKey(b)) await editor.blocks.update(b.id, b.data, (b.tunes ?? {}) as never);
    const index = editor.blocks.getBlockIndex(b.id);
    if (index !== i && index >= 0) editor.blocks.move(i, index);
  }
}

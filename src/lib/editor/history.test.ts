import { describe, expect, it, vi } from "vitest";
import { EditorHistory } from "./history";

interface B {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

/** In-memory stand-in for the EditorJS blocks API the history uses. */
function fakeEditor(initial: B[]) {
  let blocks: B[] = structuredClone(initial);
  const editor = {
    save: async () => ({ blocks: structuredClone(blocks) }),
    blocks: {
      getBlockIndex: (id: string) => blocks.findIndex((b) => b.id === id),
      delete: vi.fn((index: number) => {
        blocks.splice(index, 1);
      }),
      insert: vi.fn((type: string, data: Record<string, unknown>, _c: unknown, index: number, _f: boolean, _r: boolean, id: string) => {
        blocks.splice(index, 0, { id, type, data: structuredClone(data) });
      }),
      update: vi.fn(async (id: string, data?: Record<string, unknown>, tunes?: Record<string, unknown>) => {
        const b = blocks.find((x) => x.id === id)!;
        if (data) b.data = structuredClone(data);
        if (tunes && Object.keys(tunes).length) b.tunes = structuredClone(tunes);
        else delete b.tunes;
      }),
      move: vi.fn((to: number, from: number) => {
        const [b] = blocks.splice(from, 1);
        blocks.splice(to, 0, b!);
      }),
    },
    caret: { setToBlock: vi.fn() },
  };
  return {
    editor,
    get blocks() {
      return blocks;
    },
    set(next: B[]) {
      blocks = structuredClone(next);
    },
  };
}

const p = (id: string, text: string): B => ({ id, type: "paragraph", data: { text } });

describe("EditorHistory", () => {
  it("undoes and redoes edits, inserts, deletes and moves", async () => {
    const f = fakeEditor([p("a", "one"), p("b", "two")]);
    const h = new EditorHistory(f.editor as never);
    await h.record();

    f.set([p("a", "ONE"), p("b", "two")]); // edit
    await h.record();
    f.set([p("a", "ONE"), p("c", "new"), p("b", "two")]); // insert
    await h.record();
    f.set([p("b", "two"), p("c", "new")]); // delete a + reorder
    await h.record();

    await h.undo();
    expect(f.blocks).toEqual([p("a", "ONE"), p("c", "new"), p("b", "two")]);
    await h.undo();
    expect(f.blocks).toEqual([p("a", "ONE"), p("b", "two")]);
    await h.undo();
    expect(f.blocks).toEqual([p("a", "one"), p("b", "two")]);
    expect(h.canUndo).toBe(false);

    await h.redo();
    await h.redo();
    await h.redo();
    expect(f.blocks).toEqual([p("b", "two"), p("c", "new")]);
    expect(h.canRedo).toBe(false);
  });

  it("captures unrecorded changes before undoing, so redo can restore them", async () => {
    const f = fakeEditor([p("a", "one")]);
    const h = new EditorHistory(f.editor as never);
    await h.record();
    f.set([p("a", "typed but not yet recorded")]);
    await h.undo();
    expect(f.blocks).toEqual([p("a", "one")]);
    await h.redo();
    expect(f.blocks).toEqual([p("a", "typed but not yet recorded")]);
  });

  it("restores tune-only changes and leaves untouched blocks alone", async () => {
    const f = fakeEditor([p("a", "one"), p("b", "two")]);
    const h = new EditorHistory(f.editor as never);
    await h.record();
    f.set([{ ...p("a", "one"), tunes: { format: { alignment: "center" } } }, p("b", "two")]);
    await h.record();
    f.editor.blocks.update.mockClear();
    await h.undo();
    expect(f.blocks).toEqual([p("a", "one"), p("b", "two")]);
    expect(f.editor.blocks.update).toHaveBeenCalledTimes(1);
    expect(f.editor.blocks.update.mock.calls[0]![0]).toBe("a");
  });

  it("a new change clears the redo stack", async () => {
    const f = fakeEditor([p("a", "one")]);
    const h = new EditorHistory(f.editor as never);
    await h.record();
    f.set([p("a", "two")]);
    await h.record();
    await h.undo();
    f.set([p("a", "three")]);
    await h.record();
    expect(h.canRedo).toBe(false);
  });
});

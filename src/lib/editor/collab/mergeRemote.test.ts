import { describe, expect, it } from "vitest";
import { stateFromBlocks, type DiffBlock } from "../contentDiff";
import { mergeRemote } from "./mergeRemote";

const p = (id: string, text: string): DiffBlock => ({ id, type: "paragraph", data: { text } });
const texts = (blocks: DiffBlock[]) => blocks.map((b) => `${b.id}:${b.data.text as string}`);

describe("mergeRemote", () => {
  const base = [p("a", "one"), p("b", "two"), p("c", "three")];

  it("takes remote edits of blocks not edited here", () => {
    const local = [p("a", "one!"), p("b", "two"), p("c", "three")];
    const r = mergeRemote(stateFromBlocks(base), local, { upserts: [p("b", "TWO")], deletes: [] });
    expect(texts(r.local)).toEqual(["a:one!", "b:TWO", "c:three"]);
    expect(r.collisions).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.base.order).toEqual(["a", "b", "c"]);
  });

  it("keeps the local version when both sides edited a block", () => {
    const local = [p("a", "mine"), p("b", "two"), p("c", "three")];
    const r = mergeRemote(stateFromBlocks(base), local, { upserts: [p("a", "theirs")], deletes: [] });
    expect(texts(r.local)[0]).toBe("a:mine");
    expect(r.collisions).toEqual(["a"]);
    expect(r.changed).toBe(false);
  });

  it("inserts remote blocks and keeps local new blocks next to their neighbour", () => {
    const local = [p("a", "one"), p("x", "local new"), p("b", "two"), p("c", "three")];
    const r = mergeRemote(stateFromBlocks(base), local, {
      upserts: [p("y", "remote new")],
      deletes: [],
      order: ["a", "b", "y", "c"],
    });
    expect(r.local.map((b) => b.id)).toEqual(["a", "x", "b", "y", "c"]);
    expect(r.base.order).toEqual(["a", "b", "y", "c"]);
  });

  it("applies remote deletes unless the block was edited here", () => {
    const local = [p("a", "one"), p("b", "two edited"), p("c", "three")];
    const r = mergeRemote(stateFromBlocks(base), local, { upserts: [], deletes: ["b", "c"], order: ["a"] });
    expect(r.local.map((b) => b.id)).toEqual(["a", "b"]);
    expect(r.collisions).toEqual(["b"]);
    expect(r.base.order).toEqual(["a"]);
  });

  it("keeps a local deletion of a block edited remotely", () => {
    const local = [p("a", "one"), p("c", "three")];
    const r = mergeRemote(stateFromBlocks(base), local, { upserts: [p("b", "TWO")], deletes: [] });
    expect(r.local.map((b) => b.id)).toEqual(["a", "c"]);
    expect(r.collisions).toEqual(["b"]);
  });

  it("ignores echoes of our own saves", () => {
    const local = [p("a", "one"), p("b", "two"), p("c", "three")];
    const r = mergeRemote(stateFromBlocks(base), local, { upserts: [p("a", "one")], deletes: [] });
    expect(r.changed).toBe(false);
    expect(r.collisions).toEqual([]);
  });

  it("keeps a local reorder when the remote order didn't change", () => {
    const local = [p("c", "three"), p("a", "one"), p("b", "two")];
    const r = mergeRemote(stateFromBlocks(base), local, { upserts: [p("a", "ONE")], deletes: [] });
    expect(texts(r.local)).toEqual(["c:three", "a:ONE", "b:two"]);
  });
});

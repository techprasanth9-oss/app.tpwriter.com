import { describe, expect, it } from "vitest";
import { applyDiff, diffContent, isEmptyDiff, stateFromBlocks } from "./contentDiff";

const b = (id: string, text: string, tunes?: Record<string, unknown>) => ({
  id,
  type: "paragraph",
  data: { text },
  ...(tunes ? { tunes } : {}),
});

describe("diffContent", () => {
  const saved = stateFromBlocks([b("a", "one"), b("b", "two"), b("c", "three")]);

  it("is empty when nothing changed (missing tunes == empty tunes)", () => {
    expect(isEmptyDiff(diffContent(saved, [b("a", "one"), b("b", "two", {}), b("c", "three")]))).toBe(true);
  });

  it("sends only edited blocks and no order for an in-place edit", () => {
    expect(diffContent(saved, [b("a", "one"), b("b", "TWO"), b("c", "three")])).toEqual({
      upserts: [b("b", "TWO")],
      deletes: [],
    });
  });

  it("includes order for inserts, deletes and moves", () => {
    expect(diffContent(saved, [b("a", "one"), b("n", "new"), b("c", "three")])).toEqual({
      upserts: [b("n", "new")],
      deletes: ["b"],
      order: ["a", "n", "c"],
    });
    expect(diffContent(saved, [b("c", "three"), b("a", "one"), b("b", "two")])).toEqual({
      upserts: [],
      deletes: [],
      order: ["c", "a", "b"],
    });
  });

  it("applyDiff makes the next diff empty", () => {
    const current = [b("a", "uno"), b("c", "three"), b("z", "zed")];
    const diff = diffContent(saved, current);
    expect(isEmptyDiff(diffContent(applyDiff(saved, diff), current))).toBe(true);
  });
});

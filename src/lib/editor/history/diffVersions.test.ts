import { describe, expect, it } from "vitest";
import type { EditorBlock } from "~/lib/api/documents";
import { blockPlainText, diffStats, diffVersions, diffWords, type WordOp } from "./diffVersions";

const p = (id: string, text: string, tunes?: Record<string, unknown>): EditorBlock => ({
  id,
  type: "paragraph",
  data: { text },
  ...(tunes ? { tunes } : {}),
});
const h = (id: string, text: string, level = 2): EditorBlock => ({ id, type: "header", data: { text, level } });

const render = (ops: WordOp[]) =>
  ops.map((o) => (o.op === "equal" ? o.text : o.op === "insert" ? `{+${o.text}+}` : `[-${o.text}-]`)).join("");

describe("diffWords", () => {
  it("returns a single equal op for identical text", () => {
    expect(diffWords("same text", "same text")).toEqual([{ op: "equal", text: "same text" }]);
  });

  it("marks inserted and deleted words", () => {
    expect(render(diffWords("the quick fox", "the quick brown fox"))).toBe("the quick {+brown +}fox");
    expect(render(diffWords("the quick brown fox", "the fox"))).toBe("the [-quick brown -]fox");
  });

  it("groups a replaced phrase as delete then insert", () => {
    expect(render(diffWords("ship on Friday afternoon now", "ship on Monday morning now"))).toBe(
      "ship on [-Friday afternoon-]{+Monday morning+} now",
    );
  });

  it("handles empty sides and punctuation", () => {
    expect(render(diffWords("", "new"))).toBe("{+new+}");
    expect(render(diffWords("old", ""))).toBe("[-old-]");
    expect(render(diffWords("Hello, world.", "Hello, world!"))).toBe("Hello, world[-.-]{+!+}");
  });

  it("reconstructs both sides", () => {
    const a = "One two three four five six.";
    const b = "One 2 three five six seven.";
    const ops = diffWords(a, b);
    expect(ops.filter((o) => o.op !== "insert").map((o) => o.text).join("")).toBe(a);
    expect(ops.filter((o) => o.op !== "delete").map((o) => o.text).join("")).toBe(b);
  });
});

describe("blockPlainText", () => {
  it("strips markup and walks lists and tables", () => {
    expect(blockPlainText(p("a", "Hello <b>bold</b>&nbsp;world"))).toBe("Hello bold world");
    expect(
      blockPlainText({
        id: "l",
        type: "list",
        data: { style: "unordered", items: [{ content: "one", items: [{ content: "<i>two</i>", items: [] }] }] },
      }),
    ).toBe("one\ntwo");
    expect(blockPlainText({ id: "t", type: "table", data: { content: [["a", "b"], ["c", "d"]] } })).toBe("a b\nc d");
  });

  it("falls back to string fields for other tools, skipping urls", () => {
    expect(blockPlainText({ id: "x", type: "textBox", data: { text: "Note", url: "https://x" } })).toBe("Note");
  });
});

describe("diffVersions", () => {
  it("reports unchanged documents as all same", () => {
    const blocks = [p("a", "one"), p("b", "two")];
    const d = diffVersions(blocks, blocks);
    expect(d.map((x) => x.kind)).toEqual(["same", "same"]);
    expect(diffStats(d)).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("pairs by id and word-diffs changed text", () => {
    const d = diffVersions([p("a", "Hello world")], [p("a", "Hello brave world")]);
    expect(d).toHaveLength(1);
    const c = d[0];
    expect(c.kind).toBe("changed");
    if (c.kind !== "changed") throw new Error();
    expect(c.formatOnly).toBe(false);
    expect(render(c.words!)).toBe("Hello {+brave +}world");
  });

  it("flags formatting-only changes", () => {
    const d = diffVersions([p("a", "Hi")], [p("a", "<b>Hi</b>")]);
    expect(d[0].kind === "changed" && d[0].formatOnly).toBe(true);
    const t = diffVersions([p("a", "Hi")], [p("a", "Hi", { tpFormat: { align: "center" } })]);
    expect(t[0].kind === "changed" && t[0].formatOnly).toBe(true);
  });

  it("orders additions and removals where they belong", () => {
    const before = [p("a", "first"), p("b", "second"), p("c", "third")];
    const after = [p("a", "first"), p("n", "inserted text"), p("c", "third"), p("z", "last")];
    const d = diffVersions(before, after);
    expect(d.map((x) => `${x.kind}:${x.kind === "changed" ? x.after.id : x.block.id}`)).toEqual([
      "same:a",
      "removed:b",
      "added:n",
      "same:c",
      "added:z",
    ]);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1, changed: 0 });
  });

  it("pairs re-created blocks by content similarity", () => {
    const before = [p("a", "Intro"), p("old", "The committee will meet on Tuesday to review the budget.")];
    const after = [p("a", "Intro"), p("new", "The committee will meet on Thursday to review the budget.")];
    const d = diffVersions(before, after);
    expect(d.map((x) => x.kind)).toEqual(["same", "changed"]);
    const c = d[1];
    if (c.kind !== "changed") throw new Error();
    expect(c.before.id).toBe("old");
    expect(render(c.words!)).toContain("[-Tuesday-]{+Thursday+}");
  });

  it("treats re-created identical blocks as same", () => {
    const d = diffVersions([p("x", "Same words")], [p("y", "Same words")]);
    expect(d.map((x) => x.kind)).toEqual(["same"]);
  });

  it("does not pair unrelated text", () => {
    const d = diffVersions([p("x", "Apples and oranges")], [p("y", "Completely different sentence")]);
    expect(d.map((x) => x.kind).sort()).toEqual(["added", "removed"]);
  });

  it("pairs a paragraph turned into a heading", () => {
    const d = diffVersions([p("x", "Chapter one")], [h("x", "Chapter one")]);
    expect(d[0].kind).toBe("changed");
    if (d[0].kind === "changed") expect(d[0].formatOnly).toBe(true);
  });

  it("does not word-diff non-text blocks", () => {
    const img = (id: string, url: string): EditorBlock => ({ id, type: "image", data: { file: { url } } });
    const d = diffVersions([img("i", "/a.png")], [img("i", "/b.png")]);
    expect(d[0].kind === "changed" && d[0].words).toBeNull();
  });

  it("handles empty documents", () => {
    expect(diffVersions([], [])).toEqual([]);
    expect(diffVersions([], [p("a", "x")]).map((x) => x.kind)).toEqual(["added"]);
    expect(diffVersions([p("a", "x")], []).map((x) => x.kind)).toEqual(["removed"]);
  });
});

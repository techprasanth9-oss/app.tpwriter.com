import { beforeEach, describe, expect, it } from "vitest";
import { anchorFromRange, anchorFromSelection, displayQuote, locateAnchor, locateAnchorMatch, similarity } from "./anchor";
import { ATOM, blockText } from "./blockText";

let root: HTMLElement;

function block(id: string, inner: string): string {
  return `<div class="ce-block" data-id="${id}"><div class="ce-block__content">${inner}</div></div>`;
}
function para(id: string, html: string, editable = true): string {
  return block(id, `<div class="ce-paragraph" contenteditable="${editable}">${html}</div>`);
}

function mount(html: string) {
  root.innerHTML = `<div class="codex-editor__redactor">${html}</div>`;
}

function editable(id: string): HTMLElement {
  return root.querySelector<HTMLElement>(`[data-id="${id}"] [contenteditable]`)!;
}

/** Select `needle` (nth occurrence) inside a block's text. */
function select(id: string, needle: string, nth = 0): Range {
  const el = root.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
  const bt = blockText(el);
  let at = -1;
  for (let i = 0; i <= nth; i++) at = bt.text.indexOf(needle, at + 1);
  const r = document.createRange();
  const loc = (pos: number, end: boolean) => {
    for (const s of bt.segments) {
      if (end ? pos > s.start && pos <= s.end : pos >= s.start && pos < s.end) return [s.node, pos - s.start] as const;
    }
    throw new Error("bad pos");
  };
  r.setStart(...loc(at, false));
  r.setEnd(...loc(at + needle.length, true));
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
  return r;
}

function setText(id: string, html: string) {
  editable(id).innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  root.className = "tp-document";
  document.body.appendChild(root);
});

describe("blockText", () => {
  it("joins hosts, marks atoms and skips paginator output", () => {
    mount(
      block(
        "l1",
        `<span class="tp-split" data-mutation-free="true">ghost</span>
         <ul><li><div contenteditable="true">one <b>two</b></div></li>
         <li><div contenteditable="true">x<span contenteditable="false" class="tp-field">7</span>y</div></li></ul>
         <div class="tp-table-ghost" data-mutation-free="true"><div contenteditable="true">dup</div></div>`,
      ),
    );
    const bt = blockText(root.querySelector<HTMLElement>("[data-id=l1]")!);
    expect(bt.text).toBe(`one two\nx${ATOM}y`);
  });

  it("uses read-only hosts when nothing is editable", () => {
    mount(para("p1", 'Read <span contenteditable="false">1</span>only', false));
    const bt = blockText(root.querySelector<HTMLElement>("[data-id=p1]")!);
    expect(bt.text).toBe(`Read ${ATOM}only`);
  });

  it("does not read nested blocks into the outer block", () => {
    mount(block("cols", `<div class="col">${para("inner", "Inner text")}</div>`));
    expect(blockText(root.querySelector<HTMLElement>("[data-id=cols]")!).text).toBe("");
    expect(blockText(root.querySelector<HTMLElement>("[data-id=inner]")!).text).toBe("Inner text");
  });
});

describe("anchorFromSelection", () => {
  it("captures quote and up to 32 chars of context", () => {
    const long = "A".repeat(40);
    mount(para("p1", `${long} the <i>quick</i> brown fox ${long}`));
    select("p1", "quick brown");
    const a = anchorFromSelection(root)!;
    expect(a.blockId).toBe("p1");
    expect(a.quote).toBe("quick brown");
    expect(a.prefix).toBe(`${"A".repeat(27)} the `);
    expect(a.prefix).toHaveLength(32);
    expect(a.suffix).toBe(` fox ${"A".repeat(27)}`);
  });

  it("trims surrounding whitespace and rejects blank selections", () => {
    mount(para("p1", "one   two"));
    select("p1", " two");
    expect(anchorFromSelection(root)!.quote).toBe("two");
    select("p1", "  ");
    expect(anchorFromSelection(root)).toBeNull();
  });

  it("rejects collapsed, cross-block and outside selections", () => {
    mount(para("p1", "first") + para("p2", "second"));
    const r = document.createRange();
    r.setStart(editable("p1").firstChild!, 1);
    r.setEnd(editable("p2").firstChild!, 2);
    expect(anchorFromRange(root, r)).toBeNull();
    r.collapse(true);
    expect(anchorFromRange(root, r)).toBeNull();
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const o = document.createRange();
    o.selectNodeContents(outside);
    expect(anchorFromRange(root, o)).toBeNull();
  });

  it("rejects selections inside paginator ghosts", () => {
    mount(block("t1", `<div contenteditable="true">cell</div><div class="tp-table-ghost" data-mutation-free="true"><div contenteditable="true">ghost</div></div>`));
    const r = document.createRange();
    r.selectNodeContents(root.querySelector(".tp-table-ghost [contenteditable]")!.firstChild!);
    expect(anchorFromRange(root, r)).toBeNull();
  });
});

describe("locateAnchor", () => {
  function anchorOf(id: string, needle: string, nth = 0) {
    select(id, needle, nth);
    return anchorFromSelection(root)!;
  }

  it("finds an untouched quote exactly", () => {
    mount(para("p1", "Hello <b>bold</b> world"));
    const a = anchorOf("p1", "bold world");
    const m = locateAnchorMatch(root, a)!;
    expect(m.kind).toBe("exact");
    expect(m.range.toString()).toBe("bold world");
  });

  it("survives edits before and after the quote", () => {
    mount(para("p1", "The quick brown fox jumps over the dog."));
    const a = anchorOf("p1", "brown fox");
    setText("p1", "Yesterday, the very quick brown fox happily jumps over the lazy dog.");
    const m = locateAnchorMatch(root, a)!;
    expect(m.range.toString()).toBe("brown fox");
    expect(m.kind).toBe("quote");
  });

  it("follows formatting changes that split text nodes", () => {
    mount(para("p1", "alpha beta gamma"));
    const a = anchorOf("p1", "beta gamma");
    setText("p1", "alpha <b>be</b><i>ta</i> gamma");
    expect(locateAnchor(root, a)!.toString()).toBe("beta gamma");
  });

  it("picks the right one of duplicate quotes by context", () => {
    mount(para("p1", "red apple, green apple, blue apple"));
    const a = anchorOf("p1", "apple", 1);
    expect(a.prefix.endsWith("green ")).toBe(true);
    const m = locateAnchorMatch(root, a)!;
    expect(m.start).toBe("red apple, green ".length);
    // Insert another duplicate in front; still the green one.
    setText("p1", "apple! red apple, green apple, blue apple");
    expect(locateAnchorMatch(root, a)!.start).toBe("apple! red apple, green ".length);
  });

  it("re-finds a quote whose text was edited inside", () => {
    mount(para("p1", "We should ship the release on Friday afternoon at the latest."));
    const a = anchorOf("p1", "release on Friday afternoon");
    setText("p1", "We should ship the release on Thursday afternoon at the latest.");
    const m = locateAnchorMatch(root, a)!;
    expect(m.kind).toBe("edited");
    expect(m.range.toString()).toBe("release on Thursday afternoon");
  });

  it("orphans a quote that was deleted", () => {
    mount(para("p1", "Keep this. Remove this sentence entirely. Keep that."));
    const a = anchorOf("p1", "Remove this sentence entirely.");
    setText("p1", "Keep this. Keep that.");
    expect(locateAnchor(root, a)).toBeNull();
  });

  it("finds moved text in the nearest other block", () => {
    mount(para("p1", "intro") + para("p2", "Unique phrase here.") + para("p3", "x") + para("p4", "y"));
    const a = anchorOf("p2", "Unique phrase");
    // Block re-created under a new id far away, and a copy next door.
    root.querySelector("[data-id=p2]")!.remove();
    root.querySelector(".codex-editor__redactor")!.insertAdjacentHTML("beforeend", para("p9", "Unique phrase again"));
    const m = locateAnchorMatch(root, a)!;
    expect(m.kind).toBe("moved");
    expect(m.blockId).toBe("p9");
  });

  it("prefers the nearest block when the home block still exists", () => {
    mount(para("a", "Shared words") + para("b", "home block") + para("c", "x") + para("d", "Shared words"));
    const a = { blockId: "b", quote: "Shared words", prefix: "", suffix: "" };
    expect(locateAnchorMatch(root, a)!.blockId).toBe("a");
  });

  it("does not move very short quotes to other blocks", () => {
    mount(para("p1", "a b") + para("p2", "a c"));
    expect(locateAnchor(root, { blockId: "gone", quote: "a", prefix: "", suffix: "" })).toBeNull();
  });

  it("works across list items in one block", () => {
    mount(block("l", `<div contenteditable="true">first item</div><div contenteditable="true">second item</div>`));
    const a = { blockId: "l", quote: "item\nsecond", prefix: "first ", suffix: " item" };
    const r = locateAnchor(root, a)!;
    expect(r.toString()).toBe("itemsecond");
  });
});

describe("helpers", () => {
  it("similarity is 1 for equal and low for unrelated strings", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("Friday afternoon", "Thursday afternoon")).toBeGreaterThan(0.5);
    expect(similarity("hello", "zzzzz")).toBe(0);
  });

  it("displayQuote flattens atoms and whitespace", () => {
    expect(displayQuote(`a${ATOM} b\n c`)).toBe("a b c");
  });
});

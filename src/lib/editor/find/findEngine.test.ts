import { describe, expect, it, vi } from "vitest";
import { findMatches, replaceAll, replaceMatch } from "./findEngine";

const plain = { matchCase: false, wholeWord: false };

function mount(...blocks: string[]): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `<div class="codex-editor__redactor">${blocks
    .map((b) => `<div class="ce-block"><div class="ce-paragraph" contenteditable="true">${b}</div></div>`)
    .join("")}</div>`;
  document.body.appendChild(root);
  return root;
}

const editables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[contenteditable="true"]'));

describe("findMatches", () => {
  it("returns [] for an empty query", () => {
    expect(findMatches(mount("hello"), "", plain)).toEqual([]);
  });

  it("matches across text nodes inside one editable", () => {
    const root = mount("say he<b>llo</b> world");
    const m = findMatches(root, "hello", plain);
    expect(m).toHaveLength(1);
    expect(m[0].toString()).toBe("hello");
    expect(m[0].startContainer.textContent).toBe("say he");
    expect(m[0].endContainer.textContent).toBe("llo");
  });

  it("never matches across two editables", () => {
    const root = mount("foo", "bar");
    expect(findMatches(root, "foobar", plain)).toHaveLength(0);
    expect(findMatches(root, "o", plain)).toHaveLength(2);
  });

  it("finds matches in multiple editables in document order", () => {
    const root = mount("cat one", "<i>cat</i> two", "no");
    const m = findMatches(root, "cat", plain);
    expect(m.map((r) => r.toString())).toEqual(["cat", "cat"]);
    const eds = editables(root);
    expect(eds[0].contains(m[0].startContainer)).toBe(true);
    expect(eds[1].contains(m[1].startContainer)).toBe(true);
  });

  it("honours match case", () => {
    const root = mount("Apple apple APPLE");
    expect(findMatches(root, "apple", plain)).toHaveLength(3);
    expect(findMatches(root, "apple", { matchCase: true, wholeWord: false })).toHaveLength(1);
  });

  it("honours whole word with Unicode letters", () => {
    const root = mount("cafés café cafe naïve café2 xcafé");
    expect(findMatches(root, "café", plain)).toHaveLength(4);
    const whole = findMatches(root, "café", { matchCase: false, wholeWord: true });
    expect(whole).toHaveLength(1);
    expect(findMatches(root, "CAFÉ", { matchCase: false, wholeWord: true })).toHaveLength(1);
    expect(findMatches(root, "caf", { matchCase: false, wholeWord: true })).toHaveLength(0);
    expect(findMatches(root, "naïve", { matchCase: true, wholeWord: true })).toHaveLength(1);
  });

  it("treats regex metacharacters literally", () => {
    const root = mount("a.b axb (x) $5 well-known a/b");
    expect(findMatches(root, "a.b", plain)).toHaveLength(1);
    expect(findMatches(root, "(x)", plain)).toHaveLength(1);
    expect(findMatches(root, "$5", plain)).toHaveLength(1);
    expect(findMatches(root, "well-known", plain)).toHaveLength(1);
    expect(findMatches(root, "a/b", plain)).toHaveLength(1);
  });

  it("skips text inside contenteditable=false atoms and doesn't match across them", () => {
    const root = mount('foo<span contenteditable="false" class="chip">foo</span>bar');
    const m = findMatches(root, "foo", plain);
    expect(m).toHaveLength(1);
    expect((m[0].startContainer.parentNode as Element).classList.contains("chip")).toBe(false);
    expect(findMatches(root, "foobar", plain)).toHaveLength(0);
  });

  it("doesn't match across <br>", () => {
    expect(findMatches(mount("ab<br>cd"), "bc", plain)).toHaveLength(0);
  });

  it("ignores empty pagination split divs and non-editable areas", () => {
    const root = mount("hello");
    root.querySelector(".ce-block")!.insertAdjacentHTML("beforeend", '<div class="tp-split"></div>');
    root.insertAdjacentHTML("afterbegin", "<p>hello outside</p>");
    expect(findMatches(root, "hello", plain)).toHaveLength(1);
  });

  it("searches table cells (nested editables) separately", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="tc-table"><div class="tc-cell" contenteditable="true">ab</div><div class="tc-cell" contenteditable="true">cd</div></div>';
    expect(findMatches(root, "b", plain)).toHaveLength(1);
    expect(findMatches(root, "bc", plain)).toHaveLength(0);
  });
});

describe("replaceMatch", () => {
  it("replaces within one text node and returns a range around the new text", () => {
    const root = mount("say <b>hello</b> world");
    const [m] = findMatches(root, "hello", plain);
    const out = replaceMatch(m, "hi");
    expect(editables(root)[0].innerHTML).toBe("say <b>hi</b> world");
    expect(out.toString()).toBe("hi");
  });

  it("keeps the formatting of the match start and prunes emptied wrappers", () => {
    const root = mount("say he<b>llo</b> world");
    const [m] = findMatches(root, "hello", plain);
    const out = replaceMatch(m, "HEY");
    expect(editables(root)[0].innerHTML).toBe("say HEY world");
    expect(out.toString()).toBe("HEY");
  });

  it("inserts into the start node's formatting when the match starts inside markup", () => {
    const root = mount("x<i>ab</i><b>cd</b>y");
    const [m] = findMatches(root, "bc", plain);
    replaceMatch(m, "ZZ");
    expect(editables(root)[0].innerHTML).toBe("x<i>aZZ</i><b>d</b>y");
  });

  it("preserves surrounding markup across nested formatting", () => {
    const root = mount('<a href="#">li<b>nk</b></a> and <u>text</u>');
    const [m] = findMatches(root, "link", plain);
    replaceMatch(m, "url");
    expect(editables(root)[0].innerHTML).toBe('<a href="#">url</a> and <u>text</u>');
  });

  it("dispatches a bubbling input event on the owning editable", () => {
    const root = mount("hello");
    const spy = vi.fn();
    root.addEventListener("input", spy);
    const ed = editables(root)[0];
    let target: EventTarget | null = null;
    ed.addEventListener("input", (e) => (target = e.target));
    replaceMatch(findMatches(root, "hello", plain)[0], "bye");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(target).toBe(ed);
  });

  it("supports empty replacement (delete)", () => {
    const root = mount("a<b>bc</b>d");
    const out = replaceMatch(findMatches(root, "bc", plain)[0], "");
    expect(editables(root)[0].innerHTML).toBe("a<b></b>d");
    expect(out.collapsed).toBe(true);
  });
});

describe("replaceAll", () => {
  it("replaces every match and returns the count", () => {
    const root = mount("cat <b>cat</b> ca<i>t</i>", "the cat", "dog");
    const n = replaceAll(root, "cat", "dog", plain);
    expect(n).toBe(4);
    const eds = editables(root);
    expect(eds[0].innerHTML).toBe("dog <b>dog</b> dog");
    expect(eds[1].innerHTML).toBe("the dog");
    expect(eds[2].innerHTML).toBe("dog");
    expect(findMatches(root, "cat", plain)).toHaveLength(0);
  });

  it("handles multiple matches in one text node and replacements containing the query", () => {
    const root = mount("aa aa aa");
    expect(replaceAll(root, "aa", "aaa", plain)).toBe(3);
    expect(editables(root)[0].innerHTML).toBe("aaa aaa aaa");
  });

  it("respects options and leaves atoms untouched", () => {
    const root = mount('Foo foo <span contenteditable="false">foo</span> food');
    expect(replaceAll(root, "foo", "bar", { matchCase: true, wholeWord: true })).toBe(1);
    expect(editables(root)[0].innerHTML).toBe('Foo bar <span contenteditable="false">foo</span> food');
  });

  it("fires one input event per touched editable", () => {
    const root = mount("x x", "x", "y");
    const spy = vi.fn();
    root.addEventListener("input", spy);
    expect(replaceAll(root, "x", "z", plain)).toBe(3);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns 0 with no matches", () => {
    expect(replaceAll(mount("abc"), "zzz", "y", plain)).toBe(0);
  });
});

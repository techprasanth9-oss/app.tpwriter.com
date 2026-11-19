import { describe, expect, it, vi } from "vitest";
import { ListTool, MAX_LIST_DEPTH, markerFor } from "./ListTool";

const api: any = new Proxy(
  {},
  {
    get: () =>
      new Proxy(() => undefined, {
        get: () => () => undefined,
      }),
  },
);

const item = (content: string, items: any[] = [], meta: any = {}) => ({ content, meta, items });

function mount(data: unknown, readOnly = false) {
  const block = { id: "b1", dispatchChange: vi.fn() };
  const tool = new (ListTool as any)({ data, api, config: {}, readOnly, block }) as ListTool;
  const el = tool.render();
  document.body.innerHTML = "";
  document.body.appendChild(el);
  return { tool, el, block };
}

function contentOf(el: HTMLElement, text: string): HTMLElement {
  const found = Array.from(el.querySelectorAll<HTMLElement>(".cdx-list-item__content")).find(
    (c) => c.textContent === text,
  );
  if (!found) throw new Error(`no item "${text}"`);
  return found;
}

function caretIn(node: HTMLElement, offset = 0) {
  const text = node.firstChild ?? node;
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

function press(el: HTMLElement, text: string, key: string, opts: KeyboardEventInit = {}, offset = 0) {
  const content = contentOf(el, text);
  caretIn(content, offset);
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  content.dispatchEvent(ev);
  return ev;
}

/** Strip to `content` + children for structure assertions. */
const shape = (items: any[]): any[] => items.map((i) => [i.content, shape(i.items)]);

describe("ListTool data", () => {
  it("round-trips legacy data unchanged", () => {
    const data = {
      style: "ordered",
      items: [
        item('One <a href="https://e.com">link</a>', [item("1a", [item("1a-i")])]),
        item("Two<br>lines"),
      ],
      meta: { counterType: "numeric" },
    };
    const { tool, el } = mount(structuredClone(data));
    expect(tool.save(el)).toEqual(data);
  });

  it("round-trips legacy counter names written by the old tool", () => {
    for (const counterType of ["roman", "alphabetic"]) {
      const data = { style: "ordered", items: [item("x")], meta: { counterType } };
      const { tool, el } = mount(structuredClone(data));
      expect(tool.save(el)).toEqual(data);
    }
    const { el } = mount({ style: "ordered", items: [item("x")], meta: { counterType: "roman" } });
    expect((el.querySelector(".cdx-list") as HTMLElement).style.listStyleType).toBe("upper-roman");
  });

  it("renders nested items as nested lists and saves them back", () => {
    const data = { style: "unordered", items: [item("a", [item("b", [item("c")])])], meta: { counterType: "numeric" } };
    const { tool, el } = mount(structuredClone(data));
    const lists = el.querySelectorAll("ul");
    expect(lists).toHaveLength(3);
    expect(Array.from(lists).map((l) => l.style.listStyleType)).toEqual(["disc", "circle", "square"]);
    expect(el.querySelectorAll(".cdx-list")).toHaveLength(1);
    expect(tool.save(el)).toEqual(data);
  });

  it("reflects counterType and start in the DOM and saves them", () => {
    const data = {
      style: "ordered",
      items: [item("a", [item("b", [item("c", [item("d")])])])],
      meta: { counterType: "upper-roman", start: 4 },
    };
    const { tool, el } = mount(structuredClone(data));
    const top = el.querySelector(".cdx-list") as HTMLOListElement;
    expect(top.tagName).toBe("OL");
    expect(top.start).toBe(4);
    expect(Array.from(el.querySelectorAll("ol")).map((l) => l.style.listStyleType)).toEqual([
      "upper-roman",
      "decimal",
      "lower-alpha",
      "lower-roman",
    ]);
    expect(tool.save(el)).toEqual(data);
  });

  it("cycles numbering Word-style from the base format", () => {
    expect([0, 1, 2, 3].map((l) => markerFor("ordered", "numeric", l))).toEqual([
      "decimal",
      "lower-alpha",
      "lower-roman",
      "decimal",
    ]);
    expect(markerFor("ordered", "lower-alpha", 1)).toBe("lower-roman");
    expect(markerFor("checklist", "numeric", 0)).toBe("none");
  });

  it("ignores invalid meta, style and item values", () => {
    const { tool, el } = mount({
      style: "bogus</ol><script>",
      items: [{ content: 5, meta: { checked: "yes", evil: "x" }, items: "nope" }],
      meta: { counterType: "red; background:url(x)", start: "3; color:red", extra: 1 },
    });
    const top = el.querySelector(".cdx-list") as HTMLElement;
    expect(top.tagName).toBe("UL");
    expect(top.getAttribute("style")).toBe("list-style-type: disc;");
    expect(tool.save(el)).toEqual({
      style: "unordered",
      items: [item("")],
      meta: { counterType: "numeric" },
    });
    for (const start of [0, -2, 1.5, NaN]) {
      const t = mount({ style: "ordered", items: [item("x")], meta: { counterType: "numeric", start } });
      expect((t.el.querySelector("ol") as HTMLOListElement).hasAttribute("start")).toBe(false);
      expect(t.tool.save(t.el).meta).toEqual({ counterType: "numeric" });
    }
  });

  it("wraps converted paragraph text into one item", () => {
    const { tool, el } = mount({ style: "ordered", items: "Hello <b>x</b>" });
    expect(tool.save(el).items).toEqual([item("Hello <b>x</b>")]);
  });
});

describe("ListTool checklist", () => {
  it("renders non-editable checkboxes and saves toggles", () => {
    const data = {
      style: "checklist",
      items: [item("a", [item("a1", [], { checked: true })], { checked: false })],
      meta: { counterType: "numeric" },
    };
    const { tool, el, block } = mount(structuredClone(data));
    const boxes = el.querySelectorAll<HTMLInputElement>("input.cdx-list-item__checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.getAttribute("contenteditable")).toBe("false");
    expect(boxes[0]!.closest("[contenteditable=true]")).toBeNull();
    expect(boxes[1]!.checked).toBe(true);
    expect(boxes[1]!.closest("li")!.classList.contains("cdx-list-item--checked")).toBe(true);
    expect(tool.save(el)).toEqual(data);

    boxes[0]!.click();
    expect(block.dispatchChange).toHaveBeenCalled();
    expect(boxes[0]!.closest("li")!.classList.contains("cdx-list-item--checked")).toBe(true);
    const saved = tool.save(el);
    expect(saved.items[0]!.meta).toEqual({ checked: true });
    expect(saved.items[0]!.items[0]!.meta).toEqual({ checked: true });
  });

  it("defaults checked to false and preserves nesting across style switches", () => {
    const { tool, el } = mount({ style: "ordered", items: [item("a", [item("b")])], meta: { counterType: "numeric" } });
    tool.setStyle("checklist");
    let saved = tool.save(el);
    expect(saved.style).toBe("checklist");
    expect(saved.items).toEqual([item("a", [item("b", [], { checked: false })], { checked: false })]);
    expect(el.querySelector(".cdx-list")!.tagName).toBe("UL");

    (el.querySelector("input") as HTMLInputElement).click();
    tool.setStyle("unordered");
    saved = tool.save(el);
    expect(el.querySelector("input")).toBeNull();
    expect(saved.items[0]!.meta).toEqual({ checked: true });
    expect(shape(saved.items)).toEqual([["a", [["b", []]]]]);
  });

  it("disables checkboxes in read-only mode", () => {
    const { el } = mount({ style: "checklist", items: [item("a")], meta: {} }, true);
    expect((el.querySelector("input") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("ListTool keyboard", () => {
  const flat = () => ({
    style: "ordered",
    items: [item("one"), item("two"), item("three")],
    meta: { counterType: "numeric" },
  });

  it("Tab nests under the previous sibling and keeps the caret in the item", () => {
    const { tool, el, block } = mount(flat());
    const ev = press(el, "two", "Tab", {}, 2);
    expect(ev.defaultPrevented).toBe(true);
    expect(shape(tool.save(el).items)).toEqual([["one", [["two", []]]], ["three", []]]);
    expect(block.dispatchChange).toHaveBeenCalled();
    const sel = window.getSelection()!;
    expect(sel.anchorNode?.parentElement).toBe(contentOf(el, "two"));
    expect(sel.anchorOffset).toBe(2);

    press(el, "three", "Tab");
    expect(shape(tool.save(el).items)).toEqual([["one", [["two", []], ["three", []]]]]);
    press(el, "three", "Tab");
    expect(shape(tool.save(el).items)).toEqual([["one", [["two", [["three", []]]]]]]);
  });

  it("Tab on the first item is a no-op", () => {
    const { tool, el } = mount(flat());
    const ev = press(el, "one", "Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(shape(tool.save(el).items)).toEqual(shape(flat().items));
  });

  it("Shift+Tab outdents after the parent and adopts following siblings", () => {
    const { tool, el } = mount({
      style: "unordered",
      items: [item("p", [item("a"), item("b", [item("b1")]), item("c")]), item("q")],
      meta: { counterType: "numeric" },
    });
    press(el, "b", "Tab", { shiftKey: true });
    expect(shape(tool.save(el).items)).toEqual([
      ["p", [["a", []]]],
      ["b", [["b1", []], ["c", []]]],
      ["q", []],
    ]);
    // Top level: nothing happens.
    press(el, "q", "Tab", { shiftKey: true });
    expect(tool.save(el).items).toHaveLength(3);
  });

  it("Tab keeps the item's children at their level (Google Docs)", () => {
    const { tool, el } = mount({
      style: "unordered",
      items: [item("a"), item("b", [item("b1")])],
      meta: { counterType: "numeric" },
    });
    press(el, "b", "Tab");
    expect(shape(tool.save(el).items)).toEqual([["a", [["b", []], ["b1", []]]]]);
  });

  it(`caps nesting at ${MAX_LIST_DEPTH} levels`, () => {
    // L0 > L1 > … > L(max-1), whose parent also holds a second child "x".
    let deepest: any = item(`L${MAX_LIST_DEPTH - 1}`);
    let nested: any = item(`L${MAX_LIST_DEPTH - 2}`, [deepest, item("x")]);
    for (let l = MAX_LIST_DEPTH - 3; l >= 0; l--) nested = item(`L${l}`, [nested]);
    const data = { style: "ordered", items: [nested], meta: { counterType: "numeric" } };
    const { tool, el } = mount(structuredClone(data));
    expect(el.querySelectorAll("ol")).toHaveLength(MAX_LIST_DEPTH);
    const ev = press(el, "x", "Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(tool.save(el)).toEqual(data);
    // One level up it still works.
    press(el, "x", "Tab", { shiftKey: true });
    press(el, "x", "Tab");
    expect(tool.save(el)).toEqual(data);
  });

  it("Enter splits at the caret; Enter on an empty nested item outdents", () => {
    const { tool, el } = mount({
      style: "checklist",
      items: [item("ab", [item("c", [], { checked: true })], { checked: true })],
      meta: { counterType: "numeric" },
    });
    press(el, "ab", "Enter", {}, 1);
    expect(tool.save(el).items).toEqual([
      item("a", [], { checked: true }),
      item("b", [item("c", [], { checked: true })], { checked: false }),
    ]);

    press(el, "c", "Enter", {}, 1);
    const empty = el.querySelectorAll<HTMLElement>(".cdx-list-item__content")[3]!;
    expect(empty.textContent).toBe("");
    caretIn(empty);
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    empty.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(shape(tool.save(el).items)).toEqual([["a", []], ["b", [["c", []]]], ["", []]]);
  });

  it("Enter on an empty top-level item exits the list (removes it, lets EditorJS continue)", () => {
    const { tool, el } = mount({ style: "unordered", items: [item("a"), item("")], meta: { counterType: "numeric" } });
    const empty = el.querySelectorAll<HTMLElement>(".cdx-list-item__content")[1]!;
    caretIn(empty);
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    empty.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(shape(tool.save(el).items)).toEqual([["a", []]]);
  });

  it("Backspace at the start of an empty nested item outdents it", () => {
    const { tool, el } = mount({
      style: "unordered",
      items: [item("a", [item("")])],
      meta: { counterType: "numeric" },
    });
    const empty = el.querySelectorAll<HTMLElement>(".cdx-list-item__content")[1]!;
    caretIn(empty);
    const ev = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    empty.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(shape(tool.save(el).items)).toEqual([["a", []], ["", []]]);
  });

  it("keeps the outer element contract for pagination", () => {
    const { el } = mount(flat());
    const list = el.querySelector(".cdx-list") as HTMLElement;
    expect(list.parentElement).toBe(el);
    expect(list.style.overflow).toBe("");
    expect(list.style.display).toBe("");
  });
});

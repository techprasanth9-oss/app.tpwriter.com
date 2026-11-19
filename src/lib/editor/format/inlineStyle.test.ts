import { describe, expect, it } from "vitest";
import {
  applyInlineStyle,
  changeCase,
  clearFormatting,
  expandToWord,
  filterInlineStyle,
  stepFontSize,
} from "./inlineStyle";

function editable(html: string): HTMLElement {
  document.body.innerHTML = `<div contenteditable="true">${html}</div>`;
  return document.body.firstElementChild as HTMLElement;
}

/** Range over the first occurrence of `text` (may span text nodes). */
function rangeOf(root: HTMLElement, text: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const full = nodes.map((n) => n.data).join("");
  const at = full.indexOf(text);
  if (at < 0) throw new Error(`"${text}" not found`);
  const locate = (pos: number, end: boolean) => {
    let acc = 0;
    for (const n of nodes) {
      if (pos < acc + n.length || (end && pos === acc + n.length)) return [n, pos - acc] as const;
      acc += n.length;
    }
    const last = nodes[nodes.length - 1]!;
    return [last, last.length] as const;
  };
  const r = document.createRange();
  const [sn, so] = locate(at, false);
  const [en, eo] = locate(at + text.length, true);
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}

describe("applyInlineStyle", () => {
  it("wraps a plain-text selection in a styled span", () => {
    const root = editable("Hello brave new world");
    const out = applyInlineStyle(rangeOf(root, "brave new"), "font-size", "18pt");
    expect(root.innerHTML).toBe('Hello <span style="font-size: 18pt;">brave new</span> world');
    expect(out?.toString()).toBe("brave new");
  });

  it("splits formatting ancestors at the selection edges", () => {
    const root = editable("<b>bold text here</b>");
    applyInlineStyle(rangeOf(root, "text"), "color", "#ff0000");
    expect(root.innerHTML).toBe('<b>bold </b><span style="color: rgb(255, 0, 0);"><b>text</b></span><b> here</b>');
  });

  it("restyles instead of nesting, and merges identical neighbours", () => {
    const root = editable("one two");
    applyInlineStyle(rangeOf(root, "one"), "font-size", "18pt");
    applyInlineStyle(rangeOf(root, "one"), "font-size", "24pt");
    expect(root.innerHTML).toBe('<span style="font-size: 24pt;">one</span> two');
    applyInlineStyle(rangeOf(root, " two"), "font-size", "24pt");
    expect(root.innerHTML).toBe('<span style="font-size: 24pt;">one two</span>');
  });

  it("drops inner overrides of the same property but keeps others", () => {
    const root = editable('a<span style="font-size: 9pt; color: blue;">b</span>c');
    applyInlineStyle(rangeOf(root, "abc"), "font-size", "14pt");
    expect(root.querySelectorAll("[style*='9pt']")).toHaveLength(0);
    expect(root.innerHTML).toContain("color: blue");
    expect(root.textContent).toBe("abc");
  });

  it("removes a property with null and unwraps empty spans", () => {
    const root = editable('<span style="font-family: Arial;">text</span>');
    applyInlineStyle(rangeOf(root, "text"), "font-family", null);
    expect(root.innerHTML).toBe("text");
  });

  it("never splits an atom (variable chip)", () => {
    const root = editable('pre <span class="variable-chip" contenteditable="false">NAME</span> post');
    applyInlineStyle(rangeOf(root, "AM"), "color", "red");
    expect(root.querySelectorAll(".variable-chip")).toHaveLength(1);
    expect(root.querySelector(".variable-chip")!.textContent).toBe("NAME");
  });
});

describe("clearFormatting", () => {
  it("removes character formatting but keeps links and chips", () => {
    const root = editable(
      '<b>Bold <i>both</i></b> <a href="https://e.com">link</a> <span class="variable-chip" contenteditable="false">X</span>',
    );
    clearFormatting(rangeOf(root, root.textContent!));
    expect(root.innerHTML).toBe(
      'Bold both <a href="https://e.com">link</a> <span class="variable-chip" contenteditable="false">X</span>',
    );
  });

  it("only clears the selected part", () => {
    const root = editable("<b>keep clear keep</b>");
    clearFormatting(rangeOf(root, "clear"));
    expect(root.innerHTML).toBe("<b>keep </b>clear<b> keep</b>");
  });
});

describe("changeCase", () => {
  it.each([
    ["upper", "HELLO WORLD. AGAIN"],
    ["lower", "hello world. again"],
    ["title", "Hello World. Again"],
    ["sentence", "Hello world. Again"],
  ] as const)("%s", (mode, expected) => {
    const root = editable("hELLO <b>world</b>. again");
    changeCase(rangeOf(root, root.textContent!), mode);
    expect(root.textContent).toBe(expected);
    expect(root.querySelector("b")).not.toBeNull();
  });
});

describe("helpers", () => {
  it("expandToWord grows a caret inside a word, not at its edge", () => {
    const root = editable("hello world");
    const r = document.createRange();
    r.setStart(root.firstChild!, 8);
    r.collapse(true);
    expect(expandToWord(r)).toBe(true);
    expect(r.toString()).toBe("world");
    const edge = document.createRange();
    edge.setStart(root.firstChild!, 5);
    edge.collapse(true);
    expect(expandToWord(edge)).toBe(false);
  });

  it("filterInlineStyle keeps safe typography only", () => {
    expect(
      filterInlineStyle(
        "mso-bidi-font-size:11pt; font-size: 12pt; color:red; position:fixed; background:url(x); font-family:'Times New Roman'",
      ),
    ).toBe("font-size: 12pt; color: red; font-family: 'Times New Roman'");
  });

  it("stepFontSize walks the Word size list", () => {
    expect(stepFontSize(12, 1)).toBe(14);
    expect(stepFontSize(12, -1)).toBe(11);
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(72, 1)).toBe(72);
  });
});

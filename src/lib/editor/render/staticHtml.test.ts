import { describe, expect, it } from "vitest";
import { renderBlocksHtml } from "./staticHtml";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function render(blocks: Array<{ type: string; data: Record<string, unknown>; tunes?: Record<string, unknown> }>, fields?: Parameters<typeof renderBlocksHtml>[1]) {
  const host = document.createElement("div");
  host.innerHTML = renderBlocksHtml(blocks, fields);
  return host;
}

describe("renderBlocksHtml", () => {
  it("renders paragraphs and headers with editor classes", () => {
    const host = render([
      { type: "paragraph", data: { text: "Hello <b>world</b>" } },
      { type: "header", data: { text: "Title", level: 3 } },
      { type: "header", data: { text: "Bad level", level: 99 } },
    ]);
    const p = host.querySelector(".tp-format > .ce-paragraph")!;
    expect(p.innerHTML).toBe("Hello <b>world</b>");
    const h3 = host.querySelector("h3.ce-header")!;
    expect(h3.textContent).toBe("Title");
    expect(h3.getAttribute("data-level")).toBe("3");
    expect(host.querySelector("h2.ce-header")!.getAttribute("data-level")).toBe("2");
  });

  it("renders nested lists with per-level markers, start and checklists", () => {
    const host = render([
      {
        type: "list",
        data: {
          style: "ordered",
          meta: { counterType: "upper-roman", start: 4 },
          items: [{ content: "one", meta: {}, items: [{ content: "nested", meta: {}, items: [] }] }],
        },
      },
      {
        type: "list",
        data: {
          style: "checklist",
          meta: {},
          items: [
            { content: "done", meta: { checked: true }, items: [] },
            { content: "todo", meta: { checked: false }, items: [] },
          ],
        },
      },
    ]);
    const ol = host.querySelector("ol.cdx-list") as HTMLOListElement;
    expect(ol.style.listStyleType).toBe("upper-roman");
    expect(ol.start).toBe(4);
    const nested = ol.querySelector("ol.cdx-list--nested") as HTMLElement;
    expect(nested.style.listStyleType).toBe("decimal"); // roman → 1 → a cycle
    expect(nested.textContent).toContain("nested");
    const boxes = host.querySelectorAll<HTMLInputElement>("ul.cdx-list--checklist input[type=checkbox]");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.disabled).toBe(true);
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
  });

  it("renders images (safe src + width), tables and rules; skips breaks and toc", () => {
    const host = render([
      { type: "image", data: { file: { url: PNG }, dimensions: { width: "120px" } } },
      { type: "image", data: { url: "https://example.com/a.png", width: 50 } },
      { type: "table", data: { withHeading: true, content: [["H1", "H2"], ["a", "<i>b</i>"]] } },
      { type: "horizontalLine", data: {} },
      { type: "delimiter", data: {} },
      { type: "pageBreak", data: {} },
      { type: "sectionBreak", data: { layout: {} } },
      { type: "toc", data: { maxLevel: 3 } },
    ]);
    const imgs = host.querySelectorAll("img");
    expect(imgs[0]!.getAttribute("src")).toBe(PNG);
    expect(imgs[0]!.style.width).toBe("120px");
    expect(imgs[1]!.style.width).toBe("50px");
    expect(host.querySelectorAll("th")).toHaveLength(2);
    expect(host.querySelectorAll("td")[1]!.innerHTML).toBe("<i>b</i>");
    expect(host.querySelectorAll("hr")).toHaveLength(2);
    expect(host.querySelectorAll(".tp-format")).toHaveLength(5);
  });

  it("applies the format tune on the tp-format wrapper", () => {
    const host = render([
      {
        type: "paragraph",
        data: { text: "x" },
        tunes: {
          format: { alignment: "center", indent: 2, lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12, styleId: "title" },
        },
      },
      // Legacy alignment shape is folded in by normalizeBlock.
      { type: "paragraph", data: { text: "y", alignment: "right" } },
      { type: "paragraph", data: { text: "z" }, tunes: { format: { alignment: "url(x)", styleId: "Bad Id" } } },
    ]);
    const [a, b, c] = Array.from(host.querySelectorAll<HTMLElement>(".tp-format"));
    expect(a!.style.textAlign).toBe("center");
    expect(a!.style.paddingLeft).toBe("80px");
    expect(a!.style.lineHeight).toBe("1.5");
    expect(a!.style.paddingTop).toBe("6px");
    expect(a!.style.paddingBottom).toBe("12px");
    expect(a!.classList.contains("tp-style-title")).toBe(true);
    expect(a!.classList.contains("tp-has-space-before")).toBe(true);
    expect(b!.style.textAlign).toBe("right");
    expect(c!.style.textAlign).toBe("");
    expect(c!.className).toBe("tp-format");
  });

  it("substitutes field values but keeps the field spans", () => {
    const text =
      'Page <span class="tp-field" data-field="page" contenteditable="false">#</span> of ' +
      '<span class="tp-field" data-field="pages" contenteditable="false">#</span> — ' +
      '<span class="tp-field" data-field="title" contenteditable="false">t</span>';
    const host = render([{ type: "paragraph", data: { text } }], {
      fields: { page: 3, pages: 9, date: "1/1/2026", title: "<b>Doc</b>" },
    });
    expect(host.textContent).toBe("Page 3 of 9 — <b>Doc</b>");
    expect(host.querySelectorAll("span.tp-field")).toHaveLength(3);
    expect(host.querySelector("b")).toBeNull();
    // Without values the placeholders stay.
    const plain = render([{ type: "paragraph", data: { text } }]);
    expect(plain.textContent).toBe("Page # of # — t");
  });

  it("neutralises XSS attempts", () => {
    const html = renderBlocksHtml([
      { type: "paragraph", data: { text: '<img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><script>alert(1)</script>' } },
      { type: "image", data: { file: { url: "javascript:alert(1)" } } },
      { type: "header", data: { text: "<svg onload=alert(1)>", level: '1 onclick="x"' } },
      { type: "table", data: { content: [['<iframe src="javascript:alert(1)"></iframe>']] } },
      { type: "list", data: { style: "ordered", meta: { counterType: "x;background:url(javascript:1)" }, items: [{ content: "<img src=1 onerror=alert(1)>" }] } },
    ] as never);
    expect(html).not.toMatch(/onerror|onload|onclick|javascript:|<script|<iframe|<svg/i);
    // A relative url with quotes stays one escaped attribute value.
    const host = render([{ type: "image", data: { url: 'x" onerror="alert(1)' } }]);
    const img = host.querySelector("img")!;
    expect(img.getAttributeNames().sort()).toEqual(["alt", "src", "style"]);
  });
});

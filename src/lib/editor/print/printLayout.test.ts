import { afterEach, describe, expect, it } from "vitest";
import { buildPrintLayout, pageName, pageRulesCss, stripEditorUi, type PrintPageGeometry } from "./printLayout";
import { waitForStableLayout } from "./printDocument";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** jsdom has no layout: give elements fixed client rects. */
function setRect(el: Element, r: Rect) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r }) as DOMRect;
}

// Page 0: A4 portrait; page 1: A4 landscape, centred in the 1123px column.
const PAGES: PrintPageGeometry[] = [
  { top: 0, left: 164.5, pageWidth: 794, pageHeight: 1123 },
  { top: 1151, left: 0, pageWidth: 1123, pageHeight: 794 },
];

/**
 * A live document like DocumentSurface renders it, with the document
 * placed at (offsetX, offsetY) in the viewport and zoomed by `zoom`.
 */
function liveDocument({ zoom = 1, offsetX = 40, offsetY = 100 } = {}) {
  document.body.innerHTML = `
    <div class="tp-document" style="width:1123px">
      <style>.tp-document .ce-paragraph{color:red}</style>
      <div class="tp-sheet" style="top:0px;left:164.5px;width:794px;height:1123px">
        <div class="tp-watermark">DRAFT</div><span class="tp-sheet-number">1</span>
      </div>
      <div class="tp-sheet" style="top:1151px;left:0px;width:1123px;height:794px">
        <div class="tp-watermark">DRAFT</div><span class="tp-sheet-number">2</span>
      </div>
      <div class="page-canvas tp-flow" style="padding-top:96px;min-height:1945px">
        <div>
          <div class="codex-editor">
            <div class="codex-editor__redactor">
              <div class="ce-block ce-block--focused" data-id="b0" id="anchor-b0">
                <div class="ce-block__content"><div class="ce-paragraph" contenteditable="true" data-placeholder="Type…">First</div></div>
              </div>
              <div class="ce-block" data-id="b1">
                <div class="tp-split tp-split--strut" style="height:120px"></div><div class="tp-split" style="height:220px"></div>
                <div class="ce-block__content"><div class="ce-paragraph" contenteditable="true"><a id="fn-anchor">Split</a> paragraph</div></div>
              </div>
              <div class="ce-block" data-id="b2">
                <div class="ce-block__content"><div class="tp-image"><img src="data:image/png;base64,AA==" loading="lazy"><div class="custom-image-tool__resize-handle"></div><button>Crop</button></div></div>
              </div>
              <div class="ce-toolbar"><div class="ce-toolbar__plus"></div></div>
            </div>
          </div>
        </div>
      </div>
      <div class="tp-overlay">
        <div class="tp-page-overlay" style="top:0px;left:164.5px;width:794px;height:1123px">
          <div class="tp-hf tp-hf--header" title="Double-click to edit" data-testid="header-0"><div class="tp-hf-static">Head 1</div></div>
          <div class="tp-hf tp-hf--footer"><div class="tp-hf-static">Page 1 of 2</div></div>
        </div>
        <div class="tp-page-overlay" style="top:1151px;left:0px;width:1123px;height:794px">
          <div class="tp-hf tp-hf--header is-editing"><span class="tp-hf-tag">Header</span><div contenteditable="true">Head 2</div></div>
          <div class="tp-footnotes"><div class="tp-fn"><span class="tp-fn__num">1</span><div class="tp-fn__text" contenteditable="">Note</div></div></div>
        </div>
      </div>
    </div>`;
  const docEl = document.querySelector<HTMLElement>(".tp-document")!;
  Object.defineProperty(docEl, "offsetWidth", { configurable: true, value: 1123 });
  setRect(docEl, { top: offsetY, left: offsetX, width: 1123 * zoom, height: 1945 * zoom });
  // Unscaled document coordinates of each block.
  const blocks: Record<string, Rect> = {
    b0: { top: 96, left: 164.5 + 96, width: 602, height: 60 },
    // Starts near the bottom of page 0 and continues on page 1.
    b1: { top: 1000, left: 164.5 + 96, width: 602, height: 400 },
    b2: { top: 1500, left: 96, width: 931, height: 200 },
  };
  for (const [id, r] of Object.entries(blocks)) {
    setRect(document.querySelector(`[data-id="${id}"]`)!, {
      top: offsetY + r.top * zoom,
      left: offsetX + r.left * zoom,
      width: r.width * zoom,
      height: r.height * zoom,
    });
  }
  return docEl;
}

const ids = (page: HTMLElement) => Array.from(page.querySelectorAll<HTMLElement>(".ce-block")).map((b) => b.dataset.id);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("buildPrintLayout", () => {
  it("builds one exactly page-sized container per page with named @page rules", () => {
    const { root, pages } = buildPrintLayout(liveDocument(), PAGES);
    expect(pages).toHaveLength(2);
    expect(root.querySelectorAll(".tp-print-page")).toHaveLength(2);
    expect(pages[0]!.style.width).toBe("794px");
    expect(pages[0]!.style.height).toBe("1123px");
    expect(pages[1]!.style.width).toBe("1123px");
    expect(pages[1]!.style.height).toBe("794px");
    expect(pages[0]!.dataset.printPage).toBe("tp-page-794x1123");
    expect(pages[1]!.dataset.printPage).toBe("tp-page-1123x794");

    const css = root.querySelector("style[data-tp-print]")!.textContent!;
    expect(css).toContain("@page tp-page-794x1123 { size: 794px 1123px; margin: 0; }");
    expect(css).toContain("@page tp-page-1123x794 { size: 1123px 794px; margin: 0; }");
    expect(css).toContain('.tp-print-page[data-print-page="tp-page-1123x794"] { page: tp-page-1123x794; }');
    // Named styles from the document come along.
    expect(root.textContent).toContain(".tp-document .ce-paragraph{color:red}");
  });

  it("clones only the blocks that intersect each page, split blocks on both", () => {
    const { pages } = buildPrintLayout(liveDocument(), PAGES);
    expect(ids(pages[0]!)).toEqual(["b0", "b1"]);
    expect(ids(pages[1]!)).toEqual(["b1", "b2"]);
    // Split floats travel with the block.
    expect(pages[1]!.querySelectorAll('[data-id="b1"] .tp-split')).toHaveLength(2);
  });

  it("positions clones at their on-screen offset relative to the page", () => {
    const { pages } = buildPrintLayout(liveDocument(), PAGES);
    const b1First = pages[0]!.querySelector<HTMLElement>('[data-id="b1"]')!;
    expect(b1First.style.position).toBe("absolute");
    expect(b1First.style.top).toBe("1000px");
    expect(b1First.style.left).toBe("96px");
    expect(b1First.style.width).toBe("602px");
    expect(b1First.style.margin).toBe("0px");
    // On page 1 the block starts above the sheet: only its tail shows.
    const b1Second = pages[1]!.querySelector<HTMLElement>('[data-id="b1"]')!;
    expect(b1Second.style.top).toBe("-151px");
    expect(b1Second.style.left).toBe("260.5px");
    const b2 = pages[1]!.querySelector<HTMLElement>('[data-id="b2"]')!;
    expect(b2.style.top).toBe("349px");
    expect(b2.style.left).toBe("96px");
  });

  it("measures through zoom (scaled rects map back to document px)", () => {
    const { pages } = buildPrintLayout(liveDocument({ zoom: 1.5, offsetX: 10, offsetY: -300 }), PAGES);
    expect(ids(pages[1]!)).toEqual(["b1", "b2"]);
    expect(pages[1]!.querySelector<HTMLElement>('[data-id="b1"]')!.style.top).toBe("-151px");
    expect(pages[1]!.querySelector<HTMLElement>('[data-id="b2"]')!.style.width).toBe("931px");
  });

  it("copies sheet decoration and per-page headers / footers / footnotes", () => {
    const { pages } = buildPrintLayout(liveDocument(), PAGES);
    const sheet = pages[1]!.querySelector<HTMLElement>(".tp-sheet")!;
    expect(sheet.style.top).toBe("0px");
    expect(sheet.style.left).toBe("0px");
    expect(sheet.querySelector(".tp-watermark")?.textContent).toBe("DRAFT");
    expect(sheet.querySelector(".tp-sheet-number")).toBeNull();

    expect(pages[0]!.querySelector(".tp-hf--footer")?.textContent).toBe("Page 1 of 2");
    expect(pages[0]!.querySelector(".tp-hf--header")?.hasAttribute("title")).toBe(false);
    expect(pages[0]!.querySelector("[data-testid]")).toBeNull();
    const overlay = pages[1]!.querySelector<HTMLElement>(".tp-page-overlay")!;
    expect(overlay.style.top).toBe("0px");
    expect(overlay.style.left).toBe("0px");
    expect(overlay.querySelector(".tp-hf-tag")).toBeNull();
    expect(overlay.querySelector(".is-editing")).toBeNull();
    expect(overlay.querySelector(".tp-footnotes")?.textContent).toContain("Note");
  });

  it("strips editor UI and editing affordances, leaving the live DOM alone", () => {
    const live = liveDocument();
    const { root } = buildPrintLayout(live, PAGES);
    expect(root.querySelector("[contenteditable]")).toBeNull();
    expect(root.querySelector("[data-placeholder]")).toBeNull();
    expect(root.querySelector(".ce-toolbar")).toBeNull();
    expect(root.querySelector("[class*='resize-handle']")).toBeNull();
    expect(root.querySelector("button")).toBeNull();
    expect(root.querySelector(".ce-block--focused")).toBeNull();
    expect(root.querySelector("img")?.hasAttribute("loading")).toBe(false);
    // Live editor untouched.
    expect(live.querySelectorAll('[contenteditable="true"]').length).toBeGreaterThan(0);
    expect(live.querySelector(".ce-toolbar")).not.toBeNull();
    expect(live.querySelector<HTMLElement>('[data-id="b1"]')!.style.position).toBe("");
  });

  it("keeps element ids only on a block's first page", () => {
    const { pages } = buildPrintLayout(liveDocument(), PAGES);
    expect(pages[0]!.querySelector("#anchor-b0")).not.toBeNull();
    expect(pages[0]!.querySelector("#fn-anchor")).not.toBeNull();
    expect(pages[1]!.querySelector("#fn-anchor")).toBeNull();
  });
});

describe("helpers", () => {
  it("names pages by size and emits one @page rule per distinct size", () => {
    expect(pageName(793.7, 1122.5)).toBe("tp-page-794x1123");
    const css = pageRulesCss([PAGES[0]!, PAGES[0]!, PAGES[1]!]);
    expect(css.match(/@page tp-page-/g)).toHaveLength(2);
    expect(css).toContain("@page { margin: 0; }");
  });

  it("stripEditorUi removes toolbars and contenteditable", () => {
    const el = document.createElement("div");
    el.innerHTML = `<div class="ce-inline-toolbar"></div><p contenteditable="true" data-placeholder="x">t</p><div data-crop-handle="ne"></div>`;
    stripEditorUi(el);
    expect(el.innerHTML).toBe("<p>t</p>");
  });

  it("waitForStableLayout resolves once the signature stops changing", async () => {
    let n = 0;
    const settled = await waitForStableLayout(() => String(Math.min(++n, 3)), { quietMs: 40, intervalMs: 10, timeoutMs: 2000 });
    expect(settled).toBe(true);
    expect(n).toBeGreaterThanOrEqual(6);
    const never = await waitForStableLayout(() => String(++n), { quietMs: 40, intervalMs: 10, timeoutMs: 100 });
    expect(never).toBe(false);
  });
});

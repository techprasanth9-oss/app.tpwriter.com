/**
 * Print layout: turns the live, paginated document into a print-only DOM
 * with ONE container per page.
 *
 * On screen the document is one EditorJS flow laid over page sheets; the
 * paginator pushes blocks down (generated margin-top rules), splits text
 * blocks with invisible floats and shifts table rows. Printing that flow
 * directly would let the browser re-paginate it on its own terms. Instead,
 * for every page we build an exactly page-sized, `overflow: hidden`
 * container and place copies of the blocks that intersect it at their
 * measured on-screen offset. Measured positions already include every
 * paginator effect (pushes, per-section margins/widths, float narrowing),
 * so the clones are positioned absolutely with their margins zeroed; split
 * floats, shifted rows and ghost header rows live inside the block and are
 * copied with it. A block split over two pages is cloned onto both and the
 * container clips it to that page's part.
 *
 * Each container uses a named `@page` (`size: <w>px <h>px; margin: 0`) so
 * mixed paper sizes and orientations print on matching sheets.
 */

/** The geometry a print page needs (a subset of the paginator's PageView). */
export interface PrintPageGeometry {
  /** Sheet top within the document, px (unscaled). */
  top: number;
  /** Sheet left within the document column, px (unscaled). */
  left: number;
  pageWidth: number;
  pageHeight: number;
}

export interface PrintLayout {
  /** `.tp-print-root`: a `<style>` with the @page rules + one container per page. */
  root: HTMLElement;
  pages: HTMLElement[];
}

export const PRINT_ROOT_CLASS = "tp-print-root";
export const PRINT_PAGE_CLASS = "tp-print-page";

/** Name of the @page rule for a sheet size. */
export function pageName(width: number, height: number): string {
  return `tp-page-${Math.round(width)}x${Math.round(height)}`;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** @page rules (one per distinct sheet size) and the selector mapping
 *  containers to them. */
export function pageRulesCss(pages: PrintPageGeometry[]): string {
  const seen = new Map<string, PrintPageGeometry>();
  for (const p of pages) seen.set(pageName(p.pageWidth, p.pageHeight), p);
  const rules = ["@page { margin: 0; }"];
  for (const [name, p] of seen) {
    rules.push(`@page ${name} { size: ${px(p.pageWidth)} ${px(p.pageHeight)}; margin: 0; }`);
    rules.push(`.${PRINT_PAGE_CLASS}[data-print-page="${name}"] { page: ${name}; }`);
  }
  // The first page's size also becomes the default, for browsers that
  // ignore named pages.
  const first = pages[0];
  if (first) rules.push(`@page { size: ${px(first.pageWidth)} ${px(first.pageHeight)}; }`);
  return rules.join("\n");
}

/** Editor UI that must never print. */
const UI_SELECTORS = [
  ".ce-toolbar",
  ".ce-inline-toolbar",
  ".ce-conversion-toolbar",
  ".ce-settings",
  ".ce-popover",
  ".ce-block__toolbar",
  ".tp-hf-tag",
  ".tp-sheet-number",
  "[class*='resize-handle']",
  "[data-crop-handle]",
  "[data-crop-overlay]",
  "[data-crop-toolbar]",
  "[class*='context-menu']",
  ".te-submenu",
  ".tp-equation__placeholder",
  ".tp-equation__hint",
  ".tp-chart__edit",
  ".tp-image__status",
  "button",
  "input[type='file']",
  "script",
].join(",");

const STATE_CLASSES = [
  "ce-block--selected",
  "ce-block--focused",
  "ce-block--drop-target",
  "ce-block--stretched-hover",
  "is-editing",
];

/**
 * Remove editor UI and editing affordances from a cloned subtree:
 * toolbars, resize / crop handles, placeholders, contenteditable (no
 * caret), selection state classes, hover titles.
 */
export function stripEditorUi(root: HTMLElement): void {
  root.querySelectorAll(UI_SELECTORS).forEach((el) => el.remove());
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of all) {
    if (el.hasAttribute("contenteditable")) el.removeAttribute("contenteditable");
    el.removeAttribute("data-placeholder");
    el.removeAttribute("data-placeholder-active");
    el.removeAttribute("tabindex");
    if (el.hasAttribute("title") && el.closest(".tp-hf")) el.removeAttribute("title");
    for (const cls of STATE_CLASSES) el.classList?.remove(cls);
    // Lazy images outside the viewport might never load in print.
    if (el.tagName === "IMG") el.removeAttribute("loading");
  }
}

/** Deep clone that also carries over state cloneNode drops: form values
 *  and canvas pixels. */
function deepClone<T extends HTMLElement>(src: T): T {
  const clone = src.cloneNode(true) as T;
  const srcFields = src.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
  if (srcFields.length > 0) {
    const dstFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
    srcFields.forEach((f, i) => {
      const d = dstFields[i];
      if (!d) return;
      if (d instanceof HTMLTextAreaElement) d.textContent = f.value;
      else if (d instanceof HTMLSelectElement) d.value = f.value;
      else if (d instanceof HTMLInputElement) {
        d.setAttribute("value", f.value);
        if ((f as HTMLInputElement).checked) d.setAttribute("checked", "");
      }
    });
  }
  const srcCanvases = src.querySelectorAll("canvas");
  if (srcCanvases.length > 0) {
    const dstCanvases = clone.querySelectorAll("canvas");
    srcCanvases.forEach((c, i) => {
      const d = dstCanvases[i];
      try {
        d?.getContext("2d")?.drawImage(c, 0, 0);
      } catch {
        /* tainted or unsupported (jsdom) — leave it blank */
      }
    });
  }
  return clone;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Build the print DOM from the live document element (`.tp-document`) and
 * the paginator's pages. Nothing in the live DOM is modified.
 */
export function buildPrintLayout(documentEl: HTMLElement, pages: PrintPageGeometry[]): PrintLayout {
  const doc = documentEl.ownerDocument;
  const docRect = documentEl.getBoundingClientRect();
  // Zoom is a CSS transform on .tp-document: rects are scaled, layout isn't.
  const scale = documentEl.offsetWidth > 0 && docRect.width > 0 ? docRect.width / documentEl.offsetWidth : 1;
  const local = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return {
      top: (r.top - docRect.top) / scale,
      left: (r.left - docRect.left) / scale,
      width: r.width / scale,
      height: r.height / scale,
    };
  };

  const flowSrc = documentEl.querySelector<HTMLElement>(".tp-flow");
  const editorSrc = flowSrc?.querySelector<HTMLElement>(".codex-editor") ?? null;
  const redactorSrc = editorSrc?.querySelector<HTMLElement>(".codex-editor__redactor") ?? null;
  const blocks = redactorSrc
    ? (Array.from(redactorSrc.children).filter((c) => c.classList.contains("ce-block")) as HTMLElement[])
    : [];
  const blockBoxes = blocks.map(local);
  const sheets = Array.from(documentEl.children).filter((c) => c.classList.contains("tp-sheet")) as HTMLElement[];
  const overlays = Array.from(documentEl.querySelectorAll<HTMLElement>(".tp-overlay > .tp-page-overlay"));
  // Named-style CSS lives in <style> elements inside .tp-document.
  const docStyles = Array.from(documentEl.querySelectorAll<HTMLStyleElement>(":scope > style"));

  const root = doc.createElement("div");
  root.className = PRINT_ROOT_CLASS;
  const style = doc.createElement("style");
  style.dataset.tpPrint = "pages";
  style.textContent = pageRulesCss(pages);
  root.appendChild(style);
  for (const s of docStyles) root.appendChild(s.cloneNode(true));

  const clonedOnce = new Set<number>();
  const pageEls: HTMLElement[] = [];
  pages.forEach((page, index) => {
    const name = pageName(page.pageWidth, page.pageHeight);
    const pageEl = doc.createElement("div");
    pageEl.className = PRINT_PAGE_CLASS;
    pageEl.dataset.printPage = name;
    pageEl.dataset.pageIndex = String(index);
    pageEl.style.width = px(page.pageWidth);
    pageEl.style.height = px(page.pageHeight);

    // .tp-document scope so named styles and document CSS apply.
    const scope = doc.createElement("div");
    scope.className = "tp-document tp-print-scope";
    pageEl.appendChild(scope);

    // ── Sheet decoration ───────────────────────────────────────────────
    const sheetSrc = sheets[index];
    if (sheetSrc) {
      const sheet = deepClone(sheetSrc);
      stripEditorUi(sheet);
      sheet.style.top = "0px";
      sheet.style.left = "0px";
      sheet.style.width = px(page.pageWidth);
      sheet.style.height = px(page.pageHeight);
      sheet.removeAttribute("aria-hidden");
      scope.appendChild(sheet);
    }

    // ── Content clipped to this page ───────────────────────────────────
    const flow = doc.createElement("div");
    flow.className = `${flowSrc?.className ?? "page-canvas tp-flow"} tp-print-flow`;
    const editor = doc.createElement("div");
    editor.className = editorSrc?.className ?? "codex-editor";
    const redactor = doc.createElement("div");
    redactor.className = redactorSrc?.className ?? "codex-editor__redactor";
    editor.appendChild(redactor);
    flow.appendChild(editor);
    scope.appendChild(flow);

    const pageTop = page.top;
    const pageBottom = page.top + page.pageHeight;
    blocks.forEach((block, i) => {
      const box = blockBoxes[i]!;
      if (box.height <= 0 && box.width <= 0) return;
      // Half a pixel of slack: a block ending exactly on a sheet edge
      // doesn't belong to the next one.
      if (box.top >= pageBottom - 0.5 || box.top + box.height <= pageTop + 0.5) return;
      const clone = deepClone(block);
      stripEditorUi(clone);
      // Anchors (TOC links) should resolve to the block's first page.
      if (clonedOnce.has(i)) {
        clone.removeAttribute("id");
        clone.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
      }
      clonedOnce.add(i);
      const s = clone.style;
      s.position = "absolute";
      s.top = px(box.top - pageTop);
      s.left = px(box.left - page.left);
      s.width = px(box.width);
      s.margin = "0";
      s.maxWidth = "none";
      s.boxSizing = "border-box";
      s.cssFloat = "none";
      clone.dataset.printOffset = String(Math.round((box.top - pageTop) * 100) / 100);
      redactor.appendChild(clone);
    });

    // ── Headers / footers / footnotes ──────────────────────────────────
    const overlaySrc = overlays[index];
    if (overlaySrc) {
      const layer = doc.createElement("div");
      layer.className = "tp-overlay tp-print-overlay";
      const overlay = deepClone(overlaySrc);
      stripEditorUi(overlay);
      overlay.style.top = "0px";
      overlay.style.left = "0px";
      overlay.querySelectorAll("[data-testid]").forEach((n) => n.removeAttribute("data-testid"));
      layer.appendChild(overlay);
      scope.appendChild(layer);
    }

    root.appendChild(pageEl);
    pageEls.push(pageEl);
  });

  return { root, pages: pageEls };
}

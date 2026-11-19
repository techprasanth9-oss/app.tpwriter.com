/**
 * Read-only HTML rendering of EditorJS blocks — used where blocks are shown
 * but not edited (headers / footers on every page sheet, print).
 *
 * Structure is built with DOM APIs in an inert document (nothing loads or
 * runs there), every stored HTML string goes through `sanitizeHtml`, and
 * attribute values are only ever set via DOM setters from validated data,
 * so the returned string is safe to assign to `innerHTML`.
 */
import type { EditorBlock } from "~/lib/api/documents";
import { applyFormat, cleanFormat, FORMAT_TUNE } from "../format/paragraphFormat";
import { normalizeBlock, type EditorBlockLike } from "../normalize";
import { fieldText, type FieldValues } from "../pageSetup";
import { sanitizeHtml } from "../sanitizeData";
import { isSafeImageUrl } from "../safeUrl";
import { markerFor } from "../tools/ListTool";

export interface RenderOptions {
  /** When given, `span.tp-field[data-field]` text is replaced per page. */
  fields?: FieldValues;
}

type Block = EditorBlock | EditorBlockLike;

let inertDoc: Document | null = null;
function doc(): Document {
  inertDoc ??= document.implementation.createHTMLDocument("");
  return inertDoc;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc().createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Element whose content is a sanitized stored HTML string. */
function htmlEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  html: unknown,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = el(tag, className);
  node.innerHTML = sanitizeHtml(typeof html === "string" ? html : "");
  return node;
}

interface ListItem {
  content?: unknown;
  meta?: { checked?: unknown };
  items?: unknown;
}

type ListStyle = "ordered" | "unordered" | "checklist";
type CounterType = Parameters<typeof markerFor>[1];

const COUNTER_TYPES = new Set([
  "numeric",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
  "roman",
  "alphabetic",
]);

function renderList(data: Record<string, unknown>): HTMLElement {
  const style: ListStyle =
    data.style === "ordered" || data.style === "checklist" ? data.style : "unordered";
  const meta = (data.meta && typeof data.meta === "object" ? data.meta : {}) as Record<
    string,
    unknown
  >;
  const counter = (
    COUNTER_TYPES.has(meta.counterType as string) ? meta.counterType : "numeric"
  ) as CounterType;

  const level = (items: unknown, depth: number): HTMLElement => {
    const list = el(style === "ordered" ? "ol" : "ul", "cdx-list__level");
    if (depth === 0) list.classList.add("cdx-list", `cdx-list--${style}`);
    else list.classList.add("cdx-list--nested");
    list.dataset.level = String(depth);
    list.style.listStyleType = markerFor(style, counter, depth);
    if (
      depth === 0 &&
      style === "ordered" &&
      typeof meta.start === "number" &&
      Number.isInteger(meta.start) &&
      meta.start >= 1
    ) {
      (list as HTMLOListElement).start = meta.start;
    }
    for (const raw of Array.isArray(items) ? items : []) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as ListItem;
      const li = el("li", "cdx-list-item cdx-list__item");
      if (style === "checklist") {
        const checked = item.meta?.checked === true;
        li.classList.toggle("cdx-list-item--checked", checked);
        const box = el("input", "cdx-list-item__checkbox");
        box.type = "checkbox";
        box.disabled = true;
        box.checked = checked;
        if (checked) box.setAttribute("checked", "");
        li.appendChild(box);
      }
      li.appendChild(htmlEl("div", item.content, "cdx-list-item__content"));
      if (Array.isArray(item.items) && item.items.length > 0) {
        li.appendChild(level(item.items, depth + 1));
      }
      list.appendChild(li);
    }
    return list;
  };

  const wrapper = el("div", "cdx-list-wrapper");
  wrapper.appendChild(level(data.items, 0));
  return wrapper;
}

/** "480px" / 480 → 480, or undefined. */
function pxNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 10000 ? n : undefined;
}

function renderImage(data: Record<string, unknown>): HTMLElement | null {
  const file = data.file as { url?: unknown } | undefined;
  const url =
    typeof file?.url === "string" && file.url
      ? file.url
      : typeof data.url === "string"
        ? data.url
        : "";
  if (!isSafeImageUrl(url)) return null;
  const dims = data.dimensions as { width?: unknown } | undefined;
  const width = pxNumber(dims?.width) ?? pxNumber(data.width);

  const figure = el("div", "tp-static-image");
  const img = el("img");
  img.setAttribute("src", url.trim());
  img.alt = typeof data.altText === "string" ? data.altText : "";
  img.style.maxWidth = "100%";
  if (width) img.style.width = `${width}px`;
  figure.appendChild(img);
  if (data.showCaption === true && typeof data.caption === "string" && data.caption) {
    figure.appendChild(htmlEl("div", data.caption, "tp-static-image__caption"));
  }
  return figure;
}

function renderTable(data: Record<string, unknown>): HTMLElement | null {
  const content = Array.isArray(data.content) ? (data.content as unknown[]) : [];
  if (content.length === 0) return null;
  const withHeading = data.withHeading === true || data.withHeadings === true;
  const table = el("table", "tp-static-table");
  const tbody = el("tbody");
  content.forEach((row, r) => {
    const tr = el("tr");
    for (const cell of Array.isArray(row) ? row : []) {
      tr.appendChild(htmlEl(withHeading && r === 0 ? "th" : "td", cell));
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderContent(block: Block): HTMLElement | null {
  const data = (block.data ?? {}) as Record<string, unknown>;
  switch (block.type) {
    case "paragraph":
      return htmlEl("div", data.text, "ce-paragraph");
    case "header": {
      const n = Number(data.level);
      const level = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 2;
      const h = htmlEl(`h${level}` as "h1", data.text, "ce-header");
      h.dataset.level = String(level);
      return h;
    }
    case "list":
      return renderList(data);
    case "image":
      return renderImage(data);
    case "table":
      return renderTable(data);
    case "horizontalLine":
      return el("hr");
    default:
      // pageBreak, sectionBreak, toc and unknown tools render nothing.
      return null;
  }
}

/** Replace every field chip's text with its value (the span stays). */
function fillFields(root: HTMLElement, fields: FieldValues): void {
  for (const span of Array.from(root.querySelectorAll<HTMLElement>("span.tp-field[data-field]"))) {
    span.textContent = fieldText(span.dataset.field ?? "", fields);
  }
}

export function renderBlocksHtml(blocks: readonly Block[], opts: RenderOptions = {}): string {
  const root = el("div");
  for (const raw of blocks ?? []) {
    if (!raw || typeof raw !== "object" || typeof raw.type !== "string") continue;
    const block = normalizeBlock(raw as EditorBlockLike);
    const content = renderContent(block);
    if (!content) continue;
    const wrapper = el("div", "tp-format");
    applyFormat(wrapper, cleanFormat(block.tunes?.[FORMAT_TUNE]));
    wrapper.appendChild(content);
    root.appendChild(wrapper);
  }
  if (opts.fields) fillFields(root, opts.fields);
  return root.innerHTML;
}

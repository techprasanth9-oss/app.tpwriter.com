import type { EditorBlock, PageLayout } from "~/lib/api/documents";

/**
 * Document-level page features (stored as `document.pageSetup`, opaque to
 * the API): headers / footers, page decoration and footnote texts.
 *
 * Inline atoms used in content:
 *   - fields:    <span class="tp-field" data-field="page|pages|date|title"
 *                      contenteditable="false">…</span>
 *   - footnotes: <sup class="tp-fn-ref" data-fn-id="<id>"
 *                     contenteditable="false">n</sup>
 * Section breaks are blocks: { type: "sectionBreak", data: { layout } } —
 * `layout` applies to the section that *follows* the break, and the first
 * section uses document.defaultLayout.
 */

export interface HeaderFooterSet {
  default: EditorBlock[];
  /** Used on a section's first page when `differentFirstPage`. */
  first: EditorBlock[];
  /** Used on even pages when `differentOddEven` (odd pages use default). */
  even: EditorBlock[];
}

export type HeaderFooterKind = keyof HeaderFooterSet;

export interface Watermark {
  text: string;
  color: string;
  /** 0.05–1 */
  opacity: number;
}

export interface PageBorder {
  style: "solid" | "double" | "dashed" | "dotted";
  /** px */
  width: number;
  color: string;
}

export interface PageSetup {
  headers: HeaderFooterSet;
  footers: HeaderFooterSet;
  differentFirstPage: boolean;
  differentOddEven: boolean;
  /** Distance from the page edge to the header / footer, px. */
  headerDistance: number;
  footerDistance: number;
  watermark: Watermark | null;
  pageColor: string | null;
  pageBorder: PageBorder | null;
  /** Footnote id → inline HTML. */
  footnotes: Record<string, string>;
}

export type FieldKind = "page" | "pages" | "date" | "title";

export interface FieldValues {
  page: number;
  pages: number;
  date: string;
  title: string;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  headers: { default: [], first: [], even: [] },
  footers: { default: [], first: [], even: [] },
  differentFirstPage: false,
  differentOddEven: false,
  headerDistance: 48,
  footerDistance: 48,
  watermark: null,
  pageColor: null,
  pageBorder: null,
  footnotes: {},
};

const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const BORDER_STYLES = new Set(["solid", "double", "dashed", "dotted"]);

const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

function blocks(v: unknown): EditorBlock[] {
  return Array.isArray(v)
    ? v.filter(
        (b): b is EditorBlock =>
          !!b && typeof b === "object" && typeof (b as EditorBlock).type === "string",
      )
    : [];
}

function set(v: unknown): HeaderFooterSet {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { default: blocks(o.default), first: blocks(o.first), even: blocks(o.even) };
}

/**
 * Validate stored page setup. `legacyHeader` / `legacyFooter` are the old
 * `headerBlocks` / `footerBlocks` document fields (DOCX imports wrote
 * them), used as the default header / footer when nothing newer exists.
 */
export function cleanPageSetup(
  raw: unknown,
  legacyHeader: unknown[] = [],
  legacyFooter: unknown[] = [],
): PageSetup {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const headers = set(o.headers);
  const footers = set(o.footers);
  if (!o.headers && legacyHeader.length > 0) headers.default = blocks(legacyHeader);
  if (!o.footers && legacyFooter.length > 0) footers.default = blocks(legacyFooter);

  const wm = o.watermark as Record<string, unknown> | null | undefined;
  const border = o.pageBorder as Record<string, unknown> | null | undefined;
  const footnotes: Record<string, string> = {};
  if (o.footnotes && typeof o.footnotes === "object") {
    for (const [id, html] of Object.entries(o.footnotes as Record<string, unknown>)) {
      if (ID.test(id) && typeof html === "string") footnotes[id] = html;
    }
  }

  return {
    headers,
    footers,
    differentFirstPage: o.differentFirstPage === true,
    differentOddEven: o.differentOddEven === true,
    headerDistance: num(o.headerDistance, 0, 200, DEFAULT_PAGE_SETUP.headerDistance),
    footerDistance: num(o.footerDistance, 0, 200, DEFAULT_PAGE_SETUP.footerDistance),
    watermark:
      wm && typeof wm.text === "string" && wm.text.trim()
        ? {
            text: wm.text.slice(0, 60),
            color: typeof wm.color === "string" && COLOR.test(wm.color) ? wm.color : "#94a3b8",
            opacity: num(wm.opacity, 0.05, 1, 0.25),
          }
        : null,
    pageColor: typeof o.pageColor === "string" && COLOR.test(o.pageColor) ? o.pageColor : null,
    pageBorder:
      border && BORDER_STYLES.has(border.style as string)
        ? {
            style: border.style as PageBorder["style"],
            width: num(border.width, 1, 12, 1),
            color: typeof border.color === "string" && COLOR.test(border.color) ? border.color : "#0f172a",
          }
        : null,
    footnotes,
  };
}

/** Which header / footer variant a page uses. `pageInSection` is 0-based
 *  within its section; `pageNumber` is the 1-based document page number. */
export function headerFooterKind(
  setup: PageSetup,
  pageInSection: number,
  pageNumber: number,
): HeaderFooterKind {
  if (setup.differentFirstPage && pageInSection === 0) return "first";
  if (setup.differentOddEven && pageNumber % 2 === 0) return "even";
  return "default";
}

/** Text a field shows on a given page. */
export function fieldText(kind: string, values: FieldValues): string {
  switch (kind) {
    case "page":
      return String(values.page);
    case "pages":
      return String(values.pages);
    case "date":
      return values.date;
    case "title":
      return values.title;
    default:
      return "";
  }
}

export function fieldHtml(kind: FieldKind, placeholder: string): string {
  return `<span class="tp-field" data-field="${kind}" contenteditable="false">${placeholder}</span>`;
}

export interface SectionBreakData {
  layout: PageLayout;
}

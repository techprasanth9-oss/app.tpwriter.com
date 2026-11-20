/**
 * Read-only accessors over an ImportedDocument: visible text per block,
 * inline formatting per character, lists, tables, images, sections.
 * Written against the importer contract (import/types.ts), tolerant of
 * missing / extra fields.
 */
import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import type { ImportedDocument } from "../import/types";
import type { HeaderFooterKind } from "../../pageSetup";
import type { Num, Scope, TextPattern } from "./types";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ── Numbers / text ──────────────────────────────────────────────────────

export function inRange(value: number | undefined | null, expected: Num, eps = 0.5): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (Array.isArray(expected)) return value >= expected[0] - 1e-9 && value <= expected[1] + 1e-9;
  return Math.abs(value - expected) <= eps;
}

export const fmtNum = (n: Num) => (Array.isArray(n) ? `${n[0]}–${n[1]}` : String(n));

export function normText(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

export function matches(text: string, pattern: TextPattern): boolean {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

export const showPattern = (p: TextPattern) => (typeof p === "string" ? JSON.stringify(p) : String(p));

const parser = () => new DOMParser();

/** Visible text of inline HTML (<br> → "\n", footnote refs dropped). */
export function htmlText(html: string): string {
  if (!html) return "";
  const body = parser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body;
  let out = "";
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) out += c.textContent ?? "";
      else if (c.nodeType === 1) {
        const el = c as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === "br") out += "\n";
        else if (tag === "sup" && el.classList.contains("tp-fn-ref")) continue;
        else {
          if (/^(p|div|li|tr)$/.test(tag) && out && !out.endsWith("\n")) out += "\n";
          walk(el);
        }
      }
    }
  };
  walk(body);
  return normText(out);
}

// ── Block HTML sources ──────────────────────────────────────────────────

interface ListItem {
  content?: unknown;
  items?: unknown;
}

export function listItems(block: EditorBlock): ListItem[] {
  return Array.isArray(block.data?.items) ? (block.data.items as ListItem[]) : [];
}

export function flattenItems(items: ListItem[], depth = 1): Array<{ html: string; depth: number }> {
  const out: Array<{ html: string; depth: number }> = [];
  for (const it of items) {
    const o = obj(it);
    out.push({ html: str(o.content), depth });
    if (Array.isArray(o.items)) out.push(...flattenItems(o.items as ListItem[], depth + 1));
  }
  return out;
}

export function tableContent(block: EditorBlock): string[][] {
  const c = block.data?.content;
  return Array.isArray(c) ? c.map((r) => (Array.isArray(r) ? r.map((x) => str(x)) : [])) : [];
}

/** Inline-HTML fragments a block carries (for text + formatting checks). */
export function blockHtmls(block: EditorBlock): string[] {
  const d = obj(block.data);
  switch (block.type) {
    case "paragraph":
    case "header":
    case "quote":
      return [str(d.text)];
    case "list":
      return flattenItems(listItems(block)).map((i) => i.html);
    case "table":
      return tableContent(block).flat();
    case "textBox":
      return [str(d.text)];
    case "image":
      return [str(d.caption)];
    case "toc":
      return [];
    default: {
      // Unknown / container blocks: any string `text` / `content` fields.
      const out: string[] = [];
      if (typeof d.text === "string") out.push(d.text);
      return out;
    }
  }
}

/** Visible text of a block (all its fragments joined by newlines). */
export function blockText(block: EditorBlock): string {
  if (block.type === "equation") return str(block.data?.latex);
  if (block.type === "toc") return "";
  return normText(blockHtmls(block).map(htmlText).filter(Boolean).join("\n"));
}

export function headerFooterBlocks(doc: ImportedDocument, part: "headers" | "footers", variant?: HeaderFooterKind): EditorBlock[] {
  const set = obj(obj(doc.pageSetup)[part]);
  const kinds: HeaderFooterKind[] = variant ? [variant] : ["default", "first", "even"];
  return kinds.flatMap((k) => (Array.isArray(set[k]) ? (set[k] as EditorBlock[]) : []));
}

export function footnoteHtmls(doc: ImportedDocument): Array<[string, string]> {
  const fn = obj(obj(doc.pageSetup).footnotes);
  return Object.entries(fn).filter((e): e is [string, string] => typeof e[1] === "string");
}

/** Inline-HTML fragments of a scope. */
export function scopeHtmls(doc: ImportedDocument, scope: Scope = "all"): string[] {
  const out: string[] = [];
  if (scope === "body" || scope === "all") for (const b of doc.blocks) out.push(...blockHtmls(b));
  if (scope === "headers" || scope === "all") for (const b of headerFooterBlocks(doc, "headers")) out.push(...blockHtmls(b));
  if (scope === "footers" || scope === "all") for (const b of headerFooterBlocks(doc, "footers")) out.push(...blockHtmls(b));
  if (scope === "footnotes" || scope === "all") for (const [, h] of footnoteHtmls(doc)) out.push(h);
  return out;
}

/** Visible-text units of a scope (one per block / footnote). */
export function scopeTexts(doc: ImportedDocument, scope: Scope = "all"): string[] {
  const out: string[] = [];
  const blocks = (bs: EditorBlock[]) => bs.map(blockText).filter(Boolean);
  if (scope === "body" || scope === "all") out.push(...blocks(doc.blocks));
  if (scope === "headers" || scope === "all") out.push(...blocks(headerFooterBlocks(doc, "headers")));
  if (scope === "footers" || scope === "all") out.push(...blocks(headerFooterBlocks(doc, "footers")));
  if (scope === "footnotes" || scope === "all") out.push(...footnoteHtmls(doc).map(([, h]) => htmlText(h)));
  return out;
}

/** Raw JSON of a scope (for "must not appear anywhere" checks). */
export function scopeRaw(doc: ImportedDocument, scope: Scope = "all"): string {
  const ps = obj(doc.pageSetup);
  switch (scope) {
    case "body":
      return JSON.stringify(doc.blocks);
    case "headers":
      return JSON.stringify(ps.headers ?? null);
    case "footers":
      return JSON.stringify(ps.footers ?? null);
    case "footnotes":
      return JSON.stringify(ps.footnotes ?? null);
    default:
      return JSON.stringify({ blocks: doc.blocks, pageSetup: doc.pageSetup });
  }
}

// ── Inline formatting ───────────────────────────────────────────────────

export interface CharFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  sup: boolean;
  sub: boolean;
  color?: string;
  background?: string;
  fontFamily?: string;
  fontSizePx?: number;
  href?: string;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  lime: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  navy: "#000080",
  teal: "#008080",
  maroon: "#800000",
  olive: "#808000",
  purple: "#800080",
};

/** Any CSS colour we expect to meet → "#rrggbb" (lowercase), or undefined. */
export function normColor(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#?([0-9a-f]{6})$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${m[1]!.split("").map((c) => c + c).join("")}`;
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
    return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  }
  return undefined;
}

export function cssSizePx(v: string): number | undefined {
  const m = /^([\d.]+)(px|pt|em|rem)?$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2]) {
    case "pt":
      return (n * 4) / 3;
    case "em":
    case "rem":
      return n * 16;
    default:
      return n;
  }
}

const firstFamily = (v: string) => v.split(",")[0]!.trim().replace(/^["']|["']$/g, "");

function styled(el: HTMLElement, f: CharFormat): CharFormat {
  const n = { ...f };
  const tag = el.tagName.toLowerCase();
  if (tag === "b" || tag === "strong") n.bold = true;
  if (tag === "i" || tag === "em") n.italic = true;
  if (tag === "u" || tag === "ins") n.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") n.strike = true;
  if (tag === "sup") n.sup = true;
  if (tag === "sub") n.sub = true;
  if (tag === "mark") n.background = normColor(el.style.backgroundColor) ?? "#ffff00";
  if (tag === "a") n.href = el.getAttribute("href") ?? "";
  if (tag === "font") {
    const c = normColor(el.getAttribute("color"));
    if (c) n.color = c;
    const face = el.getAttribute("face");
    if (face) n.fontFamily = firstFamily(face);
  }
  const st = el.style;
  if (st.fontWeight === "bold" || st.fontWeight === "bolder" || Number(st.fontWeight) >= 600) n.bold = true;
  if (st.fontWeight === "normal" || (Number(st.fontWeight) > 0 && Number(st.fontWeight) < 600)) n.bold = false;
  if (st.fontStyle === "italic" || st.fontStyle === "oblique") n.italic = true;
  const deco = `${st.textDecoration} ${st.textDecorationLine}`;
  if (deco.includes("underline")) n.underline = true;
  if (deco.includes("line-through")) n.strike = true;
  if (st.verticalAlign === "super") n.sup = true;
  if (st.verticalAlign === "sub") n.sub = true;
  const color = normColor(st.color);
  if (color) n.color = color;
  const bg = normColor(st.backgroundColor);
  if (bg) n.background = bg;
  if (st.fontFamily) n.fontFamily = firstFamily(st.fontFamily);
  if (st.fontSize) {
    const px = cssSizePx(st.fontSize);
    if (px) n.fontSizePx = px;
  }
  return n;
}

export const PLAIN: CharFormat = { bold: false, italic: false, underline: false, strike: false, sup: false, sub: false };

/** Characters of an inline-HTML fragment with their formatting. */
export function formattedChars(html: string): { text: string; formats: CharFormat[] } {
  const body = parser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body;
  let text = "";
  const formats: CharFormat[] = [];
  const walk = (n: Node, f: CharFormat) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) {
        const t = (c.textContent ?? "").replace(/ /g, " ");
        text += t;
        for (let i = 0; i < t.length; i++) formats.push(f);
      } else if (c.nodeType === 1) {
        const el = c as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (tag === "br") {
          text += "\n";
          formats.push(f);
        } else if (tag === "sup" && el.classList.contains("tp-fn-ref")) {
          continue;
        } else walk(el, styled(el, f));
      }
    }
  };
  walk(body, PLAIN);
  return { text, formats };
}

/** Compact signature of a format (used by summaries / diffs). Link
 *  underline + colour are ignored (the exporter styles links itself). */
export function formatSignature(f: CharFormat): string {
  const parts: string[] = [];
  if (f.bold) parts.push("b");
  if (f.italic) parts.push("i");
  if (f.underline && f.href === undefined) parts.push("u");
  if (f.strike) parts.push("s");
  if (f.sup) parts.push("sup");
  if (f.sub) parts.push("sub");
  if (f.color && f.href === undefined) parts.push(`c=${f.color}`);
  if (f.background) parts.push(`bg=${f.background}`);
  if (f.fontFamily) parts.push(`f=${f.fontFamily}`);
  // Round to the half point DOCX stores.
  if (f.fontSizePx) parts.push(`sz=${Math.round(((f.fontSizePx * 3) / 4) * 2) / 2}pt`);
  if (f.href !== undefined) parts.push(`a=${f.href}`);
  return parts.join(",");
}

// ── Lists / tables / images / layouts ───────────────────────────────────

export function listDepth(items: ListItem[]): number {
  let max = 0;
  for (const it of items) {
    const o = obj(it);
    const d = 1 + (Array.isArray(o.items) && o.items.length > 0 ? listDepth(o.items as ListItem[]) : 0);
    max = Math.max(max, d);
  }
  return max;
}

export function listMeta(block: EditorBlock): { style: string; counterType?: string; start?: number } {
  const d = obj(block.data);
  const meta = obj(d.meta);
  return {
    style: str(d.style) || "unordered",
    counterType: typeof meta.counterType === "string" ? meta.counterType : undefined,
    start: typeof meta.start === "number" ? meta.start : undefined,
  };
}

export interface CellInfo {
  r: number;
  c: number;
  colSpan: number;
  rowSpan: number;
  style: Obj;
}

const span = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 1 ? n : 1;
};

export function tableInfo(block: EditorBlock) {
  const d = obj(block.data);
  const content = tableContent(block);
  const styles = obj(d.styles);
  const cellStyles = obj(styles.cells);
  const rowStyles = obj(styles.rows);
  const cells: CellInfo[] = [];
  const occupied: boolean[][] = content.map(() => []);
  content.forEach((row, r) => {
    let c = 0;
    row.forEach((_, j) => {
      while (occupied[r]![c]) c++;
      const st = obj(obj(cellStyles[r])[j]);
      const cs = span(st.colSpan);
      const rs = Math.min(span(st.rowSpan), content.length - r);
      for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) occupied[rr]![cc] = true;
      cells.push({ r, c: j, colSpan: cs, rowSpan: rs, style: st });
      c += cs;
    });
  });
  const cols = Math.max(0, ...occupied.map((o) => o.length));
  const headerRows = Array.isArray(d.headerRows)
    ? (d.headerRows as unknown[]).filter((n): n is number => Number.isInteger(n))
    : d.withHeadings === true || d.withHeading === true
      ? [0]
      : [];
  const repeatHeader =
    typeof d.repeatHeader === "boolean" ? d.repeatHeader : typeof d.repeatHeaderOnPrint === "boolean" ? d.repeatHeaderOnPrint : undefined;
  const widths = Array.isArray(d.columnWidths) ? (d.columnWidths as unknown[]).map(Number) : [];
  const backgrounds = new Set<string>();
  for (const cell of cells) {
    const bg = normColor(str(cell.style.backgroundColor) || str(cell.style.background));
    if (bg) backgrounds.add(bg);
  }
  for (const rs of Object.values(rowStyles)) {
    const bg = normColor(str(obj(rs).backgroundColor));
    if (bg) backgrounds.add(bg);
  }
  return { content, rows: content.length, cols, cells, headerRows, repeatHeader, widths, backgrounds };
}

export function imageAlt(block: EditorBlock): string {
  const d = obj(block.data);
  return str(d.altText) || str(d.alt);
}

/** Same rules as ImageTool's imageWrapMode (kept local: that module pulls in CSS). */
export function imageWrap(block: EditorBlock): "inline" | "top-bottom" | "float-left" | "float-right" {
  const tune = obj(obj(obj(block.data).tunes).imageTune);
  const wrap = str(tune.wrapText);
  if (wrap === "inline") return "inline";
  if (["square", "tight", "through"].includes(wrap)) {
    if (tune.float === "left") return "float-left";
    if (tune.float === "right") return "float-right";
  }
  return "top-bottom";
}

export function px(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || v.includes("%")) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export function imageSize(block: EditorBlock): { width?: number; height?: number } {
  const d = obj(block.data);
  const dim = obj(d.dimensions);
  return { width: px(dim.width ?? d.width), height: px(dim.height ?? d.height) };
}

/** Section layouts: [defaultLayout, ...each sectionBreak's layout]. */
export function sectionLayouts(doc: ImportedDocument): PageLayout[] {
  return [
    doc.defaultLayout,
    ...doc.blocks.filter((b) => b.type === "sectionBreak").map((b) => obj(b.data).layout as PageLayout),
  ];
}

/** Field kinds present in some blocks' HTML. */
export function fieldKinds(blocks: EditorBlock[]): string[] {
  const kinds = new Set<string>();
  for (const b of blocks) {
    for (const html of blockHtmls(b)) {
      for (const m of html.matchAll(/class="[^"]*\btp-field\b[^"]*"[^>]*data-field="([a-z]+)"|data-field="([a-z]+)"[^>]*class="[^"]*\btp-field\b/g)) {
        kinds.add(m[1] ?? m[2]!);
      }
    }
  }
  return [...kinds];
}

/** Footnote reference ids in body order. */
export function footnoteRefIds(blocks: EditorBlock[]): string[] {
  const ids: string[] = [];
  for (const b of blocks) {
    for (const html of blockHtmls(b)) {
      const body = parser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body;
      for (const el of Array.from(body.querySelectorAll("sup.tp-fn-ref"))) ids.push(el.getAttribute("data-fn-id") ?? "");
    }
  }
  return ids;
}

export const formatOf = (block: EditorBlock): Obj => obj(obj(block.tunes).format);

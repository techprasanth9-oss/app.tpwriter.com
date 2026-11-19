/**
 * EditorJS blocks → DOCX (Blob) via the `docx` package.
 */
import {
  AlignmentType,
  BorderStyle,
  LevelFormat,
  Document,
  ExternalHyperlink,
  FileChild,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  PageBorderOffsetFrom,
  PageBreak,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableOfContents,
  TextRun,
  type IRunOptions,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import type { PageLayout } from "~/lib/api/documents";
import type { EditorBlock, EditorOutput } from "./importer";
import { normalizeBlock } from "../normalize";
import { isSafeLinkUrl } from "../safeUrl";
import { cleanFormat, FORMAT_TUNE, INDENT_STEP_PX } from "../format/paragraphFormat";
import type { HeaderFooterSet, PageBorder, PageSetup } from "../pageSetup";
import { chartToDocx, equationToDocx, prepareObjectImages, textBoxToDocx } from "./export/objects";
import { imageBlockToDocx, loadDocxImages, useDocxImages } from "./export/image";
import { tableToDocx } from "./export/table";

/** CSS px (96 dpi) → twips (1/1440 in). */
const pxToTwip = (px: number) => Math.round(px * 15);

/** Paragraph options from the block's `format` tune. */
function formatOptions(block: EditorBlock) {
  const tunes = (block as unknown as { tunes?: Record<string, unknown> }).tunes;
  const f = cleanFormat(tunes?.[FORMAT_TUNE]);
  return {
    alignment: tuneAlignment(f.alignment),
    ...(f.indent ? { indent: { left: pxToTwip(f.indent * INDENT_STEP_PX) } } : {}),
    ...(f.spaceBefore !== undefined || f.spaceAfter !== undefined
      ? {
          spacing: {
            ...(f.spaceBefore !== undefined ? { before: pxToTwip(f.spaceBefore) } : {}),
            ...(f.spaceAfter !== undefined ? { after: pxToTwip(f.spaceAfter) } : {}),
          },
        }
      : {}),
  };
}

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

export interface ExportOptions {
  title?: string;
  /** Layout of the first section (later ones come from section breaks). */
  defaultLayout?: PageLayout;
  /** Headers / footers, footnotes, page colour and border. */
  pageSetup?: PageSetup;
}

// ── Page layout ───────────────────────────────────────────────────────

/** Exact portrait paper sizes in twips (docx swaps them for landscape). */
const PAPER_TWIPS: Record<PageLayout["paperSize"], { w: number; h: number }> = {
  A4: { w: 11906, h: 16838 },
  LETTER: { w: 12240, h: 15840 },
  LEGAL: { w: 12240, h: 20160 },
  A3: { w: 16838, h: 23811 },
  A5: { w: 8391, h: 11906 },
};

const FALLBACK_LAYOUT: PageLayout = {
  paperSize: "A4",
  orientation: "portrait",
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
};

/** Validate a stored layout (section breaks hold untrusted data). */
function cleanLayout(raw: unknown, fallback: PageLayout = FALLBACK_LAYOUT): PageLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const margin = (v: unknown, d: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000 ? v : d;
  return {
    paperSize: Object.prototype.hasOwnProperty.call(PAPER_TWIPS, o.paperSize as string)
      ? (o.paperSize as PageLayout["paperSize"])
      : fallback.paperSize,
    orientation:
      o.orientation === "landscape" || o.orientation === "portrait"
        ? o.orientation
        : fallback.orientation,
    marginTop: margin(o.marginTop, fallback.marginTop),
    marginRight: margin(o.marginRight, fallback.marginRight),
    marginBottom: margin(o.marginBottom, fallback.marginBottom),
    marginLeft: margin(o.marginLeft, fallback.marginLeft),
  };
}

const BORDER_STYLES: Record<PageBorder["style"], (typeof BorderStyle)[keyof typeof BorderStyle]> = {
  solid: BorderStyle.SINGLE,
  double: BorderStyle.DOUBLE,
  dashed: BorderStyle.DASHED,
  dotted: BorderStyle.DOTTED,
};

const hexColor = (c: string | null | undefined) =>
  c && /^#[0-9a-f]{6}$/i.test(c) ? c.slice(1).toUpperCase() : undefined;

function pageBorders(border: PageBorder | null | undefined) {
  if (!border || !BORDER_STYLES[border.style]) return undefined;
  const side = {
    style: BORDER_STYLES[border.style],
    // px → eighths of a point (Word allows 2–96).
    size: Math.min(96, Math.max(2, Math.round(border.width * 0.75 * 8))),
    color: hexColor(border.color) ?? "000000",
    space: 24,
  };
  return {
    pageBorders: { offsetFrom: PageBorderOffsetFrom.PAGE },
    pageBorderTop: side,
    pageBorderRight: side,
    pageBorderBottom: side,
    pageBorderLeft: side,
  };
}

function sectionProperties(
  layout: PageLayout,
  setup: PageSetup | undefined,
): NonNullable<ISectionOptions["properties"]> {
  const paper = PAPER_TWIPS[layout.paperSize];
  const borders = pageBorders(setup?.pageBorder);
  return {
    page: {
      size: {
        width: paper.w,
        height: paper.h,
        orientation:
          layout.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
      },
      margin: {
        top: pxToTwip(layout.marginTop),
        right: pxToTwip(layout.marginRight),
        bottom: pxToTwip(layout.marginBottom),
        left: pxToTwip(layout.marginLeft),
        header: pxToTwip(setup?.headerDistance ?? 48),
        footer: pxToTwip(setup?.footerDistance ?? 48),
      },
      ...(borders ? { borders } : {}),
    },
    ...(setup?.differentFirstPage ? { titlePage: true } : {}),
  };
}

// docx only resolves a `numbering.reference` declared in the Document's
// numbering config — an undeclared one leaves a literal `{ref-0}`
// placeholder in w:numId and Word rejects the file. So every ordered
// format/start combination used in the document gets a declared config.

type Counter = "numeric" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

const COUNTER_ALIASES: Record<string, Counter> = {
  numeric: "numeric",
  "lower-alpha": "lower-alpha",
  "upper-alpha": "upper-alpha",
  "lower-roman": "lower-roman",
  "upper-roman": "upper-roman",
  // Written by the old list toolbar.
  roman: "upper-roman",
  alphabetic: "lower-alpha",
};

const LEVEL0_FORMAT: Record<Counter, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  numeric: LevelFormat.DECIMAL,
  "lower-alpha": LevelFormat.LOWER_LETTER,
  "upper-alpha": LevelFormat.UPPER_LETTER,
  "lower-roman": LevelFormat.LOWER_ROMAN,
  "upper-roman": LevelFormat.UPPER_ROMAN,
};

/** Deeper levels cycle 1 → a → i from the top level's slot, as in the editor. */
const CYCLE = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
const CYCLE_SLOT: Record<Counter, number> = {
  numeric: 0,
  "lower-alpha": 1,
  "upper-alpha": 1,
  "lower-roman": 2,
  "upper-roman": 2,
};

function orderedNumbering(reference: string, counter: Counter, start: number) {
  return {
    reference,
    levels: Array.from({ length: 9 }, (_, level) => ({
      level,
      format: level === 0 ? LEVEL0_FORMAT[counter] : CYCLE[(CYCLE_SLOT[counter] + level) % 3]!,
      text: `%${level + 1}.`,
      start: level === 0 ? start : 1,
      alignment: AlignmentType.START,
      style: {
        paragraph: {
          indent: { left: 720 * (level + 1), hanging: 360 },
        },
      },
    })),
  };
}

/** Per-export state: the numbering configs lists need, and a running
 *  instance number so each list restarts its numbering. */
interface ExportContext {
  numbering: Map<string, ReturnType<typeof orderedNumbering>>;
  nextInstance: number;
  /** Values for title / date fields. */
  title: string;
  date: string;
  /** Footnote id → inline HTML (from pageSetup). */
  footnoteHtml: Record<string, string>;
  /** Footnote id → number, assigned in document order. */
  footnoteNumbers: Map<string, number>;
  footnotes: Record<string, { children: Paragraph[] }>;
  /** Converting a header / footer / footnote: no footnote refs or TOC there. */
  nested: boolean;
  hasToc: boolean;
}

function numberingRef(ctx: ExportContext, counter: Counter, start: number): string {
  const reference = `tp-ol-${counter}-${start}`;
  if (!ctx.numbering.has(reference)) {
    ctx.numbering.set(reference, orderedNumbering(reference, counter, start));
  }
  return reference;
}

export async function exportDocx(
  data: EditorOutput,
  opts: ExportOptions = {},
): Promise<Blob> {
  const setup = opts.pageSetup;
  const title = opts.title || "Untitled document";
  const ctx: ExportContext = {
    numbering: new Map(),
    nextInstance: 1,
    title,
    date: new Date().toLocaleDateString(),
    footnoteHtml: setup?.footnotes ?? {},
    footnoteNumbers: new Map(),
    footnotes: {},
    nested: false,
    hasToc: false,
  };

  // A section break's layout applies to the section that follows it.
  const firstLayout = cleanLayout(opts.defaultLayout);
  const sections: Array<{ layout: PageLayout; children: FileChild[] }> = [
    { layout: firstLayout, children: [] },
  ];
  // Charts are rasterised (async) before the synchronous conversion.
  await prepareObjectImages(data.blocks ?? []);
  // Image blocks (body + headers/footers): fetch http / relative URLs now.
  useDocxImages(await loadDocxImages(data.blocks ?? [], setup?.headers, setup?.footers));
  for (const block of data.blocks ?? []) {
    if (block.type === "sectionBreak") {
      const layout = (block.data as { layout?: unknown } | undefined)?.layout;
      sections.push({ layout: cleanLayout(layout, firstLayout), children: [] });
      continue;
    }
    const converted = blockToDocx(block, ctx);
    const target = sections[sections.length - 1]!.children;
    if (Array.isArray(converted)) target.push(...converted);
    else if (converted) target.push(converted);
  }

  const doc = new Document({
    creator: "TP Writer",
    title,
    numbering: { config: [...ctx.numbering.values()] },
    footnotes: ctx.footnotes,
    ...(setup?.differentOddEven ? { evenAndOddHeaderAndFooters: true } : {}),
    ...(hexColor(setup?.pageColor) ? { background: { color: hexColor(setup?.pageColor)! } } : {}),
    // Word fills a TOC field in only when asked to update fields on open.
    ...(ctx.hasToc ? { features: { updateFields: true } } : {}),
    // Watermarks aren't exported (docx has no simple text-watermark API).
    sections: sections.map(({ layout, children }) => ({
      properties: sectionProperties(layout, setup),
      ...headersAndFooters(setup, ctx),
      children: children.length > 0 ? children : [new Paragraph({ children: [] })],
    })),
  });

  return Packer.toBlob(doc);
}

/** Header / footer content (same for every section). Built per section —
 *  each section gets its own header parts. */
function headersAndFooters(
  setup: PageSetup | undefined,
  ctx: ExportContext,
): Pick<ISectionOptions, "headers" | "footers"> {
  if (!setup) return {};
  const variants = <T,>(set: HeaderFooterSet, make: (children: Array<Paragraph | Table>) => T) => {
    const used =
      set.default.length > 0 ||
      (setup.differentFirstPage && set.first.length > 0) ||
      (setup.differentOddEven && set.even.length > 0);
    if (!used) return undefined;
    return {
      default: make(storyChildren(set.default, ctx)),
      ...(setup.differentFirstPage ? { first: make(storyChildren(set.first, ctx)) } : {}),
      ...(setup.differentOddEven ? { even: make(storyChildren(set.even, ctx)) } : {}),
    };
  };
  const headers = variants(setup.headers, (children) => new Header({ children }));
  const footers = variants(setup.footers, (children) => new Footer({ children }));
  return { ...(headers ? { headers } : {}), ...(footers ? { footers } : {}) };
}

/** Blocks of a header / footer → paragraphs and tables. */
function storyChildren(blocks: EditorBlock[], ctx: ExportContext): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const wasNested = ctx.nested;
  ctx.nested = true;
  try {
    for (const block of blocks) {
      const converted = blockToDocx(block, ctx);
      for (const child of Array.isArray(converted) ? converted : converted ? [converted] : []) {
        if (child instanceof Paragraph || child instanceof Table) out.push(child);
      }
    }
  } finally {
    ctx.nested = wasNested;
  }
  if (out.length === 0) out.push(new Paragraph({ children: [] }));
  return out;
}

/** Plain text of an inline HTML string. */
function textOf(html: string): string {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

/** Footnote number for a reference, creating the footnote on first use;
 *  undefined when the ref can't be exported (no text, or not in the body). */
function footnoteNumber(ctx: ExportContext, id: string): number | undefined {
  if (ctx.nested) return undefined;
  const existing = ctx.footnoteNumbers.get(id);
  if (existing !== undefined) return existing;
  const html = Object.prototype.hasOwnProperty.call(ctx.footnoteHtml, id)
    ? ctx.footnoteHtml[id]
    : undefined;
  if (typeof html !== "string" || !textOf(html).trim()) return undefined;
  const n = ctx.footnoteNumbers.size + 1;
  ctx.footnoteNumbers.set(id, n);
  ctx.nested = true;
  try {
    ctx.footnotes[String(n)] = { children: [new Paragraph({ children: inlineHtmlToRuns(html, ctx) })] };
  } finally {
    ctx.nested = false;
  }
  return n;
}

function blockToDocx(
  rawBlock: EditorBlock,
  ctx: ExportContext,
): FileChild | FileChild[] | null {
  // Fold legacy alignment/indent shapes into the format tune first.
  const block = normalizeBlock(rawBlock);
  switch (block.type) {
    case "paragraph": {
      return new Paragraph({
        children: inlineHtmlToRuns(String(block.data.text ?? ""), ctx),
        ...formatOptions(block),
      });
    }
    case "header": {
      const level = Number(block.data.level ?? 2);
      return new Paragraph({
        heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_2,
        children: inlineHtmlToRuns(String(block.data.text ?? ""), ctx),
        ...formatOptions(block),
      });
    }
    case "pageBreak": {
      return new Paragraph({ children: [new PageBreak()] });
    }
    case "list": {
      const style = String(block.data.style ?? "unordered");
      const items = (block.data.items as ListItem[]) ?? [];
      const meta = (block.data.meta ?? {}) as { counterType?: string; start?: number };
      if (style === "ordered") {
        const counter = COUNTER_ALIASES[meta.counterType ?? ""] ?? "numeric";
        const start = Number.isInteger(meta.start) && meta.start! >= 1 ? meta.start! : 1;
        const list = { reference: numberingRef(ctx, counter, start), instance: ctx.nextInstance++ };
        return flattenList(items, 0, { kind: "ordered", ...list }, ctx);
      }
      return flattenList(items, 0, { kind: style === "checklist" ? "checklist" : "bullet" }, ctx);
    }
    case "table": {
      // Merges, header rows, shading, borders, widths: see ./export/table.
      return tableToDocx(block.data as Record<string, unknown>, {
        toRuns: (html) => inlineHtmlToRuns(html, ctx),
      });
    }
    case "image": {
      // Saved data uses `file.url`; older data / the importer use `url`.
      // Size, crop, wrap, caption, alt text: see ./export/image.
      const out = imageBlockToDocx(block);
      return out.length > 0 ? out : null;
    }
    case "delimiter":
    case "horizontalLine": {
      return new Paragraph({
        children: [new TextRun({ text: "⸻", color: "9CA3AF" })],
        alignment: AlignmentType.CENTER,
      });
    }
    case "toc": {
      if (ctx.nested) return null;
      const n = Number(block.data.maxLevel);
      const maxLevel = Number.isInteger(n) && n >= 1 && n <= 4 ? n : 3;
      const title = textOf(typeof block.data.title === "string" ? block.data.title : "").trim();
      ctx.hasToc = true;
      return [
        ...(title
          ? [
              new Paragraph({
                children: [new TextRun({ text: title, bold: true, size: 32 })],
                spacing: { after: 240 },
              }),
            ]
          : []),
        new TableOfContents(title || "Table of Contents", {
          hyperlink: true,
          headingStyleRange: `1-${maxLevel}`,
        }),
      ];
    }
    case "equation":
      return equationToDocx(block.data);
    case "textBox":
      return textBoxToDocx(block.data, (html) => inlineHtmlToRuns(html, ctx));
    case "chart":
      return chartToDocx(block.data);
    default:
      return null;
  }
}

function tuneAlignment(
  a: string | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (a) {
    case "left":
      return AlignmentType.LEFT;
    case "center":
      return AlignmentType.CENTER;
    case "right":
      return AlignmentType.RIGHT;
    case "justify":
      return AlignmentType.JUSTIFIED;
    default:
      return undefined;
  }
}

interface ListItem {
  content: string;
  meta?: { checked?: boolean };
  items?: ListItem[];
}

type ListKind =
  | { kind: "ordered"; reference: string; instance: number }
  | { kind: "bullet" }
  | { kind: "checklist" };

function flattenList(
  items: ListItem[],
  depth: number,
  list: ListKind,
  ctx: ExportContext,
): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of items) {
    const runs = inlineHtmlToRuns(item.content ?? "", ctx);
    if (list.kind === "checklist") {
      // Word has no portable checklist list type; a box glyph keeps it
      // readable and printable.
      runs.unshift(new TextRun({ text: item.meta?.checked ? "☒ " : "☐ " }));
    }
    out.push(
      new Paragraph({
        children: runs,
        ...(list.kind === "ordered"
          ? { numbering: { reference: list.reference, level: depth, instance: list.instance } }
          : list.kind === "bullet"
            ? { bullet: { level: depth } }
            : { indent: { left: 720 * (depth + 1) } }),
      }),
    );
    if (Array.isArray(item.items) && item.items.length > 0) {
      out.push(...flattenList(item.items, depth + 1, list, ctx));
    }
  }
  return out;
}


function inlineHtmlToRuns(html: string, ctx?: ExportContext): ParagraphChild[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const runs: ParagraphChild[] = [];
  walkInline(doc.body, {}, runs, ctx);
  return runs;
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  highlight?: string;
  color?: string;
  /** Background colour as hex (run shading). */
  shading?: string;
  font?: string;
  /** Half-points, as DOCX stores font sizes. */
  size?: number;
}

/** CSS colour (#rgb, #rrggbb, rgb()) → "RRGGBB", or undefined. */
function cssColorToHex(value: string): string | undefined {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return m[1]!.split("").map((c) => c + c).join("").toUpperCase();
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return m[1]!.toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined; // transparent
    return [m[1], m[2], m[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return undefined;
}

/** CSS font-size → half-points. */
function cssSizeToHalfPoints(value: string): number | undefined {
  const m = /^([\d.]+)(pt|px)$/.exec(value.trim());
  if (!m) return undefined;
  const pt = m[2] === "pt" ? Number(m[1]) : Number(m[1]) * 0.75;
  return Number.isFinite(pt) && pt > 0 ? Math.round(pt * 2) : undefined;
}

/** Run style contributed by an element's inline `style` attribute. */
function styleFromCss(el: HTMLElement, base: RunStyle): RunStyle {
  const next = { ...base };
  const st = el.style;
  if (st.color) next.color = cssColorToHex(st.color) ?? next.color;
  if (st.backgroundColor) next.shading = cssColorToHex(st.backgroundColor) ?? next.shading;
  if (st.fontFamily) {
    const first = st.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
    if (first && !/^(serif|sans-serif|monospace|var\()/.test(first)) next.font = first;
  }
  if (st.fontSize) next.size = cssSizeToHalfPoints(st.fontSize) ?? next.size;
  if (st.fontWeight === "bold" || Number(st.fontWeight) >= 600) next.bold = true;
  if (st.fontStyle === "italic") next.italics = true;
  const deco = `${st.textDecoration} ${st.textDecorationLine}`;
  if (deco.includes("underline")) next.underline = true;
  if (deco.includes("line-through")) next.strike = true;
  if (st.verticalAlign === "super") next.superScript = true;
  if (st.verticalAlign === "sub") next.subScript = true;
  return next;
}

/** A field chip → a Word field (page numbers) or its text now. */
function fieldRun(kind: string, style: RunStyle, ctx: ExportContext | undefined): TextRun | null {
  const base = toRunOptions(style);
  switch (kind) {
    case "page":
      return new TextRun({ ...base, children: [PageNumber.CURRENT] });
    case "pages":
      return new TextRun({ ...base, children: [PageNumber.TOTAL_PAGES] });
    case "date":
      return new TextRun({ ...base, text: ctx?.date ?? new Date().toLocaleDateString() });
    case "title":
      return new TextRun({ ...base, text: ctx?.title ?? "" });
    default:
      return null;
  }
}

function walkInline(
  node: Node,
  style: RunStyle,
  out: ParagraphChild[],
  ctx?: ExportContext,
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (text) out.push(new TextRun({ text, ...toRunOptions(style) }));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      out.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    if (tag === "sup" && el.classList.contains("tp-fn-ref")) {
      const n = ctx ? footnoteNumber(ctx, el.getAttribute("data-fn-id") ?? "") : undefined;
      if (n !== undefined) out.push(new FootnoteReferenceRun(n));
      continue;
    }
    let next: RunStyle = { ...style };
    if (tag === "b" || tag === "strong") next.bold = true;
    else if (tag === "i" || tag === "em") next.italics = true;
    else if (tag === "u") next.underline = true;
    else if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    else if (tag === "sup") next.superScript = true;
    else if (tag === "sub") next.subScript = true;
    else if (tag === "mark") next.highlight = "yellow";
    if (el.getAttribute("style")) next = styleFromCss(el, next);

    if (tag === "span" && el.classList.contains("tp-field")) {
      const run = fieldRun(el.getAttribute("data-field") ?? "", next, ctx);
      if (run) {
        out.push(run);
        continue;
      }
    }

    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      const runs: ParagraphChild[] = [];
      walkInline(el, { ...next, underline: true, color: next.color ?? "0563C1" }, runs, ctx);
      if (isSafeLinkUrl(href) && /^(https?:|mailto:|tel:)/i.test(href)) {
        out.push(new ExternalHyperlink({ link: href, children: runs as TextRun[] }));
      } else {
        out.push(...runs);
      }
      continue;
    }
    walkInline(el, next, out, ctx);
  }
}

function toRunOptions(style: RunStyle): IRunOptions {
  const opts: IRunOptions = {} as IRunOptions;
  if (style.bold) (opts as { bold?: boolean }).bold = true;
  if (style.italics) (opts as { italics?: boolean }).italics = true;
  if (style.underline) (opts as { underline?: object }).underline = {};
  if (style.strike) (opts as { strike?: boolean }).strike = true;
  if (style.superScript) (opts as { superScript?: boolean }).superScript = true;
  if (style.subScript) (opts as { subScript?: boolean }).subScript = true;
  if (style.highlight) (opts as { highlight?: string }).highlight = style.highlight;
  if (style.color) (opts as { color?: string }).color = style.color;
  if (style.shading) (opts as { shading?: object }).shading = { type: "clear", color: "auto", fill: style.shading };
  if (style.font) (opts as { font?: string }).font = style.font;
  if (style.size) (opts as { size?: number }).size = style.size;
  return opts;
}

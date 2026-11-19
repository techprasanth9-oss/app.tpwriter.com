/**
 * EditorJS blocks → DOCX (Blob) via the `docx` package.
 */
import {
  AlignmentType,
  LevelFormat,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import type { EditorBlock, EditorOutput } from "./importer";
import { normalizeBlock } from "../normalize";
import { isSafeLinkUrl } from "../safeUrl";
import { cleanFormat, FORMAT_TUNE, INDENT_STEP_PX } from "../format/paragraphFormat";

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
  const children: Array<Paragraph | Table> = [];
  const ctx: ExportContext = { numbering: new Map(), nextInstance: 1 };

  for (const block of data.blocks ?? []) {
    const converted = blockToDocx(block, ctx);
    if (Array.isArray(converted)) children.push(...converted);
    else if (converted) children.push(converted);
  }

  if (children.length === 0) children.push(new Paragraph({ children: [] }));

  const doc = new Document({
    creator: "TP Writer",
    title: opts.title || "Untitled document",
    numbering: { config: [...ctx.numbering.values()] },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBlob(doc);
}

function blockToDocx(
  rawBlock: EditorBlock,
  ctx: ExportContext,
): Paragraph | Table | Array<Paragraph | Table> | null {
  // Fold legacy alignment/indent shapes into the format tune first.
  const block = normalizeBlock(rawBlock);
  switch (block.type) {
    case "paragraph": {
      return new Paragraph({
        children: inlineHtmlToRuns(String(block.data.text ?? "")),
        ...formatOptions(block),
      });
    }
    case "header": {
      const level = Number(block.data.level ?? 2);
      return new Paragraph({
        heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_2,
        children: inlineHtmlToRuns(String(block.data.text ?? "")),
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
        return flattenList(items, 0, { kind: "ordered", ...list });
      }
      return flattenList(items, 0, { kind: style === "checklist" ? "checklist" : "bullet" });
    }
    case "table": {
      const content = (block.data.content as string[][]) ?? [];
      if (content.length === 0) return null;
      const withHeadings = Boolean(block.data.withHeadings);
      return new Table({
        rows: content.map(
          (row, rowIdx) =>
            new TableRow({
              tableHeader: withHeadings && rowIdx === 0,
              children: row.map(
                (cellHtml) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: inlineHtmlToRuns(cellHtml) }),
                    ],
                  }),
              ),
            }),
        ),
        width: { size: 100, type: WidthType.PERCENTAGE },
      });
    }
    case "image": {
      // ImageTool and the importer store `data.url`; `data.file.url` is
      // the stock @editorjs/image shape — accept either.
      const file = block.data.file as { url?: string } | undefined;
      const url =
        (typeof block.data.url === "string" ? block.data.url : undefined) ??
        file?.url;
      if (!url) return null;
      return imageUrlToParagraph(url, String(block.data.caption ?? ""));
    }
    case "delimiter":
    case "horizontalLine": {
      return new Paragraph({
        children: [new TextRun({ text: "⸻", color: "9CA3AF" })],
        alignment: AlignmentType.CENTER,
      });
    }
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

function flattenList(items: ListItem[], depth: number, list: ListKind): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of items) {
    const runs = inlineHtmlToRuns(item.content ?? "");
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
      out.push(...flattenList(item.items, depth + 1, list));
    }
  }
  return out;
}

function imageUrlToParagraph(url: string, caption: string): Paragraph {
  if (!url.startsWith("data:")) {
    return new Paragraph({
      children: [new TextRun({ text: `[image: ${url}]`, italics: true })],
    });
  }
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return new Paragraph({ children: [] });
  const [, mime, b64] = match;
  const type = typeFromMime(mime!);
  // Unsupported raster formats (webp, svg, tiff, emf…) would otherwise
  // be mislabelled as JPEG and produce a broken picture in Word.
  if (!type) {
    return new Paragraph({
      children: [
        new TextRun({ text: `[unsupported image: ${mime}]`, italics: true }),
      ],
    });
  }
  const bin = atob(b64!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Paragraph({
    children: [
      new ImageRun({
        data: bytes,
        transformation: { width: 480, height: 360 },
        type,
      } as never),
      ...(caption ? [new TextRun({ text: `\n${caption}`, italics: true })] : []),
    ],
  });
}

function typeFromMime(mime: string): "png" | "jpg" | "gif" | "bmp" | null {
  switch (mime.toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
    case "image/pjpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/bmp":
    case "image/x-ms-bmp":
      return "bmp";
    default:
      return null;
  }
}

function inlineHtmlToRuns(html: string): ParagraphChild[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const runs: ParagraphChild[] = [];
  walkInline(doc.body, {}, runs);
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

function walkInline(node: Node, style: RunStyle, out: ParagraphChild[]): void {
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
    let next: RunStyle = { ...style };
    if (tag === "b" || tag === "strong") next.bold = true;
    else if (tag === "i" || tag === "em") next.italics = true;
    else if (tag === "u") next.underline = true;
    else if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    else if (tag === "sup") next.superScript = true;
    else if (tag === "sub") next.subScript = true;
    else if (tag === "mark") next.highlight = "yellow";
    if (el.getAttribute("style")) next = styleFromCss(el, next);

    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      const runs: ParagraphChild[] = [];
      walkInline(el, { ...next, underline: true, color: next.color ?? "0563C1" }, runs);
      if (isSafeLinkUrl(href) && /^(https?:|mailto:|tel:)/i.test(href)) {
        out.push(new ExternalHyperlink({ link: href, children: runs as TextRun[] }));
      } else {
        out.push(...runs);
      }
      continue;
    }
    walkInline(el, next, out);
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

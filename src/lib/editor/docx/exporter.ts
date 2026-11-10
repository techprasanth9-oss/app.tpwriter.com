/**
 * EditorJS blocks → DOCX (Blob) via the `docx` package.
 */
import {
  AlignmentType,
  LevelFormat,
  Document,
  HeadingLevel,
  ImageRun,
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

/** Numbering reference used by ordered list paragraphs (see flattenList). */
const ORDERED_LIST_REF = "zw-ordered";

// docx only resolves a `numbering.reference` that is declared in the
// Document's numbering config — an undeclared one leaves a literal
// `{zw-ordered-0}` placeholder in w:numId and Word rejects the file.
const ORDERED_LIST_FORMATS = [
  LevelFormat.DECIMAL,
  LevelFormat.LOWER_LETTER,
  LevelFormat.LOWER_ROMAN,
];
const ORDERED_LIST_NUMBERING = {
  reference: ORDERED_LIST_REF,
  levels: Array.from({ length: 9 }, (_, level) => ({
    level,
    format: ORDERED_LIST_FORMATS[level % ORDERED_LIST_FORMATS.length]!,
    text: `%${level + 1}.`,
    alignment: AlignmentType.START,
    style: {
      paragraph: {
        indent: { left: 720 * (level + 1), hanging: 360 },
      },
    },
  })),
};

export async function exportDocx(
  data: EditorOutput,
  opts: ExportOptions = {},
): Promise<Blob> {
  const children: Array<Paragraph | Table> = [];

  for (const block of data.blocks ?? []) {
    const converted = blockToDocx(block);
    if (Array.isArray(converted)) children.push(...converted);
    else if (converted) children.push(converted);
  }

  if (children.length === 0) children.push(new Paragraph({ children: [] }));

  const doc = new Document({
    creator: "TP Writer",
    title: opts.title || "Untitled document",
    numbering: { config: [ORDERED_LIST_NUMBERING] },
    sections: [{ properties: {}, children }],
  });

  return Packer.toBlob(doc);
}

function blockToDocx(
  block: EditorBlock,
): Paragraph | Table | Array<Paragraph | Table> | null {
  switch (block.type) {
    case "paragraph": {
      return new Paragraph({
        children: inlineHtmlToRuns(String(block.data.text ?? "")),
        alignment: tuneAlignment(block),
      });
    }
    case "header": {
      const level = Number(block.data.level ?? 2);
      return new Paragraph({
        heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_2,
        children: inlineHtmlToRuns(String(block.data.text ?? "")),
        alignment: tuneAlignment(block),
      });
    }
    case "list": {
      const style = String(block.data.style ?? "unordered");
      const items =
        (block.data.items as Array<{ content: string; items?: unknown[] }>) ?? [];
      return flattenList(items, 0, style === "ordered");
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
  block: EditorBlock,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const tunes = (block as unknown as {
    tunes?: { alignment?: { alignment?: string } };
  }).tunes;
  const a = tunes?.alignment?.alignment;
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

function flattenList(
  items: Array<{ content: string; items?: unknown[] }>,
  depth: number,
  ordered: boolean,
): Paragraph[] {
  const out: Paragraph[] = [];
  for (const item of items) {
    out.push(
      new Paragraph({
        children: inlineHtmlToRuns(item.content ?? ""),
        bullet: ordered ? undefined : { level: depth },
        numbering: ordered
          ? { reference: ORDERED_LIST_REF, level: depth }
          : undefined,
      }),
    );
    if (Array.isArray(item.items) && item.items.length > 0) {
      out.push(
        ...flattenList(
          item.items as Array<{ content: string; items?: unknown[] }>,
          depth + 1,
          ordered,
        ),
      );
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
    const next: RunStyle = { ...style };
    if (tag === "b" || tag === "strong") next.bold = true;
    else if (tag === "i" || tag === "em") next.italics = true;
    else if (tag === "u") next.underline = true;
    else if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
    else if (tag === "sup") next.superScript = true;
    else if (tag === "sub") next.subScript = true;
    else if (tag === "mark") next.highlight = "yellow";
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
  return opts;
}

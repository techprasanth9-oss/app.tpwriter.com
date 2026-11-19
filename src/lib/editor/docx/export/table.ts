/**
 * TableTool block data → a DOCX table (+ caption paragraph).
 *
 * Kept free of exporter.ts imports (the inline-HTML → runs converter is
 * passed in) so the two modules can't form an import cycle.
 *
 * Data model (see TableTool.save): `content` is one entry per rendered
 * cell, row by row; `styles.cells[r][j]` styles the j-th cell of row r and
 * carries its `colSpan` / `rowSpan`. Rows covered by a vertical merge have
 * no entry for the covered slot — docx inserts the `vMerge` continuation
 * cells itself from `rowSpan`.
 */
import {
  AlignmentType,
  BorderStyle,
  HeightRule,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";

export type HtmlToRuns = (html: string) => ParagraphChild[];

export interface TableExportOptions {
  /** Inline HTML → runs (the exporter's converter). */
  toRuns: HtmlToRuns;
  /** Width a 100% table spans, in twips (page content width). */
  availableWidthTwips?: number;
}

/** A4 portrait with 1-inch margins. */
const DEFAULT_AVAILABLE_TWIPS = 11906 - 2 * 1440;

type CellStyle = Record<string, unknown>;

/** CSS px (96 dpi) → twips. */
const pxToTwip = (px: number) => Math.round(px * 15);

/** CSS length (px / pt) → twips, or undefined. */
export function cssLengthToTwips(value: unknown): number | undefined {
  const m = /^\s*(-?[\d.]+)\s*(px|pt)?\s*$/.exec(String(value ?? ""));
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return m[2] === "pt" ? Math.round(n * 20) : pxToTwip(n);
}

const NAMED: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  gray: "808080",
  grey: "808080",
  yellow: "FFFF00",
};

/** CSS colour (#rgb, #rrggbb, rgb(), a few names) → "RRGGBB"; undefined
 *  for transparent / unknown. */
export function cssColor(value: unknown): string | undefined {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return undefined;
  if (NAMED[v]) return NAMED[v];
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return m[1]!.split("").map((c) => c + c).join("").toUpperCase();
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return m[1]!.toUpperCase();
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
    return [m[1], m[2], m[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }
  return undefined;
}

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };

const BORDER_STYLES: Record<string, IBorderOptions["style"]> = {
  solid: BorderStyle.SINGLE,
  dashed: BorderStyle.DASHED,
  dotted: BorderStyle.DOTTED,
  double: BorderStyle.DOUBLE,
  groove: BorderStyle.THREE_D_EMBOSS,
  ridge: BorderStyle.THREE_D_ENGRAVE,
  inset: BorderStyle.INSET,
  outset: BorderStyle.OUTSET,
};

/** A CSS border (width, style, colour — any order, any may be missing) →
 *  a DOCX border. Zero width, `none`/`hidden` or a transparent colour is
 *  no border. */
export function cssBorder(width: unknown, style: unknown, color: unknown): IBorderOptions {
  const st = String(style ?? "solid").trim().toLowerCase() || "solid";
  if (st === "none" || st === "hidden") return NONE;
  const w = String(width ?? "1px").trim() || "1px";
  const twips = cssLengthToTwips(w) ?? (w === "thin" ? 15 : w === "thick" ? 75 : 45);
  if (twips <= 0) return NONE;
  const c = String(color ?? "").trim();
  if (c === "transparent") return NONE;
  // Border size is in eighths of a point (twips / 20 * 8), 2..96.
  const size = Math.max(2, Math.min(96, Math.round((twips / 20) * 8)));
  return { style: BORDER_STYLES[st] ?? BorderStyle.SINGLE, size, color: cssColor(c) ?? "000000" };
}

/** Split a border shorthand ("1px solid rgb(1, 2, 3)") into its parts. */
function parseShorthand(value: string): { width?: string; style?: string; color?: string } {
  const out: { width?: string; style?: string; color?: string } = {};
  for (const tok of value.match(/rgba?\([^)]*\)|#[0-9a-f]+|\S+/gi) ?? []) {
    const t = tok.toLowerCase();
    if (/^-?[\d.]+(px|pt)?$/.test(t) || t === "thin" || t === "medium" || t === "thick") out.width = t;
    else if (t === "none" || t === "hidden" || BORDER_STYLES[t]) out.style = t;
    else out.color = tok;
  }
  return out;
}

/** First value of a possibly multi-valued CSS box property ("1px 0px"). */
function sideValue(value: unknown, side: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parts = String(value).match(/rgba?\([^)]*\)|\S+/g) ?? [];
  if (parts.length === 0) return undefined;
  // CSS box order: top right bottom left with 1–4 values.
  const idx = [
    [0, 0, 0, 0],
    [0, 1, 0, 1],
    [0, 1, 2, 1],
    [0, 1, 2, 3],
  ][Math.min(parts.length, 4) - 1]![side]!;
  return parts[idx];
}

const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

function cellBorders(st: CellStyle, table: CellStyle, hideBorders: boolean) {
  const out: Record<string, IBorderOptions> = {};
  SIDES.forEach((side, i) => {
    const key = side.toLowerCase();
    if (hideBorders) {
      out[key] = NONE;
      return;
    }
    const own = st[`border${side}`];
    if (typeof own === "string" && own.trim()) {
      const p = parseShorthand(own);
      out[key] = cssBorder(p.width ?? "1px", p.style ?? "none", p.color);
      return;
    }
    out[key] = cssBorder(
      sideValue(st.borderWidth, i) ?? table.borderWidth,
      sideValue(st.borderStyle, i) ?? table.borderStyle,
      sideValue(st.borderColor, i) ?? table.borderColor,
    );
  });
  return out as { top: IBorderOptions; right: IBorderOptions; bottom: IBorderOptions; left: IBorderOptions };
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  start: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  end: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const VALIGN: Record<string, (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable]> = {
  top: VerticalAlignTable.TOP,
  middle: VerticalAlignTable.CENTER,
  bottom: VerticalAlignTable.BOTTOM,
};

const spanOf = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 1 ? n : 1;
};

/** Escape text for use as HTML. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Cell HTML → paragraphs: block children (p, div, li, h*) each become a
 *  paragraph; runs of inline content between them become one. */
function cellParagraphs(
  html: string,
  toRuns: HtmlToRuns,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType] | undefined,
): Paragraph[] {
  const body = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html").body;
  const BLOCK = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|UL|OL|TABLE)$/;
  const out: Paragraph[] = [];
  let inline = "";
  const flush = (chunk: string) => {
    out.push(new Paragraph({ children: toRuns(chunk), ...(alignment ? { alignment } : {}) }));
  };
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCK.test((node as Element).tagName)) {
      if (inline.trim()) flush(inline);
      inline = "";
      const el = node as HTMLElement;
      if (el.tagName === "UL" || el.tagName === "OL" || el.tagName === "TABLE") {
        // Lists / nested tables flatten to one paragraph per item / row.
        const items = el.querySelectorAll(el.tagName === "TABLE" ? "tr" : "li");
        items.forEach((item) => flush(item.innerHTML));
      } else {
        flush(el.innerHTML);
      }
    } else {
      inline += node.nodeType === Node.TEXT_NODE ? esc(node.textContent ?? "") : (node as Element).outerHTML ?? "";
    }
  }
  if (inline.trim() || out.length === 0) flush(inline);
  return out;
}

// ── Formulas (same subset as TableTool: SUM/AVG/AVERAGE/COUNT/MIN/MAX over
// an A1:B2 range) so Word shows the value the editor shows. ──────────────

function parseA1(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(m[2]!, 10) - 1;
  return col > 0 && row >= 0 ? { row, col: col - 1 } : null;
}

export function evalFormula(expr: string, content: string[][], depth = 0): number | null {
  const m = /^=\s*(SUM|AVG|AVERAGE|COUNT|MIN|MAX)\s*\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)\s*$/i.exec(expr.trim());
  if (!m || depth > 8) return null;
  const a = parseA1(m[2]!);
  const b = parseA1(m[3]!);
  if (!a || !b) return null;
  const values: number[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) {
      const raw = content[r]?.[c] ?? "";
      const text = raw.trim().startsWith("=")
        ? String(evalFormula(raw, content, depth + 1) ?? "")
        : raw.replace(/<[^>]+>/g, "");
      const n = parseFloat(text.replace(/[^0-9eE+\-.]/g, ""));
      if (!Number.isNaN(n)) values.push(n);
    }
  }
  const fn = m[1]!.toUpperCase();
  if (values.length === 0 && fn !== "COUNT") return 0;
  switch (fn) {
    case "SUM":
      return +values.reduce((x, y) => x + y, 0).toFixed(6);
    case "AVG":
    case "AVERAGE":
      return +(values.reduce((x, y) => x + y, 0) / values.length).toFixed(6);
    case "COUNT":
      return values.length;
    case "MIN":
      return Math.min(...values);
    case "MAX":
      return Math.max(...values);
  }
  return null;
}

/** Plain text of a (possibly entity-escaped) caption. */
function captionText(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  if (!s.trim()) return "";
  return (new DOMParser().parseFromString(`<!doctype html><body>${s}</body>`, "text/html").body.textContent ?? "").trim();
}

/**
 * Convert one table block. Returns the table, with its caption paragraph
 * before or after it, or null for an empty table.
 */
export function tableToDocx(data: Record<string, unknown>, opts: TableExportOptions): Array<Table | Paragraph> | null {
  const content = Array.isArray(data.content)
    ? (data.content as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === "string" ? c : "")) : []))
    : [];
  if (content.length === 0 || content.every((r) => r.length === 0)) return null;

  const styles = (data.styles ?? {}) as { table?: CellStyle; rows?: Record<string, CellStyle>; cells?: Record<string, Record<string, CellStyle>> };
  const tableStyle: CellStyle = { borderWidth: "1px", borderStyle: "solid", borderColor: "#d1d5db", ...(styles.table ?? {}) };
  const hideBorders = data.hideBorders === true;

  // Header rows: legacy `withHeading(s)` without headerRows means row 0.
  let headerRows = Array.isArray(data.headerRows) ? (data.headerRows as unknown[]).filter((n) => Number.isInteger(n)) as number[] : [];
  if (headerRows.length === 0 && (data.withHeading === true || data.withHeadings === true)) headerRows = [0];
  const headerSet = new Set(headerRows);
  let leading = 0;
  while (leading < content.length && headerSet.has(leading)) leading++;
  const repeat =
    typeof data.repeatHeader === "boolean"
      ? data.repeatHeader
      : typeof data.repeatHeaderOnPrint === "boolean"
        ? data.repeatHeaderOnPrint
        : true;

  // Logical grid width (cells + spans, HTML layout rules).
  const occupied: boolean[][] = content.map(() => []);
  content.forEach((row, r) => {
    let c = 0;
    row.forEach((_, j) => {
      while (occupied[r]![c]) c++;
      const st = styles.cells?.[r]?.[j] ?? {};
      const cs = spanOf(st.colSpan);
      const rs = Math.min(spanOf(st.rowSpan), content.length - r);
      for (let rr = r; rr < r + rs; rr++) for (let cc = c; cc < c + cs; cc++) occupied[rr]![cc] = true;
      c += cs;
    });
  });
  const numCols = Math.max(1, ...occupied.map((o) => o.length));

  // Table + column widths in twips.
  const available = opts.availableWidthTwips ?? DEFAULT_AVAILABLE_TWIPS;
  const widthCss = String(tableStyle.width ?? "100%").trim();
  const autoWidth = widthCss === "auto";
  let tableTwips = available;
  const pct = /^([\d.]+)%$/.exec(widthCss);
  if (pct) tableTwips = Math.round((Number(pct[1]) / 100) * available);
  else if (!autoWidth) tableTwips = Math.min(cssLengthToTwips(widthCss) ?? available, available * 2);
  const rawWidths = Array.isArray(data.columnWidths) ? (data.columnWidths as unknown[]).map(Number) : [];
  const shares =
    rawWidths.length === numCols && rawWidths.every((w) => Number.isFinite(w) && w > 0)
      ? rawWidths
      : Array<number>(numCols).fill(100 / numCols);
  const shareTotal = shares.reduce((a, b) => a + b, 0) || 1;
  const columnTwips = shares.map((w) => Math.max(1, Math.round((w / shareTotal) * tableTwips)));

  const rowHeights = Array.isArray(data.rowHeights) ? (data.rowHeights as unknown[]).map(Number) : [];

  const rows = content.map((row, r) => {
    const isHeader = headerSet.has(r);
    const rowBg = cssColor(styles.rows?.[r]?.backgroundColor);
    const cells = row.map((html, j) => {
      const st = styles.cells?.[r]?.[j] ?? {};
      const cs = spanOf(st.colSpan);
      const rs = Math.min(spanOf(st.rowSpan), content.length - r);

      let cellHtml = html.trim().startsWith("=")
        ? (() => {
            const v = evalFormula(html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), content);
            return v === null ? html : String(v);
          })()
        : html;
      const color = cssColor(st.color);
      if (color) cellHtml = `<span style="color:#${color}">${cellHtml}</span>`;
      const weight = String(st.fontWeight ?? "");
      if (isHeader || weight === "bold" || Number(weight) >= 600) cellHtml = `<b>${cellHtml}</b>`;

      const fill = cssColor(st.backgroundColor) ?? rowBg;
      const margins = {
        top: cssLengthToTwips(st.paddingTop),
        right: cssLengthToTwips(st.paddingRight),
        bottom: cssLengthToTwips(st.paddingBottom),
        left: cssLengthToTwips(st.paddingLeft),
      };
      const hasMargins = Object.values(margins).some((v) => v !== undefined);
      const valign = VALIGN[String(st.verticalAlign ?? "").toLowerCase()];

      return new TableCell({
        children: cellParagraphs(cellHtml, opts.toRuns, ALIGN[String(st.textAlign ?? "").toLowerCase()]),
        ...(cs > 1 ? { columnSpan: cs } : {}),
        ...(rs > 1 ? { rowSpan: rs } : {}),
        ...(fill ? { shading: { fill, type: ShadingType.CLEAR, color: "auto" } } : {}),
        ...(valign ? { verticalAlign: valign } : {}),
        ...(hasMargins
          ? {
              margins: {
                top: margins.top ?? 0,
                right: margins.right ?? 0,
                bottom: margins.bottom ?? 0,
                left: margins.left ?? 0,
              },
            }
          : {}),
        borders: cellBorders(st, tableStyle, hideBorders),
      });
    });
    const height = rowHeights[r];
    return new TableRow({
      children: cells,
      ...(repeat && r < leading ? { tableHeader: true } : {}),
      ...(Number.isFinite(height) && height! > 0
        ? { height: { value: pxToTwip(height!), rule: HeightRule.ATLEAST } }
        : {}),
    });
  });

  const align = ALIGN[String(data.tableAlign ?? "").toLowerCase()];
  const table = new Table({
    rows,
    columnWidths: columnTwips,
    width: autoWidth ? { size: 0, type: WidthType.AUTO } : { size: tableTwips, type: WidthType.DXA },
    ...(autoWidth ? {} : { layout: TableLayoutType.FIXED }),
    ...(align && align !== AlignmentType.LEFT ? { alignment: align } : {}),
    borders: hideBorders
      ? { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }
      : undefined,
  });

  const caption = captionText(data.caption);
  if (!caption) return [table];
  const captionPara = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: data.captionPosition === "bottom" ? { before: 60 } : { after: 60 },
    children: [new TextRun({ text: caption, italics: true, color: "4B5563", size: 18 })],
  });
  return data.captionPosition === "bottom" ? [table, captionPara] : [captionPara, table];
}

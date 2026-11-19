/**
 * DOCX export for the object blocks: equation, text box, chart.
 *
 *  - equation → an OMML `<m:oMath>` holding the LaTeX as one math run.
 *    Word shows it in linear format (the LaTeX source inside an equation
 *    object); the user can convert it with Equation → Professional.
 *  - textBox → a one-cell table with the preset's shading / border, width
 *    percentage and alignment; the inline HTML becomes runs.
 *  - chart → a PNG rasterised from the same SVG the editor shows (browser
 *    canvas, prepared up front by `prepareObjectImages`), or — without a
 *    canvas (jsdom, failure) — a plain data table. The title is a caption.
 */
import {
  AlignmentType,
  BorderStyle,
  ImageRun,
  Math as DocxMath,
  MathRun,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { cleanChartData, type ChartData } from "../../charts/chartData";
import { chartSummary, chartSvgString, CHART_HEIGHT, CHART_WIDTH, formatValue } from "../../charts/renderChart";
import { cleanEquationData, cleanTextBoxData, TEXT_BOX_COLORS } from "../../tools/objectData";

type ToRuns = (html: string) => ParagraphChild[];

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

// ── Equation ────────────────────────────────────────────────────────────

/** Stored LaTeX uses `\lt` / `\gt` for < / >; Word's linear format wants
 *  the plain symbols. */
export function latexForWord(latex: string): string {
  return latex.replace(/\\lt\b\s?/g, "<").replace(/\\gt\b\s?/g, ">");
}

export function equationToDocx(raw: unknown): Paragraph | null {
  const data = cleanEquationData(raw);
  const latex = latexForWord(data.latex).trim();
  if (!latex) return null;
  return new Paragraph({
    children: [new DocxMath({ children: [new MathRun(latex)] })],
    ...(data.display ? { alignment: AlignmentType.CENTER } : {}),
    spacing: { before: 120, after: 120 },
  });
}

// ── Text box ────────────────────────────────────────────────────────────

export function textBoxToDocx(raw: unknown, toRuns: ToRuns): Table {
  const data = cleanTextBoxData(raw);
  const colors = TEXT_BOX_COLORS[data.preset];
  const side = { style: BorderStyle.SINGLE, size: 12, color: colors.border };
  return new Table({
    width: { size: data.width, type: WidthType.PERCENTAGE },
    alignment: ALIGN[data.align],
    borders: {
      top: side,
      bottom: side,
      right: side,
      left: { ...side, size: 32 },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: "auto", fill: colors.fill },
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: [new Paragraph({ children: toRuns(data.text) })],
          }),
        ],
      }),
    ],
  });
}

// ── Chart ───────────────────────────────────────────────────────────────

export interface ChartImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Rasterised charts, keyed by the block's data object. */
const chartImages = new WeakMap<object, ChartImage>();

/** Export width on the page, px at 96 dpi (6 in — fits A4 / Letter). */
const EXPORT_WIDTH = 576;

function canRasterize(): boolean {
  if (typeof document === "undefined" || typeof Image === "undefined") return false;
  // jsdom has no canvas backend (and logs loudly when asked for one).
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
  return typeof HTMLCanvasElement !== "undefined";
}

/** SVG → PNG via an <img> and a 2× canvas. Null when unavailable. */
export async function rasterizeChart(data: ChartData, timeoutMs = 5000): Promise<ChartImage | null> {
  if (!canRasterize()) return null;
  const scale = 2;
  const svg = chartSvgString(data, { showTitle: false });
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("chart image timeout")), timeoutMs);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error("chart image failed"));
      };
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = CHART_WIDTH * scale;
    canvas.height = CHART_HEIGHT * scale;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      data: bytes,
      width: EXPORT_WIDTH,
      height: Math.round((EXPORT_WIDTH * CHART_HEIGHT) / CHART_WIDTH),
    };
  } catch {
    return null;
  }
}

/**
 * Rasterise every chart block before the (synchronous) block conversion.
 * Call once per export with the document's blocks; failures just leave
 * the chart to the table fallback.
 */
export async function prepareObjectImages(
  blocks: ReadonlyArray<{ type: string; data?: unknown }>,
): Promise<void> {
  const charts = blocks.filter(
    (b) => b.type === "chart" && b.data && typeof b.data === "object" && !chartImages.has(b.data as object),
  );
  await Promise.all(
    charts.map(async (b) => {
      const image = await rasterizeChart(cleanChartData(b.data));
      if (image) chartImages.set(b.data as object, image);
    }),
  );
}

function caption(title: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 60, after: 200 },
    children: [new TextRun({ text: title, italics: true, size: 20, color: "57606A" })],
  });
}

function cellParagraph(text: string, opts: { bold?: boolean; right?: boolean } = {}): Paragraph {
  return new Paragraph({
    ...(opts.right ? { alignment: AlignmentType.RIGHT } : {}),
    children: [new TextRun({ text, ...(opts.bold ? { bold: true } : {}) })],
  });
}

/** Data table used when the chart can't be rasterised. */
export function chartDataTable(data: ChartData): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({ children: [cellParagraph(data.type === "pie" ? "Category" : "", { bold: true })] }),
      ...data.series
        .slice(0, data.type === "pie" ? 1 : undefined)
        .map((s) => new TableCell({ children: [cellParagraph(s.name, { bold: true, right: true })] })),
    ],
  });
  const rows = data.labels.map(
    (label, i) =>
      new TableRow({
        children: [
          new TableCell({ children: [cellParagraph(label)] }),
          ...data.series
            .slice(0, data.type === "pie" ? 1 : undefined)
            .map((s) => new TableCell({ children: [cellParagraph(formatValue(s.values[i] ?? 0), { right: true })] })),
        ],
      }),
  );
  return new Table({ rows: [header, ...rows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

export function chartToDocx(raw: unknown): Array<Paragraph | Table> {
  const data = cleanChartData(raw);
  const image = raw && typeof raw === "object" ? chartImages.get(raw as object) : undefined;
  const out: Array<Paragraph | Table> = [];
  if (image) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: Boolean(data.title),
        children: [
          new ImageRun({
            type: "png",
            data: image.data,
            transformation: { width: image.width, height: image.height },
            altText: { name: data.title || "Chart", title: data.title || "Chart", description: chartSummary(data) },
          }),
        ],
      }),
    );
  } else {
    out.push(chartDataTable(data));
  }
  if (data.title) out.push(caption(data.title));
  return out;
}

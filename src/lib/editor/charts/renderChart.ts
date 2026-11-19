/**
 * Small dependency-free SVG chart renderer (bar / line / pie).
 *
 * Built with DOM APIs only, so every label is a text node — nothing user
 * supplied is ever parsed as markup. The output has a fixed viewBox, so
 * its rendered height depends only on the width it's given (the paginator
 * measures chart blocks as whole, unsplittable units).
 */
import type { ChartData } from "./chartData";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Categorical palette (fixed order, validated for CVD separation on a
 *  white surface). Series i always gets slot i. */
export const CHART_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"] as const;

const INK = "#1f2328";
const MUTED = "#57606a";
const GRID = "#e1e4e8";
const AXIS = "#8c959f";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export const CHART_WIDTH = 600;
export const CHART_HEIGHT = 320;

export interface RenderChartOptions {
  width?: number;
  height?: number;
  /** Draw the title inside the SVG (export puts it in a caption instead). */
  showTitle?: boolean;
}

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

function tooltip(node: SVGElement, text: string): void {
  node.appendChild(el("title", {}, text));
}

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function formatValue(n: number): string {
  return numberFormat.format(n);
}

function formatTick(n: number): string {
  return Math.abs(n) >= 10000 ? compactFormat.format(n) : numberFormat.format(n);
}

/** "Nice" axis ticks covering [min, max] (always includes 0 for bars). */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.5;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo, i = 0; v <= hi + step / 2 && i < 50; v += step, i++) {
    // Avoid -0 and float noise (0.30000000000000004).
    ticks.push(Number((Math.round(v / step) * step).toPrecision(12)) || 0);
  }
  return ticks;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

/** One-sentence summary for screen readers. */
export function chartSummary(data: ChartData): string {
  const kind = data.type === "bar" ? "Bar chart" : data.type === "line" ? "Line chart" : "Pie chart";
  const head = data.title ? `${kind}: ${data.title}.` : `${kind}.`;
  if (data.type === "pie") {
    const s = data.series[0]!;
    const parts = data.labels.map((l, i) => `${l || `Item ${i + 1}`} ${formatValue(s.values[i] ?? 0)}`);
    return `${head} ${s.name}: ${parts.join(", ")}.`;
  }
  const all = data.series.flatMap((s) => s.values);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const series = data.series.map((s) => s.name).join(", ");
  return (
    `${head} ${data.labels.length} categor${data.labels.length === 1 ? "y" : "ies"} ` +
    `(${data.labels[0] ?? ""} to ${data.labels[data.labels.length - 1] ?? ""}), ` +
    `${data.series.length} series: ${series}. Values range from ${formatValue(min)} to ${formatValue(max)}.`
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Render chart data to an `<svg>` element. */
export function renderChartSvg(data: ChartData, opts: RenderChartOptions = {}): SVGSVGElement {
  const W = opts.width ?? CHART_WIDTH;
  const H = opts.height ?? CHART_HEIGHT;
  const showTitle = opts.showTitle ?? true;
  const svg = el("svg", {
    xmlns: SVG_NS,
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    role: "img",
    class: `tp-chart__svg tp-chart__svg--${data.type}`,
    "font-family": FONT,
  });
  svg.setAttribute("aria-label", chartSummary(data));
  svg.appendChild(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));

  let top = 12;
  if (showTitle && data.title) {
    svg.appendChild(
      el(
        "text",
        { class: "tp-chart__title", x: W / 2, y: 24, "text-anchor": "middle", "font-size": 15, "font-weight": 600, fill: INK },
        truncate(data.title, 70),
      ),
    );
    top = 40;
  }

  if (data.type === "pie") {
    drawPie(svg, data, { x: 12, y: top, w: W - 24, h: H - top - 12 });
    return svg;
  }

  const legend = data.series.length >= 2;
  const bottom = legend ? 30 : 8;
  drawCartesian(svg, data, { x: 12, y: top, w: W - 24, h: H - top - bottom });
  if (legend) {
    drawLegend(
      svg,
      data.series.map((s, i) => ({ name: s.name, color: CHART_PALETTE[i % CHART_PALETTE.length]! })),
      W,
      H - 14,
    );
  }
  return svg;
}

function drawLegend(svg: SVGSVGElement, items: Array<{ name: string; color: string }>, W: number, y: number): void {
  const g = el("g", { class: "tp-chart__legend" });
  const widths = items.map((it) => 16 + Math.min(it.name.length, 18) * 6.5 + 14);
  let x = Math.max(8, (W - widths.reduce((a, b) => a + b, 0)) / 2);
  items.forEach((it, i) => {
    const item = el("g", { class: "tp-chart__legend-item" });
    item.appendChild(el("rect", { x, y: y - 9, width: 10, height: 10, rx: 2, fill: it.color }));
    item.appendChild(el("text", { x: x + 15, y, "font-size": 11, fill: INK }, truncate(it.name, 18)));
    g.appendChild(item);
    x += widths[i]!;
  });
  svg.appendChild(g);
}

function drawCartesian(svg: SVGSVGElement, data: ChartData, box: Box): void {
  const n = data.labels.length;
  const all = data.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;

  const rotate = n > 8;
  const xLabelSpace = rotate ? 52 : 22;
  const yLabelWidth = Math.max(...ticks.map((t) => formatTick(t).length)) * 6.5 + 10;
  const plot: Box = {
    x: box.x + yLabelWidth,
    y: box.y,
    w: box.w - yLabelWidth - 4,
    h: box.h - xLabelSpace,
  };
  const yOf = (v: number) => plot.y + plot.h - ((v - lo) / (hi - lo || 1)) * plot.h;

  // Gridlines + y tick labels.
  const axis = el("g", { class: "tp-chart__axis tp-chart__axis--y" });
  for (const t of ticks) {
    const y = yOf(t);
    axis.appendChild(
      el("line", { x1: plot.x, x2: plot.x + plot.w, y1: y, y2: y, stroke: t === 0 ? AXIS : GRID, "stroke-width": 1 }),
    );
    axis.appendChild(
      el("text", { x: plot.x - 6, y: y + 4, "text-anchor": "end", "font-size": 11, fill: MUTED }, formatTick(t)),
    );
  }
  svg.appendChild(axis);

  // X category labels.
  const band = plot.w / Math.max(1, n);
  const xAxis = el("g", { class: "tp-chart__axis tp-chart__axis--x" });
  const maxChars = rotate ? 12 : Math.max(3, Math.floor(band / 6.5));
  data.labels.forEach((label, i) => {
    const cx = plot.x + band * (i + 0.5);
    const y = plot.y + plot.h + 15;
    const text = el(
      "text",
      rotate
        ? { x: cx, y, "text-anchor": "end", transform: `rotate(-40 ${cx} ${y})`, "font-size": 10, fill: MUTED }
        : { x: cx, y, "text-anchor": "middle", "font-size": 11, fill: MUTED },
      truncate(label, maxChars),
    );
    if (label.length > maxChars) tooltip(text, label);
    xAxis.appendChild(text);
  });
  svg.appendChild(xAxis);

  const marks = el("g", { class: "tp-chart__marks" });
  const zeroY = yOf(Math.max(lo, Math.min(hi, 0)));
  if (data.type === "bar") {
    const groupW = band * 0.72;
    const gap = 2;
    const barW = Math.max(1, (groupW - gap * (data.series.length - 1)) / data.series.length);
    data.series.forEach((s, si) => {
      const color = CHART_PALETTE[si % CHART_PALETTE.length]!;
      s.values.forEach((v, i) => {
        const x = plot.x + band * i + (band - groupW) / 2 + si * (barW + gap);
        const y = yOf(v);
        const path = el("path", {
          class: "tp-chart__bar",
          d: barPath(x, barW, zeroY, y),
          fill: color,
        });
        tooltip(path, `${data.labels[i] ?? ""} — ${s.name}: ${formatValue(v)}`);
        marks.appendChild(path);
      });
    });
  } else {
    data.series.forEach((s, si) => {
      const color = CHART_PALETTE[si % CHART_PALETTE.length]!;
      const pts = s.values.map((v, i) => [plot.x + band * (i + 0.5), yOf(v)] as const);
      marks.appendChild(
        el("polyline", {
          class: "tp-chart__line",
          points: pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "),
          fill: "none",
          stroke: color,
          "stroke-width": 2,
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
        }),
      );
      pts.forEach(([x, y], i) => {
        const dot = el("circle", {
          class: "tp-chart__point",
          cx: x.toFixed(1),
          cy: y.toFixed(1),
          r: 4,
          fill: color,
          stroke: "#ffffff",
          "stroke-width": 2,
        });
        tooltip(dot, `${data.labels[i] ?? ""} — ${s.name}: ${formatValue(s.values[i] ?? 0)}`);
        marks.appendChild(dot);
      });
    });
  }
  svg.appendChild(marks);
}

/** Bar with a 4px rounded data end, square at the baseline. */
function barPath(x: number, w: number, baseY: number, valueY: number): string {
  const h = Math.abs(baseY - valueY);
  const r = Math.min(4, w / 2, h);
  const f = (n: number) => n.toFixed(1);
  if (h < 0.5) return `M${f(x)},${f(baseY)}h${f(w)}v0h${f(-w)}Z`;
  if (valueY < baseY) {
    return (
      `M${f(x)},${f(baseY)}V${f(valueY + r)}Q${f(x)},${f(valueY)} ${f(x + r)},${f(valueY)}` +
      `H${f(x + w - r)}Q${f(x + w)},${f(valueY)} ${f(x + w)},${f(valueY + r)}V${f(baseY)}Z`
    );
  }
  return (
    `M${f(x)},${f(baseY)}V${f(valueY - r)}Q${f(x)},${f(valueY)} ${f(x + r)},${f(valueY)}` +
    `H${f(x + w - r)}Q${f(x + w)},${f(valueY)} ${f(x + w)},${f(valueY - r)}V${f(baseY)}Z`
  );
}

function drawPie(svg: SVGSVGElement, data: ChartData, box: Box): void {
  const s = data.series[0]!;
  const values = s.values.map((v) => (v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const legendW = Math.min(220, box.w * 0.42);
  const r = Math.max(10, Math.min((box.w - legendW) / 2, box.h / 2) - 6);
  const cx = box.x + (box.w - legendW) / 2;
  const cy = box.y + box.h / 2;
  const colorOf = (i: number) => CHART_PALETTE[i % CHART_PALETTE.length]!;

  const marks = el("g", { class: "tp-chart__marks" });
  if (total <= 0) {
    marks.appendChild(el("circle", { cx, cy, r, fill: "none", stroke: GRID, "stroke-width": 2 }));
    marks.appendChild(
      el("text", { x: cx, y: cy + 4, "text-anchor": "middle", "font-size": 12, fill: MUTED }, "No positive values"),
    );
  } else {
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      if (v <= 0) return;
      const sweep = (v / total) * Math.PI * 2;
      const label = `${data.labels[i] ?? ""}: ${formatValue(s.values[i]!)} (${formatValue((v / total) * 100)}%)`;
      let node: SVGElement;
      if (sweep >= Math.PI * 2 - 1e-9) {
        node = el("circle", { class: "tp-chart__slice", cx, cy, r, fill: colorOf(i) });
      } else {
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle + sweep);
        const y2 = cy + r * Math.sin(angle + sweep);
        node = el("path", {
          class: "tp-chart__slice",
          d: `M${cx.toFixed(1)},${cy.toFixed(1)}L${x1.toFixed(2)},${y1.toFixed(2)}A${r.toFixed(1)},${r.toFixed(1)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)},${y2.toFixed(2)}Z`,
          fill: colorOf(i),
          stroke: "#ffffff",
          "stroke-width": 2,
          "stroke-linejoin": "round",
        });
      }
      tooltip(node, label);
      marks.appendChild(node);
      angle += sweep;
    });
  }
  svg.appendChild(marks);

  // Legend: one entry per category, in one or two columns.
  const g = el("g", { class: "tp-chart__legend" });
  const n = data.labels.length;
  const cols = n > 15 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const rowH = Math.min(20, box.h / Math.max(1, rows));
  const colW = legendW / cols;
  const lx = box.x + box.w - legendW;
  const ly = box.y + Math.max(0, (box.h - rows * rowH) / 2);
  const chars = cols === 2 ? 11 : 26;
  data.labels.forEach((label, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const x = lx + col * colW;
    const y = ly + row * rowH + rowH / 2;
    const item = el("g", { class: "tp-chart__legend-item" });
    item.appendChild(el("rect", { x, y: y - 5, width: 10, height: 10, rx: 2, fill: colorOf(i) }));
    const pct = total > 0 ? ` ${formatValue(Math.round((values[i]! / total) * 1000) / 10)}%` : "";
    item.appendChild(
      el("text", { x: x + 15, y: y + 4, "font-size": Math.min(11, rowH - 2), fill: INK }, `${truncate(label, chars)}${pct}`),
    );
    g.appendChild(item);
  });
  svg.appendChild(g);
}

/** Serialize for export (PNG rasterisation). */
export function chartSvgString(data: ChartData, opts: RenderChartOptions = {}): string {
  return new XMLSerializer().serializeToString(renderChartSvg(data, opts));
}

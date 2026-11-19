/**
 * Chart block data: types, limits and the cleaner every load / save /
 * export path runs through. Everything stored is plain text and numbers —
 * never HTML — and is escaped (DOM text nodes) when rendered.
 */

export type ChartType = "bar" | "line" | "pie";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartData {
  type: ChartType;
  title: string;
  labels: string[];
  series: ChartSeries[];
}

export const CHART_TYPES: readonly ChartType[] = ["bar", "line", "pie"];
export const MAX_LABELS = 30;
export const MAX_SERIES = 6;
export const MAX_TITLE_LENGTH = 120;
export const MAX_TEXT_LENGTH = 60;
/** Values are clamped so the axis maths stays finite. */
export const MAX_ABS_VALUE = 1e12;

export function defaultChartData(): ChartData {
  return {
    type: "bar",
    title: "Quarterly sales",
    labels: ["Q1", "Q2", "Q3", "Q4"],
    series: [
      { name: "2025", values: [12, 19, 15, 22] },
      { name: "2026", values: [14, 21, 18, 26] },
    ],
  };
}

/**
 * Plain-text field. The load-time sanitizer runs any string containing "<"
 * through DOMPurify (which would eat "x<y" as a tag), so "<" / ">" are
 * stored as the look-alike small less/greater-than signs. Entities left by
 * an earlier HTML pass are decoded first.
 */
export function cleanPlainText(value: unknown, max: number): string {
  let s = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/</g, "﹤")
    .replace(/>/g, "﹥")
    // Control characters have no place in a label.
    .replace(/[\u0000-\u001f\u007f]/g, " ");
  return s.slice(0, max);
}

/** A finite number, clamped; anything else becomes 0. */
export function cleanNumber(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(-MAX_ABS_VALUE, Math.min(MAX_ABS_VALUE, n));
}

/** Validate / repair chart data. Unusable input yields the sample chart. */
export function cleanChartData(raw: unknown): ChartData {
  if (!raw || typeof raw !== "object") return defaultChartData();
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.labels) && !Array.isArray(d.series)) return defaultChartData();

  const type = CHART_TYPES.includes(d.type as ChartType) ? (d.type as ChartType) : "bar";
  const title = cleanPlainText(d.title, MAX_TITLE_LENGTH);
  let labels = (Array.isArray(d.labels) ? d.labels : [])
    .slice(0, MAX_LABELS)
    .map((l) => cleanPlainText(l, MAX_TEXT_LENGTH));

  const rawSeries = (Array.isArray(d.series) ? d.series : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .slice(0, MAX_SERIES);

  if (labels.length === 0) {
    // Recover the category count from the longest series.
    const longest = rawSeries.reduce(
      (n, s) => Math.max(n, Array.isArray(s.values) ? s.values.length : 0),
      0,
    );
    const count = Math.min(MAX_LABELS, Math.max(1, longest));
    labels = Array.from({ length: count }, (_, i) => `Item ${i + 1}`);
  }

  let series: ChartSeries[] = rawSeries.map((s, i) => {
    const values = Array.isArray(s.values) ? s.values : [];
    return {
      name: cleanPlainText(s.name, MAX_TEXT_LENGTH) || `Series ${i + 1}`,
      values: labels.map((_, j) => cleanNumber(values[j])),
    };
  });
  if (series.length === 0) series = [{ name: "Series 1", values: labels.map(() => 0) }];

  return { type, title, labels, series };
}

/** Deep copy (the dialog edits a draft). */
export function cloneChartData(d: ChartData): ChartData {
  return {
    type: d.type,
    title: d.title,
    labels: [...d.labels],
    series: d.series.map((s) => ({ name: s.name, values: [...s.values] })),
  };
}

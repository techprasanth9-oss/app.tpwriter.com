import { describe, expect, it } from "vitest";
import { sanitizeEditorData } from "../sanitizeData";
import { cleanChartData, defaultChartData, MAX_LABELS, MAX_SERIES, type ChartData } from "./chartData";
import { CHART_PALETTE, chartSummary, niceTicks, renderChartSvg } from "./renderChart";

const sample: ChartData = {
  type: "bar",
  title: "Revenue",
  labels: ["Jan", "Feb", "Mar"],
  series: [
    { name: "North", values: [10, 20, 30] },
    { name: "South", values: [5, -15, 25.5] },
  ],
};

describe("cleanChartData", () => {
  it("round-trips valid data unchanged", () => {
    expect(cleanChartData(sample)).toEqual(sample);
    expect(cleanChartData(cleanChartData(sample))).toEqual(sample);
  });

  it("falls back to the sample chart for unusable input", () => {
    expect(cleanChartData(null)).toEqual(defaultChartData());
    expect(cleanChartData("chart")).toEqual(defaultChartData());
    expect(cleanChartData({ type: "bar" })).toEqual(defaultChartData());
  });

  it("repairs bad types, NaN values and ragged series", () => {
    const out = cleanChartData({
      type: "donut",
      title: 42,
      labels: ["A", 7, null],
      series: [
        { name: "S", values: [1, NaN, "3"] },
        { name: 5, values: [Infinity, "x"] },
        "junk",
        { values: "nope" },
      ],
    });
    expect(out.type).toBe("bar");
    expect(out.title).toBe("42");
    expect(out.labels).toEqual(["A", "7", ""]);
    expect(out.series).toEqual([
      { name: "S", values: [1, 0, 3] },
      { name: "5", values: [0, 0, 0] },
      { name: "Series 3", values: [0, 0, 0] },
    ]);
  });

  it("caps labels and series", () => {
    const out = cleanChartData({
      labels: Array.from({ length: 50 }, (_, i) => `L${i}`),
      series: Array.from({ length: 10 }, (_, i) => ({ name: `S${i}`, values: Array(60).fill(i) })),
    });
    expect(out.labels).toHaveLength(MAX_LABELS);
    expect(out.series).toHaveLength(MAX_SERIES);
    expect(out.series.every((s) => s.values.length === MAX_LABELS)).toBe(true);
  });

  it("derives labels from the values when none are given, and adds a series when none are", () => {
    expect(cleanChartData({ series: [{ name: "x", values: [1, 2] }] }).labels).toEqual(["Item 1", "Item 2"]);
    expect(cleanChartData({ labels: ["a"], series: [] }).series).toEqual([{ name: "Series 1", values: [0] }]);
  });

  it("stores markup characters as plain look-alikes so the load sanitizer leaves them alone", () => {
    const out = cleanChartData({
      title: "<img src=x onerror=alert(1)>",
      labels: ["x<5", "a &amp; b"],
      series: [{ name: "<b>s</b>", values: [1, 2] }],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain("<");
    expect(out.labels[1]).toBe("a & b");
    // Survives the load-time sanitizer byte-identical.
    expect(sanitizeEditorData(out)).toEqual(out);
  });
});

describe("niceTicks", () => {
  it("covers the range with round steps", () => {
    expect(niceTicks(0, 26)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(niceTicks(-15, 30)).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
    expect(niceTicks(0, 0.3)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
  });
});

describe("renderChartSvg", () => {
  it("draws one bar per value, a legend entry per series and an accessible label", () => {
    const svg = renderChartSvg(sample);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelectorAll(".tp-chart__bar")).toHaveLength(6);
    expect(svg.querySelectorAll(".tp-chart__legend-item")).toHaveLength(2);
    const label = svg.getAttribute("aria-label")!;
    expect(label).toContain("Bar chart: Revenue");
    expect(label).toContain("North, South");
    expect(label).toBe(chartSummary(sample));
    // Hover values via <title>.
    const titles = Array.from(svg.querySelectorAll(".tp-chart__bar title")).map((t) => t.textContent);
    expect(titles).toContain("Feb — South: -15");
    // Fixed palette order.
    expect(svg.querySelector(".tp-chart__bar")!.getAttribute("fill")).toBe(CHART_PALETTE[0]);
  });

  it("omits the legend for a single series", () => {
    const svg = renderChartSvg({ ...sample, series: [sample.series[0]!] });
    expect(svg.querySelectorAll(".tp-chart__legend-item")).toHaveLength(0);
    expect(svg.querySelectorAll(".tp-chart__bar")).toHaveLength(3);
  });

  it("draws lines with a point per value", () => {
    const svg = renderChartSvg({ ...sample, type: "line" });
    expect(svg.querySelectorAll(".tp-chart__line")).toHaveLength(2);
    expect(svg.querySelectorAll(".tp-chart__point")).toHaveLength(6);
  });

  it("draws a pie from the first series with a legend per category", () => {
    const svg = renderChartSvg({ ...sample, type: "pie" });
    expect(svg.querySelectorAll(".tp-chart__slice")).toHaveLength(3);
    expect(svg.querySelectorAll(".tp-chart__legend-item")).toHaveLength(3);
    expect(svg.getAttribute("aria-label")).toContain("Pie chart");
    // Non-positive slices are skipped.
    const neg = renderChartSvg({ ...sample, type: "pie", series: [{ name: "x", values: [1, -2, 0] }] });
    expect(neg.querySelectorAll(".tp-chart__slice")).toHaveLength(1);
  });

  it("renders labels as text, never markup", () => {
    const svg = renderChartSvg({ ...sample, title: "<script>x</script>", labels: ["<b>a</b>", "b", "c"] });
    expect(svg.querySelector("script")).toBeNull();
    expect(svg.querySelector("b")).toBeNull();
    expect(svg.querySelector(".tp-chart__title")!.textContent).toBe("<script>x</script>");
  });
});

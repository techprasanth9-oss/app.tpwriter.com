import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultChartData } from "../charts/chartData";
import { sanitizeEditorData } from "../sanitizeData";
import { ChartTool } from "./ChartTool";

function mount(data: unknown, readOnly = false) {
  const block = { id: "c1", dispatchChange: vi.fn() };
  const tool = new (ChartTool as any)({ data, api: {}, config: {}, readOnly, block }) as ChartTool;
  const el = tool.render();
  document.body.replaceChildren(el);
  return { tool, el, block };
}

const dialog = () => document.querySelector<HTMLElement>(".tp-chart-dialog");
const q = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const qa = <T extends HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));

function type(input: HTMLInputElement | HTMLSelectElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

afterEach(() => document.body.replaceChildren());

describe("chart tool", () => {
  it("starts new charts with the sample bar chart", () => {
    const { tool, el } = mount({});
    expect(tool.save()).toEqual(defaultChartData());
    expect(el.querySelectorAll(".tp-chart__bar")).toHaveLength(8);
  });

  it("round-trips data, and survives the load sanitizer unchanged", () => {
    const data = {
      type: "line",
      title: "Temps",
      labels: ["Mon", "Tue"],
      series: [{ name: "Max", values: [21.5, -3] }],
    };
    const { tool } = mount(data);
    expect(tool.save()).toEqual(data);
    expect(sanitizeEditorData(tool.save())).toEqual(data);
  });

  it("cleans invalid data on load", () => {
    const { tool } = mount({
      type: "radar",
      labels: Array(40).fill("x"),
      series: [{ name: "a", values: [NaN, "7"] }],
    });
    const saved = tool.save();
    expect(saved.type).toBe("bar");
    expect(saved.labels).toHaveLength(30);
    expect(saved.series[0]!.values.slice(0, 3)).toEqual([0, 7, 0]);
  });

  it("renders generated, mutation-free SVG with an accessible summary", () => {
    const { el } = mount({});
    expect(el.dataset.mutationFree).toBe("true");
    expect(el.contentEditable).toBe("false");
    const svg = el.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toMatch(/^Bar chart: Quarterly sales/);
  });

  it("edits through the modal grid and saves", () => {
    const { tool, el, block } = mount({});
    el.querySelector<HTMLButtonElement>(".tp-chart__edit")!.click();
    expect(dialog()).not.toBeNull();
    expect(q(".tp-chart-dialog").getAttribute("role")).toBe("dialog");
    // Second open is a no-op.
    tool.openEditor();
    expect(qa(".tp-chart-dialog")).toHaveLength(1);

    type(q<HTMLInputElement>(".tp-chart-dialog__title"), "New title");
    type(q<HTMLSelectElement>(".tp-chart-dialog__type"), "line");
    q<HTMLButtonElement>(".tp-chart-dialog__add-row").click();
    expect(qa(".tp-chart-dialog__label")).toHaveLength(5);
    type(qa<HTMLInputElement>(".tp-chart-dialog__label")[4]!, "Q5");
    const values = qa<HTMLInputElement>(".tp-chart-dialog__value");
    // Row-major: 5 rows × 2 series.
    type(values[8]!, "30");
    type(values[9]!, "not a number");
    // Remove the first series.
    qa<HTMLButtonElement>(".tp-chart-dialog__remove-series")[0]!.click();
    q<HTMLButtonElement>(".tp-chart-dialog__add-series").click();
    type(qa<HTMLInputElement>(".tp-chart-dialog__series-name")[1]!, "Plan");
    q<HTMLButtonElement>(".tp-chart-dialog__save").click();

    expect(dialog()).toBeNull();
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
    expect(tool.save()).toEqual({
      type: "line",
      title: "New title",
      labels: ["Q1", "Q2", "Q3", "Q4", "Q5"],
      series: [
        { name: "2026", values: [14, 21, 18, 26, 0] },
        { name: "Plan", values: [0, 0, 0, 0, 0] },
      ],
    });
    expect(el.querySelectorAll(".tp-chart__line")).toHaveLength(2);
  });

  it("Cancel and Esc discard the draft", () => {
    const { tool, el, block } = mount({});
    tool.openEditor();
    type(q<HTMLInputElement>(".tp-chart-dialog__title"), "Changed");
    q<HTMLButtonElement>(".tp-chart-dialog__cancel").click();
    expect(dialog()).toBeNull();

    tool.openEditor();
    q<HTMLButtonElement>(".tp-chart-dialog__add-row").click();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    q(".tp-chart-dialog").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.removeEventListener("keydown", outer);
    expect(outer).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();

    expect(tool.save()).toEqual(defaultChartData());
    expect(block.dispatchChange).not.toHaveBeenCalled();
    expect(el.querySelectorAll(".tp-chart__bar")).toHaveLength(8);
  });

  it("caps rows and series in the grid", () => {
    const { tool } = mount({
      labels: Array.from({ length: 30 }, (_, i) => `L${i}`),
      series: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}`, values: [] })),
    });
    tool.openEditor();
    expect(q<HTMLButtonElement>(".tp-chart-dialog__add-row").disabled).toBe(true);
    expect(q<HTMLButtonElement>(".tp-chart-dialog__add-series").disabled).toBe(true);
  });

  it("removes its dialog on destroy and never opens read-only", () => {
    const { tool } = mount({});
    tool.openEditor();
    tool.destroy();
    expect(dialog()).toBeNull();

    const ro = mount({}, true);
    expect(ro.el.querySelector(".tp-chart__edit")).toBeNull();
    ro.tool.openEditor();
    expect(dialog()).toBeNull();
  });

  it("switches type from the settings menu", () => {
    const { tool, block } = mount({});
    const items = tool.renderSettings() as Array<{ title: string; onActivate: () => void }>;
    items.find((i) => i.title === "Pie chart")!.onActivate();
    expect(tool.save().type).toBe("pie");
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
  });
});

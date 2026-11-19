import type { BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import type { MenuConfig } from "@editorjs/editorjs/types/tools";
import { cleanChartData, defaultChartData, type ChartData, type ChartType } from "../charts/chartData";
import { openChartDialog, type ChartDialogHandle } from "../charts/chartDialog";
import { renderChartSvg } from "../charts/renderChart";
import "./ChartTool.css";

const TYPE_ICONS: Record<ChartType, string> = {
  bar: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M2 14h13v1.5H2zM3 8h2.5v5H3zm4.2-4h2.5v9H7.2zm4.3 2H14v7h-2.5z"/></svg>',
  line: '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 15h13"/><path d="M2.5 12l4-5 3 3 5-6"/></svg>',
  pie: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M8 2.05A6.5 6.5 0 1 0 14.95 9H8z"/><path d="M9.5 1.5v6h6a6 6 0 0 0-6-6z"/></svg>',
};

/**
 * Chart block: inline SVG (bar / line / pie) from a small data grid.
 * The SVG is generated DOM (`data-mutation-free`); data is edited in a
 * modal grid and saved as plain text + numbers.
 */
export class ChartTool implements BlockTool {
  static get toolbox() {
    return { title: "Chart", icon: TYPE_ICONS.bar };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  /** Plain-text fields: don't let EditorJS HTML-clean them on save. */
  static get sanitize() {
    return { type: true, title: true, labels: true, series: true };
  }

  private data: ChartData;
  private readonly block?: BlockAPI;
  private readonly readOnly: boolean;
  private wrapper: HTMLElement | null = null;
  private figure: HTMLElement | null = null;
  private dialog: ChartDialogHandle | null = null;

  constructor({ data, block, readOnly }: BlockToolConstructorOptions<ChartData>) {
    const empty = !data || typeof data !== "object" || Object.keys(data).length === 0;
    this.data = empty ? defaultChartData() : cleanChartData(data);
    this.block = block;
    this.readOnly = readOnly;
  }

  render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tp-chart";
    wrapper.contentEditable = "false";
    wrapper.dataset.mutationFree = "true";
    const figure = document.createElement("div");
    figure.className = "tp-chart__figure";
    wrapper.appendChild(figure);
    if (!this.readOnly) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "tp-chart__edit";
      edit.textContent = "Edit data";
      edit.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openEditor();
      });
      wrapper.appendChild(edit);
      figure.addEventListener("dblclick", () => this.openEditor());
    }
    this.wrapper = wrapper;
    this.figure = figure;
    this.paint();
    return wrapper;
  }

  renderSettings(): MenuConfig {
    const types: Array<[ChartType, string]> = [
      ["bar", "Bar chart"],
      ["line", "Line chart"],
      ["pie", "Pie chart"],
    ];
    return [
      {
        title: "Edit data…",
        icon: '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="13" height="12" rx="1"/><path d="M2 6.5h13M2 10.5h13M6.5 2.5v12"/></svg>',
        closeOnActivate: true,
        onActivate: () => this.openEditor(),
      },
      ...types.map(([type, title]) => ({
        title,
        icon: TYPE_ICONS[type],
        toggle: "tp-chart-type",
        isActive: this.data.type === type,
        closeOnActivate: true,
        onActivate: () => {
          if (this.data.type === type) return;
          this.data = { ...this.data, type };
          this.paint();
          this.block?.dispatchChange();
        },
      })),
    ];
  }

  save(): ChartData {
    return cleanChartData(this.data);
  }

  destroy(): void {
    this.dialog?.close();
    this.dialog = null;
  }

  /** Open the data grid (no-op in read-only mode or when already open). */
  openEditor(): void {
    if (this.readOnly || this.dialog) return;
    this.dialog = openChartDialog(this.data, {
      onSave: (next) => {
        this.data = next;
        this.paint();
        this.block?.dispatchChange();
      },
      onClose: () => {
        this.dialog = null;
      },
    });
  }

  private paint(): void {
    if (!this.figure) return;
    this.figure.replaceChildren(renderChartSvg(this.data));
    if (this.wrapper) this.wrapper.dataset.chartType = this.data.type;
  }
}

export default ChartTool;

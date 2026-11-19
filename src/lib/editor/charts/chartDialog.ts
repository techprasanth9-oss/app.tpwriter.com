/**
 * Modal data grid for editing a chart. DOM-built, appended to <body>, and
 * removed on close. Edits a draft; Save hands back cleaned data, Cancel
 * (button, Esc, backdrop click) discards it.
 */
import {
  cleanChartData,
  cleanNumber,
  cloneChartData,
  MAX_LABELS,
  MAX_SERIES,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  type ChartData,
  type ChartType,
} from "./chartData";
import { CHART_PALETTE } from "./renderChart";

export interface ChartDialogHandle {
  root: HTMLElement;
  /** Close without saving (also used on block destroy). */
  close(): void;
}

let dialogSeq = 0;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function openChartDialog(
  initial: ChartData,
  { onSave, onClose }: { onSave: (data: ChartData) => void; onClose?: () => void },
): ChartDialogHandle {
  const draft = cloneChartData(initial);
  const id = `tp-chart-dialog-${++dialogSeq}`;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const backdrop = h("div", { class: "tp-chart-dialog__backdrop" });
  const dialog = h("div", {
    class: "tp-chart-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": `${id}-heading`,
  });
  backdrop.appendChild(dialog);

  const heading = h("h2", { id: `${id}-heading`, class: "tp-chart-dialog__heading" }, "Edit chart data");

  const meta = h("div", { class: "tp-chart-dialog__meta" });
  const titleLabel = h("label", { class: "tp-chart-dialog__field" }, "Title");
  const titleInput = h("input", { type: "text", class: "tp-chart-dialog__title", maxlength: String(MAX_TITLE_LENGTH) });
  titleInput.value = draft.title;
  titleInput.addEventListener("input", () => (draft.title = titleInput.value));
  titleLabel.appendChild(titleInput);

  const typeLabel = h("label", { class: "tp-chart-dialog__field" }, "Type");
  const typeSelect = h("select", { class: "tp-chart-dialog__type" });
  for (const [value, text] of [
    ["bar", "Bar"],
    ["line", "Line"],
    ["pie", "Pie (first series)"],
  ] as const) {
    const opt = h("option", { value }, text);
    if (draft.type === value) opt.selected = true;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener("change", () => (draft.type = typeSelect.value as ChartType));
  typeLabel.appendChild(typeSelect);
  meta.append(titleLabel, typeLabel);

  const gridWrap = h("div", { class: "tp-chart-dialog__grid-wrap" });
  const status = h("p", { class: "tp-chart-dialog__status", "aria-live": "polite" });

  const tools = h("div", { class: "tp-chart-dialog__tools" });
  const addRow = h("button", { type: "button", class: "tp-chart-dialog__add-row" }, "+ Row");
  const addSeries = h("button", { type: "button", class: "tp-chart-dialog__add-series" }, "+ Series");
  tools.append(addRow, addSeries);

  const footer = h("div", { class: "tp-chart-dialog__footer" });
  const cancelBtn = h("button", { type: "button", class: "tp-chart-dialog__cancel" }, "Cancel");
  const saveBtn = h("button", { type: "button", class: "tp-chart-dialog__save" }, "Save");
  footer.append(cancelBtn, saveBtn);

  dialog.append(heading, meta, tools, gridWrap, status, footer);

  const buildGrid = () => {
    const table = h("table", { class: "tp-chart-dialog__grid" });
    const thead = h("thead");
    const headRow = h("tr");
    headRow.appendChild(h("th", { scope: "col" }, "Label"));
    draft.series.forEach((s, si) => {
      const th = h("th", { scope: "col" });
      const sw = h("span", { class: "tp-chart-dialog__swatch", "aria-hidden": "true" });
      sw.style.background = CHART_PALETTE[si % CHART_PALETTE.length]!;
      const name = h("input", {
        type: "text",
        class: "tp-chart-dialog__series-name",
        "aria-label": `Series ${si + 1} name`,
        maxlength: String(MAX_TEXT_LENGTH),
      });
      name.value = s.name;
      name.addEventListener("input", () => (s.name = name.value));
      const del = h("button", {
        type: "button",
        class: "tp-chart-dialog__remove-series",
        "aria-label": `Remove series ${s.name || si + 1}`,
        title: "Remove series",
      }, "×");
      del.disabled = draft.series.length <= 1;
      del.addEventListener("click", () => {
        draft.series.splice(si, 1);
        buildGrid();
      });
      th.append(sw, name, del);
      headRow.appendChild(th);
    });
    headRow.appendChild(h("th", { scope: "col", "aria-label": "Row actions" }));
    thead.appendChild(headRow);

    const tbody = h("tbody");
    draft.labels.forEach((label, li) => {
      const tr = h("tr");
      const labelCell = h("td");
      const labelInput = h("input", {
        type: "text",
        class: "tp-chart-dialog__label",
        "aria-label": `Row ${li + 1} label`,
        maxlength: String(MAX_TEXT_LENGTH),
      });
      labelInput.value = label;
      labelInput.addEventListener("input", () => (draft.labels[li] = labelInput.value));
      labelCell.appendChild(labelInput);
      tr.appendChild(labelCell);
      draft.series.forEach((s, si) => {
        const td = h("td");
        const input = h("input", {
          type: "number",
          step: "any",
          class: "tp-chart-dialog__value",
          "aria-label": `${s.name || `Series ${si + 1}`}, ${label || `row ${li + 1}`}`,
        });
        input.value = String(s.values[li] ?? 0);
        input.addEventListener("input", () => (s.values[li] = cleanNumber(input.value)));
        td.appendChild(input);
        tr.appendChild(td);
      });
      const actions = h("td");
      const del = h("button", {
        type: "button",
        class: "tp-chart-dialog__remove-row",
        "aria-label": `Remove row ${label || li + 1}`,
        title: "Remove row",
      }, "×");
      del.disabled = draft.labels.length <= 1;
      del.addEventListener("click", () => {
        draft.labels.splice(li, 1);
        draft.series.forEach((s) => s.values.splice(li, 1));
        buildGrid();
      });
      actions.appendChild(del);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    gridWrap.replaceChildren(table);
    addRow.disabled = draft.labels.length >= MAX_LABELS;
    addSeries.disabled = draft.series.length >= MAX_SERIES;
    status.textContent = `${draft.labels.length} of ${MAX_LABELS} rows, ${draft.series.length} of ${MAX_SERIES} series.`;
  };

  addRow.addEventListener("click", () => {
    if (draft.labels.length >= MAX_LABELS) return;
    draft.labels.push(`Item ${draft.labels.length + 1}`);
    draft.series.forEach((s) => s.values.push(0));
    buildGrid();
    const inputs = gridWrap.querySelectorAll<HTMLInputElement>(".tp-chart-dialog__label");
    inputs[inputs.length - 1]?.focus();
  });
  addSeries.addEventListener("click", () => {
    if (draft.series.length >= MAX_SERIES) return;
    draft.series.push({ name: `Series ${draft.series.length + 1}`, values: draft.labels.map(() => 0) });
    buildGrid();
    const inputs = gridWrap.querySelectorAll<HTMLInputElement>(".tp-chart-dialog__series-name");
    inputs[inputs.length - 1]?.focus();
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    onClose?.();
    if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
  };

  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", () => {
    const cleaned = cleanChartData(draft);
    close();
    onSave(cleaned);
  });
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });

  // Keep keystrokes away from EditorJS / app shortcuts (Backspace with a
  // block selected, Ctrl+Z history…), and trap Tab inside the dialog.
  for (const type of ["keyup", "keypress", "input", "paste", "copy", "cut", "beforeinput"]) {
    backdrop.addEventListener(type, (e) => e.stopPropagation());
  }
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveBtn.click();
    } else if (e.key === "Tab") {
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>("input, select, button:not([disabled])"),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  buildGrid();
  document.body.appendChild(backdrop);
  titleInput.focus();
  return { root: backdrop, close };
}

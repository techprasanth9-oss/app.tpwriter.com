/**
 * TableTool: every menu feature must survive render → save → a NEW tool
 * instance → render → save. A mismatch is silent data loss (the setting
 * looks applied, then resets on reload) or a corrupted grid.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import TableTool from "./TableTool";

const api: any = new Proxy(
  {},
  { get: () => new Proxy(() => undefined, { get: () => () => undefined }) },
);

type Tool = any;

function make(data: unknown, readOnly = false): Tool {
  const tool: Tool = new (TableTool as any)({ data, api, config: {}, readOnly, block: { id: "b1" } });
  document.body.appendChild(tool.render());
  return tool;
}

/** Save, load the JSON into a fresh tool, save again: must be identical. */
function reload(tool: Tool): { saved: any; next: Tool } {
  const saved = JSON.parse(JSON.stringify(tool.save()));
  const next = make(JSON.parse(JSON.stringify(saved)));
  expect(JSON.parse(JSON.stringify(next.save()))).toEqual(saved);
  return { saved, next };
}

function grid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `${String.fromCharCode(65 + c)}${r + 1}`),
  );
}

const rowsOf = (tool: Tool): HTMLTableRowElement[] => Array.from(tool.table.rows);
const cellAt = (tool: Tool, r: number, i: number): HTMLTableCellElement =>
  tool.table.rows[r].cells[i];

/** Logical width each row covers (cells + slots covered from above). */
function rowWidths(tool: Tool): number[] {
  const { owner } = tool.layoutGrid();
  return owner.map((row: unknown[]) => row.filter(Boolean).length);
}

function select(tool: Tool, r1: number, c1: number, r2: number, c2: number) {
  tool.assignLogicalCols();
  tool.selectedCell = tool.ownerGrid[r1][c1].cell;
  tool.selectedRow = tool.selectedCell.parentElement;
  tool.selectedMinRow = r1;
  tool.selectedMaxRow = r2;
  tool.selectedMinCol = c1;
  tool.selectedMaxCol = c2;
}

function pick(tool: Tool, r: number, c: number) {
  tool.assignLogicalCols();
  tool.clearSelection();
  tool.selectedCell = tool.ownerGrid[r][c].cell;
  tool.selectedRow = tool.selectedCell.parentElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TableTool round-trips", () => {
  it("a plain table saves what it loaded", () => {
    const tool = make({ content: grid(2, 3) });
    const { saved } = reload(tool);
    expect(saved.content).toEqual(grid(2, 3));
    expect(saved.repeatHeader).toBe(true);
    expect(saved).not.toHaveProperty("repeatHeaderOnPrint");
  });

  it("merged cells save colSpan/rowSpan and render as real spans", () => {
    const tool = make({ content: grid(3, 3) });
    select(tool, 0, 0, 1, 1);
    tool.mergeCells();
    const { saved, next } = reload(tool);
    expect(saved.styles.cells[0][0]).toMatchObject({ colSpan: 2, rowSpan: 2 });
    expect(saved.content[0]).toEqual(["A1<br>B1<br>A2<br>B2", "C1"]);
    expect(saved.content[1]).toEqual(["C2"]);
    const merged = cellAt(next, 0, 0);
    expect(merged.colSpan).toBe(2);
    expect(merged.rowSpan).toBe(2);
    expect(rowWidths(next)).toEqual([3, 3, 3]);
  });

  it("split restores a full grid", () => {
    const tool = make({ content: grid(3, 3) });
    select(tool, 0, 0, 1, 1);
    tool.mergeCells();
    pick(tool, 0, 0);
    tool.splitCell();
    const { saved } = reload(tool);
    expect(saved.content.map((r: string[]) => r.length)).toEqual([3, 3, 3]);
    expect(saved.styles.cells[0][0]?.colSpan).toBeUndefined();
  });

  it("deleting the origin row of a vertical merge moves the merged cell down", () => {
    const tool = make({ content: grid(3, 3) });
    select(tool, 0, 1, 2, 1); // B1:B3
    tool.mergeCells();
    pick(tool, 0, 0);
    tool.deleteRow();
    const { saved, next } = reload(tool);
    expect(saved.content).toEqual([["A2", "B1<br>B2<br>B3", "C2"], ["A3", "C3"]]);
    expect(saved.styles.cells[0][1].rowSpan).toBe(2);
    expect(rowWidths(next)).toEqual([3, 3]);
  });

  it("deleting a row inside a vertical merge shrinks the merge", () => {
    const tool = make({ content: grid(3, 3) });
    select(tool, 0, 1, 2, 1);
    tool.mergeCells();
    pick(tool, 1, 0);
    tool.deleteRow();
    const { saved, next } = reload(tool);
    expect(saved.content).toEqual([["A1", "B1<br>B2<br>B3", "C1"], ["A3", "C3"]]);
    expect(saved.styles.cells[0][1].rowSpan).toBe(2);
    expect(rowWidths(next)).toEqual([3, 3]);
  });

  it("inserting a row inside a vertical merge grows the merge", () => {
    const tool = make({ content: grid(3, 3) });
    select(tool, 0, 0, 1, 0); // A1:A2
    tool.mergeCells();
    pick(tool, 0, 1);
    tool.insertRow("below");
    const { saved, next } = reload(tool);
    expect(saved.content.length).toBe(4);
    expect(saved.styles.cells[0][0].rowSpan).toBe(3);
    expect(saved.content[1]).toEqual(["", ""]);
    expect(rowWidths(next)).toEqual([3, 3, 3, 3]);
  });

  it("inserting a column through a horizontal merge widens it", () => {
    const tool = make({ content: grid(2, 3), columnWidths: [50, 25, 25] });
    select(tool, 0, 0, 0, 1); // A1:B1
    tool.mergeCells();
    pick(tool, 1, 0);
    tool.insertColumn("right");
    const { saved, next } = reload(tool);
    expect(saved.styles.cells[0][0].colSpan).toBe(3);
    expect(saved.content[1]).toEqual(["A2", "", "B2", "C2"]);
    expect(rowWidths(next)).toEqual([4, 4]);
    expect(saved.columnWidths).toEqual([25, 25, 25, 25]);
  });

  it("insert column right of a merged cell goes after its last column", () => {
    const tool = make({ content: grid(2, 3) });
    select(tool, 0, 0, 0, 1);
    tool.mergeCells();
    pick(tool, 0, 0);
    tool.insertColumn("right");
    const { saved } = reload(tool);
    expect(saved.content[0]).toEqual(["A1<br>B1", "", "C1"]);
    expect(saved.content[1]).toEqual(["A2", "B2", "", "C2"]);
  });

  it("deleting a column through a horizontal merge narrows it", () => {
    const tool = make({ content: grid(2, 3) });
    select(tool, 0, 0, 0, 1);
    tool.mergeCells();
    pick(tool, 1, 1);
    tool.deleteColumn();
    const { saved, next } = reload(tool);
    expect(saved.content).toEqual([["A1<br>B1", "C1"], ["A2", "C2"]]);
    expect(saved.styles.cells[0][0]?.colSpan).toBeUndefined();
    expect(rowWidths(next)).toEqual([2, 2]);
  });

  it("won't delete the last row or column", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tool = make({ content: [["only"]] });
    pick(tool, 0, 0);
    tool.deleteRow();
    pick(tool, 0, 0);
    tool.deleteColumn();
    expect(tool.save().content).toEqual([["only"]]);
  });

  it("repairs a ragged legacy table by padding short rows", () => {
    const tool = make({ content: [["a", "b", "c"], ["d"]] });
    expect(tool.save().content).toEqual([["a", "b", "c"], ["d", "", ""]]);
  });

  it("clamps a rowSpan that runs past the last row", () => {
    const tool = make({ content: [["a", "b"], ["c"]], styles: { cells: { 0: { 0: { rowSpan: 5 } } } } });
    expect(cellAt(tool, 0, 0).rowSpan).toBe(2);
    expect(tool.save().styles.cells[0][0].rowSpan).toBe(2);
  });
});

describe("TableTool header rows", () => {
  it("header rows are a leading run, marked for the paginator", () => {
    const tool = make({ content: grid(4, 2) });
    pick(tool, 1, 0);
    tool.toggleHeader();
    const { saved, next } = reload(tool);
    expect(saved.headerRows).toEqual([0, 1]);
    expect(saved.withHeading).toBe(true);
    expect(saved.repeatHeader).toBe(true);
    const rows = rowsOf(next);
    expect(rows.map((r) => r.dataset.repeatHeader ?? null)).toEqual(["true", "true", null, null]);
    expect(rows[0].cells[0].tagName).toBe("TH");
    expect(rows[2].cells[0].tagName).toBe("TD");
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(["A1", "A2", "A3", "A4"]);
  });

  it("turning a header row off keeps only the rows above it", () => {
    const tool = make({ content: grid(4, 2), headerRows: [0, 1, 2] });
    pick(tool, 1, 0);
    tool.toggleHeader();
    expect(tool.save().headerRows).toEqual([0]);
  });

  it("repeatHeader toggles, persists, and drops the DOM marks", () => {
    const tool = make({ content: grid(3, 2), headerRows: [0] });
    tool.toggleRepeatHeader();
    const { saved, next } = reload(tool);
    expect(saved.repeatHeader).toBe(false);
    expect(saved.headerRows).toEqual([0]);
    expect(rowsOf(next).some((r) => r.dataset.repeatHeader)).toBe(false);
    next.toggleRepeatHeader();
    expect(next.save().repeatHeader).toBe(true);
    expect(rowsOf(next)[0].dataset.repeatHeader).toBe("true");
  });

  it("reads legacy repeatHeaderOnPrint", () => {
    const tool = make({ content: grid(2, 2), headerRows: [0], repeatHeaderOnPrint: false });
    expect(tool.save().repeatHeader).toBe(false);
    expect(rowsOf(tool)[0].dataset.repeatHeader).toBeUndefined();
  });

  it("legacy withHeading without headerRows means the first row", () => {
    const tool = make({ content: grid(2, 2), withHeading: true });
    expect(tool.save().headerRows).toEqual([0]);
  });

  it("a stray header row further down keeps its place and doesn't repeat", () => {
    const tool = make({ content: grid(3, 1), headerRows: [2] });
    const rows = rowsOf(tool);
    expect(rows.map((r) => r.cells[0].textContent)).toEqual(["A1", "A2", "A3"]);
    expect(rows[2].cells[0].tagName).toBe("TH");
    expect(rows.some((r) => r.dataset.repeatHeader)).toBe(false);
    expect(tool.save().headerRows).toEqual([2]);
  });

  it("a row inserted under the header block is a body row", () => {
    const tool = make({ content: grid(2, 2), headerRows: [0] });
    pick(tool, 0, 0);
    tool.insertRow("below");
    expect(tool.save().headerRows).toEqual([0]);
    pick(tool, 0, 0);
    tool.insertRow("above");
    expect(tool.save().headerRows).toEqual([0, 1]);
  });
});

describe("TableTool formatting persists", () => {
  it("cell fill, text colour, alignment, padding and borders", () => {
    const tool = make({ content: grid(2, 2) });
    pick(tool, 0, 0);
    tool.setCellBackground("#ff0000");
    tool.setCellTextColor("#00ff00");
    tool.setAlignment("center");
    tool.setVerticalAlignment("bottom");
    tool.setCellPadding("1px", "2px", "3px", "4px");
    pick(tool, 1, 1);
    tool.applyBorderToSides("top");
    pick(tool, 1, 0);
    tool.setBorderWidth("3px");
    tool.setBorderStyle("dashed");
    const { saved, next } = reload(tool);
    expect(saved.styles.cells[0][0]).toMatchObject({
      backgroundColor: "rgb(255, 0, 0)",
      color: "rgb(0, 255, 0)",
      textAlign: "center",
      verticalAlign: "bottom",
      paddingTop: "1px",
      paddingRight: "2px",
      paddingBottom: "3px",
      paddingLeft: "4px",
    });
    expect(saved.styles.cells[1][1].borderBottom).toMatch(/^0px/);
    expect(saved.styles.cells[1][1].borderTop).toContain("solid");
    expect(saved.styles.cells[1][0].borderStyle).toBe("dashed");
    const c = cellAt(next, 0, 0);
    expect(c.style.backgroundColor).toBe("rgb(255, 0, 0)");
    expect(c.style.verticalAlign).toBe("bottom");
  });

  it("row and column backgrounds", () => {
    const tool = make({ content: grid(2, 2) });
    pick(tool, 1, 0);
    tool.setRowBackground("#0000ff");
    pick(tool, 0, 1);
    tool.setColumnBackground("#00ff00");
    const { saved } = reload(tool);
    expect(saved.styles.rows[1]).toEqual({ backgroundColor: "rgb(0, 0, 255)" });
    expect(saved.styles.cells[1][1].backgroundColor).toBe("rgb(0, 255, 0)");
  });

  it("table theme keeps header bold and banding", () => {
    const tool = make({ content: grid(3, 2), headerRows: [0] });
    tool.applyTableTheme("banded");
    const { saved, next } = reload(tool);
    expect(saved.theme).toBe("banded");
    expect(saved.styles.cells[0][0].fontWeight).toBe("600");
    expect(saved.styles.rows[1]).toBeDefined();
    expect(cellAt(next, 0, 0).style.fontWeight).toBe("600");
  });

  it("hide borders", () => {
    const tool = make({ content: grid(2, 2) });
    tool.toggleBorders();
    const { saved, next } = reload(tool);
    expect(saved.hideBorders).toBe(true);
    expect(cellAt(next, 0, 0).style.borderWidth).toBe("0px");
  });

  it("column widths, row height, table alignment, caption", () => {
    const tool = make({ content: grid(2, 4) });
    tool.setColumnFitMode("distribute");
    tool.setRowHeight(1, 40);
    tool.setTableAlignment("center");
    tool.data.caption = "Revenue";
    tool.data.captionPosition = "bottom";
    tool.renderCaption();
    const { saved, next } = reload(tool);
    expect(saved.columnWidths).toEqual([25, 25, 25, 25]);
    expect(saved.rowHeights).toEqual([0, 40]);
    expect(saved.tableAlign).toBe("center");
    expect(saved.caption).toBe("Revenue");
    expect(saved.captionPosition).toBe("bottom");
    expect(next.table.querySelectorAll("col")).toHaveLength(4);
    expect(next.table.firstElementChild.tagName).toBe("CAPTION");
    expect(rowsOf(next)[1].style.height).toBe("40px");
    expect(next.table.style.marginLeft).toBe("auto");
  });

  it("row heights follow their row through inserts and deletes", () => {
    const tool = make({ content: grid(3, 1), rowHeights: [0, 0, 50] });
    pick(tool, 0, 0);
    tool.insertRow("above");
    expect(tool.save().rowHeights).toEqual([0, 0, 0, 50]);
    pick(tool, 1, 0);
    tool.deleteRow();
    expect(tool.save().rowHeights).toEqual([0, 0, 50]);
  });

  it("diagonal border saves the flag, not its SVG overlay", () => {
    const tool = make({ content: grid(1, 2) });
    pick(tool, 0, 0);
    tool.setDiagonalBorder("down");
    const { saved, next } = reload(tool);
    expect(saved.styles.cells[0][0].diagonalBorder).toBe("down");
    expect(saved.content[0][0]).toBe("A1");
    expect(cellAt(next, 0, 0).querySelectorAll("[data-diagonal-overlay]")).toHaveLength(1);
  });

  it("formulas persist as formulas through structural edits", () => {
    const tool = make({ content: [["1", "2"], ["=SUM(A1:B1)", ""]] });
    expect(cellAt(tool, 1, 0).textContent).toBe("3");
    pick(tool, 0, 1);
    tool.insertColumn("right");
    const { saved, next } = reload(tool);
    expect(saved.content[1][0]).toBe("=SUM(A1:B1)");
    expect(cellAt(next, 1, 0).textContent).toBe("3");
  });

  it("stored cell images follow their cell when the grid changes", () => {
    const src = "data:image/png;base64,AAAA";
    const tool = make({
      content: grid(2, 2),
      cellImages: { "1-1": src },
      cellImageSizes: { "1-1": { width: 40, height: 30 } },
    });
    pick(tool, 0, 0);
    tool.insertColumn("left");
    pick(tool, 0, 0);
    tool.insertRow("above");
    const { saved } = reload(tool);
    expect(saved.cellImages).toEqual({ "2-2": src });
    expect(saved.cellImageSizes).toEqual({ "2-2": { width: 40, height: 30 } });
    expect(saved.content[2][2]).toBe("B2");
  });

  it("never persists the paginator's row offsets", () => {
    const tool = make({ content: grid(3, 1), styles: { rows: { 1: { backgroundColor: "red", position: "relative", top: "99px" } } } });
    const row = rowsOf(tool)[2];
    row.style.position = "relative";
    row.style.top = "120px";
    const saved = tool.save();
    expect(JSON.stringify(saved.styles.rows)).not.toMatch(/top|position/);
    expect(JSON.stringify(saved)).not.toMatch(/120px|99px/);
    expect(rowsOf(tool)[1].style.top).toBe("");
    expect(saved.styles.rows).toEqual({ 1: { backgroundColor: "red" } });
  });

  it("pasted text is escaped and replaces stale per-cell state", () => {
    const tool = make({ content: grid(2, 2), styles: { cells: { 0: { 0: { colSpan: 2 } } } } });
    tool.onPaste({ detail: { data: { textContent: "<b>x</b>|y\na|b" } } } as any);
    const saved = tool.save();
    expect(saved.content[0][0]).toBe("&lt;b&gt;x&lt;/b&gt;");
    expect(saved.styles.cells[0]?.[0]?.colSpan).toBeUndefined();
  });

  it("pasted HTML tables keep merges and leading header rows", () => {
    const tool = make({ content: grid(1, 1) });
    const src = document.createElement("div");
    src.innerHTML =
      "<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td colspan='2'>wide</td></tr></tbody></table>";
    tool.onPaste({ detail: { data: src.querySelector("table") } } as any);
    const { saved } = reload(tool);
    expect(saved.headerRows).toEqual([0]);
    expect(saved.content).toEqual([["H1", "H2"], ["wide"]]);
    expect(saved.styles.cells[1][0].colSpan).toBe(2);
  });
});

describe("TableTool lifecycle", () => {
  it("adds document listeners once and removes them on destroy", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const tool = make({ content: grid(2, 2) });
    for (let i = 0; i < 5; i++) tool.rebuildTable();
    tool.onPaste({ detail: { data: { textContent: "a|b" } } } as any);
    const added = (type: string) => add.mock.calls.filter(([t]) => t === type).length;
    expect(added("click")).toBe(1);
    expect(added("mouseup")).toBe(1);
    tool.destroy();
    const removed = (type: string, fn: unknown) =>
      remove.mock.calls.some(([t, f]) => t === type && f === fn);
    expect(removed("click", add.mock.calls.find(([t]) => t === "click")![1])).toBe(true);
    expect(removed("mouseup", add.mock.calls.find(([t]) => t === "mouseup")![1])).toBe(true);
  });

  it("disconnects its ResizeObserver (one at a time) and removes popups on destroy", () => {
    const observers: Array<{ disconnected: boolean }> = [];
    class FakeObserver {
      disconnected = false;
      constructor() {
        observers.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.disconnected = true;
      }
    }
    vi.stubGlobal("ResizeObserver", FakeObserver);
    try {
      const tool = make({ content: grid(2, 2) });
      tool.rebuildTable();
      expect(observers.filter((o) => !o.disconnected)).toHaveLength(1);
      pick(tool, 0, 0);
      tool.showPaddingPicker();
      tool.showColumnFitPicker();
      tool.showColorPicker("background");
      const before = document.body.children.length;
      expect(before).toBeGreaterThan(1);
      tool.destroy();
      expect(observers.every((o) => o.disconnected)).toBe(true);
      expect(document.body.children.length).toBe(1); // only the tool's wrapper
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

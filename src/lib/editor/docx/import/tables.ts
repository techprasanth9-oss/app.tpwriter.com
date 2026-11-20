/**
 * w:tbl → TableTool data: grid widths → columnWidths %, gridSpan / vMerge →
 * colSpan / rowSpan, cell shading, borders (cell → table → table style),
 * vertical / text alignment, tblHeader → headerRows + repeatHeader.
 * Rows only through direct children (nested tables never leak rows).
 */

import type { EditorBlock } from "~/lib/api/documents";
import { block, type ImportContext, type PartScope } from "./context";
import { hexColor, round, twipsToPx } from "./html";
import { flowToInline } from "./inlineFlow";
import { alternateContent, attr, child, intAttr, kids, onOff, path, tag, val } from "./xml";

interface Cell {
  tc: Element | null;
  col: number;
  span: number;
  rowSpan: number;
  row: number;
}

const BORDER_STYLE: Record<string, string> = {
  single: "solid",
  thick: "solid",
  double: "double",
  triple: "double",
  dashed: "dashed",
  dashSmallGap: "dashed",
  dotDash: "dashed",
  dotDotDash: "dashed",
  dotted: "dotted",
};

/** A w:top / w:left / … border element → CSS border shorthand. */
function borderCss(el: Element | null): string | null {
  if (!el) return null;
  const v = attr(el, "w:val") ?? "single";
  if (v === "nil" || v === "none") return "none";
  const style = BORDER_STYLE[v] ?? "solid";
  const sz = intAttr(el, "w:sz") ?? 4;
  const width = Math.max(1, Math.round(sz / 6));
  const color = hexColor(attr(el, "w:color")) ?? "#000000";
  return `${width}px ${style} ${color}`;
}

function side(el: Element | null, a: string, b: string): Element | null {
  return child(el, a) ?? child(el, b);
}

/** Rows of a table (through sdt / customXml wrappers), direct only. */
function rowsOf(container: Element): Element[] {
  const out: Element[] = [];
  for (const c of kids(container)) {
    const t = tag(c);
    if (t === "w:tr") out.push(c);
    else if (t === "w:sdt") out.push(...rowsOf(child(c, "w:sdtContent") ?? c));
    else if (t === "w:customXml") out.push(...rowsOf(c));
    else if (t === "mc:AlternateContent") for (const k of alternateContent(c)) if (tag(k) === "w:tr") out.push(k);
  }
  return out;
}

function cellsOf(row: Element): Element[] {
  const out: Element[] = [];
  for (const c of kids(row)) {
    const t = tag(c);
    if (t === "w:tc") out.push(c);
    else if (t === "w:sdt") out.push(...cellsOf(child(c, "w:sdtContent") ?? c));
    else if (t === "w:customXml") out.push(...cellsOf(c));
  }
  return out;
}

export function convertTable(tbl: Element, ctx: ImportContext, scope: PartScope): EditorBlock {
  const tblPr = child(tbl, "w:tblPr");
  const styleId = val(tblPr, "w:tblStyle");
  let styleBorders: Element | null = null;
  for (const s of ctx.styles.chain(styleId)) {
    const b = child(s.tblPr ?? null, "w:tblBorders");
    if (b) {
      styleBorders = b;
      break;
    }
  }
  const tblBorders = child(tblPr, "w:tblBorders") ?? styleBorders;

  // Grid.
  const gridCols = kids(child(tbl, "w:tblGrid"))
    .filter((g) => tag(g) === "w:gridCol")
    .map((g) => Math.max(0, intAttr(g, "w:w") ?? 0));

  // Lay cells out on the grid.
  const trs = rowsOf(tbl);
  const rows: Cell[][] = [];
  const owners: (Cell | undefined)[][] = [];
  const headerRows: number[] = [];
  const rowHeights: number[] = [];
  let headerRun = true;
  let maxCol = gridCols.length;

  trs.forEach((tr, r) => {
    const trPr = child(tr, "w:trPr");
    const isHeader = !!child(trPr, "w:tblHeader") && onOff(val(trPr, "w:tblHeader"));
    if (isHeader && headerRun) headerRows.push(r);
    else headerRun = false;
    const h = intAttr(child(trPr, "w:trHeight"), "w:val");
    rowHeights.push(h && h > 0 ? Math.round(twipsToPx(h)) : 0);

    const row: Cell[] = [];
    owners[r] = [];
    let col = intAttr(child(trPr, "w:gridBefore"), "w:val") ?? 0;
    if (col > 0) {
      const filler: Cell = { tc: null, col: 0, span: col, rowSpan: 1, row: r };
      row.push(filler);
      for (let c = 0; c < col; c++) owners[r]![c] = filler;
    }
    for (const tc of cellsOf(tr)) {
      const tcPr = child(tc, "w:tcPr");
      const span = Math.max(1, Math.min(1000, intAttr(child(tcPr, "w:gridSpan"), "w:val") ?? 1));
      const vm = child(tcPr, "w:vMerge");
      const vmVal = vm ? (attr(vm, "w:val") ?? "continue") : null;
      const above = r > 0 ? owners[r - 1]![col] : undefined;
      if (vmVal === "continue" && above && above.tc && above.col === col) {
        above.rowSpan = r - above.row + 1;
        for (let c = col; c < col + span; c++) owners[r]![c] = above;
      } else {
        const cell: Cell = { tc, col, span, rowSpan: 1, row: r };
        row.push(cell);
        for (let c = col; c < col + span; c++) owners[r]![c] = cell;
      }
      col += span;
    }
    maxCol = Math.max(maxCol, col);
    rows.push(row);
  });
  const nRows = rows.length;

  // Borders: decide per edge whether the table uses one uniform border.
  const outer = {
    top: borderCss(side(tblBorders, "w:top", "w:top")),
    bottom: borderCss(side(tblBorders, "w:bottom", "w:bottom")),
    left: borderCss(side(tblBorders, "w:left", "w:start")),
    right: borderCss(side(tblBorders, "w:right", "w:end")),
    insideH: borderCss(child(tblBorders, "w:insideH")),
    insideV: borderCss(child(tblBorders, "w:insideV")),
  };
  const tableEdges = [outer.top, outer.bottom, outer.left, outer.right, outer.insideH, outer.insideV];
  const anyCellBorders = trs.some((tr) => cellsOf(tr).some((tc) => !!path(tc, "w:tcPr", "w:tcBorders")));
  const allNone = !anyCellBorders && tableEdges.every((e) => e === null || e === "none");
  const uniform =
    !anyCellBorders && tableEdges.every((e) => e !== null && e === tableEdges[0]) && tableEdges[0] !== "none"
      ? tableEdges[0]!
      : null;

  const content: string[][] = [];
  const cellStyles: Record<number, Record<number, Record<string, unknown>>> = {};
  rows.forEach((row, r) => {
    const out: string[] = [];
    cellStyles[r] = {};
    row.forEach((cell, j) => {
      const st: Record<string, unknown> = {};
      if (cell.span > 1) st.colSpan = cell.span;
      if (cell.rowSpan > 1) st.rowSpan = cell.rowSpan;
      if (!cell.tc) {
        out.push("");
        st.borderTop = st.borderLeft = st.borderBottom = "none";
        cellStyles[r]![j] = st;
        return;
      }
      const tcPr = child(cell.tc, "w:tcPr");
      const flow = flowToInline(kids(cell.tc).filter((k) => tag(k) !== "w:tcPr"), ctx, scope);
      out.push(flow.lines.length === 1 && flow.lines[0] === "" ? "" : flow.lines.join("<br>"));
      if (flow.alignment && flow.alignment !== "left") st.textAlign = flow.alignment;
      const fill = hexColor(attr(child(tcPr, "w:shd"), "w:fill"));
      if (fill) st.backgroundColor = fill;
      const va = val(tcPr, "w:vAlign");
      if (va === "center") st.verticalAlign = "middle";
      else if (va === "bottom") st.verticalAlign = "bottom";
      else if (va === "top") st.verticalAlign = "top";

      if (!uniform && !allNone) {
        const own = child(tcPr, "w:tcBorders");
        const lastRow = cell.row + cell.rowSpan >= nRows;
        const lastCol = cell.col + cell.span >= maxCol;
        const pick = (ownEl: Element | null, edge: string | null) => borderCss(ownEl) ?? edge ?? "none";
        st.borderTop = pick(child(own, "w:top"), cell.row === 0 ? outer.top : outer.insideH);
        st.borderBottom = pick(child(own, "w:bottom"), lastRow ? outer.bottom : outer.insideH);
        st.borderLeft = pick(side(own, "w:left", "w:start"), cell.col === 0 ? outer.left : outer.insideV);
        st.borderRight = pick(side(own, "w:right", "w:end"), lastCol ? outer.right : outer.insideV);
      }
      if (Object.keys(st).length) cellStyles[r]![j] = st;
    });
    content.push(out);
  });

  // Column widths in % of the grid.
  let widths = gridCols;
  if (widths.length === 0 || widths.every((w) => w === 0)) {
    widths = [];
    for (const cell of rows[0] ?? []) {
      const w = intAttr(path(cell.tc, "w:tcPr", "w:tcW"), "w:w") ?? 0;
      for (let k = 0; k < cell.span; k++) widths.push(w / cell.span);
    }
  }
  const total = widths.reduce((a, b) => a + b, 0);
  const columnWidths = total > 0 && widths.length === maxCol ? widths.map((w) => round((w / total) * 100, 2)) : [];

  // Table width.
  const tblW = child(tblPr, "w:tblW");
  const wType = attr(tblW, "w:type");
  const wVal = intAttr(tblW, "w:w") ?? 0;
  let width = "100%";
  if (wType === "pct" && wVal > 0) width = `${Math.min(100, round(wVal / 50, 1))}%`;
  else if (wType === "dxa" && wVal > 0) width = `${Math.min(100, round((twipsToPx(wVal) / ctx.contentWidth) * 100, 1))}%`;
  else if (total > 0 && gridCols.length) width = `${Math.min(100, round((twipsToPx(total) / ctx.contentWidth) * 100, 1))}%`;

  const jc = val(tblPr, "w:jc");
  const tableAlign = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : "left";

  const table: Record<string, unknown> = { width };
  if (uniform) {
    const [w, s, c] = uniform.split(" ");
    Object.assign(table, { borderWidth: w, borderStyle: s, borderColor: c });
  }

  return block(ctx, "table", {
    content,
    withHeading: headerRows.length > 0,
    headerRows,
    repeatHeader: headerRows.length > 0,
    hideBorders: allNone,
    columnWidths,
    rowHeights: rowHeights.some((h) => h > 0) ? rowHeights : [],
    tableAlign,
    styles: { table, rows: {}, cells: cellStyles },
  });
}

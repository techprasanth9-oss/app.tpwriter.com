import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../exporter";
import { cssBorder, cssLengthToTwips, evalFormula } from "./table";

async function documentXml(data: Record<string, unknown>): Promise<string> {
  const blob = await exportDocx({ blocks: [{ id: "t1", type: "table", data }] } as any);
  const zip = await JSZip.loadAsync(blob);
  return (await zip.file("word/document.xml")?.async("string")) ?? "";
}

const rowsOf = (xml: string) => [...xml.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>|<w:tr [^>]*>([\s\S]*?)<\/w:tr>/g)].map((m) => m[1] ?? m[2]!);
const cellsOf = (rowXml: string) => [...rowXml.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((m) => m[1]!);

describe("table export", () => {
  it("repeats leading header rows when repeatHeader is on", async () => {
    const xml = await documentXml({
      content: [["H1", "H2"], ["H3", "H4"], ["a", "b"]],
      headerRows: [0, 1],
      repeatHeader: true,
    });
    const rows = rowsOf(xml);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("<w:tblHeader/>");
    expect(rows[1]).toContain("<w:tblHeader/>");
    expect(rows[2]).not.toContain("tblHeader");
    // Header text is bold.
    expect(cellsOf(rows[0]!)[0]).toContain("<w:b/>");
  });

  it("does not repeat when repeatHeader is off (or legacy repeatHeaderOnPrint=false)", async () => {
    for (const flag of [{ repeatHeader: false }, { repeatHeaderOnPrint: false }]) {
      const xml = await documentXml({ content: [["H"], ["a"]], headerRows: [0], ...flag });
      expect(xml).not.toContain("tblHeader");
    }
  });

  it("exports merges as gridSpan and vMerge", async () => {
    const xml = await documentXml({
      content: [["merged", "C1"], ["C2"], ["A3", "B3", "C3"]],
      styles: { cells: { 0: { 0: { colSpan: 2, rowSpan: 2 } } } },
    });
    const rows = rowsOf(xml);
    expect(rows).toHaveLength(3);
    const r0 = cellsOf(rows[0]!);
    expect(r0).toHaveLength(2);
    expect(r0[0]).toContain('<w:gridSpan w:val="2"/>');
    expect(r0[0]).toContain('<w:vMerge w:val="restart"/>');
    const r1 = cellsOf(rows[1]!);
    expect(r1).toHaveLength(2);
    expect(r1[0]).toMatch(/<w:vMerge(?: w:val="continue")?\/>/);
    expect(r1[0]).toContain('<w:gridSpan w:val="2"/>');
    expect(r1[1]).toContain("C2");
    expect(cellsOf(rows[2]!)).toHaveLength(3);
    expect(xml.match(/<w:gridCol /g)).toHaveLength(3);
  });

  it("exports shading, borders, alignment, padding and colour", async () => {
    const xml = await documentXml({
      content: [["x", "y"]],
      styles: {
        rows: { 0: { backgroundColor: "rgb(0, 0, 255)" } },
        cells: {
          0: {
            0: {
              backgroundColor: "rgb(255, 0, 0)",
              borderTop: "2px dashed rgb(0, 128, 0)",
              borderBottom: "0px solid transparent",
              borderLeft: "none",
              textAlign: "center",
              verticalAlign: "bottom",
              paddingLeft: "8px",
              color: "#00ff00",
            },
          },
        },
      },
    });
    const [c0, c1] = cellsOf(rowsOf(xml)[0]!);
    expect(c0).toMatch(/<w:shd [^>]*w:fill="FF0000"/);
    expect(c1).toMatch(/<w:shd [^>]*w:fill="0000FF"/); // row colour fallback
    expect(c0).toMatch(/<w:top w:val="dashed" w:color="008000" w:sz="12"\/>|<w:top [^>]*w:val="dashed"[^>]*\/>/);
    expect(c0).toMatch(/<w:bottom [^>]*w:val="none"/);
    expect(c0).toMatch(/<w:left [^>]*w:val="none"/);
    expect(c0).toContain('<w:vAlign w:val="bottom"/>');
    expect(c0).toContain('<w:jc w:val="center"/>');
    expect(c0).toMatch(/<w:left w:w="120" w:type="dxa"\/>|<w:left [^>]*w:w="120"/);
    expect(c0).toContain('<w:color w:val="00FF00"/>');
    // Table-default border on the other cell.
    expect(c1).toMatch(/<w:top [^>]*w:val="single"[^>]*w:color="D1D5DB"|<w:top [^>]*w:color="D1D5DB"[^>]*w:val="single"/);
  });

  it("exports column widths, table width/alignment, row height and caption", async () => {
    const xml = await documentXml({
      content: [["a", "b"]],
      columnWidths: [25, 75],
      rowHeights: [40],
      tableAlign: "center",
      caption: "Revenue &amp; costs",
      captionPosition: "bottom",
      styles: { table: { width: "400px" } },
    });
    expect(xml).toContain('<w:gridCol w:w="1500"/>');
    expect(xml).toContain('<w:gridCol w:w="4500"/>');
    expect(xml).toMatch(/<w:tblW [^>]*w:w="6000"|<w:tblW w:type="dxa" w:w="6000"/);
    expect(xml).toMatch(/<w:tblPr>[\s\S]*<w:jc w:val="center"\/>[\s\S]*<\/w:tblPr>/);
    expect(xml).toMatch(/<w:trHeight [^>]*w:val="600"/);
    expect(xml).toContain("Revenue &amp; costs");
    expect(xml.indexOf("</w:tbl>")).toBeLessThan(xml.indexOf("Revenue"));
  });

  it("hides every border when hideBorders is set", async () => {
    const xml = await documentXml({ content: [["a"]], hideBorders: true });
    const cell = cellsOf(rowsOf(xml)[0]!)[0]!;
    for (const side of ["top", "left", "bottom", "right"]) expect(cell).toMatch(new RegExp(`<w:${side} [^>]*w:val="none"`));
  });

  it("exports a formula's value", async () => {
    const xml = await documentXml({ content: [["1", "2"], ["=SUM(A1:B1)", ""]] });
    expect(xml).toContain(">3<");
    expect(xml).not.toContain("SUM(");
  });

  it("keeps legacy withHeadings data working", async () => {
    const xml = await documentXml({ content: [["H"], ["a"]], withHeadings: true });
    expect(rowsOf(xml)[0]).toContain("<w:tblHeader/>");
  });

  it("helpers", () => {
    expect(cssLengthToTwips("10px")).toBe(150);
    expect(cssLengthToTwips("12pt")).toBe(240);
    expect(cssBorder("0", "solid", "#000").style).toBe("none");
    expect(cssBorder("1px", "double", "rgb(1, 2, 3)")).toEqual({ style: "double", size: 6, color: "010203" });
    expect(evalFormula("=AVG(A1:A2)", [["2"], ["4"]])).toBe(3);
  });
});

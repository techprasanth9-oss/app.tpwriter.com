import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../exporter";
import { latexForWord, rasterizeChart } from "./objects";
import { defaultChartData } from "../../charts/chartData";

async function documentXml(blocks: Array<{ type: string; data: Record<string, unknown> }>) {
  const blob = await exportDocx({ blocks: blocks.map((b, i) => ({ id: `b${i}`, ...b })) } as never);
  const zip = await JSZip.loadAsync(blob);
  return { xml: await zip.file("word/document.xml")!.async("string"), files: Object.keys(zip.files) };
}

describe("object blocks → DOCX", () => {
  it("exports an equation as Office Math with the LaTeX in a math run, centred when display", async () => {
    const { xml } = await documentXml([
      { type: "equation", data: { latex: "a^2 \\lt b", display: true } },
      { type: "equation", data: { latex: "x", display: false } },
      { type: "equation", data: { latex: "  " } },
    ]);
    expect(xml.match(/<m:oMath>/g)).toHaveLength(2);
    // `\\lt ` (how "<" is stored) maps back to the symbol.
    expect(xml).toContain("<m:t>a^2 &lt;b</m:t>");
    // The display equation's paragraph is centred, the inline one isn't.
    const paras = xml.split("<w:p>").filter((p) => p.includes("<m:oMath>"));
    expect(paras[0]).toContain('<w:jc w:val="center"/>');
    expect(paras[1]).not.toContain('<w:jc w:val="center"/>');
  });

  it("maps \\lt / \\gt back to symbols for Word's linear format", () => {
    expect(latexForWord("x\\lt y\\gt z \\left(")).toBe("x<y>z \\left(");
  });

  it("exports a text box as a shaded single-cell table with its runs", async () => {
    const { xml } = await documentXml([
      {
        type: "textBox",
        data: { text: "Hello <b>bold</b><br>next", preset: "info", width: 75, align: "right" },
      },
    ]);
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
    expect(xml.match(/<w:tc>/g)).toHaveLength(1);
    expect(xml).toContain('w:fill="DDF4FF"');
    expect(xml).toContain('w:color="54AEFF"');
    // Percent widths are in fiftieths of a percent.
    expect(xml).toContain('<w:tblW w:type="pct" w:w="3750"/>');
    expect(xml).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain("bold");
    expect(xml).toContain("<w:br/>");
  });

  it("falls back to a data table with a caption for charts when there's no canvas (jsdom)", async () => {
    expect(await rasterizeChart(defaultChartData())).toBeNull();
    const { xml, files } = await documentXml([{ type: "chart", data: defaultChartData() as never }]);
    expect(files.some((f) => f.startsWith("word/media/"))).toBe(false);
    expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
    // Header + 4 rows.
    expect(xml.match(/<w:tr>|<w:tr /g)).toHaveLength(5);
    for (const text of ["2025", "2026", "Q1", "Q4", "26"]) expect(xml).toContain(`>${text}</w:t>`);
    expect(xml).toContain(">Quarterly sales</w:t>");
  });

  it("cleans hostile chart / text box data on export", async () => {
    const { xml } = await documentXml([
      { type: "chart", data: { type: "pie", title: 7, labels: ["a", "b"], series: [{ name: "s", values: [NaN, 3] }] } },
      { type: "textBox", data: { text: "x", preset: "evil", width: 5000, align: "up" } },
    ]);
    expect(xml).toContain('w:fill="FFF8C5"'); // note preset
    // Width clamped to 100%, bad alignment → centre.
    expect(xml).toContain('<w:tblW w:type="pct" w:w="5000"/><w:jc w:val="center"/>');
    expect(xml).toContain(">0</w:t>");
  });
});

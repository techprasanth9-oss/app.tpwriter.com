import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../exporter";
import { resolveStyles } from "../../styles/namedStyles";

async function documentXml(blocks: unknown[], opts = {}) {
  const blob = await exportDocx({ time: 1, version: "2.31", blocks: blocks as never }, opts);
  const zip = await JSZip.loadAsync(blob);
  return {
    doc: await zip.file("word/document.xml")!.async("string"),
    styles: await zip.file("word/styles.xml")!.async("string"),
  };
}

const eq = (latex: string) => ({ id: "e", type: "equation", data: { latex, display: true } });

describe("LaTeX → Office Math", () => {
  it("builds real fractions, roots, sums and scripts", async () => {
    const { doc } = await documentXml([eq("\\frac{a+b}{c} + \\sqrt{x^2} + \\sum_{i=1}^{n} i^{2} + x_1")]);
    expect(doc).toContain("<m:f>");
    expect(doc).toContain("<m:rad>");
    expect(doc).toContain("<m:nary>");
    expect(doc).toContain("<m:sSup>");
    expect(doc).toContain("<m:sSub>");
    expect(doc).not.toContain("\\frac");
  });

  it("maps Greek letters and operators, keeps \\lt as <", async () => {
    const { doc } = await documentXml([eq("\\alpha \\times \\beta \\leq \\pi, a \\lt b")]);
    for (const ch of ["α", "×", "β", "≤", "π", "&lt;"]) expect(doc).toContain(ch);
  });

  it("keeps unknown commands literally instead of dropping them", async () => {
    const { doc } = await documentXml([eq("\\weird{x} + 1")]);
    expect(doc).toContain("\\weird");
  });
});

describe("named styles and paragraph formatting", () => {
  it("writes Title/Subtitle/Quote styles, line spacing and the document's styles", async () => {
    const styles = resolveStyles({ normal: { fontFamily: "Georgia, serif", fontSize: 18 } });
    const { doc, styles: xml } = await documentXml(
      [
        { id: "t", type: "paragraph", data: { text: "T" }, tunes: { format: { styleId: "title" } } },
        { id: "s", type: "paragraph", data: { text: "S" }, tunes: { format: { styleId: "subtitle", lineHeight: 1.5 } } },
        { id: "q", type: "paragraph", data: { text: "Q" }, tunes: { format: { styleId: "quote" } } },
      ],
      { styles },
    );
    expect(doc).toContain('<w:pStyle w:val="Title"/>');
    expect(doc).toContain('<w:pStyle w:val="Subtitle"/>');
    expect(doc).toContain('<w:pStyle w:val="Quote"/>');
    expect(doc).toMatch(/w:line="360"/);
    expect(xml).toContain('w:styleId="Subtitle"');
    expect(xml).toContain('w:styleId="Quote"');
    expect(xml).toContain('w:ascii="Georgia"');
    expect(xml).toContain('<w:sz w:val="27"/>'); // 18px = 13.5pt
  });
});

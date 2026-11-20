import { describe, expect, it } from "vitest";
import { sanitizeEditorData } from "../../sanitizeData";
import { importDocxFile } from "./index";
import { buildDocx, p, pStyle, r, relXml, stylesXml } from "./testDocx";

const imp = async (body: string, extra: Parameters<typeof buildDocx>[0] extends infer S ? Partial<S> : never = {}) =>
  importDocxFile(await buildDocx({ body, ...extra }));

const text = (b: { data: Record<string, unknown> }) => String(b.data.text);

describe("runs", () => {
  it("maps character formatting to sanitizer-safe tags and spans", async () => {
    const out = await imp(
      p(
        r("B", "<w:b/>") +
          r("I", "<w:i/>") +
          r("U", '<w:u w:val="single"/>') +
          r("S", "<w:strike/>") +
          r("D", "<w:dstrike/>") +
          r("2", '<w:vertAlign w:val="superscript"/>') +
          r("o", '<w:vertAlign w:val="subscript"/>') +
          r("C", '<w:color w:val="FF0000"/>') +
          r("H", '<w:highlight w:val="yellow"/>') +
          r("Sh", '<w:shd w:val="clear" w:fill="00FF00"/>') +
          r("F", '<w:rFonts w:ascii="Times New Roman"/><w:sz w:val="28"/>'),
      ),
    );
    const html = text(out.blocks[0]!);
    expect(html).toContain("<b>B</b>");
    expect(html).toContain("<i>I</i>");
    expect(html).toContain("<u>U</u>");
    expect(html).toContain("<s>SD</s>"); // strike + dstrike merge
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain("<sub>o</sub>");
    expect(html).toContain('<span style="color: #ff0000">C</span>');
    expect(html).toContain('<span style="background-color: #ffff00">H</span>');
    expect(html).toContain('<span style="background-color: #00ff00">Sh</span>');
    expect(html).toMatch(/<span style="font-family: 'Times New Roman', Times, serif; font-size: 14pt">F<\/span>/);
    expect(sanitizeEditorData(out.blocks)).toEqual(out.blocks);
  });

  it("merges neighbouring runs with identical formatting", async () => {
    const out = await imp(p(r("Hel", "<w:b/>") + r("lo", "<w:b/>") + r(" world")));
    expect(text(out.blocks[0]!)).toBe("<b>Hello</b> world");
  });

  it("escapes text: script tags and entities stay text", async () => {
    const out = await imp(p(r("&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt; a &amp; b")));
    const html = text(out.blocks[0]!);
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("a &amp; b");
  });

  it("external hyperlinks via rels, internal anchors, unsafe schemes dropped", async () => {
    const out = await imp(
      p(
        '<w:hyperlink r:id="rIdA"><w:r><w:t>ext</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink w:anchor="sec1"><w:r><w:t>int</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink r:id="rIdJ"><w:r><w:t>bad</w:t></w:r></w:hyperlink>' +
          '<w:hyperlink r:id="rIdQ"><w:r><w:t>quote</w:t></w:r></w:hyperlink>',
      ),
      {
        rels:
          relXml("rIdA", "hyperlink", "https://example.com/a?x=1&amp;y=2", true) +
          relXml("rIdJ", "hyperlink", "javascript:alert(1)", true) +
          relXml("rIdQ", "hyperlink", 'https://e.com/&quot;onmouseover=&quot;x', true),
      },
    );
    const html = text(out.blocks[0]!);
    expect(html).toContain('<a href="https://example.com/a?x=1&amp;y=2">ext</a>');
    expect(html).toContain('<a href="#sec1">int</a>');
    expect(html).not.toMatch(/javascript/i);
    expect(html).toContain("bad");
    expect(html).not.toMatch(/onmouseover="/);
    expect(out.warnings.join()).toMatch(/unsafe/);
  });

  it("line breaks, tabs, symbols, soft hyphens, caps, hidden text", async () => {
    const out = await imp(
      p(
        '<w:r><w:t>a</w:t><w:br/><w:t>b</w:t><w:tab/><w:t>c</w:t></w:r>' +
          '<w:r><w:sym w:font="Symbol" w:char="F061"/></w:r>' +
          "<w:r><w:t>co</w:t><w:softHyphen/><w:t>op</w:t></w:r>" +
          r("caps", "<w:caps/>") +
          r("HIDDEN", "<w:vanish/>"),
      ),
    );
    const html = text(out.blocks[0]!);
    expect(html).toContain("a<br>b");
    expect(html).toMatch(/b(&nbsp;)+ c/);
    expect(html).toContain("α");
    expect(html).toContain("co­op");
    expect(html).toContain("CAPS");
    expect(html).not.toContain("HIDDEN");
  });

  it("a page break run splits the paragraph", async () => {
    const out = await imp(p(r("before") + '<w:r><w:br w:type="page"/></w:r>' + r("after")));
    expect(out.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(text(out.blocks[0]!)).toBe("before");
    expect(text(out.blocks[2]!)).toBe("after");
  });

  it("only-a-page-break paragraph is just a pageBreak", async () => {
    const out = await imp(p(r("one")) + p('<w:r><w:br w:type="page"/></w:r>') + p(r("two")));
    expect(out.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("tracked insertions are accepted, deletions dropped", async () => {
    const out = await imp(
      p(r("keep ") + '<w:ins w:id="1"><w:r><w:t>new</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>old</w:delText></w:r></w:del>'),
    );
    expect(text(out.blocks[0]!)).toBe("keep new");
    expect(out.warnings.join()).toMatch(/Tracked changes/);
  });

  it("keeps runs of spaces", async () => {
    const out = await imp(p(r("a   b")));
    expect(text(out.blocks[0]!)).toBe("a&nbsp;&nbsp; b");
  });
});

describe("paragraphs", () => {
  it("jc, indentation, spacing, line spacing → format tune", async () => {
    const out = await imp(
      p(r("x"), '<w:jc w:val="both"/><w:ind w:left="1200"/><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>') +
        p(r("c"), '<w:jc w:val="center"/>') +
        p(r("e"), '<w:spacing w:line="480" w:lineRule="exact"/>'),
    );
    expect(out.blocks[0]!.tunes).toEqual({
      format: { alignment: "justify", indent: 2, spaceBefore: 16, spaceAfter: 8, lineHeight: 1.5 },
    });
    expect(out.blocks[1]!.tunes).toEqual({ format: { alignment: "center" } });
    // 24pt exact line on the default 11pt font.
    expect((out.blocks[2]!.tunes as { format: { lineHeight: number } }).format.lineHeight).toBeCloseTo(2.18, 2);
  });

  it("keeps empty paragraphs", async () => {
    const out = await imp(p(r("a")) + "<w:p/>" + p(r("b")));
    expect(out.blocks.map((b) => text(b))).toEqual(["a", "", "b"]);
  });

  it("pageBreakBefore puts the break BEFORE the paragraph", async () => {
    const out = await imp(p(r("one")) + p(r("two"), "<w:pageBreakBefore/>"));
    expect(out.blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
    expect(text(out.blocks[2]!)).toBe("two");
  });

  it("does not pick up a nested pPr from a text box inside the paragraph", async () => {
    const out = await imp(
      p(
        r("outer") +
          `<w:r><w:pict><v:shape style="width:200pt;height:50pt"><v:textbox><w:txbxContent>${p(r("inner"), '<w:jc w:val="right"/>')}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`,
      ),
    );
    const para = out.blocks.find((b) => b.type === "paragraph")!;
    expect(para.tunes).toBeUndefined();
    expect(out.blocks.find((b) => b.type === "textBox")!.data.text).toBe("inner");
  });
});

describe("styles", () => {
  const styles = stylesXml(
    pStyle("Normal", "Normal", '<w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr>', { isDefault: true }) +
      pStyle("berschrift1", "heading 1", '<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="480"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr>', { basedOn: "Normal" }) +
      pStyle("H2", "heading 2", '<w:rPr><w:b/><w:sz w:val="26"/></w:rPr>', { basedOn: "Normal" }) +
      pStyle("H6", "heading 6", "", { basedOn: "Normal" }) +
      pStyle("Titel", "Title", '<w:rPr><w:sz w:val="56"/></w:rPr>', { basedOn: "Normal" }) +
      pStyle("Zitat", "Intense Quote", '<w:rPr><w:i/></w:rPr>', { basedOn: "Normal" }) +
      pStyle("MyHead", "Fancy", "", { basedOn: "H2" }) +
      pStyle("Outline", "Custom Outline", '<w:pPr><w:outlineLvl w:val="2"/></w:pPr>', { basedOn: "Normal" }) +
      pStyle("Body", "Body Text", '<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>', { basedOn: "Normal" }) +
      pStyle("Emph", "Strong Emphasis", '<w:rPr><w:b/><w:color w:val="C00000"/></w:rPr>', { type: "character" }),
    '<w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>',
  );

  it("maps by style NAME (localised ids), outline level and basedOn", async () => {
    const out = await imp(
      p(r("H1"), '<w:pStyle w:val="berschrift1"/>') +
        p(r("H2"), '<w:pStyle w:val="H2"/>') +
        p(r("H6"), '<w:pStyle w:val="H6"/>') +
        p(r("T"), '<w:pStyle w:val="Titel"/>') +
        p(r("Q"), '<w:pStyle w:val="Zitat"/>') +
        p(r("F"), '<w:pStyle w:val="MyHead"/>') +
        p(r("O"), '<w:pStyle w:val="Outline"/>') +
        p(r("N")),
      { styles },
    );
    const b = out.blocks;
    expect(b[0]).toMatchObject({ type: "header", data: { text: "H1", level: 1 } });
    expect(b[1]).toMatchObject({ type: "header", data: { text: "H2", level: 2 } });
    expect(b[2]).toMatchObject({ type: "header", data: { level: 4 } });
    expect(b[3]).toMatchObject({ type: "paragraph", tunes: { format: { styleId: "title" } } });
    expect(b[4]).toMatchObject({ type: "paragraph", tunes: { format: { styleId: "quote" } } });
    expect(b[5]).toMatchObject({ type: "header", data: { level: 2 } });
    expect(b[6]).toMatchObject({ type: "header", data: { level: 3 } });
    expect(b[7]).toMatchObject({ type: "paragraph", data: { text: "N" } });
    expect(b[7]!.tunes).toBeUndefined();
    expect(out.warnings.join()).toMatch(/5–9/);
    // Heading text isn't wrapped in <b> / colour spans the style provides.
    expect(b[0]!.data.text).toBe("H1");
  });

  it("derives named-style overrides from docDefaults + basedOn", async () => {
    const out = await imp(p(r("x")), { styles });
    expect(out.styles.normal).toMatchObject({
      fontFamily: "Calibri, Carlito, sans-serif",
      fontSize: 14.7,
      lineHeight: 1.08,
      spaceAfter: 11,
      fontWeight: 400,
    });
    expect(out.styles.heading1).toMatchObject({ fontSize: 21.3, fontWeight: 700, color: "#2f5496", spaceBefore: 32 });
    expect(out.styles.title).toMatchObject({ fontSize: 37.3, fontWeight: 400 });
    expect(out.styles.quote).toMatchObject({ italic: true });
    expect(out.styles.subtitle).toBeUndefined();
  });

  it("emits inline formatting only where it differs from the paragraph's style", async () => {
    const out = await imp(
      p(r("plain") + r("bold", "<w:b/>"), '<w:pStyle w:val="berschrift1"/>') +
        p(r("notbold", '<w:b w:val="0"/>'), '<w:pStyle w:val="berschrift1"/>') +
        p(r("arial"), '<w:pStyle w:val="Body"/>') +
        p(r("strong", '<w:rStyle w:val="Emph"/>')),
      { styles },
    );
    expect(out.blocks[0]!.data.text).toBe("plainbold");
    expect(out.blocks[1]!.data.text).toBe('<span style="font-weight: normal">notbold</span>');
    expect(out.blocks[2]!.data.text).toBe('<span style="font-family: Arial, Helvetica, sans-serif">arial</span>');
    expect(out.blocks[3]!.data.text).toBe('<span style="color: #c00000"><b>strong</b></span>');
  });

  it("recognises localised style names and follows basedOn for them", async () => {
    const out = await imp(
      p(r("T"), '<w:pStyle w:val="Titel"/>') + p(r("Q"), '<w:pStyle w:val="Zitat"/>') + p(r("D"), '<w:pStyle w:val="Derived"/>'),
      {
        styles: stylesXml(
          pStyle("Normal", "Normal", "", { isDefault: true }) +
            pStyle("Titel", "Titel", "", { basedOn: "Normal" }) +
            pStyle("Zitat", "Zitat", "", { basedOn: "Normal" }) +
            pStyle("Derived", "My Quote", "", { basedOn: "Zitat" }),
        ),
      },
    );
    expect(out.blocks.map((b) => (b.tunes as { format?: { styleId?: string } })?.format?.styleId)).toEqual(["title", "quote", "quote"]);
  });

  it("theme fonts resolve through asciiTheme", async () => {
    const theme = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme name="x"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
    const out = await imp(p(r("x")), {
      theme,
      styles: stylesXml(pStyle("Normal", "Normal", "", { isDefault: true }), '<w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault>'),
    });
    expect(out.styles.normal?.fontFamily).toBe("Verdana, Geneva, sans-serif");
  });
});

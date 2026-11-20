import { describe, expect, it } from "vitest";
import { sanitizeEditorData } from "../../sanitizeData";
import { importDocxFile } from "./index";
import { ommlToLatex } from "./math";
import { parseXml } from "./xml";
import { buildDocx, NS, p, PNG_1x1, r, relXml, type DocxSpec } from "./testDocx";

const imp = async (body: string, extra: Partial<DocxSpec> = {}) => importDocxFile(await buildDocx({ body, ...extra }));

const abstract = (id: string, levels: Array<[string, string?]>) =>
  `<w:abstractNum w:abstractNumId="${id}">${levels
    .map(([fmt, text], i) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text ?? `%${i + 1}.`}"/></w:lvl>`)
    .join("")}</w:abstractNum>`;
const li = (text: string, numId: string, ilvl = 0) =>
  p(r(text), `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`);

describe("lists", () => {
  const numbering =
    abstract("0", [["bullet", "•"], ["bullet", "o"]]) +
    abstract("1", [["decimal"], ["lowerLetter"]]) +
    abstract("2", [["upperRoman"]]) +
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' + // ordered, NOT a bullet despite numId 1
    '<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>' +
    '<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>';

  it("builds one nested list block per run of the same numId", async () => {
    const out = await imp(li("one", "1") + li("one-a", "1", 1) + li("two", "1") + li("b1", "2") + li("b1.1", "2", 1), { numbering });
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0]!.data).toEqual({
      style: "ordered",
      meta: { counterType: "numeric" },
      items: [
        { content: "one", meta: {}, items: [{ content: "one-a", meta: {}, items: [] }] },
        { content: "two", meta: {}, items: [] },
      ],
    });
    expect(out.blocks[1]!.data).toMatchObject({ style: "unordered", items: [{ content: "b1", items: [{ content: "b1.1" }] }] });
  });

  it("restarts and continuations carry meta.start", async () => {
    const out = await imp(li("a", "1") + li("b", "1") + p(r("break")) + li("c", "1") + li("five", "3") + li("I", "4"), { numbering });
    expect(out.blocks.map((b) => b.type)).toEqual(["list", "paragraph", "list", "list", "list"]);
    expect((out.blocks[2]!.data.meta as { start?: number }).start).toBe(3);
    expect((out.blocks[3]!.data.meta as { start?: number }).start).toBe(5);
    expect(out.blocks[4]!.data.meta).toEqual({ counterType: "upper-roman" });
  });

  it("numId 0 is not a list", async () => {
    const out = await imp(li("plain", "0"), { numbering });
    expect(out.blocks[0]!.type).toBe("paragraph");
  });
});

describe("tables", () => {
  const tc = (text: string, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${p(r(text))}</w:tc>`;

  it("grid widths, spans, merges, shading, borders, header rows", async () => {
    const tbl = `<w:tbl><w:tblPr><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="FF0000"/><w:bottom w:val="single" w:sz="8" w:color="FF0000"/><w:left w:val="single" w:sz="8" w:color="FF0000"/><w:right w:val="single" w:sz="8" w:color="FF0000"/><w:insideH w:val="single" w:sz="8" w:color="FF0000"/><w:insideV w:val="single" w:sz="8" w:color="FF0000"/></w:tblBorders></w:tblPr>
      <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/></w:trPr>${tc("H1", '<w:shd w:val="clear" w:fill="DDEEFF"/>')}${tc("H2", '<w:gridSpan w:val="2"/>')}</w:tr>
      <w:tr>${tc("A", '<w:vMerge w:val="restart"/><w:vAlign w:val="center"/>')}${tc("B")}${`<w:tc>${p(r("C"), '<w:jc w:val="right"/>')}</w:tc>`}</w:tr>
      <w:tr>${tc("", "<w:vMerge/>")}${tc("D")}${tc("E")}</w:tr>
    </w:tbl>`;
    const out = await imp(tbl);
    const t = out.blocks[0]!;
    expect(t.type).toBe("table");
    const d = t.data as Record<string, any>;
    expect(d.content).toEqual([["H1", "H2"], ["A", "B", "C"], ["D", "E"]]);
    expect(d.columnWidths).toEqual([50, 25, 25]);
    expect(d.headerRows).toEqual([0]);
    expect(d.withHeading).toBe(true);
    expect(d.repeatHeader).toBe(true);
    expect(d.tableAlign).toBe("center");
    expect(d.styles.table).toMatchObject({ borderWidth: "1px", borderStyle: "solid", borderColor: "#ff0000" });
    expect(d.styles.cells[0][0]).toEqual({ backgroundColor: "#ddeeff" });
    expect(d.styles.cells[0][1]).toEqual({ colSpan: 2 });
    expect(d.styles.cells[1][0]).toEqual({ rowSpan: 2, verticalAlign: "middle" });
    expect(d.styles.cells[1][2]).toEqual({ textAlign: "right" });
  });

  it("a row fully covered by a vertical merge is []", async () => {
    const out = await imp(
      `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr>${tc("A", '<w:vMerge w:val="restart"/>')}</w:tr><w:tr>${tc("", "<w:vMerge/>")}</w:tr></w:tbl>`,
    );
    expect((out.blocks[0]!.data as any).content).toEqual([["A"], []]);
  });

  it("per-cell borders, nil borders hide the table, multi-paragraph cells, nested tables, images", async () => {
    const out = await imp(
      `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>
        <w:tr><w:tc>${p(r("line 1"))}${p(r("line 2", "<w:b/>"))}<w:tbl><w:tr>${tc("n1")}${tc("n2")}</w:tr></w:tbl></w:tc></w:tr></w:tbl>` +
        `<w:tbl><w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcBorders><w:top w:val="double" w:sz="12" w:color="00FF00"/></w:tcBorders></w:tcPr>${p(r("x"))}</w:tc></w:tr></w:tbl>`,
    );
    const a = out.blocks[0]!.data as any;
    expect(a.hideBorders).toBe(true);
    expect(a.content[0][0]).toBe("line 1<br><b>line 2</b><br>n1 | n2");
    const b = out.blocks[1]!.data as any;
    expect(b.styles.cells[0][0].borderTop).toBe("2px double #00ff00");
    expect(out.warnings.join()).toMatch(/Nested tables/);
  });
});

const IMG_RELS = relXml("rIdImg1", "image", "media/image1.png") + relXml("rIdImg10", "image", "media/image10.png");

function inlinePic(rid: string, opts: { cx?: number; cy?: number; descr?: string; srcRect?: string } = {}) {
  return `<w:r><w:drawing><wp:inline><wp:extent cx="${opts.cx ?? 952500}" cy="${opts.cy ?? 476250}"/><wp:docPr id="1" name="Picture 1" descr="${opts.descr ?? ""}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/>${opts.srcRect ?? ""}</pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function anchorPic(rid: string, wrap: string, posH: string) {
  return `<w:r><w:drawing><wp:anchor behindDoc="0" distL="114300" distR="114300"><wp:positionH relativeFrom="column">${posH}</wp:positionH><wp:extent cx="952500" cy="952500"/>${wrap}<wp:docPr id="2" name="P"/><a:graphic><a:graphicData uri="x"><pic:pic><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

describe("drawings", () => {
  const files = { "word/media/image1.png": PNG_1x1, "word/media/image10.png": new Uint8Array([1, 2, 3]) };

  it("inline image: exact media match, size, alt text, crop, data URL", async () => {
    const out = await imp(
      p(inlinePic("rIdImg1", { descr: "A &quot;cat&quot; &lt;pic&gt;", srcRect: '<a:srcRect l="10000" r="10000"/>' }), '<w:jc w:val="center"/>'),
      { rels: IMG_RELS, files },
    );
    const img = out.blocks.find((b) => b.type === "image")!;
    const d = img.data as any;
    expect(d.file.url).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(d.dimensions).toEqual({ width: "125px", height: "50px" });
    expect(d.crop).toEqual({ top: 0, right: 10, bottom: 0, left: 10 });
    expect(d.altText).toBe('A "cat" pic');
    expect(d.tunes.imageTune.wrapText).toBe("top-bottom");
    expect(img.tunes).toEqual({ alignment: { alignment: "center" } });
    expect(sanitizeEditorData(out.blocks)).toEqual(out.blocks);
  });

  it("never matches image1 for image10 (unsupported image10 is skipped)", async () => {
    const out = await imp(p(inlinePic("rIdImg10")), { rels: IMG_RELS, files });
    expect(out.blocks.some((b) => b.type === "image")).toBe(false);
    expect(out.warnings.join()).toMatch(/unsupported format/);
  });

  it("anchored wrapping: square → float side, top-bottom, behind → warning", async () => {
    const out = await imp(
      p(anchorPic("rIdImg1", '<wp:wrapSquare wrapText="bothSides"/>', "<wp:align>right</wp:align>") + r("text")) +
        p(anchorPic("rIdImg1", "<wp:wrapTight/>", "<wp:posOffset>0</wp:posOffset>")) +
        p(anchorPic("rIdImg1", "<wp:wrapTopAndBottom/>", "<wp:align>center</wp:align>")) +
        p(anchorPic("rIdImg1", "<wp:wrapNone/>", "<wp:align>left</wp:align>")),
      { rels: IMG_RELS, files },
    );
    const imgs = out.blocks.filter((b) => b.type === "image").map((b) => (b.data as any).tunes.imageTune);
    expect(imgs[0]).toMatchObject({ wrapText: "square", float: "right", marginLeft: "12px" });
    expect(imgs[1]).toMatchObject({ wrapText: "tight", float: "left" });
    expect(imgs[2]).toMatchObject({ wrapText: "top-bottom" });
    expect(imgs[3]).toMatchObject({ wrapText: "top-bottom" });
    // The float comes before the paragraph it's anchored in.
    expect(out.blocks[0]!.type).toBe("image");
    expect(out.blocks[1]).toMatchObject({ type: "paragraph", data: { text: "text" } });
    expect(out.warnings.join()).toMatch(/in front of text/);
  });

  it("text boxes → textBox blocks (plain preset)", async () => {
    const box = `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH><wp:extent cx="2857500" cy="952500"/><wp:wrapSquare/><wp:docPr id="3" name="Text Box 3"/><a:graphic><a:graphicData uri="x"><wps:wsp><wps:txbx><w:txbxContent>${p(r("Boxed &lt;b&gt;", "<w:b/>"))}${p(r("two"))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>${p(r("fallback"))}</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const out = await imp(p(box));
    const tb = out.blocks.find((b) => b.type === "textBox")!;
    expect(tb.data).toEqual({ text: "<b>Boxed &lt;b&gt;</b><br>two", preset: "plain", width: 50, align: "center" });
    expect(JSON.stringify(out.blocks)).not.toContain("fallback");
  });

  it("images in table cells become [image]", async () => {
    const out = await imp(`<w:tbl><w:tr><w:tc>${p(inlinePic("rIdImg1"))}</w:tc></w:tr></w:tbl>`, { rels: IMG_RELS, files });
    expect((out.blocks[0]!.data as any).content[0][0]).toBe("[image]");
    expect(out.warnings.join()).toMatch(/\[image\]/);
  });
});

describe("math", () => {
  const conv = (xml: string) => ommlToLatex(parseXml(`<m:oMath ${NS}>${xml}</m:oMath>`)!.root);
  const mr = (t: string) => `<m:r><m:t>${t}</m:t></m:r>`;

  it("converts the common OMML structures", () => {
    expect(conv(`<m:f><m:num>${mr("a")}</m:num><m:den>${mr("b")}</m:den></m:f>`)).toBe("\\frac{a}{b}");
    expect(conv(`<m:sSup><m:e>${mr("x")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup>`)).toBe("x^{2}");
    expect(conv(`<m:sSub><m:e>${mr("x")}</m:e><m:sub>${mr("i")}</m:sub></m:sSub>`)).toBe("x_{i}");
    expect(conv(`<m:sSubSup><m:e>${mr("x")}</m:e><m:sub>${mr("i")}</m:sub><m:sup>${mr("2")}</m:sup></m:sSubSup>`)).toBe("x_{i}^{2}");
    expect(conv(`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mr("x")}</m:e></m:rad>`)).toBe("\\sqrt{x}");
    expect(conv(`<m:rad><m:deg>${mr("3")}</m:deg><m:e>${mr("x")}</m:e></m:rad>`)).toBe("\\sqrt[3]{x}");
    expect(
      conv(`<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub>${mr("i=1")}</m:sub><m:sup>${mr("n")}</m:sup><m:e>${mr("i")}</m:e></m:nary>`),
    ).toBe("\\sum_{i=1}^{n} i");
    expect(conv(`<m:nary><m:sub>${mr("0")}</m:sub><m:sup>${mr("1")}</m:sup><m:e>${mr("f")}</m:e></m:nary>`)).toBe("\\int_{0}^{1} f");
    expect(conv(`<m:d><m:e>${mr("a+b")}</m:e></m:d>`)).toBe("\\left(a+b\\right)");
    expect(conv(`<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e>${mr("x")}</m:e></m:d>`)).toBe("\\left[x\\right]");
    expect(conv(`<m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e>${mr("x")}</m:e></m:func>`)).toBe("\\sin{x}");
    expect(conv(`<m:acc><m:e>${mr("a")}</m:e></m:acc>`)).toBe("\\hat{a}");
    expect(conv(`<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${mr("z")}</m:e></m:bar>`)).toBe("\\overline{z}");
    expect(conv(mr("α+β≤∞"))).toBe("\\alpha +\\beta \\le \\infty");
  });

  it("unknown elements keep their text and warn", () => {
    const warnings: string[] = [];
    const out = ommlToLatex(parseXml(`<m:oMath ${NS}><m:weird>${mr("q")}</m:weird></m:oMath>`)!.root, (w) => warnings.push(w));
    expect(out).toBe("q");
    expect(warnings[0]).toMatch(/not supported/);
  });

  it("oMathPara → display equation block (< stored as \\lt); inline math → LaTeX text", async () => {
    const out = await imp(
      p(`<m:oMathPara><m:oMath>${mr("a&lt;b")}</m:oMath></m:oMathPara>`) +
        p(r("where ") + `<m:oMath><m:sSup><m:e>${mr("x")}</m:e><m:sup>${mr("2")}</m:sup></m:sSup></m:oMath>`),
    );
    expect(out.blocks[0]).toMatchObject({ type: "equation", data: { latex: "a\\lt b", display: true } });
    expect(out.blocks[1]!.data.text).toBe("where $x^{2}$");
    expect(out.warnings.join()).toMatch(/Inline equations/);
  });
});

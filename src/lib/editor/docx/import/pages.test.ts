import { describe, expect, it, vi } from "vitest";
import { sanitizeEditorData } from "../../sanitizeData";
import { importDocxFile } from "./index";
import { buildDocx, NS, p, PNG_1x1, r, relsFile, relXml, type DocxSpec } from "./testDocx";

const imp = async (body: string, extra: Partial<DocxSpec> = {}) => importDocxFile(await buildDocx({ body, ...extra }));

const A4 = '<w:pgSz w:w="11906" w:h="16838"/>';
const LETTER_L = '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>';
const mar = (t: number) => `<w:pgMar w:top="${t}" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="600"/>`;

describe("sections + page setup", () => {
  it("sectPr in a paragraph ends ITS section; the break carries the NEXT layout", async () => {
    const out = await imp(
      p(r("s1")) +
        p(r("s1 end"), `<w:sectPr>${A4}${mar(1440)}</w:sectPr>`) +
        p(r("s2"), "") +
        p("", `<w:sectPr><w:type w:val="continuous"/>${LETTER_L}${mar(720)}</w:sectPr>`) +
        p(r("s3")) +
        `<w:sectPr>${A4}${mar(2880)}</w:sectPr>`,
    );
    expect(out.defaultLayout).toEqual({
      paperSize: "A4",
      orientation: "portrait",
      marginTop: 96,
      marginRight: 96,
      marginBottom: 96,
      marginLeft: 96,
    });
    const types = out.blocks.map((b) => b.type);
    expect(types).toEqual(["paragraph", "paragraph", "sectionBreak", "paragraph", "paragraph", "sectionBreak", "paragraph"]);
    expect(out.blocks[2]!.data.layout).toMatchObject({ paperSize: "LETTER", orientation: "landscape", marginTop: 48 });
    expect(out.blocks[5]!.data.layout).toMatchObject({ paperSize: "A4", orientation: "portrait", marginTop: 192 });
    expect(out.pageSetup.headerDistance).toBe(48);
    expect(out.pageSetup.footerDistance).toBe(40);
    // Section 2's sectPr says it starts continuously.
    expect(out.warnings.join()).toMatch(/Continuous/);
  });

  it("continuous breaks warn; odd paper sizes snap with a warning", async () => {
    const out = await imp(
      p(r("a"), `<w:sectPr>${A4}</w:sectPr>`) + p(r("b")) + `<w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="10000" w:h="14000"/></w:sectPr>`,
    );
    expect(out.blocks[1]!.type).toBe("sectionBreak");
    expect(out.warnings.join()).toMatch(/Continuous section breaks/);
    expect(out.warnings.join()).toMatch(/Paper size .* isn't supported/);
  });

  it("page colour and page borders", async () => {
    const out = await imp(
      p(r("x")) + `<w:sectPr>${A4}<w:pgBorders><w:top w:val="double" w:sz="12" w:color="FF0000"/></w:pgBorders></w:sectPr>`,
      { beforeBody: '<w:background w:color="FFFFCC"/>' },
    );
    expect(out.pageSetup.pageColor).toBe("#ffffcc");
    expect(out.pageSetup.pageBorder).toEqual({ style: "double", width: 2, color: "#ff0000" });
  });
});

const header = (inner: string) => `<w:hdr ${NS}>${inner}</w:hdr>`;
const footer = (inner: string) => `<w:ftr ${NS}>${inner}</w:ftr>`;

describe("headers / footers + fields", () => {
  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rH1"/><w:headerReference w:type="first" r:id="rH2"/><w:footerReference w:type="default" r:id="rF1"/><w:footerReference w:type="even" r:id="rF2"/><w:titlePg/>${A4}</w:sectPr>`;
  const rels =
    relXml("rH1", "header", "header1.xml") +
    relXml("rH2", "header", "header2.xml") +
    relXml("rF1", "footer", "footer1.xml") +
    relXml("rF2", "footer", "footer2.xml") +
    relXml("rH3", "header", "header3.xml");
  const pageField = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const files = {
    "word/header1.xml": header(
      p(r("Report ") + '<w:fldSimple w:instr=" TITLE "><w:r><w:t>cached</w:t></w:r></w:fldSimple>') +
        p(
          `<w:r><w:pict><v:shape id="PowerPlusWaterMarkObject1" fillcolor="silver"><v:fill opacity=".5"/><v:textpath string="CONFIDENTIAL"/></v:shape></w:pict></w:r>`,
        ),
    ),
    "word/header2.xml": header(p(r("First page") + '<w:r><w:drawing><wp:inline><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="logo"/><a:graphic><a:graphicData uri="x"><pic:pic><pic:blipFill><a:blip r:embed="rLogo"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')),
    "word/_rels/header2.xml.rels": relsFile(relXml("rLogo", "image", "media/logo.png")),
    "word/media/logo.png": PNG_1x1,
    "word/footer1.xml": footer(p(r("Page ") + pageField + r(" of ") + '<w:fldSimple w:instr="NUMPAGES"><w:r><w:t>9</w:t></w:r></w:fldSimple>' + r(" — ") + '<w:fldSimple w:instr="DATE \\@ &quot;d MMM yyyy&quot;"/>')),
    "word/footer2.xml": footer(p(r("Even"))),
    "word/header3.xml": header(p(r("other"))),
  };

  it("first section's header/footer variants, flags, fields, watermark", async () => {
    const firstSect = sect.replace("<w:titlePg/>", "");
    const out = await imp(
      p(r("body"), firstSect) + p(r("2")) + `<w:sectPr><w:headerReference w:type="default" r:id="rH3"/>${A4}</w:sectPr>`,
      {
      rels,
      files,
      settings: "<w:evenAndOddHeaders/>",
    });
    const ps = out.pageSetup;
    expect(ps.headers.default).toHaveLength(1);
    expect(ps.headers.default[0]!.data.text).toBe(
      'Report <span class="tp-field" data-field="title" contenteditable="false">title</span>',
    );
    expect(ps.watermark).toEqual({ text: "CONFIDENTIAL", color: "#c0c0c0", opacity: 0.5 });
    expect(ps.headers.first[0]!.data.text).toBe("First page");
    expect(ps.footers.default[0]!.data.text).toBe(
      'Page <span class="tp-field" data-field="page" contenteditable="false">#</span> of <span class="tp-field" data-field="pages" contenteditable="false">##</span> — <span class="tp-field" data-field="date" contenteditable="false">date</span>',
    );
    expect(ps.footers.even[0]!.data.text).toBe("Even");
    expect(ps.differentOddEven).toBe(true);
    expect(ps.differentFirstPage).toBe(false); // no titlePg on the first section
    expect(out.warnings.join()).toMatch(/Later sections have their own headers/);
    expect(sanitizeEditorData(ps)).toEqual(ps);
  });

  it("titlePg on the first section → differentFirstPage", async () => {
    const out = await imp(p(r("body")) + sect, { rels, files });
    expect(out.pageSetup.differentFirstPage).toBe(true);
    expect(out.pageSetup.headers.first[0]!.data.text).toBe("First page");
    // Header images resolve through the header part's own rels.
    expect(out.pageSetup.headers.first.map((b) => b.type)).toEqual(["paragraph", "image"]);
    expect((out.pageSetup.headers.first[1]!.data as any).file.url).toMatch(/^data:image\/png/);
    expect(out.pageSetup.differentOddEven).toBe(false);
  });

  it("unknown complex fields keep their cached result; fields in the body work too", async () => {
    const out = await imp(
      p(r("See ") + `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF _Ref1 \\h</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("Table 1")}<w:r><w:fldChar w:fldCharType="end"/></w:r>` + r(".")),
    );
    expect(out.blocks[0]!.data.text).toBe("See Table 1.");
  });

  it("HYPERLINK fields become links (unsafe dropped)", async () => {
    const f = (url: string, text: string) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "${url}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r(text)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const out = await imp(p(f("https://a.example/", "good") + f("javascript:alert(1)", "evil")));
    expect(out.blocks[0]!.data.text).toBe('<a href="https://a.example/">good</a>evil');
  });
});

describe("footnotes", () => {
  it("references become atoms; texts go to pageSetup.footnotes; endnotes appended", async () => {
    const out = await imp(
      p(r("Claim") + '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="2"/></w:r>' + r(" more") + '<w:r><w:endnoteReference w:id="1"/></w:r>'),
      {
        footnotes:
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Source &lt;script&gt;x&lt;/script&gt;, </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>p. 4</w:t></w:r></w:p></w:footnote>',
        endnotes: '<w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t>End note</w:t></w:r></w:p></w:endnote>',
      },
    );
    expect(out.blocks[0]!.data.text).toBe(
      'Claim<sup class="tp-fn-ref" data-fn-id="fn2" contenteditable="false" data-mutation-free="true">1</sup> more<sup class="tp-fn-ref" data-fn-id="en1" contenteditable="false" data-mutation-free="true">2</sup>',
    );
    expect(out.pageSetup.footnotes).toEqual({ fn2: "Source &lt;script&gt;x&lt;/script&gt;, <i>p. 4</i>", en1: "End note" });
    expect(out.warnings.join()).toMatch(/Endnotes were imported as footnotes/);
  });
});

describe("toc", () => {
  const entry = (t: string) => p(`<w:hyperlink w:anchor="_Toc1"><w:r><w:t>${t}</w:t></w:r></w:hyperlink>`);

  it("sdt Table of Contents → one toc block, cached entries skipped", async () => {
    const out = await imp(
      `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj></w:sdtPr><w:sdtContent>` +
        p(r("Inhalt")) +
        p(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-2" \\h \\z \\u</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Intro 1</w:t></w:r>`) +
        entry("Second 2") +
        p('<w:r><w:fldChar w:fldCharType="end"/></w:r>') +
        `</w:sdtContent></w:sdt>` +
        p(r("After")),
    );
    expect(out.blocks.map((b) => b.type)).toEqual(["toc", "paragraph"]);
    expect(out.blocks[0]!.data).toEqual({ maxLevel: 2, title: "Contents" });
  });

  it("a bare TOC field (no sdt) → toc block; following content is kept", async () => {
    const out = await imp(
      p(r("Contents")) +
        p(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-3"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("Chapter 1")}`) +
        entry("Chapter 2") +
        p(r("Chapter 3") + '<w:r><w:fldChar w:fldCharType="end"/></w:r>') +
        p(r("Body")),
    );
    expect(out.blocks.map((b) => b.type)).toEqual(["toc", "paragraph"]);
    expect(out.blocks[0]!.data).toEqual({ maxLevel: 3, title: "Contents" });
    expect(out.blocks[1]!.data.text).toBe("Body");
  });
});

describe("robustness + performance", () => {
  it("unbalanced fields and junk elements don't crash", async () => {
    const out = await imp(p('<w:r><w:fldChar w:fldCharType="end"/></w:r>' + r("ok")) + "<w:foo><w:bar/></w:foo>" + p(r("next")));
    expect(out.blocks.map((b) => b.data.text)).toEqual(["ok", "next"]);
  });

  it("missing referenced parts become warnings", async () => {
    const out = await imp(
      p('<w:r><w:drawing><wp:inline><wp:extent cx="1" cy="1"/><a:graphic><a:graphicData uri="x"><pic:pic><pic:blipFill><a:blip r:embed="nope"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>') +
        `<w:sectPr><w:headerReference w:type="default" r:id="rMissing"/></w:sectPr>`,
      { rels: relXml("rMissing", "header", "header9.xml") },
    );
    expect(out.blocks).toHaveLength(1);
    expect(out.warnings.join()).toMatch(/missing picture/);
  });

  it("yields to the event loop on large documents and stays linear", async () => {
    const body = Array.from({ length: 3000 }, (_, i) => p(r(`Paragraph ${i}`, i % 2 ? "<w:b/>" : ""))).join("");
    const buf = await buildDocx({ body });
    const spy = vi.spyOn(globalThis, "setTimeout");
    const t0 = performance.now();
    const out = await importDocxFile(buf);
    const ms = performance.now() - t0;
    expect(out.blocks).toHaveLength(3000);
    expect(spy.mock.calls.filter((c) => c[1] === 0).length).toBeGreaterThanOrEqual(14);
    spy.mockRestore();
    expect(ms).toBeLessThan(8000);
  });

  it("a full document's output is a fixed point of sanitizeEditorData", async () => {
    const out = await imp(
      p(r("<b>&lt;i&gt;</b>".replace(/</g, "&lt;").replace(/>/g, "&gt;"), "<w:b/><w:color w:val=\"123456\"/>")) +
        `<w:tbl><w:tr><w:tc>${p(r("cell &amp; more", "<w:i/>"))}</w:tc></w:tr></w:tbl>`,
    );
    expect(sanitizeEditorData(out.blocks)).toEqual(out.blocks);
  });
});

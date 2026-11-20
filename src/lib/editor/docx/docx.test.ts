import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "./exporter";
import { importDocxFile } from "./import";
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../pageSetup";
import type { PageLayout } from "~/lib/api/documents";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function buildDocx(bodyXml: string, rels = ""): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
    </Types>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml}</w:body></w:document>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

const allText = (blocks: Array<{ data: unknown }>) => JSON.stringify(blocks);

describe("importDocxFile (security basics)", () => {
  it("imports plain text", async () => {
    const out = await importDocxFile(await buildDocx(`<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>`));
    expect(allText(out.blocks)).toContain("Hello world");
  });

  it("escapes markup in document text instead of emitting it", async () => {
    const out = await importDocxFile(
      await buildDocx(`<w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt; a &amp; b</w:t></w:r></w:p>`),
    );
    const json = allText(out.blocks);
    expect(json).not.toContain("<img");
    expect(json).toContain("&lt;img");
  });

  it("drops javascript: hyperlinks but keeps their text", async () => {
    const out = await importDocxFile(
      await buildDocx(
        `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>click me</w:t></w:r></w:hyperlink></w:p>`,
        `<Relationship Id="rId9" Type="${R}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>`,
      ),
    );
    const json = allText(out.blocks);
    expect(json).toContain("click me");
    expect(json).not.toMatch(/javascript/i);
  });

  it("keeps safe hyperlinks", async () => {
    const out = await importDocxFile(
      await buildDocx(
        `<w:p><w:hyperlink r:id="rId9"><w:r><w:t>site</w:t></w:r></w:hyperlink></w:p>`,
        `<Relationship Id="rId9" Type="${R}/hyperlink" Target="https://example.com/?a=1&amp;b=2" TargetMode="External"/>`,
      ),
    );
    expect(allText(out.blocks)).toContain("https://example.com/");
  });

  it("throws on a file that isn't a docx instead of returning an empty doc", async () => {
    const junk = new ArrayBuffer(64);
    new Uint8Array(junk).fill(0x41);
    await expect(importDocxFile(junk)).rejects.toThrow();
  });
});

describe("exportDocx", () => {
  it("writes valid numbering for ordered lists", async () => {
    const blob = await exportDocx({
      time: 1,
      version: "2.30.7",
      blocks: [
        {
          type: "list",
          data: { style: "ordered", items: [{ content: "one", meta: {}, items: [] }] },
        },
      ],
    });
    const zip = await JSZip.loadAsync(blob);
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).not.toContain("{zw-ordered");
    expect(doc).toContain("one");
  });

  it("exports inline fonts, sizes, colours, highlights and links", async () => {
    const blob = await exportDocx({
      time: 1,
      version: "2.30.7",
      blocks: [
        {
          type: "paragraph",
          data: {
            text:
              '<span style="font-family: Georgia, serif; font-size: 18pt; color: rgb(255, 0, 0);">styled</span> ' +
              '<span style="background-color: #fef08a">marked</span> ' +
              '<a href="https://example.com/x">site</a> <a href="javascript:alert(1)">bad</a>',
          },
        },
      ],
    });
    const zip = await JSZip.loadAsync(blob);
    const doc = await zip.file("word/document.xml")!.async("string");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(doc).toContain('w:ascii="Georgia"');
    expect(doc).toContain('<w:sz w:val="36"/>');
    expect(doc).toContain('<w:color w:val="FF0000"/>');
    expect(doc).toContain('w:fill="FEF08A"');
    expect(doc).toContain("<w:hyperlink");
    expect(rels).toContain('Target="https://example.com/x"');
    expect(rels).not.toContain("javascript");
    expect(doc).toContain(">bad<");
  });

  it("exports list number formats, start values, restarts and checklists", async () => {
    const item = (content: string, extra: object = {}) => ({ content, meta: {}, items: [], ...extra });
    const blob = await exportDocx({
      time: 1,
      version: "2.30.7",
      blocks: [
        { type: "list", data: { style: "ordered", meta: { counterType: "upper-roman", start: 3 }, items: [item("roman three")] } },
        { type: "list", data: { style: "ordered", meta: { counterType: "numeric" }, items: [item("one")] } },
        { type: "list", data: { style: "ordered", meta: { counterType: "numeric" }, items: [item("one again")] } },
        { type: "list", data: { style: "checklist", meta: {}, items: [item("done", { meta: { checked: true } }), item("todo", { meta: { checked: false } })] } },
      ],
    });
    const zip = await JSZip.loadAsync(blob);
    const numbering = await zip.file("word/numbering.xml")!.async("string");
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(numbering).toContain('w:val="upperRoman"');
    expect(numbering).toContain('<w:start w:val="3"/>');
    // Two separate numeric lists → two num instances (each restarts at 1).
    const numIds = new Set([...doc.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
    expect(numIds.size).toBe(3);
    expect(doc).not.toContain("{tp-ol");
    expect(doc).toContain("☒ ");
    expect(doc).toContain("☐ ");
  });
});


describe("exportDocx page features", () => {
  const layout = (over: Partial<PageLayout> = {}): PageLayout => ({
    paperSize: "A4",
    orientation: "portrait",
    marginTop: 96,
    marginRight: 96,
    marginBottom: 96,
    marginLeft: 96,
    ...over,
  });
  let nextId = 0;
  const p = (text: string) => ({ id: `b${nextId++}`, type: "paragraph", data: { text } });
  const setup = (over: Partial<PageSetup>): PageSetup => ({ ...DEFAULT_PAGE_SETUP, ...over });

  async function unzip(blob: Blob) {
    const zip = await JSZip.loadAsync(blob);
    const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
    const files = Object.keys(zip.files);
    return { zip, read, files };
  }

  it("splits sections at section breaks with their own size and orientation", async () => {
    const blob = await exportDocx(
      {
        blocks: [
          p("first"),
          { type: "sectionBreak", data: { layout: layout({ paperSize: "LETTER", orientation: "landscape", marginLeft: 48 }) } },
          p("second"),
        ],
      },
      { defaultLayout: layout(), pageSetup: setup({ headerDistance: 32 }) },
    );
    const { read } = await unzip(blob);
    const doc = await read("word/document.xml");
    const sizes = [...doc.matchAll(/<w:pgSz ([^>]*)\/>/g)].map((m) => m[1]!);
    expect(sizes).toHaveLength(2);
    expect(sizes[0]).toContain('w:w="11906"');
    expect(sizes[0]).toContain('w:h="16838"');
    expect(sizes[0]).toContain('w:orient="portrait"');
    expect(sizes[1]).toContain('w:w="15840"');
    expect(sizes[1]).toContain('w:h="12240"');
    expect(sizes[1]).toContain('w:orient="landscape"');
    expect(doc).toContain('w:left="720"');
    expect(doc).toContain('w:header="480"');
    // The first section ends at the "first" paragraph (its sectPr sits in
    // that paragraph's pPr); the body's final sectPr follows "second".
    expect(doc.indexOf('w:orient="portrait"')).toBeLessThan(doc.indexOf(">first<"));
    expect(doc.indexOf(">second<")).toBeLessThan(doc.indexOf('w:orient="landscape"'));
  });

  it("exports headers with page fields, first-page and even variants", async () => {
    const field = (kind: string) =>
      `<span class="tp-field" data-field="${kind}" contenteditable="false">#</span>`;
    const blob = await exportDocx(
      { blocks: [p("body")] },
      {
        title: "My Doc",
        pageSetup: setup({
          differentFirstPage: true,
          differentOddEven: true,
          headers: {
            default: [p(`Page ${field("page")} of ${field("pages")}`)],
            first: [p(`Cover ${field("title")}`)],
            even: [p("Even header")],
          },
          footers: { default: [p(`Printed ${field("date")}`)], first: [], even: [] },
        }),
      },
    );
    const { read, files } = await unzip(blob);
    const headers = await Promise.all(
      files.filter((f) => /^word\/header\d+\.xml$/.test(f)).map(read),
    );
    const all = headers.join("\n");
    expect(all).toContain("w:fldChar");
    expect(all).toMatch(/PAGE/);
    expect(all).toMatch(/NUMPAGES/);
    expect(all).toContain("Cover ");
    expect(all).toContain("My Doc");
    expect(all).toContain("Even header");
    const footers = await Promise.all(files.filter((f) => /^word\/footer\d+\.xml$/.test(f)).map(read));
    expect(footers.join("")).toContain(new Date().toLocaleDateString());

    const doc = await read("word/document.xml");
    expect(doc).toContain("<w:titlePg");
    expect(doc).toMatch(/<w:headerReference [^>]*w:type="first"/);
    expect(doc).toMatch(/<w:headerReference [^>]*w:type="even"/);
    expect(await read("word/settings.xml")).toContain("<w:evenAndOddHeaders");
  });

  it("exports footnote references and their text", async () => {
    const ref = (id: string) => `<sup class="tp-fn-ref" data-fn-id="${id}" contenteditable="false">1</sup>`;
    const blob = await exportDocx(
      { blocks: [p(`Claim${ref("b")} and another${ref("a")} and empty${ref("none")}`)] },
      {
        pageSetup: setup({
          footnotes: { a: "Second <b>note</b>", b: "First note", none: "  " },
          headers: { default: [p(`hdr${ref("a")}`)], first: [], even: [] },
        }),
      },
    );
    const { read } = await unzip(blob);
    const doc = await read("word/document.xml");
    const refs = [...doc.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((m) => m[1]);
    expect(refs).toEqual(["1", "2"]);
    // The ref's placeholder digit isn't exported as text.
    expect(doc).not.toMatch(/>1<\/w:t>/);
    const notes = await read("word/footnotes.xml");
    expect(notes).toContain("First note");
    expect(notes).toContain("Second ");
    expect(notes.indexOf("First note")).toBeLessThan(notes.indexOf("Second "));
    const header = await read("word/header1.xml");
    expect(header).toContain("hdr");
    expect(header).not.toContain("footnoteReference");
  });

  it("exports a table of contents field and asks Word to update fields", async () => {
    const blob = await exportDocx({
      blocks: [
        { type: "toc", data: { maxLevel: 2, title: "Contents" } },
        { type: "header", data: { text: "Intro", level: 1 } },
      ],
    });
    const { read } = await unzip(blob);
    const doc = await read("word/document.xml");
    expect(doc).toContain("Contents");
    expect(doc).toContain("w:fldCharType=\"begin\"");
    expect(doc).toContain('\\o &quot;1-2&quot;');
    expect(await read("word/settings.xml")).toContain("<w:updateFields");
  });

  it("exports page colour and page border", async () => {
    const blob = await exportDocx(
      { blocks: [p("x")] },
      {
        pageSetup: setup({
          pageColor: "#fef3c7",
          pageBorder: { style: "double", width: 2, color: "#ff0000" },
        }),
      },
    );
    const { read } = await unzip(blob);
    const doc = await read("word/document.xml");
    expect(doc).toMatch(/<w:background [^>]*w:color="FEF3C7"/);
    expect(doc).toContain("<w:pgBorders");
    expect(doc).toMatch(/<w:top [^>]*w:val="double"[^>]*/);
    expect(doc).toContain('w:color="FF0000"');
  });
});

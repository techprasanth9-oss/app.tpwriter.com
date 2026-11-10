import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "./exporter";
import { importDocx } from "./importer";

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

describe("importDocx", () => {
  it("imports plain text", async () => {
    const out = await importDocx(await buildDocx(`<w:p><w:r><w:t>Hello world</w:t></w:r></w:p>`));
    expect(allText(out.blocks)).toContain("Hello world");
  });

  it("escapes markup in document text instead of emitting it", async () => {
    const out = await importDocx(
      await buildDocx(`<w:p><w:r><w:t>&lt;img src=x onerror=alert(1)&gt; a &amp; b</w:t></w:r></w:p>`),
    );
    const json = allText(out.blocks);
    expect(json).not.toContain("<img");
    expect(json).toContain("&lt;img");
  });

  it("drops javascript: hyperlinks but keeps their text", async () => {
    const out = await importDocx(
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
    const out = await importDocx(
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
    await expect(importDocx(junk)).rejects.toThrow(/not a valid \.docx/i);
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
});

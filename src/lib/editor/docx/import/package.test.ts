import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { sanitizeEditorData } from "../../sanitizeData";
import { importDocxFile } from "./index";
import { buildDocx, NS, p, r } from "./testDocx";

describe("package + limits", () => {
  it("imports a minimal document and reads the core title", async () => {
    const out = await importDocxFile(
      await buildDocx({ body: p(r("Hello world")), core: "<dc:title>My &lt;Title&gt;</dc:title>" }),
    );
    expect(out.blocks).toHaveLength(1);
    expect(out.blocks[0]).toMatchObject({ type: "paragraph", data: { text: "Hello world" } });
    expect(out.title).toBe("My <Title>");
    expect(out.defaultLayout.paperSize).toBe("A4");
  });

  it("accepts a File", async () => {
    const buf = await buildDocx({ body: p(r("From a file")) });
    const file = new File([buf], "x.docx");
    const out = await importDocxFile(file);
    expect(out.blocks[0]!.data.text).toBe("From a file");
  });

  it("rejects input over maxBytes", async () => {
    const buf = await buildDocx({ body: p(r("x")) });
    await expect(importDocxFile(buf, { maxBytes: 10, maxUncompressedBytes: 1e9 })).rejects.toThrow(/too large/);
  });

  it("rejects a zip whose declared uncompressed size is over the limit", async () => {
    const buf = await buildDocx({ body: p(r("x".repeat(5000))) });
    await expect(importDocxFile(buf, { maxBytes: 1e9, maxUncompressedBytes: 2000 })).rejects.toThrow(/uncompressed/);
  });

  it("counts inflated bytes even when the declared sizes lie", async () => {
    const buf = await buildDocx({ body: p(r("y".repeat(20000))) });
    // Patch the central directory's uncompressed sizes to 1 byte.
    const bytes = new Uint8Array(buf.slice(0));
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true); // central dir header
    }
    await expect(importDocxFile(bytes.buffer, { maxBytes: 1e9, maxUncompressedBytes: 5000 })).rejects.toThrow(
      /too large when uncompressed/,
    );
  });

  it("throws a clear error for a non-zip", async () => {
    const junk = new TextEncoder().encode("this is not a zip at all").buffer;
    await expect(importDocxFile(junk)).rejects.toThrow(/not a zip/);
  });

  it("throws when word/document.xml is missing", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    await expect(importDocxFile(await zip.generateAsync({ type: "arraybuffer" }))).rejects.toThrow(/document\.xml is missing/);
  });

  it("throws when the body is missing or document.xml is malformed", async () => {
    await expect(
      importDocxFile(await buildDocx({ body: "", rawDocument: `<w:document ${NS}></w:document>` })),
    ).rejects.toThrow(/no body/);
    await expect(importDocxFile(await buildDocx({ body: "", rawDocument: `<w:document ${NS}><w:body>` }))).rejects.toThrow(
      /not valid XML/,
    );
  });

  it("turns malformed secondary parts into warnings", async () => {
    const out = await importDocxFile(
      await buildDocx({
        body: p(r("Still here")),
        styles: "<w:styles><broken",
        numbering: "<oops",
      }),
    );
    expect(out.blocks[0]!.data.text).toBe("Still here");
    expect(out.warnings.join("\n")).toMatch(/styles\.xml is not valid XML/);
  });

  it("output passes sanitizeEditorData unchanged", async () => {
    const out = await importDocxFile(await buildDocx({ body: p(r("a &amp; b  c")) + p(r("x", "<w:b/>")) }));
    expect(sanitizeEditorData(out.blocks)).toEqual(out.blocks);
    expect(sanitizeEditorData(out.pageSetup)).toEqual(out.pageSetup);
  });
});

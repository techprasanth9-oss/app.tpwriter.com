import { describe, expect, it } from "vitest";
import { sanitizeEditorData, sanitizeHtml } from "./sanitizeData";

describe("sanitizeHtml", () => {
  it("strips script and event handlers", () => {
    const out = sanitizeHtml('<img src="x.png" onerror="alert(1)"><script>alert(2)</script>hi');
    expect(out).not.toMatch(/onerror|script/i);
    expect(out).toContain("hi");
  });

  it("drops javascript: hrefs but keeps the link text", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript/i);
    expect(out).toContain("click");
  });

  it("keeps the formatting our tools emit", () => {
    const html =
      '<b>bold</b> <span class="variable-chip" data-var-name="x" contenteditable="false" style="color: red;">x</span> <a href="https://e.com" target="_blank">l</a>';
    const out = sanitizeHtml(html);
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain('data-var-name="x"');
    expect(out).toContain('contenteditable="false"');
    expect(out).toContain('style="color: red;"');
    expect(out).toContain('href="https://e.com"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe("sanitizeEditorData", () => {
  it("sanitizes nested block data and leaves plain values untouched", () => {
    const data = {
      time: 1,
      blocks: [
        { id: "a", type: "paragraph", data: { text: "<img src=x onerror=alert(1)>ok", alignment: "center" } },
        { id: "b", type: "table", data: { content: [["<b>1</b>", "<svg onload=alert(1)></svg>"]], theme: "a & b" } },
        { id: "c", type: "list", data: { items: [{ content: "<a href='javascript:x'>l</a>", items: [] }] } },
      ],
    };
    const out = sanitizeEditorData(data);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/onerror|onload|javascript/i);
    expect(out.blocks[0]!.data.alignment).toBe("center");
    expect(out.blocks[1]!.data.theme).toBe("a & b");
    expect((out.blocks[1]!.data.content as string[][])[0]![0]).toBe("<b>1</b>");
  });

  it("validates URL-valued keys", () => {
    const out = sanitizeEditorData({
      file: { url: "javascript:alert(1)" },
      link: { url: "https://ok.example" },
      originalUrl: "data:image/svg+xml;base64,AAAA",
      ok: { url: "/api/uploads/a.png?x=1&y=2" },
    });
    expect(out.file.url).toBe("");
    expect(out.link.url).toBe("https://ok.example");
    expect(out.originalUrl).toBe("");
    expect(out.ok.url).toBe("/api/uploads/a.png?x=1&y=2");
  });
});

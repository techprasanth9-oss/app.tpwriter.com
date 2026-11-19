import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportDocx } from "../exporter";
import { collectImageUrls, loadImage, sniffType } from "./image";

// 1×1 PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;
const pngBytes = () => Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
const EMU = 9525;

async function documentXml(blocks: unknown[]): Promise<string> {
  const blob = await exportDocx({ blocks } as never);
  const zip = await JSZip.loadAsync(blob);
  return zip.file("word/document.xml")!.async("string");
}

const image = (data: Record<string, unknown>, tunes?: Record<string, unknown>) => ({
  type: "image",
  data,
  ...(tunes ? { tunes } : {}),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image export", () => {
  it("uses the saved px size, alt text and alignment", async () => {
    const xml = await documentXml([
      image({
        file: { url: PNG },
        dimensions: { width: "300px", height: "150px" },
        altText: "A chart",
        tunes: { alignment: { alignment: "center" }, imageTune: { wrapText: "top-bottom", float: "inline" } },
      }),
    ]);
    expect(xml).toContain(`<wp:extent cx="${300 * EMU}" cy="${150 * EMU}"/>`);
    expect(xml).toMatch(/descr="A chart"/);
    expect(xml).toMatch(/<w:jc w:val="center"\/>/);
    expect(xml).toContain("<wp:inline");
  });

  it("accepts legacy data.url and numeric importer dimensions", async () => {
    const xml = await documentXml([image({ url: PNG, dimensions: { width: 200, height: 100 } })]);
    expect(xml).toContain(`<wp:extent cx="${200 * EMU}" cy="${100 * EMU}"/>`);
  });

  it("keeps the aspect ratio when only one side (or none) is saved", async () => {
    const xml = await documentXml([image({ file: { url: PNG }, dimensions: { width: "50px", height: "auto" } })]);
    expect(xml).toContain(`<wp:extent cx="${50 * EMU}" cy="${50 * EMU}"/>`);
  });

  it("falls back to the block alignment tune", async () => {
    const xml = await documentXml([image({ file: { url: PNG } }, { alignment: { alignment: "right" } })]);
    expect(xml).toMatch(/<w:jc w:val="right"\/>/);
  });

  it("crops: extent is the visible part, srcRect carries the crop", async () => {
    const xml = await documentXml([
      image({
        file: { url: PNG },
        dimensions: { width: "400px", height: "200px" },
        crop: { top: 10, right: 25, bottom: 0, left: 25 },
      }),
    ]);
    expect(xml).toContain(`<wp:extent cx="${200 * EMU}" cy="${180 * EMU}"/>`);
    expect(xml).toMatch(/<a:srcRect[^>]*l="25000"/);
    expect(xml).toMatch(/<a:srcRect[^>]*t="10000"/);
  });

  it("float wraps become anchored square-wrapped pictures", async () => {
    const xml = await documentXml([
      image({
        file: { url: PNG },
        dimensions: { width: "120px", height: "120px" },
        tunes: { imageTune: { wrapText: "square", float: "left" } },
      }),
      image({
        file: { url: PNG },
        dimensions: { width: "120px", height: "120px" },
        tunes: { imageTune: { wrapText: "tight", float: "right" } },
      }),
    ]);
    expect(xml).toContain("<wp:anchor");
    expect(xml).toMatch(/<wp:wrapSquare wrapText="right"/);
    expect(xml).toMatch(/<wp:wrapSquare wrapText="left"/);
    expect(xml).toMatch(/<wp:align>left<\/wp:align>/);
    expect(xml).toMatch(/<wp:align>right<\/wp:align>/);
  });

  it("writes a caption paragraph only when shown", async () => {
    const xml = await documentXml([
      image({ file: { url: PNG }, caption: "Figure 1", showCaption: true }),
      image({ file: { url: PNG }, caption: "Hidden", showCaption: false }),
    ]);
    expect(xml).toContain("Figure 1");
    expect(xml).not.toContain("Hidden");
  });

  it("rotation, flip, link and border", async () => {
    const xml = await documentXml([
      image({
        file: { url: PNG },
        rotation: 90,
        flipX: true,
        link: { url: "https://example.com" },
        border: { width: "2px", style: "solid", color: "#ff0000" },
      }),
    ]);
    expect(xml).toMatch(/rot="5400000"/);
    expect(xml).toMatch(/flipH="(1|true)"/);
    expect(xml).toContain("hlinkClick");
    expect(xml).toMatch(/<a:ln w="19050"/);
    expect(xml).toContain("FF0000");
  });

  it("fetches relative upload URLs against the page location", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => pngBytes().buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const xml = await documentXml([image({ file: { url: "/api/uploads/a.png" } })]);
    expect(fetchMock).toHaveBeenCalledWith(`${location.origin}/api/uploads/a.png`, expect.anything());
    expect(xml).toContain("<pic:pic");
  });

  it("writes [image] when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    const xml = await documentXml([
      image({ file: { url: "https://cdn.example.com/x.png" } }),
      image({ file: { url: "https://cdn.example.com/y.png" }, altText: "Logo" }),
    ]);
    expect(xml).toContain("[image]");
    expect(xml).toContain("[image: Logo]");
    expect(xml).not.toContain("<pic:pic");
  });

  it("webp / svg fall back to [image] where there is no canvas (jsdom)", async () => {
    const webp = "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
    expect(await loadImage(webp)).toBeNull();
    const xml = await documentXml([image({ file: { url: webp } })]);
    expect(xml).toContain("[image]");
  });

  it("helpers: sniffing and URL collection", () => {
    expect(sniffType(pngBytes())).toBe("png");
    expect(sniffType(new TextEncoder().encode("<svg xmlns='x'/>"))).toBe("svg");
    expect(
      collectImageUrls(
        [image({ file: { url: "/a.png" } }), { type: "column", data: { cols: [{ blocks: [image({ url: "/b.png" })] }] } }],
        { default: [image({ url: "/a.png" })] },
      ).sort(),
    ).toEqual(["/a.png", "/b.png"]);
  });
});

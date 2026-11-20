import { describe, expect, it, vi } from "vitest";
import { dataUrlToFile, uploadEmbeddedImages } from "./uploadEmbedded";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

describe("uploadEmbeddedImages", () => {
  it("uploads each distinct embedded image once and swaps in the URL", async () => {
    const upload = vi.fn(async (f: File) => ({ url: `/api/uploads/${f.name}` }));
    const doc = {
      blocks: [
        { type: "image", data: { file: { url: PNG } } },
        { type: "image", data: { file: { url: PNG } } },
        { type: "paragraph", data: { text: "keep data:image/png;base64,xx inside text? no — not a whole value" } },
      ],
      pageSetup: { headers: { default: [{ type: "image", data: { file: { url: GIF } } }] } },
    };
    const { value, uploaded, failed } = await uploadEmbeddedImages(doc, upload);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(uploaded).toBe(2);
    expect(failed).toBe(0);
    expect(value.blocks[0]!.data.file!.url).toMatch(/^\/api\/uploads\/imported-\d\.png$/);
    expect(value.blocks[1]!.data.file!.url).toBe(value.blocks[0]!.data.file!.url);
    expect(value.pageSetup.headers.default[0]!.data.file.url).toMatch(/\.gif$/);
    expect(value.blocks[2]!.data.text).toContain("data:image/png");
  });

  it("keeps the embedded image when an upload fails", async () => {
    const { value, failed } = await uploadEmbeddedImages({ url: PNG }, async () => {
      throw new Error("offline");
    });
    expect(failed).toBe(1);
    expect(value.url).toBe(PNG);
  });

  it("decodes a data URL into a typed File", async () => {
    const f = dataUrlToFile(PNG, 0);
    expect(f.type).toBe("image/png");
    expect(f.name).toBe("imported-1.png");
    expect(f.size).toBeGreaterThan(40);
  });
});

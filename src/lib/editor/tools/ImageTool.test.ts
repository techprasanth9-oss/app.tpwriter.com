/**
 * ImageTool: every settings-panel feature must survive
 * render → save → new instance → render → save, uploads must go through
 * the configured uploader, and the tool must clean up after itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ImageTool, { imageWrapMode, normalizeRotation, t } from "./ImageTool";

const api: any = new Proxy(
  {},
  { get: () => new Proxy(() => undefined, { get: () => () => undefined }) },
);

const PNG_DATA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

type AnyTool = any;

function make(data: unknown = {}, config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): AnyTool {
  const tool: AnyTool = new (ImageTool as any)({ data, api, config, readOnly: false, ...extra });
  const el = tool.render();
  document.body.appendChild(el);
  return tool;
}

/** Save, load the result into a fresh instance, save again. */
function roundTrip(tool: AnyTool): { first: any; second: any } {
  const first = tool.save();
  const next = make(JSON.parse(JSON.stringify(first)));
  const second = next.save();
  next.destroy();
  return { first, second };
}

function openPanel(tool: AnyTool): HTMLElement {
  tool.wrapper.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const panel = document.querySelector("[data-image-settings-panel]") as HTMLElement;
  expect(panel).toBeTruthy();
  return panel;
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find(
    (b) => (b.textContent || (b as any).innerText || "").trim() === text || b.title === text,
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

function inputAfterLabel(root: ParentNode, text: string): HTMLInputElement {
  const label = Array.from(root.querySelectorAll("span,label")).find(
    (l) => l.textContent?.trim() === text,
  );
  const input = label?.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input for "${text}"`);
  return input as HTMLInputElement;
}

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string, event = "change") {
  el.value = value;
  el.dispatchEvent(new Event(event, { bubbles: true }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImageTool loading & saving", () => {
  it("accepts legacy data.url and saves file.url", () => {
    const tool = make({ url: PNG_DATA });
    expect(tool.save().file.url).toBe(PNG_DATA);
    const tool2 = make({ file: { url: "/api/uploads/a.png" } });
    expect(tool2.save().file.url).toBe("/api/uploads/a.png");
  });

  it("does not overwrite saved sizes with 0px when the image hasn't loaded", () => {
    const tool = make({ file: { url: "/a.png" }, dimensions: { width: "320px", height: "200px" } });
    const out = tool.save();
    expect(out.dimensions).toEqual({ width: "320px", height: "200px" });
  });

  it("treats a stored 0px size as unknown", () => {
    const tool = make({ file: { url: "/a.png" }, dimensions: { width: "0px", height: "0px" } });
    expect(tool.save().dimensions).toEqual({ width: "auto", height: "auto" });
  });

  it("loads DOCX-importer numeric dimensions", () => {
    const tool = make({ url: PNG_DATA, dimensions: { width: 240, height: 120 } });
    expect(tool.save().dimensions).toEqual({ width: "240px", height: "120px" });
  });

  it("round-trips a fully configured image unchanged", () => {
    const data = {
      file: { url: "/api/uploads/x.png" },
      caption: "A caption",
      dimensions: { width: "300px", height: "150px" },
      rotation: 90,
      aspectRatio: "locked",
      flipX: true,
      flipY: false,
      zoom: 1.21,
      altText: "Alt",
      border: { width: "2px", style: "dashed", color: "#ff0000" },
      originalUrl: "/api/uploads/orig.png",
      showCaption: true,
      crop: { top: 5, right: 10, bottom: 15, left: 20 },
      link: { url: "https://example.com", openInNewTab: false },
      shadow: "medium",
      filters: { brightness: 120, contrast: 80, saturation: 50 },
      shape: "rounded",
      tunes: {
        alignment: { alignment: "right" },
        imageTune: {
          float: "right",
          wrapText: "square",
          position: "relative",
          marginTop: "4px",
          marginRight: "8px",
          marginBottom: "12px",
          marginLeft: "16px",
        },
      },
    };
    const tool = make(data);
    const { first, second } = roundTrip(tool);
    expect(first).toEqual(data);
    expect(second).toEqual(data);
  });
});

describe("ImageTool settings panel round-trips", () => {
  const base = () => ({ file: { url: PNG_DATA }, dimensions: { width: "400px", height: "200px" } });

  it("size fields with aspect lock", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    button(panel, "🔓").click(); // lock
    setValue(inputAfterLabel(panel, "Width (px)"), "200");
    const { first, second } = roundTrip(tool);
    expect(first.dimensions).toEqual({ width: "200px", height: "100px" });
    expect(first.aspectRatio).toBe("locked");
    expect(second).toEqual(first);
  });

  it("unlocked size fields change one axis", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    setValue(inputAfterLabel(panel, "Height (px)"), "50");
    expect(roundTrip(tool).second.dimensions).toEqual({ width: "400px", height: "50px" });
  });

  it("lock does not squash the image into a square on reload", () => {
    const tool = make(base());
    button(openPanel(tool), "🔓").click();
    const { second } = roundTrip(tool);
    expect(second.dimensions).toEqual({ width: "400px", height: "200px" });
  });

  it("size presets keep the aspect ratio", () => {
    const tool = make(base());
    button(openPanel(tool), "Small").click();
    expect(roundTrip(tool).second.dimensions).toEqual({ width: "150px", height: "75px" });
  });

  it("aspect-ratio preset reshapes and persists", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    const select = Array.from(panel.querySelectorAll("select")).find((s) =>
      s.querySelector('option[value="16:9"]'),
    )!;
    setValue(select, "1:1");
    const { second } = roundTrip(tool);
    expect(second.aspectRatio).toBe("1:1");
    expect(second.dimensions).toEqual({ width: "400px", height: "400px" });
  });

  it("alignment", () => {
    const tool = make(base());
    button(openPanel(tool), "Align center").click();
    expect(tool.wrapper.style.textAlign).toBe("center");
    expect(roundTrip(tool).second.tunes.alignment.alignment).toBe("center");
  });

  it("text wrapping + DOM contract", () => {
    const tool = make(base());
    expect(tool.wrapper.classList.contains("tp-image--top-bottom")).toBe(true);
    const panel = openPanel(tool);
    button(panel, "Square").click();
    expect(tool.wrapper.classList.contains("tp-image--float-left")).toBe(true);
    expect(tool.wrapper.style.getPropertyValue("--tp-image-width")).toBe("400px");
    button(panel, "Align right").click();
    expect(tool.wrapper.className).toMatch(/tp-image--float-right/);
    expect(tool.wrapper.className).not.toMatch(/tp-image--float-left|tp-image--top-bottom/);
    // Never floats anything itself.
    expect(tool.imageContainer.style.float).toBe("");
    const { second } = roundTrip(tool);
    expect(imageWrapMode(second)).toBe("float-right");
    const reloaded = make(second);
    expect(reloaded.wrapper.classList.contains("tp-image--float-right")).toBe(true);

    button(panel, "Inline").click();
    expect(tool.wrapper.classList.contains("tp-image--inline")).toBe(true);
    expect(tool.wrapper.style.getPropertyValue("--tp-image-width")).toBe("");
    button(panel, "Top & bottom").click();
    expect(tool.wrapper.classList.contains("tp-image--top-bottom")).toBe(true);
  });

  it("float width accounts for crop, margins and border", () => {
    const tool = make({
      ...base(),
      crop: { top: 0, right: 25, bottom: 0, left: 25 },
      border: { width: "2px", style: "solid", color: "#000000" },
      tunes: { imageTune: { wrapText: "tight", float: "left", marginLeft: "0px", marginRight: "10px" } },
    });
    expect(tool.wrapper.style.getPropertyValue("--tp-image-width")).toBe("214px");
  });

  it("margins", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    setValue(inputAfterLabel(panel, "Top"), "16");
    setValue(inputAfterLabel(panel, "Left"), ""); // emptied field → 0px, not "px"
    const t2 = roundTrip(tool).second.tunes.imageTune;
    expect(t2.marginTop).toBe("16px");
    expect(t2.marginLeft).toBe("0px");
  });

  it("crop", () => {
    const tool = make(base());
    button(openPanel(tool), "Crop image").click();
    button(tool.wrapper, "Apply crop").click();
    expect(roundTrip(tool).second.crop).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it("brightness / contrast / saturation", () => {
    const tool = make(base());
    const sliders = openPanel(tool).querySelectorAll('input[type="range"]');
    setValue(sliders[0] as HTMLInputElement, "150", "input");
    setValue(sliders[1] as HTMLInputElement, "60", "input");
    setValue(sliders[2] as HTMLInputElement, "0", "input");
    expect(roundTrip(tool).second.filters).toEqual({ brightness: 150, contrast: 60, saturation: 0 });
  });

  it("shape, shadow and border", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    button(panel, "Circle").click();
    button(panel, "Strong").click();
    const style = Array.from(panel.querySelectorAll("select")).find((s) =>
      s.querySelector('option[value="dashed"]'),
    )!;
    setValue(style, "dotted");
    expect(tool.imageContainer.style.borderRadius).toBe("50%"); // border didn't undo the circle
    const { second } = roundTrip(tool);
    expect(second.shape).toBe("circle");
    expect(second.shadow).toBe("strong");
    expect(second.border).toEqual({ style: "dotted", width: "1px", color: "#000000" });
  });

  it("caption + show caption, alt text and link", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    const toggle = panel.querySelector('label span input[type="checkbox"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    setValue(panel.querySelector('input[placeholder="Add a caption…"]') as HTMLInputElement, "Fig 1", "input");
    setValue(
      panel.querySelector('input[placeholder="Describe the image for screen readers"]') as HTMLInputElement,
      "A cat",
      "input",
    );
    setValue(panel.querySelector('input[type="url"]') as HTMLInputElement, "https://e.com/x");
    expect(tool.wrapper.querySelector("[data-image-caption]")?.textContent).toBe("Fig 1");
    const { second } = roundTrip(tool);
    expect(second.caption).toBe("Fig 1");
    expect(second.showCaption).toBe(true);
    expect(second.altText).toBe("A cat");
    expect(second.link).toEqual({ url: "https://e.com/x", openInNewTab: true });
  });

  it("rejects javascript: links", () => {
    const tool = make(base());
    setValue(openPanel(tool).querySelector('input[type="url"]') as HTMLInputElement, "javascript:alert(1)");
    expect(tool.save().link).toBeUndefined();
  });

  it("inline caption typing is saved before blur", () => {
    const tool = make({ ...base(), caption: "Old", showCaption: true });
    const cap = tool.wrapper.querySelector("[data-image-caption]") as HTMLElement;
    cap.textContent = "New";
    cap.dispatchEvent(new Event("input", { bubbles: true }));
    expect(tool.save().caption).toBe("New");
  });

  it("rotation and flip", () => {
    const tool = make(base());
    const panel = openPanel(tool);
    button(panel, "Rotate left").click();
    button(panel, "Flip horizontally").click();
    button(panel, "Flip vertically").click();
    const { second } = roundTrip(tool);
    expect(second.rotation).toBe(270); // was -90, displayed as "90°"
    expect(second.flipX).toBe(true);
    expect(second.flipY).toBe(true);
    expect(normalizeRotation(-450)).toBe(270);
  });

  it("replace image goes through the uploader and keeps styling", async () => {
    const uploader = vi.fn(async () => ({ url: "/api/uploads/new.png" }));
    const tool = make({ ...base(), shape: "circle", crop: { top: 1, right: 1, bottom: 1, left: 1 } }, { uploader });
    await tool.replaceWithFile(new File(["x"], "n.png", { type: "image/png" }));
    expect(uploader).toHaveBeenCalledOnce();
    const { second } = roundTrip(tool);
    expect(second.file.url).toBe("/api/uploads/new.png");
    expect(second.originalUrl).toBe("/api/uploads/new.png");
    expect(second.shape).toBe("circle");
    expect(second.crop).toBeUndefined(); // old crop doesn't apply to a new picture
    expect(second.dimensions.width).toBe("400px");
  });

  it("failed replace keeps the previous image", async () => {
    const uploader = vi.fn(async () => {
      throw new Error("offline");
    });
    const tool = make(base(), { uploader });
    // SVG can't be embedded in jsdom (no canvas) → total failure.
    await tool.replaceWithFile(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(tool.save().file.url).toBe(PNG_DATA);
    expect(tool.wrapper.querySelector("img")).toBeTruthy();
    expect(tool.wrapper.querySelector('[data-image-notice="error"]')).toBeTruthy();
  });
});

describe("ImageTool uploads", () => {
  const file = () => new File([new Uint8Array([137, 80, 78, 71])], "p.png", { type: "image/png" });
  const fileEvent = (f: File) => ({ detail: { type: "file", file: f } }) as unknown as CustomEvent;

  it("pasted files go through config.uploader", async () => {
    const uploader = vi.fn(async () => ({ url: "/api/uploads/u.png" }));
    const tool = make({}, { uploader });
    await tool.onPaste(fileEvent(file()));
    expect(uploader).toHaveBeenCalledOnce();
    expect(tool.save().file.url).toBe("/api/uploads/u.png");
    expect(tool.wrapper.querySelector("[data-image-notice]")).toBeNull();
  });

  it("shows an uploading state while the upload runs", async () => {
    let resolve!: (v: { url: string }) => void;
    const uploader = vi.fn(() => new Promise<{ url: string }>((r) => (resolve = r)));
    const tool = make({}, { uploader });
    const done = tool.onPaste(fileEvent(file()));
    await flush();
    expect(tool.wrapper.querySelector("[data-image-uploading]")).toBeTruthy();
    expect(tool.wrapper.classList.contains("tp-image--uploading")).toBe(true);
    resolve({ url: "/api/uploads/u.png" });
    await done;
    expect(tool.wrapper.querySelector("[data-image-uploading]")).toBeNull();
    expect(tool.wrapper.querySelector("img")?.getAttribute("src")).toBe("/api/uploads/u.png");
  });

  it("falls back to a data: URL with a notice when the upload fails", async () => {
    const uploader = vi.fn(async () => {
      throw new Error("500");
    });
    const tool = make({}, { uploader });
    await tool.onPaste(fileEvent(file()));
    expect(tool.save().file.url).toMatch(/^data:image\/png;base64,/);
    expect(tool.wrapper.querySelector('[data-image-notice="warning"]')?.textContent).toMatch(/Upload failed/);
  });

  it("embeds as a data: URL without an uploader", async () => {
    const tool = make({});
    await tool.onPaste(fileEvent(file()));
    expect(tool.save().file.url).toMatch(/^data:image\/png;base64,/);
  });

  it("pasted image URLs are fetched and uploaded", async () => {
    const uploader = vi.fn(async (f: File) => ({ url: `/api/uploads/${f.name}` }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/jpeg" }) })),
    );
    const tool = make({}, { uploader });
    await tool.onPaste({ detail: { type: "pattern", key: "image", data: "https://cdn.x/cat.jpg" } } as any);
    expect(uploader).toHaveBeenCalledOnce();
    expect(tool.save().file.url).toBe("/api/uploads/cat.jpg");
  });

  it("keeps the original URL (with a notice) when the fetch is blocked", async () => {
    const uploader = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("CORS"))));
    const tool = make({}, { uploader });
    await tool.onPaste({ detail: { type: "tag", data: Object.assign(document.createElement("img"), { src: "https://x/y.png" }) } } as any);
    expect(uploader).not.toHaveBeenCalled();
    expect(tool.save().file.url).toBe("https://x/y.png");
    expect(tool.wrapper.querySelector('[data-image-notice="warning"]')).toBeTruthy();
  });

  it("an unusable paste leaves the upload prompt, not a broken block", async () => {
    const tool = make({});
    await tool.onPaste({ detail: { type: "pattern", key: "image", data: "javascript:alert(1).png" } } as any);
    expect(tool.save().file.url).toBe("");
    expect(tool.wrapper.querySelector("[data-image-dropzone]")).toBeTruthy();
    expect(tool.wrapper.querySelector('[data-image-notice="error"]')).toBeTruthy();
  });

  it("onPaste never rejects when the reader fails", async () => {
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      setTimeout(() => this.onerror?.(new ProgressEvent("error") as any), 0);
    });
    const tool = make({});
    await expect(tool.onPaste(fileEvent(file()))).resolves.toBeUndefined();
    expect(tool.wrapper.querySelector('[data-image-notice="error"]')).toBeTruthy();
  });

  it("dropping a file on the empty block uploads it", async () => {
    const uploader = vi.fn(async () => ({ url: "/api/uploads/d.png" }));
    const tool = make({}, { uploader });
    const zone = tool.wrapper.querySelector("[data-image-dropzone]") as HTMLElement;
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as any;
    drop.dataTransfer = { files: [file()], types: ["Files"] };
    zone.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(tool.save().file.url).toBe("/api/uploads/d.png"));
  });
});

describe("ImageTool cleanup", () => {
  it("only one settings panel is open at a time", () => {
    const a = make({ file: { url: PNG_DATA } });
    const b = make({ file: { url: PNG_DATA } });
    openPanel(a);
    openPanel(b);
    expect(document.querySelectorAll("[data-image-settings-panel]").length).toBe(1);
  });

  it("destroy() removes the panel and document listeners", async () => {
    const tool = make({ file: { url: PNG_DATA } });
    const remove = vi.spyOn(document, "removeEventListener");
    openPanel(tool);
    await flush(); // listeners attach on the next tick
    tool.destroy();
    expect(document.querySelector("[data-image-settings-panel]")).toBeNull();
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toEqual(expect.arrayContaining(["click", "keydown"]));
  });

  it("an upload finishing after destroy() doesn't touch the DOM", async () => {
    let resolve!: (v: { url: string }) => void;
    const tool = make({}, { uploader: () => new Promise((r) => (resolve = r)) });
    const done = tool.onPaste({ detail: { type: "file", file: new File(["x"], "a.png", { type: "image/png" }) } } as any);
    await flush();
    tool.destroy();
    resolve({ url: "/api/uploads/late.png" });
    await done;
    expect(tool.wrapper.querySelector("img")).toBeNull();
  });

  it("replace doesn't leave a file input in <body>", () => {
    const tool = make({ file: { url: PNG_DATA } });
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    button(openPanel(tool), "Choose new file").click();
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("t() shim", () => {
  it("interpolates {{var}}", () => {
    expect(t("editor.tools.image.pasteHint", { key: "Ctrl+V" })).toBe(
      "Press Ctrl+V to paste an image or image URL",
    );
    expect(t("x.y", { defaultValue: "Hi {{name}}!", name: "Ann" })).toBe("Hi Ann!");
    expect(t("x.y", { defaultValue: "Keep {{missing}}" })).toBe("Keep {{missing}}");
  });
});

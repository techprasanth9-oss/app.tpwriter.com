// @ts-nocheck
import { confirmDialog } from "~/components/ui/dialogs";
import { isSafeImageUrl, isSafeLinkUrl } from "../safeUrl";
import "./ImageTool.css";
/**
 * ImageTool — EditorJS block tool for images.
 *
 * Ported from eSigns with CLM-side wiring stripped:
 *   - `isPrintRoute` collapsed to a plain `/print|/complete` URL check.
 *   - `failedPopper` replaced with `console.warn`.
 *   - `t(key, { defaultValue })` collapsed to inline English literals
 *     via a local `t()` shim that extracts the defaultValue (or derives a
 *     readable fallback from the key's last segment).
 *   - S3 upload glue replaced with a `config.uploader?: (file) => Promise<{url}>`
 *     hook. When no uploader is supplied the tool falls back to inline
 *     base64 data URLs via FileReader.readAsDataURL (same behaviour as
 *     the pre-port image file paste path).
 */

/** English strings for keys the eSigns code calls without a defaultValue. */
const DEFAULT_STRINGS: Record<string, string> = {
  "common.cancel": "Cancel",
  "editor.common.reset": "Reset",
  "editor.tools.image.alignment": "Alignment",
  "editor.tools.image.leftAlign": "Align left",
  "editor.tools.image.centerAlign": "Align center",
  "editor.tools.image.rightAlign": "Align right",
  "editor.tools.image.aspectRatio": "Aspect ratio",
  "editor.tools.image.aspectRatioHelp": "Choose a ratio to reshape the image frame",
  "editor.tools.image.ratioFree": "Free",
  "editor.tools.image.ratioLocked": "Locked (keep current proportions)",
  "editor.tools.image.ratioSquare": "Square (1:1)",
  "editor.tools.image.ratioStandard": "Standard (4:3)",
  "editor.tools.image.ratioClassic": "Classic (3:2)",
  "editor.tools.image.ratioWide": "Wide (16:9)",
  "editor.tools.image.ratioPortrait": "Portrait (9:16)",
  "editor.tools.image.ratioVertical": "Vertical (3:4)",
  "editor.tools.image.ratioPanoramic": "Panoramic (2:1)",
  "editor.tools.image.ratioTall": "Tall (1:2)",
  "editor.tools.image.ratioStory": "Story (9:10)",
  "editor.tools.image.rotate": "Rotate",
  "editor.tools.image.rotateLeft": "Rotate left",
  "editor.tools.image.rotateRight": "Rotate right",
  "editor.tools.image.flip": "Flip",
  "editor.tools.image.flipHorizontal": "Flip horizontally",
  "editor.tools.image.flipVertical": "Flip vertically",
  "editor.tools.image.zoom": "Zoom",
  "editor.tools.image.zoomIn": "Zoom in",
  "editor.tools.image.zoomOut": "Zoom out",
  "editor.tools.image.margins": "Margins",
  "editor.tools.image.marginsHelp": "Space around the image, in pixels",
  "editor.tools.image.top": "Top",
  "editor.tools.image.right": "Right",
  "editor.tools.image.bottom": "Bottom",
  "editor.tools.image.left": "Left",
  "editor.tools.image.topMargin": "Top margin",
  "editor.tools.image.rightMargin": "Right margin",
  "editor.tools.image.bottomMargin": "Bottom margin",
  "editor.tools.image.leftMargin": "Left margin",
  "editor.tools.image.resetAllMargins": "Reset all margins",
  "editor.tools.image.chooseFile": "Choose file",
  "editor.tools.image.clickToUpload": "Click to upload",
  "editor.tools.image.orDragDrop": "or drag and drop an image",
  "editor.tools.image.pasteUrl": "Paste URL",
  "editor.tools.image.pasteHint": "Press {{key}} to paste an image or image URL",
  "editor.tools.image.load": "Load",
  "editor.tools.image.enterUrl": "Enter an image URL",
  "editor.tools.image.enterValidUrl": "Enter a valid image URL (http or https)",
  "editor.tools.image.typeNotAccepted": "That file type isn't supported",
  "editor.tools.image.failedToLoad": "The image failed to load",
  "editor.tools.image.tryAnother": "Try another image or check the link",
  "editor.tools.image.tryAgain": "Try again",
  "editor.tools.image.imagePreview": "Image",
  "editor.tools.image.uploading": "Uploading image…",
  "editor.tools.image.uploadFailedEmbedded":
    "Upload failed — the image was embedded in the document instead.",
  "editor.tools.image.uploadFailed": "Couldn't add the image: {{reason}}",
  "editor.tools.image.linkedNotCopied":
    "Couldn't copy the image — it is linked from its original address.",
};

/** Inline shim for the eSigns i18n layer. Picks `options.defaultValue`,
 *  then the English table above, then a label derived from the key's
 *  last segment — and interpolates `{{var}}` placeholders from `options`. */
export function t(
  key: string,
  options?: { defaultValue?: string } & Record<string, unknown>,
): string {
  let text: string;
  if (options && typeof options.defaultValue === "string") {
    text = options.defaultValue;
  } else if (DEFAULT_STRINGS[key]) {
    text = DEFAULT_STRINGS[key];
  } else {
    const last = key.split(".").pop() || key;
    const spaced = last.replace(/([A-Z])/g, " $1").replace(/[._-]/g, " ").trim();
    text = spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }
  if (!options) return text;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) =>
    name !== "defaultValue" && options[name] !== undefined && options[name] !== null
      ? String(options[name])
      : match,
  );
}

// ── Wrap contract ──────────────────────────────────────────────────────
// The tool never floats anything itself: it tags its root with exactly one
// of these classes and the editor CSS / paginator decide the layout (the
// whole `.ce-block` is floated for the two float modes).

export type ImageWrapMode = "inline" | "top-bottom" | "float-left" | "float-right";

export const IMAGE_WRAP_CLASSES: Record<ImageWrapMode, string> = {
  inline: "tp-image--inline",
  "top-bottom": "tp-image--top-bottom",
  "float-left": "tp-image--float-left",
  "float-right": "tp-image--float-right",
};

const FLOAT_WRAPS = new Set(["square", "tight", "through"]);

/**
 * Canonical wrap mode for saved image data (`data.tunes.imageTune`).
 *   inline                       → inline
 *   square / tight / through     → float-left / float-right by `float`
 *                                  (legacy `float: "inline"` never floated
 *                                  → top-bottom)
 *   top-bottom / none / behind / in-front / missing → top-bottom
 */
export function imageWrapMode(data: unknown): ImageWrapMode {
  const tune = (data as { tunes?: { imageTune?: { wrapText?: unknown; float?: unknown } } } | null)
    ?.tunes?.imageTune;
  const wrap = typeof tune?.wrapText === "string" ? tune.wrapText : "";
  if (wrap === "inline") return "inline";
  if (FLOAT_WRAPS.has(wrap)) {
    if (tune?.float === "left") return "float-left";
    if (tune?.float === "right") return "float-right";
  }
  return "top-bottom";
}

/** `"123px"` / `123` → 123; anything else → 0. */
export function parsePx(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  if (typeof value !== "string" || value.includes("%")) return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Read a Blob as a data: URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** True when the page can actually rasterise images (not jsdom / SSR). */
export function canRasterize(): boolean {
  if (typeof document === "undefined" || typeof Image === "undefined") return false;
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const c = document.createElement("canvas");
    return typeof c.getContext === "function" && !!c.getContext("2d");
  } catch {
    return false;
  }
}

/**
 * Draw an image (SVG, WebP, …) onto a canvas and return PNG bytes. Only
 * works in a real browser; rejects in jsdom so callers can fall back.
 */
export async function rasterizeToPng(
  blob: Blob,
  size?: { width: number; height: number },
): Promise<Blob> {
  if (!canRasterize()) throw new Error("canvas rasterisation unavailable");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = objectUrl;
    });
    const w = Math.max(1, Math.round(size?.width || img.naturalWidth || 300));
    const h = Math.max(1, Math.round(size?.height || img.naturalHeight || 150));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Raster types a data: URL may carry (mirrors safeUrl's allow-list). */
const EMBEDDABLE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

/** Image URLs recognised in pasted text / the URL field. */
const IMAGE_URL_PATTERN = /^(https?:\/\/|\/)\S+\.(?:jpe?g|png|gif|bmp|webp|svg)(?:[?#]\S*)?$/i;

/** File-picker filter: everything the browser can show; non-raster types
 *  are uploaded as-is or rasterised before embedding. */
const ACCEPT_TYPES =
  "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/*";

/** Outcome of turning a file / URL into something `data.url` can hold. */
interface IngestResult {
  url: string;
  /** Why we didn't end up with an uploaded copy (shown to the user). */
  notice?: string;
}

/** Any angle → 0, 90, 180 or 270-style value in [0, 360). */
export function normalizeRotation(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 360) + 360) % 360;
}

/** The single open settings panel across all image blocks. */
let openPanelOwner: ImageTool | null = null;

/** eSigns called `failedPopper(message)` to show a toast on bad user input;
 *  the TP-Writer port surfaces the same message via a console warning. */
function failedPopper(message: string): void {
  console.warn(message);
}

/** Replaces the eSigns `isPrintRoute` helper. The image tool only cares
 *  about hiding resize chrome on the completed/print view. */
function isPrintRoute(pathname: string): boolean {
  return pathname.includes("/print") || pathname.includes("/complete");
}

/** Config shape consumed by this tool. `uploader` is the single plug-in
 *  point for hosting an uploaded image — return the hosted URL. When
 *  omitted, images are embedded inline as base64 data URLs. */
export interface ImageToolConfig {
  uploader?: (file: File) => Promise<{ url: string }>;
  // Fallback for callers using the generic EditorJSComponent onImageUpload
  // signature — same contract as `uploader`.
  onImageUpload?: (file: File) => Promise<{ url: string }>;
  isEditable?: boolean;
  [key: string]: unknown;
}

interface CustomImageToolData {
  url: string;
  caption: string;
  width: string;
  height: string;
  rotation: number;
  aspectRatio: string;
  flipX: boolean;
  flipY: boolean;
  zoom: number;
  // Tier-1 additions. All optional + default-off so legacy image blocks
  // load exactly as before.
  altText?: string;
  border?: {
    width: string; // "1px", "2px", ...
    style: string; // "solid" | "dashed" | "dotted" | "double" | "none"
    color: string; // "#000000"
  };
  originalUrl?: string; // snapshot taken on first render, used by Reset
  // Captions are OFF by default. Only when the admin flips this on does
  // renderCaption() paint anything — no hover ghost, no text, no reserved
  // row. Keeps a stock image inserted into a template completely clean.
  showCaption?: boolean;
  // Four-sided inset crop expressed as percentages of the image's natural
  // dimensions. Rendering clips the overflow of a container sized to the
  // visible portion only; omit the object entirely for an uncropped image.
  crop?: { top: number; right: number; bottom: number; left: number };
  // Tier-2 additions. All optional + default-off.
  link?: { url: string; openInNewTab: boolean };
  shadow?: "none" | "soft" | "medium" | "strong";
  filters?: { brightness: number; contrast: number; saturation: number };
  shape?: "rectangle" | "rounded" | "circle";
  tunes?: {
    alignment?: {
      alignment: string;
    };
    imageTune?: {
      float: string;
      wrapText: string;
      position: string;
      marginTop?: string;
      marginRight?: string;
      marginBottom?: string;
      marginLeft?: string;
    };
  };
}

export default class ImageTool {
  static get toolbox() {
    return {
      title: "Image",
      // Lucide "Image" — rounded frame with sun + mountain. The old
      // icon had no stroke attributes so EditorJS rendered it as a
      // solid black square in the palette.
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get pasteConfig() {
    return {
      tags: ["IMG"],
      patterns: {
        image: /https?:\/\/.*\.(?:jpe?g|png|gif|bmp|webp)/i,
      },
      files: {
        mimeTypes: ["image/*"],
      },
    };
  }

  /** Editor.js paste / drop entry point. Returns the ingest promise (never
   *  rejects) so tests and callers can await the result. */
  onPaste(event: CustomEvent): Promise<void> {
    const detail = event?.detail ?? {};
    switch (detail.type) {
      case "file": {
        const file = detail.file as File;
        if (file && typeof file.type === "string" && file.type.startsWith("image/")) {
          return this.runIngest(() => this.ingestFile(file));
        }
        break;
      }
      case "tag": {
        const img = detail.data as HTMLImageElement;
        const src = img?.getAttribute?.("src") || img?.src || "";
        if (img?.alt && !this.data.altText) this.data.altText = img.alt;
        if (src) return this.runIngest(() => this.ingestUrl(src));
        break;
      }
      case "pattern":
        if (detail.key === "image" && typeof detail.data === "string") {
          return this.runIngest(() => this.ingestUrl(detail.data.trim()));
        }
        break;
    }
    return Promise.resolve();
  }

  // renderSettings() intentionally omitted — EditorJS falls back to the
  // standard tunes when a tool doesn't define its own panel, which was
  // duplicating the admin-only chrome we already surface via the right-click
  // context menu. The right-click menu is the single source of truth for
  // image settings; see _createContextMenu, _createLayoutSection,
  // _createTransformSection, _createMarginsSection.

  private renderLayoutSettings(container: HTMLElement): void {
    const alignmentSection = this.createSection(
      t("editor.tools.image.alignment"),
    );
    container.appendChild(alignmentSection);

    const alignmentButtons = document.createElement("div");
    alignmentButtons.style.display = "flex";
    alignmentButtons.style.gap = "8px";
    alignmentButtons.style.width = "100%";
    alignmentButtons.style.justifyContent = "center";

    const alignments = [
      {
        value: "left",
        icon: "⬅",
        label: t("editor.tools.image.leftAlign"),
      },
      {
        value: "center",
        icon: "⫿",
        label: t("editor.tools.image.centerAlign"),
      },
      {
        value: "right",
        icon: "➡",
        label: t("editor.tools.image.rightAlign"),
      },
    ];

    alignments.forEach((align) => {
      const button = this.createIconButton(align.icon, align.label, () => {
        this.setAlignment(align.value);
        alignments.forEach((a) => {
          const btn = alignmentButtons.querySelector(
            `[data-align="${a.value}"]`,
          ) as HTMLElement;
          if (btn) {
            const isActive = a.value === align.value;
            btn.style.backgroundColor = isActive ? "#4086FF" : "#fff";
            btn.style.color = isActive ? "#fff" : "#4086FF";
            btn.style.borderColor = isActive ? "#4086FF" : "#d0d5dd";
          }
        });
      });
      button.setAttribute("data-align", align.value);

      const isActive =
        (this.data.tunes?.alignment?.alignment || "left") === align.value;
      if (isActive) {
        button.style.backgroundColor = "#4086FF";
        button.style.color = "#fff";
        button.style.borderColor = "#4086FF";
      }

      alignmentButtons.appendChild(button);
    });
    container.appendChild(alignmentButtons);

    // ── Text wrapping ────────────────────────────────────────────────────
    const wrapTitle = this.createSection(
      t("editor.tools.image.textWrapping", {
        defaultValue: "Text wrapping",
      }),
    );
    container.appendChild(wrapTitle);
    const wrapGrid = document.createElement("div");
    wrapGrid.style.cssText =
      "display:grid;grid-template-columns:1fr 1fr;gap:6px;";
    const wraps = [
      {
        value: "inline",
        label: t("editor.tools.image.wrapInline", {
          defaultValue: "Inline",
        }),
      },
      {
        value: "square",
        label: t("editor.tools.image.wrapSquare", {
          defaultValue: "Square",
        }),
      },
      {
        value: "tight",
        label: t("editor.tools.image.wrapTight", {
          defaultValue: "Tight",
        }),
      },
      {
        value: "through",
        label: t("editor.tools.image.wrapThrough", {
          defaultValue: "Through",
        }),
      },
      {
        value: "top-bottom",
        label: t("editor.tools.image.wrapTopBottom", {
          defaultValue: "Top & bottom",
        }),
      },
      {
        value: "none",
        label: t("editor.tools.image.wrapNone", { defaultValue: "None" }),
      },
    ];
    wraps.forEach(({ value, label }) => {
      const b = this.createButton(label, () => {
        this.setWrapText(value);
        wrapGrid.querySelectorAll("button").forEach((el) => {
          const btn = el as HTMLButtonElement;
          const isActive = btn.dataset.wrap === value;
          btn.style.backgroundColor = isActive ? "#2563eb" : "#fff";
          btn.style.color = isActive ? "#fff" : "#475569";
          btn.style.borderColor = isActive ? "#2563eb" : "#d0d5dd";
        });
      });
      b.dataset.wrap = value;
      b.style.fontSize = "12px";
      const isActive =
        (this.data.tunes?.imageTune?.wrapText || "top-bottom") === value;
      if (isActive) {
        b.style.backgroundColor = "#2563eb";
        b.style.color = "#fff";
        b.style.borderColor = "#2563eb";
      }
      wrapGrid.appendChild(b);
    });
    container.appendChild(wrapGrid);

    const aspectSection = this.createSection(
      t("editor.tools.image.aspectRatio"),
    );
    container.appendChild(aspectSection);

    const select = document.createElement("select");
    select.innerHTML = `
      <option value="free">${t("editor.tools.image.ratioFree")}</option>
      <option value="locked">${t("editor.tools.image.ratioLocked")}</option>
      <option value="1:1">${t("editor.tools.image.ratioSquare")}</option>
      <option value="4:3">${t("editor.tools.image.ratioStandard")}</option>
      <option value="3:2">${t("editor.tools.image.ratioClassic")}</option>
      <option value="16:9">${t("editor.tools.image.ratioWide")}</option>
      <option value="9:16">${t("editor.tools.image.ratioPortrait")}</option>
      <option value="3:4">${t("editor.tools.image.ratioVertical")}</option>
      <option value="2:1">${t("editor.tools.image.ratioPanoramic")}</option>
      <option value="1:2">${t("editor.tools.image.ratioTall")}</option>
      <option value="9:10">${t("editor.tools.image.ratioStory")}</option>
    `;
    select.value = this.data.aspectRatio;
    select.style.width = "100%";
    select.style.padding = "10px 12px";
    select.style.border = "1px solid #d0d5dd";
    select.style.borderRadius = "6px";
    select.style.backgroundColor = "#fff";
    select.style.fontSize = "14px";
    select.style.color = "#344054";
    select.style.cursor = "pointer";
    select.style.transition = "all 0.2s ease";
    select.style.fontFamily = "inherit";

    select.addEventListener("change", (event) => {
      this.data.aspectRatio = (event.target as HTMLSelectElement).value;
      this.applyAspectRatio();
      syncSizeFields();
      refreshLockBtn();
    });

    select.addEventListener("focus", () => {
      select.style.borderColor = "#4086FF";
      select.style.boxShadow = "0 0 0 3px rgba(64, 134, 255, 0.1)";
    });

    select.addEventListener("blur", () => {
      select.style.borderColor = "#d0d5dd";
      select.style.boxShadow = "none";
    });

    container.appendChild(select);

    const helpText = document.createElement("div");
    helpText.style.fontSize = "12px";
    helpText.style.color = "#667085";
    helpText.style.marginTop = "8px";
    helpText.style.textAlign = "center";
    helpText.textContent = t("editor.tools.image.aspectRatioHelp");
    container.appendChild(helpText);

    // ── Size (numeric W/H + lock aspect) ─────────────────────────────────
    const sizeSection = this.createSection(
      t("editor.tools.image.sizeTitle", { defaultValue: "Size" }),
    );
    container.appendChild(sizeSection);

    const sizeRow = document.createElement("div");
    sizeRow.style.cssText = "display:flex;gap:8px;align-items:flex-end;";

    const currentImg = () =>
      this.imageContainer?.querySelector("img") as HTMLImageElement | null;
    // Ratio to hold when the lock is on / a preset is picked: the current
    // box first (what the user sees), else the picture's natural ratio.
    const currentRatio = () => this.currentAspect();

    const makeNumField = (label: string, initial: number) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "flex:1;display:flex;flex-direction:column;gap:4px;";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      lbl.style.cssText = "font-size:11px;color:#6b7280;";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "20";
      input.max = "2000";
      input.value = String(initial || 0);
      input.style.cssText =
        "padding:8px;border:1px solid #d0d5dd;border-radius:6px;font-size:14px;width:100%;";
      wrap.appendChild(lbl);
      wrap.appendChild(input);
      return { wrap, input };
    };

    const widthField = makeNumField(
      t("editor.tools.image.widthPx", { defaultValue: "Width (px)" }),
      Math.round(parsePx(this.data.width)),
    );
    const heightField = makeNumField(
      t("editor.tools.image.heightPx", { defaultValue: "Height (px)" }),
      Math.round(parsePx(this.data.height)),
    );
    const syncSizeFields = () => {
      widthField.input.value = String(Math.round(parsePx(this.data.width)));
      heightField.input.value = String(Math.round(parsePx(this.data.height)));
    };

    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    const refreshLockBtn = () => {
      const locked = this.data.aspectRatio && this.data.aspectRatio !== "free";
      lockBtn.textContent = locked ? "🔒" : "🔓";
      lockBtn.title = locked
        ? t("editor.tools.image.aspectLocked", {
            defaultValue: "Aspect ratio locked",
          })
        : t("editor.tools.image.aspectUnlocked", {
            defaultValue: "Aspect ratio unlocked",
          });
      lockBtn.style.background = locked ? "#eff6ff" : "#fff";
      lockBtn.style.borderColor = locked ? "#2563eb" : "#d0d5dd";
      lockBtn.style.color = locked ? "#2563eb" : "#475569";
    };
    lockBtn.style.cssText =
      "padding:8px 10px;border:1px solid #d0d5dd;background:#fff;border-radius:6px;cursor:pointer;height:38px;";
    refreshLockBtn();
    lockBtn.addEventListener("click", () => {
      // "locked" keeps whatever proportions the image has right now. (It
      // used to store "1:1", which squashed the picture into a square on
      // the next render.)
      if (this.data.aspectRatio && this.data.aspectRatio !== "free") {
        this.data.aspectRatio = "free";
      } else {
        this.data.aspectRatio = "locked";
      }
      select.value = this.data.aspectRatio;
      refreshLockBtn();
    });

    const applySize = (changedAxis: "w" | "h", keepRatio = false) => {
      const img = currentImg();
      if (!img) return;
      const r = currentRatio() || 1;
      let w = Math.min(2000, Math.max(20, Math.round(parsePx(widthField.input.value)) || 0));
      let h = Math.min(2000, Math.max(20, Math.round(parsePx(heightField.input.value)) || 0));
      const locked =
        keepRatio || (this.data.aspectRatio && this.data.aspectRatio !== "free");
      if (locked) {
        if (changedAxis === "w") {
          h = Math.round(w / r);
          heightField.input.value = String(h);
        } else {
          w = Math.round(h * r);
          widthField.input.value = String(w);
        }
      }
      widthField.input.value = String(w);
      heightField.input.value = String(h);
      this.setImageSize(w, h);
    };
    widthField.input.addEventListener("change", () => applySize("w"));
    heightField.input.addEventListener("change", () => applySize("h"));

    sizeRow.appendChild(widthField.wrap);
    sizeRow.appendChild(lockBtn);
    sizeRow.appendChild(heightField.wrap);
    container.appendChild(sizeRow);

    // ── Preset sizes (Tier-2) ────────────────────────────────────────────
    // Fixed width values; honours the aspect lock so heights snap too.
    const presetsRow = document.createElement("div");
    presetsRow.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    const presets: { label: string; width: number | "full" }[] = [
      {
        label: t("editor.tools.image.presetS", { defaultValue: "Small" }),
        width: 150,
      },
      {
        label: t("editor.tools.image.presetM", { defaultValue: "Medium" }),
        width: 400,
      },
      {
        label: t("editor.tools.image.presetL", { defaultValue: "Large" }),
        width: 600,
      },
      {
        label: t("editor.tools.image.presetFull", {
          defaultValue: "Full width",
        }),
        width: "full",
      },
    ];
    presets.forEach(({ label, width }) => {
      const b = this.createButton(label, () => {
        const targetW = width === "full" ? this.MAX_PARENT_WIDTH : width;
        widthField.input.value = String(targetW);
        // Presets resize; they never distort the picture.
        applySize("w", true);
      });
      b.style.flex = "1";
      b.style.fontSize = "12px";
      presetsRow.appendChild(b);
    });
    container.appendChild(presetsRow);

    // ── Shape (Tier-2) ───────────────────────────────────────────────────
    const shapeSection = this.createSection(
      t("editor.tools.image.shapeTitle", { defaultValue: "Shape" }),
    );
    container.appendChild(shapeSection);

    const shapeRow = document.createElement("div");
    shapeRow.style.cssText = "display:flex;gap:6px;";
    const shapes: {
      value: NonNullable<typeof this.data.shape>;
      label: string;
    }[] = [
      {
        value: "rectangle",
        label: t("editor.tools.image.shapeRect", {
          defaultValue: "Rectangle",
        }),
      },
      {
        value: "rounded",
        label: t("editor.tools.image.shapeRounded", {
          defaultValue: "Rounded",
        }),
      },
      {
        value: "circle",
        label: t("editor.tools.image.shapeCircle", {
          defaultValue: "Circle",
        }),
      },
    ];
    shapes.forEach(({ value, label }) => {
      const b = this.createButton(label, () => {
        this.data.shape = value;
        this.applyShapeAndShadow();
        // Refresh active-state on all three.
        shapeRow.querySelectorAll("button").forEach((el) => {
          const btn = el as HTMLButtonElement;
          const isActive = btn.dataset.shape === this.data.shape;
          btn.style.backgroundColor = isActive ? "#2563eb" : "#fff";
          btn.style.color = isActive ? "#fff" : "#475569";
          btn.style.borderColor = isActive ? "#2563eb" : "#d0d5dd";
        });
      });
      b.dataset.shape = value;
      b.style.flex = "1";
      b.style.fontSize = "12px";
      const isActive = (this.data.shape || "rectangle") === value;
      if (isActive) {
        b.style.backgroundColor = "#2563eb";
        b.style.color = "#fff";
        b.style.borderColor = "#2563eb";
      }
      shapeRow.appendChild(b);
    });
    container.appendChild(shapeRow);

    // ── Shadow (Tier-2) ──────────────────────────────────────────────────
    const shadowSection = this.createSection(
      t("editor.tools.image.shadowTitle", { defaultValue: "Shadow" }),
    );
    container.appendChild(shadowSection);

    const shadowRow = document.createElement("div");
    shadowRow.style.cssText = "display:flex;gap:6px;";
    const shadows: {
      value: NonNullable<typeof this.data.shadow>;
      label: string;
    }[] = [
      {
        value: "none",
        label: t("editor.tools.image.shadowNone", {
          defaultValue: "None",
        }),
      },
      {
        value: "soft",
        label: t("editor.tools.image.shadowSoft", {
          defaultValue: "Soft",
        }),
      },
      {
        value: "medium",
        label: t("editor.tools.image.shadowMedium", {
          defaultValue: "Medium",
        }),
      },
      {
        value: "strong",
        label: t("editor.tools.image.shadowStrong", {
          defaultValue: "Strong",
        }),
      },
    ];
    shadows.forEach(({ value, label }) => {
      const b = this.createButton(label, () => {
        this.data.shadow = value;
        this.applyShapeAndShadow();
        shadowRow.querySelectorAll("button").forEach((el) => {
          const btn = el as HTMLButtonElement;
          const isActive = btn.dataset.shadow === this.data.shadow;
          btn.style.backgroundColor = isActive ? "#2563eb" : "#fff";
          btn.style.color = isActive ? "#fff" : "#475569";
          btn.style.borderColor = isActive ? "#2563eb" : "#d0d5dd";
        });
      });
      b.dataset.shadow = value;
      b.style.flex = "1";
      b.style.fontSize = "12px";
      const isActive = (this.data.shadow || "none") === value;
      if (isActive) {
        b.style.backgroundColor = "#2563eb";
        b.style.color = "#fff";
        b.style.borderColor = "#2563eb";
      }
      shadowRow.appendChild(b);
    });
    container.appendChild(shadowRow);

    // ── Hyperlink (Tier-2) ───────────────────────────────────────────────
    const linkSection = this.createSection(
      t("editor.tools.image.linkTitle", { defaultValue: "Link" }),
    );
    container.appendChild(linkSection);

    const linkInput = document.createElement("input");
    linkInput.type = "url";
    linkInput.value = this.data.link?.url || "";
    linkInput.placeholder = "https://example.com";
    linkInput.style.cssText =
      "width:100%;padding:8px 10px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px;box-sizing:border-box;";
    const linkTargetRow = document.createElement("label");
    linkTargetRow.style.cssText =
      "display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;font-size:12px;color:#4b5563;user-select:none;";
    const linkTargetCheckbox = document.createElement("input");
    linkTargetCheckbox.type = "checkbox";
    linkTargetCheckbox.checked = this.data.link?.openInNewTab ?? true;
    const linkTargetText = document.createElement("span");
    linkTargetText.textContent = t("editor.tools.image.linkNewTab", {
      defaultValue: "Open in new tab",
    });
    linkTargetRow.appendChild(linkTargetCheckbox);
    linkTargetRow.appendChild(linkTargetText);

    const commitLink = () => {
      const url = linkInput.value.trim();
      if (!url || !isSafeLinkUrl(url)) {
        // Reject javascript:/data: and other non-navigational schemes.
        if (url) linkInput.value = "";
        this.data.link = undefined;
      } else {
        this.data.link = {
          url,
          openInNewTab: linkTargetCheckbox.checked,
        };
      }
      this.applyLinkWrapper();
    };
    linkInput.addEventListener("change", commitLink);
    linkTargetCheckbox.addEventListener("change", commitLink);
    container.appendChild(linkInput);
    container.appendChild(linkTargetRow);

    // ── Border ───────────────────────────────────────────────────────────
    const borderSection = this.createSection(
      t("editor.tools.image.borderTitle", { defaultValue: "Border" }),
    );
    container.appendChild(borderSection);

    const borderRow = document.createElement("div");
    borderRow.style.cssText = "display:flex;gap:8px;align-items:center;";

    const styleSelect = document.createElement("select");
    styleSelect.innerHTML = `
      <option value="none">${t("editor.tools.table.none", { defaultValue: "None" })}</option>
      <option value="solid">${t("editor.tools.table.solid", { defaultValue: "Solid" })}</option>
      <option value="dashed">${t("editor.tools.table.dashed", { defaultValue: "Dashed" })}</option>
      <option value="dotted">${t("editor.tools.table.dotted", { defaultValue: "Dotted" })}</option>
      <option value="double">${t("editor.tools.table.double", { defaultValue: "Double" })}</option>
    `;
    styleSelect.value = this.data.border?.style || "none";
    styleSelect.style.cssText =
      "flex:1;padding:8px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px;background:#fff;";

    const widthSelect = document.createElement("select");
    const widths = ["1px", "2px", "3px", "4px", "6px"];
    widths.forEach((w) => {
      const o = document.createElement("option");
      o.value = w;
      o.textContent = w;
      widthSelect.appendChild(o);
    });
    widthSelect.value = this.data.border?.width || "1px";
    widthSelect.style.cssText =
      "width:70px;padding:8px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px;background:#fff;";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = this.data.border?.color || "#000000";
    colorInput.style.cssText =
      "width:38px;height:38px;padding:0;border:1px solid #d0d5dd;border-radius:6px;cursor:pointer;background:#fff;";

    const commitBorder = () => {
      const style = styleSelect.value;
      if (style === "none") {
        this.data.border = undefined;
      } else {
        this.data.border = {
          style,
          width: widthSelect.value,
          color: colorInput.value,
        };
      }
      this.applyBorderStyles();
      // Border styling resets the radius; re-apply the chosen shape on top.
      this.applyShapeAndShadow();
      this.syncWrapContract();
    };
    styleSelect.addEventListener("change", commitBorder);
    widthSelect.addEventListener("change", commitBorder);
    colorInput.addEventListener("change", commitBorder);

    borderRow.appendChild(styleSelect);
    borderRow.appendChild(widthSelect);
    borderRow.appendChild(colorInput);
    container.appendChild(borderRow);

    // ── Alt text (accessibility) ─────────────────────────────────────────
    const altSection = this.createSection(
      t("editor.tools.image.altTitle", { defaultValue: "Alt text" }),
    );
    container.appendChild(altSection);

    const altInput = document.createElement("input");
    altInput.type = "text";
    altInput.value = this.data.altText || "";
    altInput.placeholder = t("editor.tools.image.altPlaceholder", {
      defaultValue: "Describe the image for screen readers",
    });
    altInput.style.cssText =
      "width:100%;padding:8px 10px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px;";
    altInput.addEventListener("input", () => {
      this.data.altText = altInput.value;
      const img = currentImg();
      if (img) img.alt = altInput.value;
    });
    container.appendChild(altInput);

    // ── Caption ──────────────────────────────────────────────────────────
    // Toggle gates the text input + the under-image render. Admin flips
    // the switch on → the input enables and the caption appears below
    // the image; flips off → everything hides (and the stored string is
    // preserved so toggling back on brings it back).
    const captionSection = this.createSection(
      t("editor.tools.image.captionTitle", { defaultValue: "Caption" }),
    );
    container.appendChild(captionSection);

    const captionToggleRow = document.createElement("label");
    captionToggleRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;cursor:pointer;user-select:none;font-size:12px;color:#4b5563;";
    const captionToggleLabel = document.createElement("span");
    captionToggleLabel.textContent = t("editor.tools.image.captionShow", {
      defaultValue: "Show caption",
    });

    // Minimal pill-style switch (no extra lib). The styling matches the
    // other toggles in the right-panel.
    const switchWrap = document.createElement("span");
    switchWrap.style.cssText = `
      position:relative;display:inline-block;width:34px;height:18px;flex-shrink:0;
    `;
    const switchInput = document.createElement("input");
    switchInput.type = "checkbox";
    switchInput.checked = !!this.data.showCaption;
    switchInput.style.cssText = "opacity:0;width:0;height:0;position:absolute;";
    const switchTrack = document.createElement("span");
    const paintSwitch = () => {
      switchTrack.style.cssText = `
        position:absolute;inset:0;border-radius:999px;transition:background 0.15s;
        background:${switchInput.checked ? "#2563eb" : "#d1d5db"};
      `;
      switchTrack.innerHTML = `<span style="
        position:absolute;top:2px;left:${switchInput.checked ? "18px" : "2px"};
        width:14px;height:14px;background:#fff;border-radius:50%;
        transition:left 0.15s;box-shadow:0 1px 2px rgba(0,0,0,0.2);
      "></span>`;
    };
    paintSwitch();
    switchWrap.appendChild(switchInput);
    switchWrap.appendChild(switchTrack);
    captionToggleRow.appendChild(captionToggleLabel);
    captionToggleRow.appendChild(switchWrap);
    container.appendChild(captionToggleRow);

    const captionInput = document.createElement("input");
    captionInput.type = "text";
    captionInput.value = this.data.caption || "";
    captionInput.placeholder = t("editor.tools.image.captionPlaceholder", {
      defaultValue: "Add a caption…",
    });
    captionInput.style.cssText =
      "width:100%;padding:8px 10px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px;box-sizing:border-box;";
    const refreshCaptionInput = () => {
      captionInput.disabled = !this.data.showCaption;
      captionInput.style.opacity = this.data.showCaption ? "1" : "0.5";
      captionInput.style.cursor = this.data.showCaption ? "text" : "not-allowed";
    };
    refreshCaptionInput();
    captionInput.addEventListener("input", () => {
      this.data.caption = captionInput.value;
      this.renderCaption();
    });
    container.appendChild(captionInput);

    switchInput.addEventListener("change", () => {
      this.data.showCaption = switchInput.checked;
      paintSwitch();
      refreshCaptionInput();
      this.renderCaption();
    });
  }

  private renderTransformSettings(container: HTMLElement): void {
    const rotateSection = this.createSection(
      t("editor.tools.image.rotate"),
    );
    container.appendChild(rotateSection);

    const rotateContainer = document.createElement("div");
    rotateContainer.style.display = "flex";
    rotateContainer.style.gap = "8px";
    rotateContainer.style.width = "100%";

    const rotateLeft = this.createIconButton(
      "↶",
      t("editor.tools.image.rotateLeft"),
      () => {
        this.data.rotation = normalizeRotation(this.data.rotation - 90);
        this.applyTransformation();
        updateRotationDisplay();
      },
    );

    const rotateRight = this.createIconButton(
      "↷",
      t("editor.tools.image.rotateRight"),
      () => {
        this.data.rotation = normalizeRotation(this.data.rotation + 90);
        this.applyTransformation();
        updateRotationDisplay();
      },
    );

    const rotationDisplay = document.createElement("div");
    rotationDisplay.style.flex = "1";
    rotationDisplay.style.textAlign = "center";
    rotationDisplay.style.padding = "10px";
    rotationDisplay.style.backgroundColor = "#f8f9fa";
    rotationDisplay.style.borderRadius = "6px";
    rotationDisplay.style.fontSize = "14px";
    rotationDisplay.style.color = "#344054";
    rotationDisplay.textContent = `${normalizeRotation(this.data.rotation)}°`;

    const updateRotationDisplay = () => {
      rotationDisplay.textContent = `${normalizeRotation(this.data.rotation)}°`;
    };

    rotateContainer.appendChild(rotateLeft);
    rotateContainer.appendChild(rotationDisplay);
    rotateContainer.appendChild(rotateRight);
    container.appendChild(rotateContainer);

    const flipSection = this.createSection(t("editor.tools.image.flip"));
    container.appendChild(flipSection);

    const flipContainer = document.createElement("div");
    flipContainer.style.display = "flex";
    flipContainer.style.gap = "8px";
    flipContainer.style.width = "100%";

    const flipXButton = this.createIconButton(
      "↔",
      t("editor.tools.image.flipHorizontal"),
      () => {
        this.data.flipX = !this.data.flipX;
        this.applyTransformation();
        flipXButton.style.backgroundColor = this.data.flipX
          ? "#4086FF"
          : "#fff";
        flipXButton.style.color = this.data.flipX ? "#fff" : "#4086FF";
      },
    );

    const flipYButton = this.createIconButton(
      "↕",
      t("editor.tools.image.flipVertical"),
      () => {
        this.data.flipY = !this.data.flipY;
        this.applyTransformation();
        flipYButton.style.backgroundColor = this.data.flipY
          ? "#4086FF"
          : "#fff";
        flipYButton.style.color = this.data.flipY ? "#fff" : "#4086FF";
      },
    );

    if (this.data.flipX) {
      flipXButton.style.backgroundColor = "#4086FF";
      flipXButton.style.color = "#fff";
    }
    if (this.data.flipY) {
      flipYButton.style.backgroundColor = "#4086FF";
      flipYButton.style.color = "#fff";
    }

    flipXButton.style.flex = "1";
    flipYButton.style.flex = "1";

    flipContainer.appendChild(flipXButton);
    flipContainer.appendChild(flipYButton);
    container.appendChild(flipContainer);

    const zoomSection = this.createSection(t("editor.tools.image.zoom"));
    container.appendChild(zoomSection);

    const zoomControls = document.createElement("div");
    zoomControls.style.display = "flex";
    zoomControls.style.gap = "8px";
    zoomControls.style.alignItems = "center";
    zoomControls.style.width = "100%";

    const zoomOutButton = this.createIconButton(
      "−",
      t("editor.tools.image.zoomOut"),
      () => {
        this.data.zoom = Math.max(0.1, Math.round(this.data.zoom * 0.9 * 1000) / 1000);
        this.applyZoom();
        updateZoomDisplay();
      },
    );

    const zoomDisplay = document.createElement("div");
    zoomDisplay.style.flex = "1";
    zoomDisplay.style.textAlign = "center";
    zoomDisplay.style.fontSize = "14px";
    zoomDisplay.style.fontWeight = "500";
    zoomDisplay.style.color = "#344054";

    const zoomInButton = this.createIconButton(
      "+",
      t("editor.tools.image.zoomIn"),
      () => {
        this.data.zoom = Math.min(10, Math.round(this.data.zoom * 1.1 * 1000) / 1000);
        this.applyZoom();
        updateZoomDisplay();
      },
    );

    const zoomResetButton = this.createButton(
      t("editor.common.reset"),
      () => {
        this.data.zoom = 1;
        this.applyZoom();
        updateZoomDisplay();
      },
    );
    zoomResetButton.style.marginTop = "8px";
    zoomResetButton.style.width = "100%";
    zoomResetButton.style.backgroundColor = "#f8f9fa";
    zoomResetButton.style.color = "#667085";

    const updateZoomDisplay = () => {
      zoomDisplay.textContent = `${Math.round(this.data.zoom * 100)}%`;
    };

    updateZoomDisplay();

    zoomControls.appendChild(zoomOutButton);
    zoomControls.appendChild(zoomDisplay);
    zoomControls.appendChild(zoomInButton);

    container.appendChild(zoomControls);
    container.appendChild(zoomResetButton);

    // ── Filters (Tier-2) ────────────────────────────────────────────────
    const filterSection = this.createSection(
      t("editor.tools.image.filtersTitle", { defaultValue: "Adjust" }),
    );
    container.appendChild(filterSection);

    // Keep slider refs so Reset-adjustments can update them in-place
    // instead of re-mounting the whole Transform tab (which would reset
    // scroll + any mid-interaction state).
    const sliderRefs: {
      el: HTMLInputElement;
      valueLabel: HTMLSpanElement;
      key: "brightness" | "contrast" | "saturation";
    }[] = [];

    const makeSlider = (
      label: string,
      key: "brightness" | "contrast" | "saturation",
    ) => {
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "display:flex;flex-direction:column;gap:4px;margin-bottom:8px;";
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;justify-content:space-between;align-items:center;";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      lbl.style.cssText = "font-size:11px;color:#6b7280;";
      const val = document.createElement("span");
      val.style.cssText =
        "font-size:11px;color:#374151;font-variant-numeric:tabular-nums;";
      val.textContent = `${this.data.filters?.[key] ?? 100}%`;
      row.appendChild(lbl);
      row.appendChild(val);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "200";
      slider.step = "5";
      slider.value = String(this.data.filters?.[key] ?? 100);
      slider.style.cssText = "width:100%;accent-color:#2563eb;";
      slider.addEventListener("input", () => {
        if (!this.data.filters) {
          this.data.filters = {
            brightness: 100,
            contrast: 100,
            saturation: 100,
          };
        }
        this.data.filters[key] = parseInt(slider.value, 10);
        val.textContent = `${this.data.filters[key]}%`;
        this.applyFilters();
      });
      wrap.appendChild(row);
      wrap.appendChild(slider);
      sliderRefs.push({ el: slider, valueLabel: val, key });
      return wrap;
    };

    container.appendChild(
      makeSlider(
        t("editor.tools.image.brightness", { defaultValue: "Brightness" }),
        "brightness",
      ),
    );
    container.appendChild(
      makeSlider(
        t("editor.tools.image.contrast", { defaultValue: "Contrast" }),
        "contrast",
      ),
    );
    container.appendChild(
      makeSlider(
        t("editor.tools.image.saturation", { defaultValue: "Saturation" }),
        "saturation",
      ),
    );

    const resetFiltersBtn = this.createButton(
      t("editor.tools.image.filtersReset", {
        defaultValue: "Reset adjustments",
      }),
      () => {
        this.data.filters = { brightness: 100, contrast: 100, saturation: 100 };
        this.applyFilters();
        sliderRefs.forEach(({ el, valueLabel }) => {
          el.value = "100";
          valueLabel.textContent = "100%";
        });
      },
    );
    resetFiltersBtn.style.width = "100%";
    resetFiltersBtn.style.backgroundColor = "#f8f9fa";
    resetFiltersBtn.style.color = "#667085";
    container.appendChild(resetFiltersBtn);

    // ── Crop ────────────────────────────────────────────────────────────
    const cropSection = this.createSection(
      t("editor.tools.image.cropTitle", { defaultValue: "Crop" }),
    );
    container.appendChild(cropSection);

    const cropRow = document.createElement("div");
    cropRow.style.cssText = "display:flex;gap:8px;";

    const cropBtn = this.createButton(
      this.data.crop
        ? t("editor.tools.image.cropEdit", { defaultValue: "Edit crop" })
        : t("editor.tools.image.cropStart", {
            defaultValue: "Crop image",
          }),
      () => this.enterCropMode(),
    );
    cropBtn.style.flex = "1";
    cropRow.appendChild(cropBtn);

    if (this.data.crop) {
      const clearCropBtn = this.createButton(
        t("editor.tools.image.cropClear", { defaultValue: "Clear" }),
        () => this.clearCrop(),
      );
      clearCropBtn.style.flex = "0 0 auto";
      clearCropBtn.style.backgroundColor = "#fef2f2";
      clearCropBtn.style.color = "#dc2626";
      clearCropBtn.style.borderColor = "#fecaca";
      cropRow.appendChild(clearCropBtn);
    }
    container.appendChild(cropRow);

    // ── Replace image ───────────────────────────────────────────────────
    const replaceSection = this.createSection(
      t("editor.tools.image.replaceTitle", {
        defaultValue: "Replace image",
      }),
    );
    container.appendChild(replaceSection);

    const replaceBtn = this.createButton(
      t("editor.tools.image.replaceButton", {
        defaultValue: "Choose new file",
      }),
      () => this.triggerReplaceImage(),
    );
    replaceBtn.style.width = "100%";
    container.appendChild(replaceBtn);

    // ── Reset to original ───────────────────────────────────────────────
    const resetSection = this.createSection(
      t("editor.tools.image.resetTitle", { defaultValue: "Reset" }),
    );
    container.appendChild(resetSection);

    const resetBtn = this.createButton(
      t("editor.tools.image.resetButton", {
        defaultValue: "Reset to original",
      }),
      () => this.resetToOriginal(),
    );
    resetBtn.style.width = "100%";
    resetBtn.style.backgroundColor = "#fef2f2";
    resetBtn.style.color = "#dc2626";
    resetBtn.style.borderColor = "#fecaca";
    container.appendChild(resetBtn);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Crop mode. On enter, the image is shown at full natural dimensions
  // with a dark overlay dimming everything outside the current crop rect.
  // 8 handles (4 corners + 4 edge midpoints) let the admin drag the rect.
  // Done commits percentages back to data.crop; Cancel reverts.
  // ──────────────────────────────────────────────────────────────────────────
  private clearCrop(): void {
    this.data.crop = undefined;
    this.createImage();
    this.notifyChange();
  }

  private enterCropMode(): void {
    if (!this.imageContainer || !this.wrapper) return;
    // Already cropping — don't stack a second overlay.
    if (this.imageContainer.querySelector("[data-crop-overlay]")) return;
    const img = this.imageContainer.querySelector(
      "img",
    ) as HTMLImageElement | null;
    if (!img) return;

    // Snapshot current state so Cancel can restore it.
    const savedCrop = this.data.crop ? { ...this.data.crop } : undefined;
    const savedContainerCss = this.imageContainer.style.cssText;
    const savedImgCss = img.style.cssText;

    // Reset the image to full-size, un-clipped so the admin can see the
    // whole picture while they're choosing the crop rectangle.
    const fullW =
      parseInt(this.data.width, 10) ||
      img.naturalWidth ||
      img.offsetWidth ||
      300;
    const fullH =
      parseInt(this.data.height, 10) ||
      img.naturalHeight ||
      img.offsetHeight ||
      200;
    this.imageContainer.style.overflow = "visible";
    this.imageContainer.style.width = `${fullW}px`;
    this.imageContainer.style.height = `${fullH}px`;
    this.imageContainer.style.position = "relative";
    img.style.position = "static";
    img.style.left = "";
    img.style.top = "";
    img.style.width = `${fullW}px`;
    img.style.height = `${fullH}px`;
    img.style.maxWidth = "none";

    // Current crop rect in percentages. Start from saved values or a 10%
    // inset so the admin can see which handles to grab immediately.
    const rect = savedCrop
      ? { ...savedCrop }
      : { top: 10, right: 10, bottom: 10, left: 10 };

    const overlay = document.createElement("div");
    overlay.setAttribute("data-crop-overlay", "true");
    overlay.style.cssText = `
      position:absolute;inset:0;pointer-events:none;z-index:10;
    `;

    // Four side-dim rectangles that form the "mask" with a transparent
    // window where the crop rect is. Easier to drag-handle than a single
    // clip-path mask because each side is a plain div.
    const dim = (sel: string) => {
      const d = document.createElement("div");
      d.setAttribute("data-crop-dim", sel);
      d.style.cssText =
        "position:absolute;background:rgba(0,0,0,0.5);pointer-events:none;";
      return d;
    };
    const dimTop = dim("top");
    const dimRight = dim("right");
    const dimBottom = dim("bottom");
    const dimLeft = dim("left");
    overlay.append(dimTop, dimRight, dimBottom, dimLeft);

    // The crop rectangle outline + handle markers. pointer-events:auto so
    // the handles are grabbable; the rest of the overlay stays passive.
    const outline = document.createElement("div");
    outline.setAttribute("data-crop-rect", "true");
    outline.style.cssText = `
      position:absolute;border:1px dashed #ffffff;
      box-shadow:0 0 0 1px rgba(37,99,235,0.9);
      pointer-events:auto;cursor:move;
    `;
    overlay.appendChild(outline);

    const handles: {
      el: HTMLDivElement;
      pos: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
    }[] = [];
    const addHandle = (pos: (typeof handles)[0]["pos"]) => {
      const h = document.createElement("div");
      h.setAttribute("data-crop-handle", pos);
      const cursorMap: Record<string, string> = {
        nw: "nwse-resize",
        n: "ns-resize",
        ne: "nesw-resize",
        e: "ew-resize",
        se: "nwse-resize",
        s: "ns-resize",
        sw: "nesw-resize",
        w: "ew-resize",
      };
      h.style.cssText = `
        position:absolute;width:10px;height:10px;background:#ffffff;
        border:1.5px solid #2563eb;border-radius:50%;pointer-events:auto;
        cursor:${cursorMap[pos]};z-index:11;
      `;
      outline.appendChild(h);
      handles.push({ el: h, pos });
    };
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((p) =>
      addHandle(p as any),
    );

    this.imageContainer.appendChild(overlay);

    // Position everything from the current `rect` percentages.
    const layout = () => {
      const t = rect.top;
      const r = rect.right;
      const b = rect.bottom;
      const l = rect.left;
      outline.style.top = `${t}%`;
      outline.style.left = `${l}%`;
      outline.style.right = `${r}%`;
      outline.style.bottom = `${b}%`;
      // Assign (not append) so dragging doesn't grow the style string.
      const base = "position:absolute;background:rgba(0,0,0,0.5);pointer-events:none;";
      dimTop.style.cssText = `${base}top:0;left:0;right:0;height:${t}%;`;
      dimBottom.style.cssText = `${base}bottom:0;left:0;right:0;height:${b}%;`;
      dimLeft.style.cssText = `${base}top:${t}%;bottom:${b}%;left:0;width:${l}%;`;
      dimRight.style.cssText = `${base}top:${t}%;bottom:${b}%;right:0;width:${r}%;`;
      // Handle positions relative to the outline. Half-size offsets keep
      // the circles centred on the outline edges.
      const H = 5;
      const place = (pos: string, el: HTMLElement) => {
        el.style.top = "";
        el.style.bottom = "";
        el.style.left = "";
        el.style.right = "";
        if (pos.includes("n")) el.style.top = `-${H}px`;
        if (pos.includes("s")) el.style.bottom = `-${H}px`;
        if (pos.includes("w")) el.style.left = `-${H}px`;
        if (pos.includes("e")) el.style.right = `-${H}px`;
        if (pos === "n" || pos === "s") {
          el.style.left = `calc(50% - ${H}px)`;
        }
        if (pos === "e" || pos === "w") {
          el.style.top = `calc(50% - ${H}px)`;
        }
      };
      handles.forEach((h) => place(h.pos, h.el));
    };
    layout();

    // Drag logic: each handle resizes its side(s). Clamp so left+right < 90
    // (always leave ≥10% visible so the crop rect doesn't collapse to zero).
    const clamp = (v: number, lo = 0, hi = 90) => Math.max(lo, Math.min(hi, v));
    const containerRect = () => this.imageContainer!.getBoundingClientRect();

    const attachHandle = (el: HTMLElement, pos: (typeof handles)[0]["pos"]) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const start = { ...rect };
        const startX = e.clientX;
        const startY = e.clientY;
        const cRect = containerRect();
        const W = cRect.width || 1;
        const H = cRect.height || 1;
        const onMove = (ev: MouseEvent) => {
          const dxPct = ((ev.clientX - startX) / W) * 100;
          const dyPct = ((ev.clientY - startY) / H) * 100;
          const next = { ...start };
          if (pos.includes("w"))
            next.left = clamp(start.left + dxPct, 0, 100 - start.right - 5);
          if (pos.includes("e"))
            next.right = clamp(start.right - dxPct, 0, 100 - start.left - 5);
          if (pos.includes("n"))
            next.top = clamp(start.top + dyPct, 0, 100 - start.bottom - 5);
          if (pos.includes("s"))
            next.bottom = clamp(start.bottom - dyPct, 0, 100 - start.top - 5);
          Object.assign(rect, next);
          layout();
        };
        this.trackDrag(onMove);
      });
    };
    handles.forEach((h) => attachHandle(h.el, h.pos));

    // Drag the outline body to pan the crop rect without resizing it.
    outline.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).hasAttribute("data-crop-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      const start = { ...rect };
      const startX = e.clientX;
      const startY = e.clientY;
      const cRect = containerRect();
      const W = cRect.width || 1;
      const H = cRect.height || 1;
      const onMove = (ev: MouseEvent) => {
        const dxPct = ((ev.clientX - startX) / W) * 100;
        const dyPct = ((ev.clientY - startY) / H) * 100;
        const widthPct = 100 - start.left - start.right;
        const heightPct = 100 - start.top - start.bottom;
        const nextLeft = clamp(start.left + dxPct, 0, 100 - widthPct);
        const nextTop = clamp(start.top + dyPct, 0, 100 - heightPct);
        rect.left = nextLeft;
        rect.right = 100 - nextLeft - widthPct;
        rect.top = nextTop;
        rect.bottom = 100 - nextTop - heightPct;
        layout();
      };
      this.trackDrag(onMove);
    });

    // Done / Cancel toolbar — floats just below the image.
    const toolbar = document.createElement("div");
    toolbar.setAttribute("data-crop-toolbar", "true");
    toolbar.style.cssText = `
      display:flex;gap:8px;justify-content:center;
      margin-top:8px;
    `;
    const doneBtn = this.createButton(
      t("editor.tools.image.cropDone", { defaultValue: "Apply crop" }),
      () => {
        this.data.crop = {
          top: Math.round(rect.top * 100) / 100,
          right: Math.round(rect.right * 100) / 100,
          bottom: Math.round(rect.bottom * 100) / 100,
          left: Math.round(rect.left * 100) / 100,
        };
        // Zero crop? Treat as uncropped.
        if (
          this.data.crop.top === 0 &&
          this.data.crop.right === 0 &&
          this.data.crop.bottom === 0 &&
          this.data.crop.left === 0
        ) {
          this.data.crop = undefined;
        }
        cleanup();
        this.createImage();
        this.notifyChange();
      },
    );
    doneBtn.style.backgroundColor = "#2563eb";
    doneBtn.style.color = "#ffffff";
    doneBtn.style.borderColor = "#2563eb";

    const cancelBtn = this.createButton(
      t("common.cancel", { defaultValue: "Cancel" }),
      () => {
        this.data.crop = savedCrop;
        cleanup();
        // Restore the pre-crop container/img styles verbatim so a
        // cancelled session doesn't resize or re-position anything.
        if (this.imageContainer) {
          this.imageContainer.style.cssText = savedContainerCss;
        }
        img.style.cssText = savedImgCss;
        // Re-apply any existing crop (restores the saved view).
        this.applyCropIfAny();
        this.syncWrapContract();
      },
    );

    toolbar.appendChild(doneBtn);
    toolbar.appendChild(cancelBtn);
    this.wrapper.appendChild(toolbar);

    const cleanup = () => {
      overlay.remove();
      toolbar.remove();
      this.stopDrag();
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Replace & Reset actions. Replace swaps the url but keeps size, rotation,
  // flip, border and alignment — the common case is updating a logo to a
  // newer file without having to re-position it. Reset clears all transforms
  // AND the border/caption/alt text so the admin gets back a plain,
  // untouched copy of the originally-uploaded image.
  // ──────────────────────────────────────────────────────────────────────────
  private triggerReplaceImage(): void {
    // Not attached to the DOM: a cancelled file dialog never fires
    // `change`, and an attached input would then leak into <body>.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT_TYPES;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.replaceWithFile(file);
    });
    input.click();
  }

  /** Swap the picture, keeping size / styling. Goes through the uploader
   *  like any other ingest; on failure the previous picture stays. */
  replaceWithFile(file: File): Promise<void> {
    return this.runIngest(() => this.ingestFile(file), { replace: true });
  }

  private async resetToOriginal(): Promise<void> {
    const ok = await confirmDialog({
      title: t("editor.tools.image.resetTitle", { defaultValue: "Reset this image?" }),
      message: t("editor.tools.image.resetConfirm", {
        defaultValue: "Rotation, flip, zoom, border, caption and alt text go back to their originals.",
      }),
      confirmLabel: t("editor.tools.image.resetAction", { defaultValue: "Reset image" }),
      danger: true,
    });
    if (!ok) return;
    this.data.rotation = 0;
    this.data.flipX = false;
    this.data.flipY = false;
    this.data.zoom = 1;
    this.data.aspectRatio = "free";
    this.data.border = undefined;
    this.data.caption = "";
    this.data.showCaption = false;
    this.data.altText = "";
    this.data.crop = undefined;
    this.data.link = undefined;
    this.data.shadow = "none";
    this.data.filters = { brightness: 100, contrast: 100, saturation: 100 };
    this.data.shape = "rectangle";
    // Width/height recomputed from natural size on next load.
    this.data.width = "auto";
    this.data.height = "auto";
    this.data.url = this.data.originalUrl || this.data.url;
    this.createImage();
    this.notifyChange();
  }

  private renderMarginSettings(container: HTMLElement): void {
    const helpText = document.createElement("div");
    helpText.style.fontSize = "12px";
    helpText.style.color = "#667085";
    helpText.style.marginBottom = "16px";
    helpText.style.textAlign = "center";
    helpText.textContent = t("editor.tools.image.marginsHelp");
    container.appendChild(helpText);

    const marginGrid = document.createElement("div");
    marginGrid.style.display = "grid";
    marginGrid.style.gridTemplateColumns = "1fr 1fr";
    marginGrid.style.gap = "12px";

    const margins = [
      {
        label: t("editor.tools.image.topMargin"),
        key: "marginTop",
        value: this.data.tunes?.imageTune?.marginTop || "0px",
        placeholder: "0px",
      },
      {
        label: t("editor.tools.image.rightMargin"),
        key: "marginRight",
        value: this.data.tunes?.imageTune?.marginRight || "0px",
        placeholder: "0px",
      },
      {
        label: t("editor.tools.image.bottomMargin"),
        key: "marginBottom",
        value: this.data.tunes?.imageTune?.marginBottom || "0px",
        placeholder: "0px",
      },
      {
        label: t("editor.tools.image.leftMargin"),
        key: "marginLeft",
        value: this.data.tunes?.imageTune?.marginLeft || "0px",
        placeholder: "0px",
      },
    ];

    margins.forEach((margin) => {
      const container = document.createElement("div");

      const label = document.createElement("label");
      label.textContent = margin.label;
      label.style.fontSize = "13px";
      label.style.fontWeight = "500";
      label.style.color = "#344054";
      label.style.marginBottom = "6px";
      label.style.display = "block";

      const inputWrapper = document.createElement("div");
      inputWrapper.style.display = "flex";
      inputWrapper.style.alignItems = "center";
      inputWrapper.style.gap = "4px";

      const input = document.createElement("input");
      input.type = "text";
      input.value = margin.value.replace("px", "");
      input.placeholder = margin.placeholder.replace("px", "");
      input.style.flex = "1";
      input.style.padding = "8px 12px";
      input.style.border = "1px solid #d0d5dd";
      input.style.borderRadius = "6px";
      input.style.fontSize = "14px";
      input.style.color = "#344054";
      input.style.fontFamily = "inherit";

      const unitLabel = document.createElement("span");
      unitLabel.textContent = "px";
      unitLabel.style.fontSize = "14px";
      unitLabel.style.color = "#667085";
      unitLabel.style.minWidth = "24px";

      input.addEventListener("focus", () => {
        input.style.borderColor = "#4086FF";
        input.style.boxShadow = "0 0 0 3px rgba(64, 134, 255, 0.1)";
      });

      input.addEventListener("blur", () => {
        input.style.borderColor = "#d0d5dd";
        input.style.boxShadow = "none";

        let value = input.value.trim();
        if (value === "") value = "0";

        value = value.replace(/[^\d.]/g, "");

        const numValue = parseFloat(value);
        if (!isNaN(numValue)) {
          this.setMargin(margin.key, `${numValue}px`);
          input.value = numValue.toString();
        } else {
          input.value = "0";
          this.setMargin(margin.key, "0px");
        }
      });

      input.addEventListener("keypress", (e) => {
        const charCode = e.which ? e.which : e.keyCode;
        if (
          charCode !== 46 &&
          charCode !== 45 &&
          (charCode < 48 || charCode > 57)
        ) {
          e.preventDefault();
        }
      });

      const presetContainer = document.createElement("div");
      presetContainer.style.display = "flex";
      presetContainer.style.gap = "4px";
      presetContainer.style.marginTop = "4px";

      const presets = [0, 8, 16, 24, 32];
      presets.forEach((preset) => {
        const presetButton = document.createElement("button");
        presetButton.textContent = `${preset}`;
        presetButton.style.padding = "2px 6px";
        presetButton.style.border = "1px solid #d0d5dd";
        presetButton.style.borderRadius = "4px";
        presetButton.style.backgroundColor = "#fff";
        presetButton.style.color = "#667085";
        presetButton.style.fontSize = "11px";
        presetButton.style.cursor = "pointer";
        presetButton.style.transition = "all 0.2s ease";

        presetButton.addEventListener("mouseenter", () => {
          presetButton.style.backgroundColor = "#f0f8ff";
          presetButton.style.borderColor = "#4086FF";
          presetButton.style.color = "#4086FF";
        });

        presetButton.addEventListener("mouseleave", () => {
          presetButton.style.backgroundColor = "#fff";
          presetButton.style.borderColor = "#d0d5dd";
          presetButton.style.color = "#667085";
        });

        presetButton.addEventListener("click", () => {
          input.value = preset.toString();
          this.setMargin(margin.key, `${preset}px`);
        });

        presetContainer.appendChild(presetButton);
      });

      inputWrapper.appendChild(input);
      inputWrapper.appendChild(unitLabel);
      container.appendChild(label);
      container.appendChild(inputWrapper);
      container.appendChild(presetContainer);
      marginGrid.appendChild(container);
    });

    container.appendChild(marginGrid);

    const resetButton = this.createButton(
      t("editor.tools.image.resetAllMargins"),
      () => {
        margins.forEach((margin) => {
          this.setMargin(margin.key, "0px");
          const input = container.querySelector(
            `[placeholder="${margin.placeholder.replace("px", "")}"]`,
          ) as HTMLInputElement;
          if (input) input.value = "0";
        });
      },
    );
    resetButton.style.marginTop = "16px";
    resetButton.style.width = "100%";
    resetButton.style.backgroundColor = "#f8f9fa";
    resetButton.style.color = "#667085";

    container.appendChild(resetButton);
  }

  private createSection(title: string): HTMLElement {
    const section = document.createElement("div");
    section.style.width = "100%";

    const label = document.createElement("label");
    label.innerText = title;
    label.style.fontSize = "14px";
    label.style.fontWeight = "600";
    label.style.color = "#344054";
    label.style.width = "100%";
    label.style.textAlign = "left";
    label.style.marginBottom = "8px";
    label.style.display = "block";

    section.appendChild(label);
    return section;
  }

  private createButton(
    text: string,
    onClick: (e: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.innerText = text;
    button.style.border = "1px solid #d0d5dd";
    button.style.padding = "10px 16px";
    button.style.borderRadius = "6px";
    button.style.backgroundColor = "#fff";
    button.style.color = "#4086FF";
    button.style.fontSize = "14px";
    button.style.fontWeight = "500";
    button.style.cursor = "pointer";
    button.style.transition = "all 0.2s ease";
    button.style.outline = "none";
    button.style.fontFamily = "inherit";
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.gap = "6px";

    button.addEventListener("mouseover", () => {
      button.style.backgroundColor = "#f0f8ff";
      button.style.borderColor = "#4086FF";
    });

    button.addEventListener("mouseout", () => {
      button.style.backgroundColor = "#fff";
      button.style.borderColor = "#d0d5dd";
    });

    button.addEventListener("mousedown", () => {
      button.style.backgroundColor = "#e6f2ff";
    });

    button.addEventListener("mouseup", () => {
      button.style.backgroundColor = "#f0f8ff";
    });

    button.addEventListener("click", onClick);

    return button;
  }

  private createIconButton(
    icon: string,
    title: string,
    onClick: (e: MouseEvent) => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.innerHTML = `<span style="font-size: 16px;">${icon}</span>`;
    button.title = title;
    button.style.border = "1px solid #d0d5dd";
    button.style.padding = "10px";
    button.style.borderRadius = "6px";
    button.style.backgroundColor = "#fff";
    button.style.color = "#4086FF";
    button.style.fontSize = "16px";
    button.style.cursor = "pointer";
    button.style.transition = "all 0.2s ease";
    button.style.outline = "none";
    button.style.display = "flex";
    button.style.alignItems = "center";
    button.style.justifyContent = "center";
    button.style.minWidth = "44px";

    button.addEventListener("mouseover", () => {
      button.style.backgroundColor = "#f0f8ff";
      button.style.borderColor = "#4086FF";
    });

    button.addEventListener("mouseout", () => {
      button.style.backgroundColor = "#fff";
      button.style.borderColor = "#d0d5dd";
    });

    button.addEventListener("mousedown", () => {
      button.style.backgroundColor = "#e6f2ff";
    });

    button.addEventListener("mouseup", () => {
      button.style.backgroundColor = "#f0f8ff";
    });

    button.addEventListener("click", onClick);

    return button;
  }

  // TODO: tighten these three bags once the EditorJS SDK ships typings
  // for api/config/block-data that fit our concrete usage.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private api: any;
  private config: ImageToolConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private data: any;
  private readOnly = false;
  private wrapper: HTMLElement | null;
  private imageContainer: HTMLElement | null;
  private resizeHandles: HTMLElement[];
  private completedPreview: boolean;
  private readonly MAX_PARENT_WIDTH = 729;
  private contextMenu: HTMLElement | null = null;
  private isContextMenuOpen: boolean = false;
  private block: any = null;
  private destroyed = false;
  /** Bumped per ingest so a stale upload can't overwrite a newer one. */
  private ingestSeq = 0;
  private uploading = false;
  /** Active document-level drag listener (resize / crop), for cleanup. */
  private dragMove: ((e: MouseEvent) => void) | null = null;
  private dragUp: (() => void) | null = null;
  private boundPaste = (e: ClipboardEvent) => this.handlePaste(e);
  private boundContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!this.readOnly) this._showContextMenu(this.wrapper!);
  };
  private captionHoverShow: (() => void) | null = null;
  private captionHoverHide: (() => void) | null = null;
  /** Set by Replace: on the next load keep the width and refit the height
   *  to the new picture's proportions. */
  private refitOnLoad = false;

  private get uploader(): ((file: File) => Promise<{ url: string }>) | undefined {
    const fn = this.config?.uploader ?? this.config?.onImageUpload;
    return typeof fn === "function" ? fn : undefined;
  }

  /** Tell Editor.js the block changed (settings live outside the block). */
  private notifyChange(): void {
    if (this.destroyed) return;
    try {
      this.block?.dispatchChange?.();
    } catch {
      /* block already gone */
    }
  }

  /** Follow the mouse on `document` until mouseup; one drag at a time. */
  private trackDrag(onMove: (e: MouseEvent) => void, onEnd?: () => void): void {
    this.stopDrag();
    const onUp = () => {
      this.stopDrag();
      onEnd?.();
    };
    this.dragMove = onMove;
    this.dragUp = onUp;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private stopDrag(): void {
    if (this.dragMove) document.removeEventListener("mousemove", this.dragMove);
    if (this.dragUp) document.removeEventListener("mouseup", this.dragUp);
    this.dragMove = null;
    this.dragUp = null;
  }

  /** Embed a blob as a data: URL the load-time sanitizer will keep
   *  (raster only). SVG & co. are rasterised to PNG when a canvas exists. */
  private async embedBlob(blob: Blob): Promise<string> {
    let data = blob;
    if (!EMBEDDABLE_TYPES.has((blob.type || "").toLowerCase())) {
      try {
        data = await rasterizeToPng(blob);
      } catch {
        throw new Error(
          t("editor.tools.image.typeCantEmbed", {
            defaultValue: "this image type can't be embedded without an upload server",
          }),
        );
      }
    }
    const url = await blobToDataUrl(data);
    if (!isSafeImageUrl(url)) throw new Error("unsupported image data");
    return url;
  }

  /** Upload a file through `config.uploader`. Falls back to a data: URL
   *  only when there is no uploader, or the upload fails (with a notice). */
  private async ingestFile(file: File): Promise<IngestResult> {
    if (!file || !String(file.type || "").startsWith("image/")) {
      throw new Error(t("editor.tools.image.typeNotAccepted"));
    }
    const uploader = this.uploader;
    if (uploader) {
      try {
        const result = await uploader(file);
        if (result && typeof result.url === "string" && isSafeImageUrl(result.url)) {
          return { url: result.url };
        }
        throw new Error("uploader returned no usable url");
      } catch (err) {
        console.warn("ImageTool upload failed, embedding instead:", err);
        return {
          url: await this.embedBlob(file),
          notice: t("editor.tools.image.uploadFailedEmbedded"),
        };
      }
    }
    return { url: await this.embedBlob(file) };
  }

  /** Pasted / typed image URL (http, relative, blob: or data:). With an
   *  uploader the bytes are fetched and re-hosted so the document doesn't
   *  hot-link; without one, a data: URL keeps the old self-contained
   *  behaviour. If the bytes can't be fetched (CORS) the URL is kept. */
  private async ingestUrl(raw: string): Promise<IngestResult> {
    const url = (raw || "").trim();
    if (!isSafeImageUrl(url)) {
      throw new Error(t("editor.tools.image.enterValidUrl"));
    }
    const isData = url.toLowerCase().startsWith("data:");
    let blob: Blob | null = null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      blob = await res.blob();
      if (blob.type && !blob.type.startsWith("image/")) {
        throw new Error(`not an image (${blob.type})`);
      }
    } catch (err) {
      console.warn("ImageTool could not fetch image:", err);
      blob = null;
    }
    if (!blob) {
      // data: URLs that passed isSafeImageUrl are raster — keep as-is.
      // blob: URLs die with the page, so they can't be kept.
      if (isData) return { url };
      if (url.toLowerCase().startsWith("blob:")) {
        throw new Error(t("editor.tools.image.failedToLoad"));
      }
      return { url, notice: t("editor.tools.image.linkedNotCopied") };
    }
    const uploader = this.uploader;
    if (uploader) {
      const type = blob.type || "image/png";
      const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").replace(/\+.*/, "");
      const name =
        (!isData && url.split(/[?#]/)[0].split("/").pop()) || `pasted-image.${ext}`;
      const file = new File([blob], name, { type });
      return this.ingestFile(file);
    }
    if (isData) return { url };
    try {
      return { url: await this.embedBlob(blob) };
    } catch {
      return { url, notice: t("editor.tools.image.linkedNotCopied") };
    }
  }

  /**
   * Run an ingest with UI: uploading state while it runs, the image (plus
   * any fallback notice) on success, and on failure the previous picture
   * or the upload prompt with an error — never a broken block. Never
   * rejects.
   */
  private async runIngest(
    work: () => Promise<IngestResult>,
    opts: { replace?: boolean } = {},
  ): Promise<void> {
    const seq = ++this.ingestSeq;
    const previousUrl = this.data.url;
    this.setUploading(true);
    let result: IngestResult | null = null;
    let error: unknown = null;
    try {
      result = await work();
    } catch (err) {
      error = err;
    }
    if (this.destroyed || seq !== this.ingestSeq) return;
    this.setUploading(false);
    if (result && result.url) {
      if (opts.replace || previousUrl) {
        // A new picture: the old crop is meaningless, keep the width and
        // let the height follow the new picture's proportions.
        this.data.crop = undefined;
        this.refitOnLoad = parsePx(this.data.width) > 0;
        this.data.originalUrl = result.url;
      }
      this.data.url = result.url;
      if (!this.data.originalUrl) this.data.originalUrl = result.url;
      this.createImage();
      if (result.notice) this.showNotice(result.notice, "warning");
      this.notifyChange();
      return;
    }
    const reason =
      error instanceof Error && error.message ? error.message : String(error ?? "unknown error");
    console.warn("ImageTool ingest failed:", error);
    if (previousUrl) this.createImage();
    else this.createUploadUI();
    this.showNotice(t("editor.tools.image.uploadFailed", { reason }), "error");
  }

  /** Uploading overlay (over the picture) or placeholder (empty block). */
  private setUploading(on: boolean): void {
    this.uploading = on;
    if (!this.wrapper) return;
    this.wrapper.classList.toggle("tp-image--uploading", on);
    this.wrapper.setAttribute("aria-busy", on ? "true" : "false");
    this.wrapper.querySelectorAll("[data-image-uploading]").forEach((el) => el.remove());
    if (!on) return;
    this.wrapper.querySelectorAll("[data-image-notice]").forEach((el) => el.remove());
    const status = document.createElement("div");
    status.setAttribute("data-image-uploading", "true");
    status.setAttribute("role", "status");
    status.className = "tp-image__status";
    const spinner = document.createElement("span");
    spinner.className = "tp-image__spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = t("editor.tools.image.uploading");
    status.append(spinner, label);
    if (this.data.url && this.imageContainer && this.wrapper.contains(this.imageContainer)) {
      status.classList.add("tp-image__status--overlay");
      this.imageContainer.appendChild(status);
    } else {
      this.wrapper.innerHTML = "";
      this.wrapper.appendChild(status);
    }
  }

  /** Inline message under the image. Not saved. */
  private showNotice(message: string, kind: "warning" | "error"): void {
    if (!this.wrapper || this.destroyed) return;
    this.wrapper.querySelectorAll("[data-image-notice]").forEach((el) => el.remove());
    const notice = document.createElement("div");
    notice.setAttribute("data-image-notice", kind);
    notice.setAttribute("role", kind === "error" ? "alert" : "status");
    notice.className = `tp-image__msg tp-image__msg--${kind}`;
    notice.contentEditable = "false";
    const text = document.createElement("span");
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "tp-image__msg-close";
    close.textContent = "✕";
    close.title = t("editor.tools.image.dismiss", { defaultValue: "Dismiss" });
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      notice.remove();
    });
    notice.append(text, close);
    this.wrapper.appendChild(notice);
  }

  /** Width / height ratio to preserve: current box, else natural size. */
  private currentAspect(): number {
    const w = parsePx(this.data.width);
    const h = parsePx(this.data.height);
    if (w && h) return w / h;
    const img = this.imageContainer?.querySelector("img") as HTMLImageElement | null;
    if (img && img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight;
    return 1;
  }

  /** Single place that resizes the picture (settings fields, presets). */
  private setImageSize(w: number, h: number): void {
    this.data.width = `${Math.round(w)}px`;
    this.data.height = `${Math.round(h)}px`;
    const img = this.imageContainer?.querySelector("img") as HTMLImageElement | null;
    if (img) {
      img.style.width = this.data.width;
      img.style.height = this.data.height;
    }
    this.applyCropIfAny();
    this.updateResizeHandles();
    this.syncWrapContract();
  }

  /**
   * Root-class contract for the paginator / editor CSS: exactly one
   * `tp-image--{inline|top-bottom|float-left|float-right}` class, and for
   * floats `--tp-image-width` = the horizontal space the image occupies.
   */
  private syncWrapContract(): void {
    if (!this.wrapper) return;
    const mode = imageWrapMode(this.data);
    for (const cls of Object.values(IMAGE_WRAP_CLASSES)) {
      this.wrapper.classList.toggle(cls, cls === IMAGE_WRAP_CLASSES[mode]);
    }
    this.wrapper.dataset.wrap = mode;
    if (mode === "float-left" || mode === "float-right") {
      this.wrapper.style.setProperty("--tp-image-width", `${this.occupiedWidth()}px`);
    } else {
      this.wrapper.style.removeProperty("--tp-image-width");
    }
  }

  /** Visible (crop-aware) width + horizontal margins + border. */
  private occupiedWidth(): number {
    let w = parsePx(this.data.width);
    if (!w) {
      const img = this.imageContainer?.querySelector("img") as HTMLImageElement | null;
      w = img?.naturalWidth || 0;
    }
    const crop = this.data.crop;
    if (crop) w = w * (1 - ((crop.left || 0) + (crop.right || 0)) / 100);
    const tune = this.data.tunes?.imageTune || {};
    const border = this.data.border && this.data.border.style !== "none"
      ? parsePx(this.data.border.width || "1px")
      : 0;
    const total = w + parsePx(tune.marginLeft) + parsePx(tune.marginRight) + border * 2;
    return Math.min(this.MAX_PARENT_WIDTH, Math.max(0, Math.round(total)));
  }

  private parseDimension(value: any): string {
    if (!value) return "auto";

    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? `${Math.round(value * 100) / 100}px` : "auto";
    }
    // "0px" (written by older saves of an unloaded image) means unknown.
    if (typeof value === "string" && parsePx(value) === 0) return "auto";

    if (typeof value === "string") {
      if (
        value.includes("px") ||
        value.includes("%") ||
        value.includes("em") ||
        value.includes("rem")
      ) {
        return value;
      }

      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        return `${numValue}px`;
      }
    }

    return "auto";
  }
  constructor({
    data,
    config,
    api,
    readOnly = false,
    block,
  }: {
    data: any;
    config: any;
    api: any;
    readOnly?: boolean;
    block?: any;
  }) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config || {};
    this.block = block ?? null;
    data = data && typeof data === "object" ? data : {};

    // `file.url` is what save() writes; `url` is older data / the DOCX
    // importer / stock @editorjs/image — accept either.
    const url =
      (typeof data.file?.url === "string" && data.file.url) ||
      (typeof data.url === "string" && data.url) ||
      "";

    const savedTunes = data.tunes && typeof data.tunes === "object" ? data.tunes : {};
    const savedImageTune =
      savedTunes.imageTune && typeof savedTunes.imageTune === "object"
        ? savedTunes.imageTune
        : {};
    const tunes: any = {
      ...savedTunes,
      imageTune: {
        float: "inline",
        wrapText: "top-bottom",
        position: "inline",
        marginTop: "0px",
        marginRight: "0px",
        marginBottom: "0px",
        marginLeft: "0px",
        ...savedImageTune,
      },
    };
    // Alignment stays undefined unless chosen: the block-level alignment
    // tune then shows through via inherited text-align.
    if (savedTunes.alignment && typeof savedTunes.alignment === "object") {
      tunes.alignment = { ...savedTunes.alignment };
    }

    const filters =
      data.filters && typeof data.filters === "object" ? data.filters : {};
    const num = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : d;

    this.data = {
      url,
      caption: typeof data.caption === "string" ? data.caption : "",
      width: this.parseDimension(data.dimensions?.width ?? data.width),
      height: this.parseDimension(data.dimensions?.height ?? data.height),
      rotation: normalizeRotation(data.rotation),
      aspectRatio: typeof data.aspectRatio === "string" ? data.aspectRatio : "free",
      flipX: data.flipX === true,
      flipY: data.flipY === true,
      zoom: num(data.zoom, 1) > 0 ? num(data.zoom, 1) : 1,
      altText: typeof data.altText === "string" ? data.altText : "",
      border:
        data.border && typeof data.border === "object" && data.border.style
          ? { ...data.border }
          : undefined,
      // originalUrl is captured once (on first render if missing). Legacy
      // blocks won't have it in storage; Reset still works for them by
      // falling back to the current url.
      originalUrl: (typeof data.originalUrl === "string" && data.originalUrl) || url,
      // Default OFF: a brand-new image or one coming from an older save
      // (no showCaption key) renders without any caption chrome. If the
      // doc stored a caption string though, treat that as implicit opt-in
      // so round-tripping an authored caption doesn't silently hide it.
      showCaption:
        typeof data.showCaption === "boolean"
          ? data.showCaption
          : !!(data.caption && String(data.caption).trim()),
      crop: data.crop && typeof data.crop === "object" ? { ...data.crop } : undefined,
      link:
        data.link && typeof data.link === "object" && data.link.url
          ? { url: data.link.url, openInNewTab: data.link.openInNewTab !== false }
          : undefined,
      shadow: data.shadow || "none",
      filters: {
        brightness: num(filters.brightness, 100),
        contrast: num(filters.contrast, 100),
        saturation: num(filters.saturation, 100),
      },
      shape: data.shape || "rectangle",
      tunes,
    };
    this.wrapper = null;
    this.imageContainer = null;
    this.resizeHandles = [];
    this.completedPreview = !!this.config.isEditable;
  }

  private isCompleteMode(): boolean {
    return (
      window.location.pathname.includes("/complete") ||
      isPrintRoute(window.location.pathname)
    );
  }

  private shouldShowResizeHandles(): boolean {
    return !this.readOnly && !this.isCompleteMode();
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("image-tool-wrapper", "tp-image");
    this.wrapper.style.maxWidth = `${this.MAX_PARENT_WIDTH}px`;
    this.wrapper.style.margin = "0 auto";

    if (!this.isCompleteMode() && !this.readOnly) {
      this.wrapper.addEventListener("paste", this.boundPaste);
    }
    // Right-click opens the settings panel (editable only; read-only
    // views keep the browser's own menu).
    if (!this.readOnly) {
      this.wrapper.addEventListener("contextmenu", this.boundContextMenu);
    }

    if (this.data.url) {
      this.createImage();
    } else {
      this.createUploadUI();
    }
    this.applyTunesStyles();

    return this.wrapper;
  }

  /**
   * Alignment + margins + the wrap contract. Layout of floats is NOT done
   * here — see syncWrapContract: the editor floats the whole `.ce-block`.
   */
  private applyTunesStyles(): void {
    if (!this.wrapper) return;

    const alignment = this.data.tunes?.alignment?.alignment;
    this.wrapper.style.display = "block";
    // Explicit alignment from the settings panel; otherwise inherit (the
    // block-level alignment tune sets text-align on .ce-block__content).
    this.wrapper.style.textAlign =
      alignment === "center" || alignment === "right" || alignment === "left" ? alignment : "";

    this.syncWrapContract();
    if (!this.imageContainer) return;

    this.imageContainer.style.float = "";
    this.imageContainer.style.display = "inline-block";
    this.imageContainer.style.verticalAlign = "top";
    const m = this.data.tunes?.imageTune || {};
    this.imageContainer.style.marginTop = m.marginTop || "0px";
    this.imageContainer.style.marginRight = m.marginRight || "0px";
    this.imageContainer.style.marginBottom = m.marginBottom || "0px";
    this.imageContainer.style.marginLeft = m.marginLeft || "0px";
  }

  private setAlignment(alignment: string): void {
    if (!this.data.tunes) this.data.tunes = {};
    if (!this.data.tunes.alignment) this.data.tunes.alignment = {};
    this.data.tunes.alignment.alignment = alignment;
    if (!this.data.tunes.imageTune) this.data.tunes.imageTune = {};
    const tune = this.data.tunes.imageTune;

    if (FLOAT_WRAPS.has(tune.wrapText)) {
      if (alignment === "center") {
        // A float can't be centred — centring means top & bottom wrap.
        tune.wrapText = "top-bottom";
        tune.float = "inline";
      } else {
        tune.float = alignment === "right" ? "right" : "left";
      }
    }
    this.applyTunesStyles();
    this.notifyChange();
  }

  private setFloat(floatValue: string): void {
    if (!this.data.tunes) this.data.tunes = {};
    if (!this.data.tunes.imageTune) this.data.tunes.imageTune = {};
    this.data.tunes.imageTune.float = floatValue;
    this.applyTunesStyles();
    this.notifyChange();
  }

  private setMargin(marginKey: string, value: string): void {
    if (!this.data.tunes) this.data.tunes = {};
    if (!this.data.tunes.imageTune) this.data.tunes.imageTune = {};
    // Numbers only, clamped; anything unparsable becomes 0px (it used to
    // store e.g. "px" from an emptied number field).
    const n = parseFloat(String(value ?? ""));
    const px = Number.isFinite(n) ? Math.max(-200, Math.min(400, Math.round(n))) : 0;
    this.data.tunes.imageTune[marginKey] = `${px}px`;
    this.applyTunesStyles();
    this.notifyChange();
  }

  private handlePaste(event: ClipboardEvent): void {
    const target = event.target as HTMLElement | null;
    // Let inputs (URL field, panel fields) paste natively.
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind !== "string" && item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          event.stopPropagation();
          void this.runIngest(() => this.ingestFile(file), { replace: !!this.data.url });
          return;
        }
      }
    }

    // Text pasted into the caption stays text.
    if (target?.closest?.("[data-image-caption]")) return;

    const pastedText = (clipboardData.getData("text") || "").trim();
    if (pastedText && IMAGE_URL_PATTERN.test(pastedText) && !/\s/.test(pastedText)) {
      event.preventDefault();
      event.stopPropagation();
      void this.runIngest(() => this.ingestUrl(pastedText), { replace: !!this.data.url });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tier-2 visual effects. Shape masks + shadow sit on the container so
  // they wrap the image (and any border); filters live on the img itself
  // so brightness/contrast/saturation apply to pixels without affecting
  // the border or the shadow. Keeping them separated means toggling one
  // never interferes with another.
  // ──────────────────────────────────────────────────────────────────────────
  private applyShapeAndShadow(): void {
    if (!this.imageContainer) return;
    const shape = this.data.shape || "rectangle";
    if (shape === "circle") {
      this.imageContainer.style.borderRadius = "50%";
      this.imageContainer.style.overflow = "hidden";
    } else if (shape === "rounded") {
      this.imageContainer.style.borderRadius = "12px";
      this.imageContainer.style.overflow = "hidden";
    } else {
      // "rectangle" — only override if the border path hasn't already
      // set a radius (border keeps a subtle 4px by default).
      if (!this.data.border) {
        this.imageContainer.style.borderRadius = "";
      }
    }

    const shadow = this.data.shadow || "none";
    const shadowMap: Record<string, string> = {
      none: "",
      soft: "0 2px 6px rgba(0,0,0,0.12)",
      medium: "0 4px 14px rgba(0,0,0,0.2)",
      strong: "0 10px 28px rgba(0,0,0,0.3)",
    };
    this.imageContainer.style.boxShadow = shadowMap[shadow] || "";
  }

  private applyFilters(): void {
    if (!this.imageContainer) return;
    const img = this.imageContainer.querySelector(
      "img",
    ) as HTMLImageElement | null;
    if (!img) return;
    const f = this.data.filters || {
      brightness: 100,
      contrast: 100,
      saturation: 100,
    };
    // Skip the filter chain when everything is at identity — avoids a
    // tiny GPU hit on untouched images and keeps colour accurate for
    // print rendering (filters can round-trip slightly differently
    // through Puppeteer).
    const isIdentity =
      f.brightness === 100 && f.contrast === 100 && f.saturation === 100;
    img.style.filter = isIdentity
      ? ""
      : `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%)`;
  }

  // Rewraps the img in an <a> when a link url is set, strips the wrapper
  // when it isn't. Called at render time + whenever the Layout settings
  // change the link url.
  private applyLinkWrapper(): void {
    if (!this.imageContainer) return;
    const img = this.imageContainer.querySelector(
      "img",
    ) as HTMLImageElement | null;
    if (!img) return;
    const existing = this.imageContainer.querySelector("a[data-image-link]");
    const link = this.data.link;
    if (link && link.url) {
      if (existing) {
        (existing as HTMLAnchorElement).href = link.url;
        (existing as HTMLAnchorElement).target = link.openInNewTab
          ? "_blank"
          : "_self";
        if (link.openInNewTab) {
          (existing as HTMLAnchorElement).rel = "noopener noreferrer";
        } else {
          (existing as HTMLAnchorElement).removeAttribute("rel");
        }
        return;
      }
      const a = document.createElement("a");
      a.setAttribute("data-image-link", "true");
      a.href = link.url;
      a.target = link.openInNewTab ? "_blank" : "_self";
      if (link.openInNewTab) a.rel = "noopener noreferrer";
      a.style.cssText = "display:block;line-height:0;";
      // Preserve editing: in editable mode we don't want the anchor to
      // intercept clicks (otherwise clicking the image navigates away
      // instead of letting the admin select / drag it). Only "arm" the
      // link in the completed/print view.
      if (!this.isCompleteMode()) {
        a.addEventListener("click", (e) => e.preventDefault());
      }
      img.parentNode?.insertBefore(a, img);
      a.appendChild(img);
    } else if (existing) {
      // Unwrap — move img back out of the anchor and drop the anchor.
      const anchor = existing as HTMLAnchorElement;
      const parent = anchor.parentNode;
      if (parent) {
        parent.insertBefore(img, anchor);
        anchor.remove();
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Border rendering. The border lives on the image CONTAINER (not the img
  // itself) so it stays correctly positioned when the image is rotated or
  // flipped — those transforms rotate the img inside the container.
  // ──────────────────────────────────────────────────────────────────────────
  private applyBorderStyles(): void {
    if (!this.imageContainer) return;
    const b = this.data.border;
    if (!b || b.style === "none" || !b.style) {
      this.imageContainer.style.border = "";
      this.imageContainer.style.borderRadius = "";
      return;
    }
    this.imageContainer.style.border = `${b.width || "1px"} ${b.style} ${b.color || "#000000"}`;
    // Keep the subtle rounding the image uses so the border wraps the
    // same curve. Users who want sharp corners get it via "none".
    this.imageContainer.style.borderRadius = "4px";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Crop rendering. The container is sized to the VISIBLE portion only
  // (overflow:hidden) and the full-size <img> inside is nudged with
  // negative offsets so just the un-cropped area shows through. We can't
  // use clip-path alone because it only hides pixels — the surrounding
  // layout would still reserve space for the full image.
  // ──────────────────────────────────────────────────────────────────────────
  private applyCropIfAny(): void {
    if (!this.imageContainer) return;
    const img = this.imageContainer.querySelector(
      "img",
    ) as HTMLImageElement | null;
    if (!img) return;
    const crop = this.data.crop;
    if (!crop) {
      // Clear any crop styling that may linger from a previous render.
      img.style.position = "";
      img.style.left = "";
      img.style.top = "";
      this.imageContainer.style.overflow = "visible";
      return;
    }
    const fullW =
      parseInt(this.data.width, 10) || img.naturalWidth || img.offsetWidth || 0;
    const fullH =
      parseInt(this.data.height, 10) ||
      img.naturalHeight ||
      img.offsetHeight ||
      0;
    const visibleW = fullW * (1 - (crop.left + crop.right) / 100);
    const visibleH = fullH * (1 - (crop.top + crop.bottom) / 100);
    const offsetX = fullW * (crop.left / 100);
    const offsetY = fullH * (crop.top / 100);

    this.imageContainer.style.width = `${visibleW}px`;
    this.imageContainer.style.height = `${visibleH}px`;
    this.imageContainer.style.overflow = "hidden";
    this.imageContainer.style.position = "relative";
    img.style.width = `${fullW}px`;
    img.style.height = `${fullH}px`;
    img.style.maxWidth = "none";
    img.style.position = "absolute";
    img.style.left = `-${offsetX}px`;
    img.style.top = `-${offsetY}px`;
  }

  // Caption below the image. Shows ONLY when there is actual text, so a
  // bare image reads as a clean image — no "Add a caption…" placeholder
  // littering the document. In editable mode a hover-only ghost affordance
  // appears so admins can discover + add a caption without clicking into
  // the right-side settings panel.
  private renderCaption(): void {
    if (!this.wrapper) return;
    // Clear any previous caption element + hover listeners before re-render.
    this.wrapper.querySelectorAll("[data-image-caption]").forEach((el) => el.remove());
    this.wrapper.querySelectorAll("[data-image-caption-ghost]").forEach((el) => el.remove());
    if (this.captionHoverShow) this.wrapper.removeEventListener("mouseenter", this.captionHoverShow);
    if (this.captionHoverHide) this.wrapper.removeEventListener("mouseleave", this.captionHoverHide);
    this.captionHoverShow = null;
    this.captionHoverHide = null;

    // Caption disabled by the admin → render nothing, no hover ghost either.
    if (!this.data.showCaption) return;

    const text = (this.data.caption || "").trim();

    // 1) Has text → always render it (both editable and read-only views).
    if (text) {
      const caption = document.createElement("div");
      caption.setAttribute("data-image-caption", "true");
      caption.contentEditable = this.readOnly ? "false" : "true";
      caption.textContent = text;
      caption.style.cssText = `
        font-size: 12px;
        font-style: italic;
        color: #6b7280;
        text-align: center;
        padding: 4px 2px;
        min-height: 1em;
        outline: none;
      `;
      caption.addEventListener("focus", () => {
        caption.style.color = "#374151";
      });
      // Keep data in step while typing so a save mid-edit isn't stale.
      caption.addEventListener("input", () => {
        this.data.caption = caption.textContent || "";
      });
      caption.addEventListener("blur", () => {
        this.data.caption = (caption.textContent || "").trim();
        if (!this.data.caption) {
          // Admin cleared the caption inline → fall back to the hover-only
          // ghost so the placeholder doesn't sit in-document.
          this.renderCaption();
          return;
        }
        caption.style.color = "#6b7280";
      });
      this.wrapper.appendChild(caption);
      return;
    }

    // 2) No text + read-only → render nothing.
    if (this.readOnly) return;

    // 3) No text + editable → hover-only ghost affordance. Visible on
    //    pointer-enter of the image wrapper, hidden on leave. Clicking
    //    swaps it for a live editable caption focused for immediate typing.
    const ghost = document.createElement("div");
    ghost.setAttribute("data-image-caption-ghost", "true");
    ghost.textContent = t("editor.tools.image.captionPlaceholder", {
      defaultValue: "Add a caption…",
    });
    ghost.style.cssText = `
      font-size: 11px;
      font-style: italic;
      color: #9ca3af;
      text-align: center;
      padding: 4px 2px;
      cursor: text;
      opacity: 0;
      transition: opacity 0.15s ease;
      user-select: none;
      pointer-events: none;
    `;
    this.wrapper.appendChild(ghost);

    const show = () => {
      ghost.style.opacity = "1";
      ghost.style.pointerEvents = "auto";
    };
    const hide = () => {
      ghost.style.opacity = "0";
      ghost.style.pointerEvents = "none";
    };
    this.captionHoverShow = show;
    this.captionHoverHide = hide;
    this.wrapper.addEventListener("mouseenter", show);
    this.wrapper.addEventListener("mouseleave", hide);

    ghost.addEventListener("click", (e) => {
      e.stopPropagation();
      // Promote the ghost to a real caption and focus it so typing lands
      // immediately. The blur handler on the real caption folds state
      // back into data.caption and re-renders accordingly.
      ghost.remove();
      this.data.caption = "";
      const live = document.createElement("div");
      live.setAttribute("data-image-caption", "true");
      live.contentEditable = "true";
      live.textContent = "";
      live.style.cssText = `
        font-size: 12px;
        font-style: italic;
        color: #374151;
        text-align: center;
        padding: 4px 2px;
        min-height: 1em;
        outline: none;
      `;
      live.addEventListener("input", () => {
        this.data.caption = live.textContent || "";
      });
      this.wrapper!.appendChild(live);
      live.focus();
      live.addEventListener("blur", () => {
        this.data.caption = (live.textContent || "").trim();
        this.renderCaption();
      });
    });
  }

  createImage(): void {
    if (!this.wrapper) return;

    this.wrapper.innerHTML = "";

    this.imageContainer = document.createElement("div");
    this.imageContainer.classList.add("image-container");
    this.imageContainer.style.position = "relative";
    this.imageContainer.style.overflow = "visible";
    this.imageContainer.style.display = "inline-block";
    this.imageContainer.style.maxWidth = "100%";

    this.applyTunesStyles();

    // Capture the first-seen url as the original so Reset can revert
    // transforms without re-uploading. Only taken when missing — legacy
    // blocks keep the url they already had.
    if (!this.data.originalUrl) {
      this.data.originalUrl = this.data.url;
    }

    const image = document.createElement("img");
    image.src = this.data.url;
    image.alt = this.data.altText || "";
    image.style.maxWidth = "100%";
    image.style.maxHeight = "none";

    let widthValue = this.data.width;
    let heightValue = this.data.height;

    if (typeof widthValue === "number") {
      widthValue = `${widthValue}px`;
    }
    if (typeof heightValue === "number") {
      heightValue = `${heightValue}px`;
    }

    if (widthValue === "auto" || !widthValue.toString().includes("px")) {
      widthValue = "auto";
    }
    if (heightValue === "auto" || !heightValue.toString().includes("px")) {
      heightValue = "auto";
    }

    image.style.width = widthValue;
    image.style.height = heightValue;
    image.style.marginTop = "12px";
    image.style.marginBottom = "12px";
    image.style.display = "block";
    image.style.borderRadius = "4px";

    image.onerror = () => {
      const urlForLog =
        typeof this.data.url === "string"
          ? this.data.url.slice(0, 120)
          : this.data.url;
      console.error("Failed to load image:", urlForLog);
      this.showImageError();
    };

    image.onload = () => {
      if (this.destroyed) return;
      const naturalWidth = image.naturalWidth;
      const naturalHeight = image.naturalHeight;

      if (this.refitOnLoad && naturalWidth && naturalHeight) {
        // Replaced picture: keep the chosen width, follow its proportions.
        this.refitOnLoad = false;
        const w = parsePx(this.data.width);
        this.data.height = `${Math.max(1, Math.round((w * naturalHeight) / naturalWidth))}px`;
        image.style.width = this.data.width;
        image.style.height = this.data.height;
      } else if (
        widthValue === "auto" ||
        heightValue === "auto" ||
        !widthValue ||
        !heightValue ||
        widthValue === "0px" ||
        heightValue === "0px"
      ) {
        let initialWidth = naturalWidth;
        let initialHeight = naturalHeight;

        if (initialWidth > this.MAX_PARENT_WIDTH) {
          const scale = this.MAX_PARENT_WIDTH / initialWidth;
          initialWidth = this.MAX_PARENT_WIDTH;
          initialHeight = Math.round(initialHeight * scale);
        }

        const MIN_SIZE = 50;
        if (initialWidth < MIN_SIZE) {
          const scale = MIN_SIZE / initialWidth;
          initialWidth = MIN_SIZE;
          initialHeight = Math.round(initialHeight * scale);
        }

        this.data.width = `${initialWidth}px`;
        this.data.height = `${initialHeight}px`;
        image.style.width = this.data.width;
        image.style.height = this.data.height;
      } else {
        const currentWidth = parseInt(widthValue, 10);
        const currentHeight = parseInt(heightValue, 10);

        if (currentWidth > 2000 || currentHeight > 2000) {
          console.warn(
            "Dimensions too large, scaling down:",
            currentWidth,
            currentHeight,
          );

          const maxDimension = 600;
          const scale = maxDimension / Math.max(currentWidth, currentHeight);

          const newWidth = Math.round(currentWidth * scale);
          const newHeight = Math.round(currentHeight * scale);

          this.data.width = `${newWidth}px`;
          this.data.height = `${newHeight}px`;
          image.style.width = this.data.width;
          image.style.height = this.data.height;
        }
      }

      this.applyTransformation(image);
      this.applyCropIfAny();
      this.updateResizeHandles();
      this.syncWrapContract();
    };

    this.applyTransformation(image);
    image.classList.add("image-tool-image");

    this.imageContainer.appendChild(image);
    this.applyBorderStyles();
    this.applyShapeAndShadow();
    this.applyFilters();
    this.applyLinkWrapper();
    // Crop is applied AFTER append (and once the image has loaded natural
    // dims) via applyCropIfAny — a no-op when data.crop is undefined.
    const applyCrop = () => this.applyCropIfAny();
    if (image.complete) {
      applyCrop();
    } else {
      image.addEventListener("load", applyCrop, { once: true });
    }
    this.wrapper.appendChild(this.imageContainer);
    this.renderCaption();

    if (this.shouldShowResizeHandles()) {
      this.createResizeHandles();
      this.applyAspectRatio();
    }
    this.syncWrapContract();
  }

  private showImageError(): void {
    if (!this.wrapper) return;

    this.wrapper.innerHTML = "";
    const errorContainer = document.createElement("div");
    errorContainer.style.textAlign = "center";
    errorContainer.style.padding = "20px";
    errorContainer.style.color = "#dc2626";
    errorContainer.style.border = "1px solid #fecaca";
    errorContainer.style.borderRadius = "4px";
    errorContainer.style.backgroundColor = "#fef2f2";
    errorContainer.style.maxWidth = "340px";
    errorContainer.style.margin = "12px auto";
    errorContainer.style.boxSizing = "border-box";

    errorContainer.innerHTML = `
      <div style="margin-bottom: 10px;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      </div>
      <p style="margin: 0; font-size: 14px; font-weight: 500;">${t("editor.tools.image.failedToLoad")}</p>
      <p style="margin: 8px 0 0 0; font-size: 12px; opacity: 0.8;">${t("editor.tools.image.tryAnother")}</p>
    `;

    if (!this.isCompleteMode()) {
      const retryButton = this.createButton(
        t("editor.tools.image.tryAgain"),
        () => {
          this.createUploadUI();
        },
      );
      retryButton.style.marginTop = "12px";
      retryButton.style.backgroundColor = "#dc2626";
      retryButton.style.color = "white";
      errorContainer.appendChild(retryButton);
    }

    this.wrapper.appendChild(errorContainer);
  }

  private addPasteHint(): void {
    if (!this.wrapper || this.readOnly || this.isCompleteMode()) return;

    const pasteHint = document.createElement("div");
    pasteHint.style.textAlign = "center";
    pasteHint.style.fontSize = "12px";
    pasteHint.style.color = "#667085";
    pasteHint.style.marginTop = "8px";
    pasteHint.innerHTML = t("editor.tools.image.pasteHint", {
      key: `<kbd style="padding: 2px 6px; background: #f3f4f6; border-radius: 4px; font-size: 11px; border: 1px solid #d1d5db;">Ctrl+V</kbd>`,
    });
    this.wrapper.appendChild(pasteHint);
  }

  applyTransformation(image?: HTMLImageElement): void {
    if (!image && this.imageContainer) {
      image = this.imageContainer.querySelector("img") as HTMLImageElement;
    }

    if (!image) return;

    let transform = `rotate(${this.data.rotation}deg)`;
    transform += this.data.flipX ? " scaleX(-1)" : "";
    transform += this.data.flipY ? " scaleY(-1)" : "";
    transform += ` scale(${this.data.zoom})`;

    image.style.transform = transform;
    image.style.transformOrigin = "center center";
  }

  applyZoom(): void {
    if (!this.imageContainer) return;
    const image = this.imageContainer.querySelector("img") as HTMLImageElement;
    if (!image) return;

    this.applyTransformation(image);
    this.updateResizeHandles();
  }

  createResizeHandles(): void {
    this.removeResizeHandles();

    if (this.isCompleteMode()) return;

    const positions = [
      "nw",
      "ne",
      "se",
      "sw",
      "top",
      "right",
      "bottom",
      "left",
    ];

    this.resizeHandles = positions.map((pos) => {
      const handle = document.createElement("div");
      handle.classList.add(
        "custom-image-tool__resize-handle",
        `custom-image-tool__resize-handle--${pos}`,
      );
      handle.style.position = "absolute";
      handle.style.width = "12px";
      handle.style.height = "12px";
      handle.style.backgroundColor = "#4086FF";
      handle.style.border = "2px solid #fff";
      handle.style.borderRadius = "50%";
      handle.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
      handle.style.cursor =
        pos === "nw" || pos === "se"
          ? "nwse-resize"
          : pos === "ne" || pos === "sw"
            ? "nesw-resize"
            : pos === "top" || pos === "bottom"
              ? "ns-resize"
              : "ew-resize";
      handle.style.zIndex = "10";
      handle.style.transition = "all 0.1s ease";

      handle.addEventListener("mouseenter", () => {
        handle.style.transform = "scale(1.2)";
        handle.style.backgroundColor = "#2563eb";
      });
      handle.addEventListener("mouseleave", () => {
        handle.style.transform = "scale(1)";
        handle.style.backgroundColor = "#4086FF";
      });

      handle.addEventListener("mousedown", (event) =>
        this.startResize(event, pos),
      );
      this.imageContainer!.appendChild(handle);
      return handle;
    });

    this.updateResizeHandles();
  }

  private removeResizeHandles(): void {
    this.resizeHandles.forEach((handle) => {
      if (handle.parentNode) {
        handle.parentNode.removeChild(handle);
      }
    });
    this.resizeHandles = [];
  }

  updateResizeHandles(): void {
    if (
      !this.imageContainer ||
      this.resizeHandles.length === 0 ||
      this.isCompleteMode()
    )
      return;

    const image = this.imageContainer.querySelector("img") as HTMLImageElement;
    if (!image) return;

    const containerRect = this.imageContainer.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();

    const relTop = imageRect.top - containerRect.top;
    const relLeft = imageRect.left - containerRect.left;
    const visWidth = imageRect.width;
    const visHeight = imageRect.height;

    this.resizeHandles.forEach((handle) => {
      const pos = handle.classList[1].split("--")[1];

      switch (pos) {
        case "nw":
          handle.style.top = `${relTop - 6}px`;
          handle.style.left = `${relLeft - 6}px`;
          break;
        case "ne":
          handle.style.top = `${relTop - 6}px`;
          handle.style.left = `${relLeft + visWidth - 6}px`;
          break;
        case "se":
          handle.style.top = `${relTop + visHeight - 6}px`;
          handle.style.left = `${relLeft + visWidth - 6}px`;
          break;
        case "sw":
          handle.style.top = `${relTop + visHeight - 6}px`;
          handle.style.left = `${relLeft - 6}px`;
          break;
        case "top":
          handle.style.top = `${relTop - 6}px`;
          handle.style.left = `${relLeft + visWidth / 2 - 6}px`;
          break;
        case "right":
          handle.style.top = `${relTop + visHeight / 2 - 6}px`;
          handle.style.left = `${relLeft + visWidth - 6}px`;
          break;
        case "bottom":
          handle.style.top = `${relTop + visHeight - 6}px`;
          handle.style.left = `${relLeft + visWidth / 2 - 6}px`;
          break;
        case "left":
          handle.style.top = `${relTop + visHeight / 2 - 6}px`;
          handle.style.left = `${relLeft - 6}px`;
          break;
      }
    });
  }

  applyAspectRatio(): void {
    if (!this.imageContainer) return;
    const image = this.imageContainer.querySelector("img") as HTMLImageElement;
    if (!image) return;

    const preset = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(this.data.aspectRatio || ""));
    if (preset && Number(preset[1]) > 0 && Number(preset[2]) > 0) {
      const w = Number(preset[1]);
      const h = Number(preset[2]);
      const currentWidth =
        parseInt(image.style.width, 10) || image.naturalWidth || 300;

      let newWidth = Math.max(
        50,
        Math.min(currentWidth, this.MAX_PARENT_WIDTH),
      );
      const newHeight = Math.round((newWidth * h) / w);

      image.style.width = `${newWidth}px`;
      image.style.height = `${newHeight}px`;
      this.data.width = `${newWidth}px`;
      this.data.height = `${newHeight}px`;
    }
    this.updateResizeHandles();
    this.syncWrapContract();
  }

  startResize(event: MouseEvent, position: string): void {
    if (this.isCompleteMode()) return;

    event.preventDefault();
    event.stopPropagation();

    const image = this.imageContainer!.querySelector("img") as HTMLImageElement;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = image.offsetWidth;
    const startHeight = image.offsetHeight;

    const aspectRatio =
      this.data.aspectRatio && this.data.aspectRatio !== "free" && startHeight
        ? startWidth / startHeight
        : null;

    const onMouseMove = (e: MouseEvent) => {
      let newWidth = startWidth;
      let newHeight = startHeight;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (position.includes("right")) newWidth = startWidth + dx;
      if (position.includes("left")) newWidth = startWidth - dx;
      if (position.includes("bottom")) newHeight = startHeight + dy;
      if (position.includes("top")) newHeight = startHeight - dy;

      if (position === "nw") {
        newWidth = startWidth - dx;
        newHeight = startHeight - dy;
      } else if (position === "ne") {
        newWidth = startWidth + dx;
        newHeight = startHeight - dy;
      } else if (position === "sw") {
        newWidth = startWidth - dx;
        newHeight = startHeight + dy;
      } else if (position === "se") {
        newWidth = startWidth + dx;
        newHeight = startHeight + dy;
      }

      newWidth = Math.max(20, newWidth);
      newHeight = Math.max(20, newHeight);

      newWidth = Math.min(newWidth, this.MAX_PARENT_WIDTH);

      if (aspectRatio) {
        if (position.includes("right") || position.includes("left")) {
          newHeight = Math.round(newWidth / aspectRatio);
        } else {
          newWidth = Math.round(newHeight * aspectRatio);
          newWidth = Math.min(newWidth, this.MAX_PARENT_WIDTH);
          newHeight = Math.round(newWidth / aspectRatio);
        }
      }

      image.style.width = `${newWidth}px`;
      image.style.height = `${newHeight}px`;
      this.data.width = `${newWidth}px`;
      this.data.height = `${newHeight}px`;

      this.applyCropIfAny();
      this.updateResizeHandles();
      this.syncWrapContract();
    };

    this.trackDrag(onMouseMove, () => this.notifyChange());
  }

  createUploadUI(): void {
    if (!this.wrapper) return;

    this.wrapper.innerHTML = "";

    if (this.isCompleteMode()) {
      const messageContainer = document.createElement("div");
      messageContainer.style.textAlign = "center";
      messageContainer.style.padding = "20px";
      messageContainer.style.color = "#667085";
      messageContainer.style.fontStyle = "italic";
      messageContainer.innerText = t("editor.tools.image.imagePreview");
      this.wrapper.appendChild(messageContainer);
      return;
    }

    const uploadContainer = document.createElement("div");
    uploadContainer.style.display = "flex";
    uploadContainer.style.flexDirection = "column";
    uploadContainer.style.alignItems = "center";
    uploadContainer.style.gap = "10px";
    uploadContainer.style.padding = "20px 20px 18px";
    uploadContainer.style.border = "1.5px dashed #d0d5dd";
    uploadContainer.style.borderRadius = "10px";
    uploadContainer.style.backgroundColor = "#f8fafc";
    uploadContainer.style.transition =
      "border-color 0.15s ease, background-color 0.15s ease";
    uploadContainer.style.cursor = "default";

    uploadContainer.addEventListener("mouseenter", () => {
      uploadContainer.style.borderColor = "#4086FF";
      uploadContainer.style.backgroundColor = "#f0f7ff";
    });
    uploadContainer.addEventListener("mouseleave", () => {
      uploadContainer.style.borderColor = "#d0d5dd";
      uploadContainer.style.backgroundColor = "#f8fafc";
    });

    // Smaller icon — 26px feels balanced against the tighter type.
    const uploadIcon = document.createElement("div");
    uploadIcon.innerHTML = `
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#667085" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
      </svg>
    `;
    uploadIcon.style.display = "flex";
    uploadIcon.style.alignItems = "center";
    uploadIcon.style.justifyContent = "center";
    uploadIcon.style.width = "40px";
    uploadIcon.style.height = "40px";
    uploadIcon.style.borderRadius = "50%";
    uploadIcon.style.backgroundColor = "#eff4ff";
    uploadIcon.style.color = "#4086FF";

    // Single-line title now — modern editors don't need a big "Upload
    // Image" heading; the icon + clear instruction reads faster.
    const title = document.createElement("div");
    title.innerHTML =
      `<span style="color:#344054;font-weight:600">${t("editor.tools.image.clickToUpload")}</span>` +
      `<span style="color:#667085"> ${t("editor.tools.image.orDragDrop")}</span>`;
    title.style.fontSize = "13px";
    title.style.textAlign = "center";
    title.style.lineHeight = "1.4";

    // Action row: Choose file (primary) + Paste URL (text button).
    // Horizontal to keep vertical footprint minimal.
    const actionsRow = document.createElement("div");
    actionsRow.style.display = "flex";
    actionsRow.style.alignItems = "center";
    actionsRow.style.gap = "8px";
    actionsRow.style.marginTop = "2px";

    const uploadButton = this.createButton(
      t("editor.tools.image.chooseFile"),
      () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ACCEPT_TYPES;
        input.addEventListener("change", (event: Event) => {
          const inputTarget = event.target as HTMLInputElement;
          const file = inputTarget.files?.[0];
          if (!file) return;
          if (!String(file.type).startsWith("image/")) {
            this.showNotice(t("editor.tools.image.typeNotAccepted"), "error");
            return;
          }
          void this.runIngest(() => this.ingestFile(file));
        });
        input.click();
      },
    );
    // Slim the primary button down from full-width to a tight pill.
    uploadButton.style.marginBottom = "0";
    uploadButton.style.width = "auto";
    uploadButton.style.maxWidth = "none";
    uploadButton.style.padding = "7px 14px";
    uploadButton.style.fontSize = "12.5px";
    uploadButton.style.fontWeight = "500";

    // Vertical divider between the two actions — subtle.
    const divider = document.createElement("span");
    divider.style.width = "1px";
    divider.style.height = "18px";
    divider.style.backgroundColor = "#e1e5e9";

    // URL input row — hidden by default. Rendered inline below the
    // action row when the user clicks the "Paste URL" text button.
    const urlRow = document.createElement("div");
    urlRow.style.display = "none";
    urlRow.style.width = "100%";
    urlRow.style.maxWidth = "360px";
    urlRow.style.gap = "6px";
    urlRow.style.marginTop = "6px";

    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.placeholder = "https://example.com/image.jpg";
    urlInput.style.flex = "1";
    urlInput.style.padding = "7px 10px";
    urlInput.style.border = "1px solid #d0d5dd";
    urlInput.style.borderRadius = "6px";
    urlInput.style.fontSize = "12.5px";
    urlInput.style.color = "#344054";
    urlInput.style.fontFamily = "inherit";
    urlInput.style.outline = "none";
    urlInput.addEventListener("focus", () => {
      urlInput.style.borderColor = "#4086FF";
      urlInput.style.boxShadow = "0 0 0 3px rgba(64, 134, 255, 0.12)";
    });
    urlInput.addEventListener("blur", () => {
      urlInput.style.borderColor = "#d0d5dd";
      urlInput.style.boxShadow = "none";
    });

    const loadButton = this.createButton(
      t("editor.tools.image.load"),
      () => {
        const url = urlInput.value.trim();
        if (!url) {
          failedPopper(t("editor.tools.image.enterUrl"));
          return;
        }
        if (!isSafeImageUrl(url) || url.toLowerCase().startsWith("data:")) {
          failedPopper(t("editor.tools.image.enterValidUrl"));
          this.showNotice(t("editor.tools.image.enterValidUrl"), "error");
          return;
        }
        void this.runIngest(() => this.ingestUrl(url));
      },
    );
    loadButton.style.padding = "7px 12px";
    loadButton.style.fontSize = "12.5px";
    loadButton.style.whiteSpace = "nowrap";
    loadButton.style.margin = "0";

    urlInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") loadButton.click();
    });

    urlRow.appendChild(urlInput);
    urlRow.appendChild(loadButton);

    // "Paste URL" text button toggles the input row.
    const urlToggle = document.createElement("button");
    urlToggle.type = "button";
    urlToggle.textContent = t("editor.tools.image.pasteUrl");
    urlToggle.style.background = "none";
    urlToggle.style.border = "none";
    urlToggle.style.padding = "0";
    urlToggle.style.color = "#4086FF";
    urlToggle.style.fontSize = "12.5px";
    urlToggle.style.fontWeight = "500";
    urlToggle.style.cursor = "pointer";
    urlToggle.style.fontFamily = "inherit";
    urlToggle.addEventListener("mouseenter", () => {
      urlToggle.style.textDecoration = "underline";
    });
    urlToggle.addEventListener("mouseleave", () => {
      urlToggle.style.textDecoration = "none";
    });
    urlToggle.addEventListener("click", () => {
      const shown = urlRow.style.display === "flex";
      urlRow.style.display = shown ? "none" : "flex";
      urlToggle.textContent = shown
        ? t("editor.tools.image.pasteUrl")
        : t("common.cancel");
      if (!shown) setTimeout(() => urlInput.focus(), 0);
    });

    actionsRow.appendChild(uploadButton);
    actionsRow.appendChild(divider);
    actionsRow.appendChild(urlToggle);

    // Supported format hint — small, muted, one line.
    const formats = document.createElement("div");
    formats.textContent = "JPG · PNG · GIF · BMP · WebP · SVG";
    formats.style.fontSize = "11px";
    formats.style.color = "#98a2b3";
    formats.style.letterSpacing = "0.2px";
    formats.style.marginTop = "2px";

    // Focusable so a click + Ctrl/Cmd+V lands on this block (the wrapper's
    // paste listener handles it). Drops are handled here so Editor.js
    // doesn't insert a second image block next to this empty one.
    uploadContainer.tabIndex = 0;
    uploadContainer.setAttribute("data-image-dropzone", "true");
    uploadContainer.addEventListener("dragover", (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      uploadContainer.classList.add("tp-image__drop--over");
    });
    uploadContainer.addEventListener("dragleave", () => {
      uploadContainer.classList.remove("tp-image__drop--over");
    });
    uploadContainer.addEventListener("drop", (e: DragEvent) => {
      uploadContainer.classList.remove("tp-image__drop--over");
      const file = Array.from(e.dataTransfer?.files || []).find((f) =>
        String(f.type).startsWith("image/"),
      );
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      void this.runIngest(() => this.ingestFile(file));
    });

    uploadContainer.appendChild(uploadIcon);
    uploadContainer.appendChild(title);
    uploadContainer.appendChild(actionsRow);
    uploadContainer.appendChild(urlRow);
    uploadContainer.appendChild(formats);

    this.wrapper.appendChild(uploadContainer);
  }
  save(): any {
    // Sizes come from data (every resize path writes it). Reading
    // offsetWidth here used to save "0px" for a not-yet-loaded or hidden
    // image and lose the size; it's only a fallback for "auto" now.
    const image = this.imageContainer?.querySelector("img") as HTMLImageElement;
    if (image && (!parsePx(this.data.width) || !parsePx(this.data.height))) {
      if (image.offsetWidth > 0 && image.offsetHeight > 0) {
        this.data.width = `${image.offsetWidth}px`;
        this.data.height = `${image.offsetHeight}px`;
      }
    }
    // A caption being typed inline (not yet blurred).
    const liveCaption = this.wrapper?.querySelector("[data-image-caption]");
    if (liveCaption && this.data.showCaption) {
      this.data.caption = (liveCaption.textContent || "").trim();
    }

    return {
      file: { url: this.data.url },
      caption: this.data.caption,
      dimensions: { width: this.data.width, height: this.data.height },
      rotation: normalizeRotation(this.data.rotation),
      aspectRatio: this.data.aspectRatio || "free",
      flipX: this.data.flipX,
      flipY: this.data.flipY,
      zoom: this.data.zoom,
      altText: this.data.altText || "",
      border: this.data.border,
      originalUrl: this.data.originalUrl,
      showCaption: this.data.showCaption,
      crop: this.data.crop,
      link: this.data.link,
      shadow: this.data.shadow,
      filters: this.data.filters,
      shape: this.data.shape,
      tunes: this.data.tunes,
    };
  }

  /** Editor.js: block removed from the page. */
  removed(): void {
    this.destroy();
  }

  /** Editor.js: editor / block destroyed. Removes everything this tool
   *  put outside its own block (settings panel, document listeners). */
  destroy(): void {
    if (this.destroyed) return;
    this._closeContextMenu();
    this.stopDrag();
    this.ingestSeq++; // ignore any upload still in flight
    if (this.wrapper) {
      this.wrapper.removeEventListener("paste", this.boundPaste);
      this.wrapper.removeEventListener("contextmenu", this.boundContextMenu);
      if (this.captionHoverShow) this.wrapper.removeEventListener("mouseenter", this.captionHoverShow);
      if (this.captionHoverHide) this.wrapper.removeEventListener("mouseleave", this.captionHoverHide);
    }
    this.captionHoverShow = null;
    this.captionHoverHide = null;
    this.destroyed = true;
  }

  // Context Menu Methods
  private _showContextMenu(targetElement: HTMLElement): void {
    if (this.isContextMenuOpen) {
      this._closeContextMenu();
      return;
    }
    // One panel at a time across every image block.
    if (openPanelOwner && openPanelOwner !== this) openPanelOwner._closeContextMenu();
    // Belt and braces: drop any orphaned panel left in <body>.
    document
      .querySelectorAll("[data-image-settings-panel]")
      .forEach((el) => el.remove());

    this.contextMenu = this._createContextMenu();
    document.body.appendChild(this.contextMenu);
    this.isContextMenuOpen = true;
    openPanelOwner = this;

    this._positionContextMenu(targetElement);

    // Deferred so the opening click doesn't close it; skipped if the panel
    // was closed again before the timer fired.
    const menu = this.contextMenu;
    setTimeout(() => {
      if (this.contextMenu !== menu || !this.isContextMenuOpen) return;
      document.addEventListener("click", this._handleOutsideClick);
      document.addEventListener("keydown", this._handleEscKey);
    }, 0);
  }

  private _handleOutsideClick = (e: MouseEvent): void => {
    if (this.contextMenu && !this.contextMenu.contains(e.target as Node)) {
      this._closeContextMenu();
    }
  };

  private _handleEscKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.isContextMenuOpen) {
      this._closeContextMenu();
    }
  };

  private _closeContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
    if (openPanelOwner === this) openPanelOwner = null;
    this.isContextMenuOpen = false;
    document.removeEventListener("click", this._handleOutsideClick);
    document.removeEventListener("keydown", this._handleEscKey);
  }

  // Positioning is now baked into the panel's CSS (right:0; top:0;
  // height:100vh), so this method is a no-op kept only so existing
  // call sites don't need to change.
  private _positionContextMenu(_targetElement: HTMLElement): void {
    return;
  }

  private _createContextMenu(): HTMLElement {
    // Right-docked side panel instead of a centred modal. Matches the
    // existing "CONTENT" / Design panel pattern on the right of the
    // builder — leaves the document fully visible while editing image
    // settings, and single-column stacking plays nicer with the number
    // of Tier-1 + Tier-2 controls than a cramped 3-column grid did.
    const menu = document.createElement("div");
    menu.setAttribute("data-image-settings-panel", "true");
    menu.style.position = "fixed";
    menu.style.top = "0";
    menu.style.right = "0";
    menu.style.width = "500px";
    menu.style.maxWidth = "95vw";
    menu.style.height = "100vh";
    menu.style.backgroundColor = "#fff";
    menu.style.boxShadow = "-4px 0 16px rgba(0,0,0,0.08)";
    menu.style.zIndex = "100000";
    menu.style.borderLeft = "1px solid #e1e5e9";
    menu.style.display = "flex";
    menu.style.flexDirection = "column";
    // Slide-in from the right so the panel feels like a sibling of the
    // other right-side docked panels rather than a popup.
    menu.style.transform = "translateX(100%)";
    menu.style.transition = "transform 0.18s ease-out";
    const slideIn = () => {
      menu.style.transform = "translateX(0)";
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(slideIn);
    else slideIn();
    // Every control in the panel edits this.data; tell Editor.js once per
    // interaction instead of from each handler.
    const changed = () => setTimeout(() => this.notifyChange(), 0);
    menu.addEventListener("change", changed);
    menu.addEventListener("input", changed);
    menu.addEventListener("click", changed);

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 14px 18px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f9fafb;
      flex-shrink: 0;
    `;

    const title = document.createElement("h3");
    title.textContent = t("editor.tools.image.imageSettings", {
      defaultValue: "Image settings",
    });
    title.style.cssText =
      "margin:0;font-size:15px;font-weight:600;color:#111827;";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
      border: none; background: none; font-size: 18px; cursor: pointer;
      color: #6b7280; padding: 4px 8px; border-radius: 4px;
      transition: background 0.15s;
    `;
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.backgroundColor = "#e5e7eb";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.backgroundColor = "transparent";
    });
    closeBtn.addEventListener("click", () => this._closeContextMenu());

    header.appendChild(title);
    header.appendChild(closeBtn);
    menu.appendChild(header);

    // Scrollable body — single column, three collapsible groups.
    const body = document.createElement("div");
    body.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    `;

    const makeGroup = (
      titleText: string,
      content: HTMLElement,
      defaultOpen: boolean,
    ) => {
      const details = document.createElement("details");
      details.open = defaultOpen;
      details.style.cssText =
        "border:1px solid #e5e7eb;border-radius:8px;background:#fff;";
      const summary = document.createElement("summary");
      summary.textContent = titleText;
      summary.style.cssText = `
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 600;
        color: #111827;
        cursor: pointer;
        user-select: none;
        list-style: none;
        border-bottom: 1px solid transparent;
      `;
      // Pseudo-list-style-type suppression + chevron is easier via a
      // single toggle class, but inline SVG keeps this class-free.
      summary.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:8px;">
          <svg width="12" height="12" viewBox="0 0 12 12" style="transition:transform 0.15s;" data-chevron><path d="M4 2l4 4-4 4" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          ${titleText}
        </span>
      `;
      const wrap = document.createElement("div");
      wrap.style.cssText = "padding: 14px;";
      wrap.appendChild(content);
      details.appendChild(summary);
      details.appendChild(wrap);
      // Rotate the chevron on open/close.
      const rotateChevron = () => {
        const ch = summary.querySelector("[data-chevron]") as SVGElement | null;
        if (ch)
          ch.style.transform = details.open ? "rotate(90deg)" : "rotate(0deg)";
      };
      rotateChevron();
      details.addEventListener("toggle", rotateChevron);
      return details;
    };

    const layoutSection = this._createLayoutSection();
    const transformSection = this._createTransformSection();
    const marginsSection = this._createMarginsSection();

    body.appendChild(
      makeGroup(
        t("editor.tools.image.layout", { defaultValue: "Layout" }),
        layoutSection,
        true,
      ),
    );
    body.appendChild(
      makeGroup(
        t("editor.tools.image.transform", { defaultValue: "Transform" }),
        transformSection,
        false,
      ),
    );
    body.appendChild(
      makeGroup(
        t("editor.tools.image.margins", { defaultValue: "Margins" }),
        marginsSection,
        false,
      ),
    );

    menu.appendChild(body);

    return menu;
  }

  // Right-click menu sections now delegate straight to the shared UI
  // builders. One source of truth for every control (alignment, size,
  // presets, shape, shadow, link, border, alt text, caption, filters,
  // crop, rotate/flip/zoom, replace, reset) means a new feature only has
  // to be added in renderLayoutSettings / renderTransformSettings and it
  // shows up here automatically.
  private _createLayoutSection(): HTMLElement {
    const section = document.createElement("div");
    this.renderLayoutSettings(section);
    return section;
  }

  private _createTransformSection(): HTMLElement {
    const section = document.createElement("div");
    this.renderTransformSettings(section);
    return section;
  }

  private _createMarginsSection(): HTMLElement {
    const section = document.createElement("div");

    const title = this._createSectionTitle(
      t("editor.tools.image.margins"),
    );
    section.appendChild(title);

    const margins = ["marginTop", "marginRight", "marginBottom", "marginLeft"];
    const labels = [
      t("editor.tools.image.top"),
      t("editor.tools.image.right"),
      t("editor.tools.image.bottom"),
      t("editor.tools.image.left"),
    ];

    margins.forEach((margin, index) => {
      const container = document.createElement("div");
      container.style.marginBottom = "12px";

      const label = document.createElement("label");
      label.textContent = labels[index];
      label.style.fontSize = "12px";
      label.style.color = "#344054";
      label.style.display = "block";
      label.style.marginBottom = "4px";

      const input = document.createElement("input");
      input.type = "number";
      input.value = String(
        parseInt(this.data.tunes?.imageTune?.[margin] || "0", 10) || 0,
      );
      input.style.width = "100%";
      input.style.padding = "8px 12px";
      input.style.border = "1px solid #d0d5dd";
      input.style.borderRadius = "6px";
      input.style.fontSize = "13px";

      input.addEventListener("change", (e) => {
        const value = (e.target as HTMLInputElement).value;
        this.setMargin(margin, value);
        input.value = String(parsePx(this.data.tunes.imageTune[margin]) || 0);
      });

      container.appendChild(label);
      container.appendChild(input);
      section.appendChild(container);
    });

    return section;
  }

  private _createSectionTitle(text: string): HTMLElement {
    const title = document.createElement("div");
    title.textContent = text;
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.color = "#344054";
    title.style.marginBottom = "12px";
    return title;
  }

  private _createOptionButton(
    text: string,
    isActive: boolean,
    onClick: () => void,
  ): HTMLElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.padding = "8px 12px";
    btn.style.border = "1px solid #d0d5dd";
    btn.style.borderRadius = "6px";
    btn.style.fontSize = "13px";
    btn.style.cursor = "pointer";
    btn.style.transition = "all 0.2s";
    btn.style.flex = "1";
    btn.style.whiteSpace = "nowrap";

    if (isActive) {
      btn.style.backgroundColor = "#4086FF";
      btn.style.color = "#fff";
      btn.style.borderColor = "#4086FF";
    } else {
      btn.style.backgroundColor = "#fff";
      btn.style.color = "#344054";
    }

    btn.addEventListener("mouseenter", () => {
      if (!isActive) {
        btn.style.backgroundColor = "#f9fafb";
        btn.style.borderColor = "#4086FF";
      }
    });

    btn.addEventListener("mouseleave", () => {
      if (!isActive) {
        btn.style.backgroundColor = "#fff";
        btn.style.borderColor = "#d0d5dd";
      }
    });

    btn.addEventListener("click", onClick);

    return btn;
  }

  private setWrapText(wrapValue: string): void {
    if (!this.data.tunes) this.data.tunes = {};
    if (!this.data.tunes.imageTune) this.data.tunes.imageTune = {};
    this.data.tunes.imageTune.wrapText = wrapValue;

    const alignment = this.data.tunes?.alignment?.alignment || "left";

    if (!FLOAT_WRAPS.has(wrapValue)) {
      this.data.tunes.imageTune.float = "inline";
    } else if (alignment === "right") {
      this.data.tunes.imageTune.float = "right";
    } else {
      // Floats sit left or right; a centred image floats left.
      this.data.tunes.imageTune.float = "left";
      if (alignment === "center") this.data.tunes.alignment.alignment = "left";
    }

    this.applyTunesStyles();
    this.notifyChange();
  }
}

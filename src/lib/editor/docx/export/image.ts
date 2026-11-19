/**
 * Image blocks → DOCX.
 *
 * `docx` needs the image bytes synchronously while the document tree is
 * built, so http(s) / relative URLs are fetched up-front by
 * `loadDocxImages` and handed to the block converter through
 * `useDocxImages`. data: URLs decode synchronously and need no preload.
 *
 * Mapping (ImageTool data → Word):
 *   dimensions (px)          → extent (docx transformation is px @96dpi)
 *   crop (% per edge)        → a:srcRect crop; extent = visible part
 *   rotation / flipX / flipY → a:xfrm rot / flipH / flipV
 *   altText                  → wp:docPr descr + title
 *   link                     → a:hlinkClick on the picture
 *   border (solid colour)    → a:ln outline
 *   wrap inline / top-bottom → inline picture in its own aligned paragraph
 *   wrap float-left / -right → wp:anchor, wrapSquare, text on the other side
 *   caption (showCaption)    → italic paragraph after the picture
 *   tunes margins            → paragraph spacing / indent (inline) or
 *                              wrap distances (floating)
 * Anything that can't be fetched or decoded becomes an "[image]" text.
 */
import {
  AlignmentType,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Paragraph,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  VerticalPositionRelativeFrom,
} from "docx";
import { isSafeImageUrl, isSafeLinkUrl } from "../../safeUrl";
import { canRasterize, imageWrapMode, parsePx, rasterizeToPng } from "../../tools/ImageTool";

export type DocxImageType = "png" | "jpg" | "gif" | "bmp";

export interface LoadedImage {
  data: Uint8Array;
  type: DocxImageType;
  /** Natural pixel size, when it could be read from the file header. */
  width?: number;
  height?: number;
}

/** url → bytes (or null when the image couldn't be loaded). */
export type DocxImageCache = Map<string, LoadedImage | null>;

/** Widest picture we emit when the block has no saved size (6.5in). */
const MAX_AUTO_WIDTH_PX = 624;
/** Hard cap — the tool never saves more than this. */
const MAX_PX = 2000;
const EMU_PER_PX = 9525;

let activeCache: DocxImageCache = new Map();

/** Images the converter should use (set right before building the doc). */
export function useDocxImages(cache: DocxImageCache): void {
  activeCache = cache;
}

// ── Loading ───────────────────────────────────────────────────────────

interface ImageBlockLike {
  type?: unknown;
  data?: unknown;
  tunes?: unknown;
}

/** The URL an image block points at (`file.url`, or legacy `url`). */
export function imageBlockUrl(data: unknown): string {
  const d = (data ?? {}) as { file?: { url?: unknown }; url?: unknown };
  if (typeof d.file?.url === "string" && d.file.url) return d.file.url;
  if (typeof d.url === "string" && d.url) return d.url;
  return "";
}

/** Every image URL anywhere in the given values (blocks, nested editors,
 *  header / footer sets). */
export function collectImageUrls(...roots: unknown[]): string[] {
  const urls = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const block = v as ImageBlockLike;
    if (block.type === "image") {
      const url = imageBlockUrl(block.data);
      if (url) urls.add(url);
    }
    Object.values(v as Record<string, unknown>).forEach(walk);
  };
  roots.forEach(walk);
  return [...urls];
}

/** Fetch / decode every image the document references. Never rejects. */
export async function loadDocxImages(...roots: unknown[]): Promise<DocxImageCache> {
  const cache: DocxImageCache = new Map();
  await Promise.all(
    collectImageUrls(...roots).map(async (url) => {
      cache.set(url, await loadImage(url).catch(() => null));
    }),
  );
  return cache;
}

/** Bytes for one image URL, converted to a type Word understands. */
export async function loadImage(url: string): Promise<LoadedImage | null> {
  if (!isSafeImageUrl(url)) return null;
  let bytes: Uint8Array;
  let mime = "";
  if (url.toLowerCase().startsWith("data:")) {
    const decoded = decodeDataUrl(url);
    if (!decoded) return null;
    ({ bytes, mime } = decoded);
  } else {
    const href = resolveUrl(url);
    if (!href || typeof fetch !== "function") return null;
    try {
      const res = await fetch(href, { credentials: "include" });
      if (!res.ok) return null;
      mime = res.headers?.get?.("content-type") ?? "";
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
  const direct = toLoaded(bytes);
  if (direct) return direct;
  // WebP / SVG / anything else: PNG via canvas in a real browser only.
  if (!canRasterize()) return null;
  try {
    const sniffed = sniffType(bytes);
    const type = mime.split(";")[0] || (sniffed === "svg" ? "image/svg+xml" : "");
    const blob = new Blob([bytes as BlobPart], type ? { type } : undefined);
    const png = await rasterizeToPng(blob);
    return toLoaded(new Uint8Array(await png.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Relative URLs (`/api/uploads/x`) resolve against the current page. */
function resolveUrl(url: string): string | null {
  try {
    const base = typeof location !== "undefined" ? location.href : undefined;
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/is.exec(url);
  if (!match || !match[2]) return null;
  try {
    const bin = atob(match[3]!.replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: match[1] ?? "" };
  } catch {
    return null;
  }
}

/** Identify the format from the file's magic bytes (content-type and
 *  data: URL labels lie often enough not to trust them). */
export function sniffType(b: Uint8Array): DocxImageType | "webp" | "svg" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "webp";
  }
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  return null;
}

function toLoaded(bytes: Uint8Array): LoadedImage | null {
  const type = sniffType(bytes);
  if (type !== "png" && type !== "jpg" && type !== "gif" && type !== "bmp") return null;
  return { data: bytes, type, ...naturalSize(bytes, type) };
}

/** Pixel size from the file header (PNG IHDR, GIF LSD, BMP DIB, JPEG SOF). */
function naturalSize(b: Uint8Array, type: DocxImageType): { width?: number; height?: number } {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!;
  const u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const i32le = (i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24);
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  try {
    if (type === "png" && b.length >= 24) return { width: u32be(16), height: u32be(20) };
    if (type === "gif" && b.length >= 10) return { width: u16le(6), height: u16le(8) };
    if (type === "bmp" && b.length >= 26) return { width: Math.abs(i32le(18)), height: Math.abs(i32le(22)) };
    if (type === "jpg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1]!;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: u16be(i + 5), width: u16be(i + 7) };
        }
        i += 2 + u16be(i + 2);
      }
    }
  } catch {
    /* truncated header */
  }
  return {};
}

// ── Conversion ────────────────────────────────────────────────────────

interface ImageData {
  caption?: unknown;
  showCaption?: unknown;
  altText?: unknown;
  dimensions?: { width?: unknown; height?: unknown };
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  flipX?: unknown;
  flipY?: unknown;
  crop?: { top?: unknown; right?: unknown; bottom?: unknown; left?: unknown };
  link?: { url?: unknown };
  border?: { width?: unknown; style?: unknown; color?: unknown };
  tunes?: {
    alignment?: { alignment?: unknown };
    imageTune?: Record<string, unknown>;
  };
}

const pct = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.min(95, Math.max(0, n)) : 0;
};
const pxToTwip = (px: number) => Math.round(px * 15);

function hex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  const h = m[1]!;
  return (h.length === 3 ? h.replace(/./g, "$&$&") : h).toUpperCase();
}

function alignmentOf(data: ImageData, block: ImageBlockLike) {
  const own = data.tunes?.alignment?.alignment;
  const tune = (block.tunes as { alignment?: { alignment?: unknown } } | undefined)?.alignment
    ?.alignment;
  const a = typeof own === "string" ? own : typeof tune === "string" ? tune : "left";
  return a === "center" ? AlignmentType.CENTER : a === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
}

/** Display size in px: saved size, else natural size capped to the page,
 *  keeping the aspect ratio whenever only one side is known. */
function displaySize(data: ImageData, img: LoadedImage): { width: number; height: number } {
  let w = parsePx(data.dimensions?.width ?? data.width);
  let h = parsePx(data.dimensions?.height ?? data.height);
  const ratio = img.width && img.height ? img.width / img.height : w && h ? w / h : 4 / 3;
  if (!w && !h) {
    w = Math.min(img.width || 480, MAX_AUTO_WIDTH_PX);
    h = w / ratio;
  } else if (!w) {
    w = h * ratio;
  } else if (!h) {
    h = w / ratio;
  }
  const scale = Math.min(1, MAX_PX / Math.max(w, h));
  return { width: Math.max(1, w * scale), height: Math.max(1, h * scale) };
}

function fallbackParagraph(data: ImageData, alignment: (typeof AlignmentType)[keyof typeof AlignmentType]): Paragraph {
  const alt = typeof data.altText === "string" ? data.altText.trim() : "";
  return new Paragraph({
    alignment,
    children: [new TextRun({ text: alt ? `[image: ${alt}]` : "[image]", italics: true })],
  });
}

let imageCounter = 0;

/**
 * One image block → paragraphs (picture, then caption when shown). Uses
 * the preloaded cache for http / relative URLs; data: URLs decode here.
 */
export function imageBlockToDocx(
  block: ImageBlockLike,
  images: DocxImageCache = activeCache,
): Paragraph[] {
  const data = (block.data ?? {}) as ImageData;
  const url = imageBlockUrl(data);
  if (!url) return [];
  const alignment = alignmentOf(data, block);
  const wrap = imageWrapMode(data);

  let img = images.get(url) ?? null;
  if (!img && !images.has(url) && url.toLowerCase().startsWith("data:")) {
    const decoded = decodeDataUrl(url);
    img = decoded ? toLoaded(decoded.bytes) : null;
  }

  const caption =
    typeof data.caption === "string" && data.showCaption !== false ? data.caption.trim() : "";
  const captionParagraph = caption
    ? new Paragraph({
        alignment: wrap.startsWith("float") ? undefined : alignment,
        spacing: { after: 120 },
        children: [new TextRun({ text: caption, italics: true, size: 18, color: "6B7280" })],
      })
    : null;

  if (!img) {
    return captionParagraph ? [fallbackParagraph(data, alignment), captionParagraph] : [fallbackParagraph(data, alignment)];
  }

  const size = displaySize(data, img);
  const crop = {
    top: pct(data.crop?.top),
    right: pct(data.crop?.right),
    bottom: pct(data.crop?.bottom),
    left: pct(data.crop?.left),
  };
  const cropped = crop.top || crop.right || crop.bottom || crop.left;
  // The tool's width/height describe the whole picture; Word's extent is
  // the visible (cropped) frame.
  const visible = {
    width: Math.max(1, Math.round(size.width * (1 - (crop.left + crop.right) / 100))),
    height: Math.max(1, Math.round(size.height * (1 - (crop.top + crop.bottom) / 100))),
  };

  const rotation = Number(data.rotation);
  const alt = typeof data.altText === "string" ? data.altText.trim() : "";
  const linkUrl = typeof data.link?.url === "string" && isSafeLinkUrl(data.link.url) ? data.link.url : undefined;
  const borderColor = hex(data.border?.color);
  const borderWidth = parsePx(data.border?.width);
  const hasBorder = !!data.border && data.border.style !== "none" && !!data.border.style;

  const tune = data.tunes?.imageTune ?? {};
  const margin = {
    top: parsePx(tune.marginTop),
    right: parsePx(tune.marginRight),
    bottom: parsePx(tune.marginBottom),
    left: parsePx(tune.marginLeft),
  };

  imageCounter += 1;
  const floating =
    wrap === "float-left" || wrap === "float-right"
      ? {
          horizontalPosition: {
            relative: HorizontalPositionRelativeFrom.COLUMN,
            align: wrap === "float-left" ? HorizontalPositionAlign.LEFT : HorizontalPositionAlign.RIGHT,
          },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
          allowOverlap: false,
          wrap: {
            type: TextWrappingType.SQUARE,
            // Text flows on the side away from the picture.
            side: wrap === "float-left" ? TextWrappingSide.RIGHT : TextWrappingSide.LEFT,
          },
          // Distance from text (EMU); at least ~1/8in on the text side.
          margins: {
            top: Math.round(margin.top * EMU_PER_PX),
            bottom: Math.round(Math.max(margin.bottom, 8) * EMU_PER_PX),
            left: Math.round((wrap === "float-right" ? Math.max(margin.left, 12) : margin.left) * EMU_PER_PX),
            right: Math.round((wrap === "float-left" ? Math.max(margin.right, 12) : margin.right) * EMU_PER_PX),
          },
        }
      : undefined;

  const run = new ImageRun({
    type: img.type,
    data: img.data,
    transformation: {
      width: visible.width,
      height: visible.height,
      ...(Number.isFinite(rotation) && rotation % 360 !== 0 ? { rotation: ((rotation % 360) + 360) % 360 } : {}),
      ...(data.flipX === true || data.flipY === true
        ? { flip: { horizontal: data.flipX === true, vertical: data.flipY === true } }
        : {}),
    },
    altText: {
      name: `Picture ${imageCounter}`,
      description: alt,
      title: alt,
    },
    ...(cropped ? { crop } : {}),
    ...(linkUrl ? { link: linkUrl } : {}),
    ...(hasBorder
      ? {
          outline: {
            type: "solidFill" as const,
            solidFillType: "rgb" as const,
            value: borderColor ?? "000000",
            width: Math.round((borderWidth || 1) * EMU_PER_PX),
          },
        }
      : {}),
    ...(floating ? { floating } : {}),
  });

  const picture = floating
    ? new Paragraph({ children: [run] })
    : new Paragraph({
        alignment,
        children: [run],
        spacing: {
          ...(margin.top ? { before: pxToTwip(margin.top) } : {}),
          ...(margin.bottom ? { after: pxToTwip(margin.bottom) } : {}),
        },
        ...(margin.left || margin.right
          ? {
              indent: {
                ...(margin.left ? { left: pxToTwip(margin.left) } : {}),
                ...(margin.right ? { right: pxToTwip(margin.right) } : {}),
              },
            }
          : {}),
      });
  return captionParagraph ? [picture, captionParagraph] : [picture];
}

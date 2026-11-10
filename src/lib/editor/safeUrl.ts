/**
 * URL allow-listing for anything that ends up in `href` / `src`. Shared by
 * the load-time sanitizer, the EditorJS sanitize rules and the tools.
 */

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_PROTOCOLS = new Set(["http:", "https:", "blob:"]);
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]*$/i;

/** Relative URLs (`/x`, `./x`, `x.png`) and in-page anchors (`#x`). */
function isRelative(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("//");
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

/** True for links a user may click: http(s), mailto, tel, relative, #anchor. */
export function isSafeLinkUrl(raw: string | null | undefined): boolean {
  // Browsers ignore control characters and whitespace inside the scheme, so
  // `java\nscript:` must be normalised before checking.
  const url = (raw ?? "").replace(/[\u0000- ]/g, "");
  if (!url) return false;
  if (isRelative(url)) return true;
  const protocol = protocolOf(url);
  return protocol !== null && LINK_PROTOCOLS.has(protocol);
}

/** True for image sources: http(s), blob, relative, or a raster data: URL. */
export function isSafeImageUrl(raw: string | null | undefined): boolean {
  const url = (raw ?? "").trim();
  if (!url) return false;
  if (url.toLowerCase().startsWith("data:")) return SAFE_DATA_IMAGE.test(url);
  if (isRelative(url.replace(/[\u0000- ]/g, ""))) return true;
  const protocol = protocolOf(url);
  return protocol !== null && IMAGE_PROTOCOLS.has(protocol);
}

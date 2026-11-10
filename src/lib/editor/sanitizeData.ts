import DOMPurify from "dompurify";
import { isSafeImageUrl, isSafeLinkUrl } from "./safeUrl";

/**
 * Load-time sanitizer for EditorJS data.
 *
 * EditorJS only runs a tool's `sanitize` rules on save and paste — never on
 * `render()` — and our tools write stored strings straight into `innerHTML`.
 * Anything loaded from the API or produced by the DOCX importer therefore
 * goes through `sanitizeEditorData` before it reaches an editor.
 */

const FORBID_TAGS = [
  "style",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "iframe",
  "frame",
  "object",
  "embed",
  "svg",
  "math",
];

/** Keys whose string value is a URL rather than HTML. */
const LINK_KEYS = new Set(["href", "link"]);
const IMAGE_KEYS = new Set(["src", "originalUrl", "imageUrl", "thumbnail"]);

let hooksInstalled = false;

function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  // DOMPurify's default URI check allows any unknown-protocol-free value;
  // tighten it to the same allow-lists the tools use.
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "href" && !isSafeLinkUrl(data.attrValue)) {
      data.keepAttr = false;
    }
    if (data.attrName === "src" && !isSafeImageUrl(data.attrValue)) {
      data.keepAttr = false;
    }
  });
  // Links opened in a new tab must not get a handle on this window.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Sanitize one HTML fragment string. */
export function sanitizeHtml(html: string): string {
  installHooks();
  return DOMPurify.sanitize(html, {
    FORBID_TAGS,
    ADD_ATTR: ["contenteditable", "target"],
  });
}

function sanitizeValue(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    if (key === "url") {
      // `url` is an image source on image blocks and a link target on
      // `link: { url }` — accept it if it's safe as either.
      return isSafeImageUrl(value) || isSafeLinkUrl(value) ? value : "";
    }
    if (key && LINK_KEYS.has(key)) return isSafeLinkUrl(value) ? value : "";
    if (key && IMAGE_KEYS.has(key)) return isSafeImageUrl(value) ? value : "";
    // A string without "<" can't contain markup; leave it byte-identical so
    // plain values (colours, ids, CSS lengths) round-trip untouched.
    return value.includes("<") ? sanitizeHtml(value) : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, null));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v, k);
    return out;
  }
  return value;
}

/** Deep-sanitize EditorJS output data (blocks, tunes, nested editors). */
export function sanitizeEditorData<T>(data: T): T {
  return sanitizeValue(data, null) as T;
}

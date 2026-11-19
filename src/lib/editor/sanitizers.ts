/**
 * Shared EditorJS sanitizer whitelists. Lives in its own module so every
 * block tool and inline tool can import without creating a circular dep
 * with the tool factory.
 *
 * Two layers of sanitization run on every block save; both must agree:
 *   1. Block-tool `static get sanitize` (Header / Paragraph / List / Table)
 *   2. Inline-tool `static sanitize` (VariableTool, formatting tools)
 *
 * Drift between layers = the attribute gets stripped on save and the chip's
 * data link is lost. Keep this file as the single source of truth.
 */

import { filterInlineStyle } from "./format/inlineStyle";
import { isSafeImageUrl, isSafeLinkUrl } from "./safeUrl";

/** `<a>` keeps its href only when the scheme is allow-listed — html-janitor
 *  filters attribute names, not values, so `javascript:` would pass a plain
 *  `{ href: true }` rule. */
export function sanitizeAnchor(el: Element) {
  const base = { target: true, rel: true, class: true };
  return isSafeLinkUrl(el.getAttribute("href")) ? { ...base, href: true } : base;
}

/** `<img>` is dropped entirely unless its src is an allowed image URL. */
export function sanitizeImage(el: Element) {
  if (!isSafeImageUrl(el.getAttribute("src"))) return false;
  return { src: true, alt: true, style: true, class: true, width: true, height: true };
}

/** Attrs allowed on a `<span class="variable-chip">`. */
export const VARIABLE_SPAN_SANITIZER = {
  class: true,
  "data-var-name": true,
  "data-var-value": true,
  "data-field-type": true,
  "data-has-value": true,
  "data-placeholder-text": true,
  // Header/footer fields: <span class="tp-field" data-field="page">.
  "data-field": true,
  style: true,
  contenteditable: true,
};

/** Attrs allowed on `<mark data-placeholder-name>` — inline placeholder anchor
 * used by DOCX import for underscore runs (`_____`) and by the Variable tool. */
export const MARK_SANITIZER = {
  class: true,
  "data-placeholder-name": true,
  "data-unique-id": true,
  "data-field-type": true,
  "data-custom-width": true,
  "data-custom-color": true,
  "data-empty": true,
  style: true,
  contenteditable: true,
};

/**
 * `<span>`: chips (with a class) keep their attributes as-is; plain styling
 * spans keep only typography styles — this is what strips Word's `mso-*`
 * and positioning junk from pasted content.
 */
export function sanitizeSpan(el: Element) {
  if (!el.hasAttribute("class")) {
    const style = filterInlineStyle(el.getAttribute("style") ?? "");
    if (style) el.setAttribute("style", style);
    else el.removeAttribute("style");
  }
  return VARIABLE_SPAN_SANITIZER;
}

/** `<sup>`: plain superscript, or a footnote reference atom. */
export function sanitizeSup(el: Element) {
  return el.classList.contains("tp-fn-ref")
    ? { class: true, "data-fn-id": true, contenteditable: true, "data-mutation-free": true }
    : {};
}

/** Allowed inline tag set for a block's saved text content. */
export const BLOCK_INLINE_TAGS = {
  br: true,
  b: true,
  strong: true,
  i: true,
  em: true,
  u: true,
  s: true,
  strike: true,
  sup: sanitizeSup,
  sub: true,
  code: true,
  mark: MARK_SANITIZER,
  span: sanitizeSpan,
  ins: { class: true, "data-label": true, style: true },
  a: sanitizeAnchor,
};

/** Table cells: inline tags plus the block-level wrappers contenteditable
 *  produces on Enter, and inline images. */
export const TABLE_CELL_TAGS = {
  ...BLOCK_INLINE_TAGS,
  div: { style: true, class: true },
  p: { style: true, class: true },
  font: { color: true, face: true, size: true },
  img: sanitizeImage,
};

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

/** Attrs allowed on a `<span class="variable-chip">`. */
export const VARIABLE_SPAN_SANITIZER = {
  class: true,
  "data-var-name": true,
  "data-var-value": true,
  "data-field-type": true,
  "data-has-value": true,
  "data-placeholder-text": true,
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
  sup: true,
  sub: true,
  code: true,
  mark: MARK_SANITIZER,
  span: VARIABLE_SPAN_SANITIZER,
  ins: { class: true, "data-label": true, style: true },
  a: { href: true, target: true, rel: true, class: true },
};

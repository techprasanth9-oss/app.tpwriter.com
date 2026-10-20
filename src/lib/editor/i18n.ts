/**
 * EditorJS i18n stubs for TP Writer. English-only, no runtime i18n layer.
 *
 * The original eSigns build pulled strings from `~/i18n` so the editor chrome
 * could follow a runtime language switch. TP Writer ships English only, so
 * these helpers are identity shims — the ported tools call `translateEditorToolName`
 * for their button tooltips and the editor host calls `getEditorJsI18nConfig()`
 * when constructing EditorJS. Returning `undefined` from the config helper tells
 * EditorJS to use its built-in English chrome and skip the i18n dictionary pass.
 */

/**
 * Drop-in `i18n` option for `new EditorJS({ ... })`. Returning `undefined`
 * means "don't pass an i18n block" and EditorJS falls through to its own
 * English defaults — no runtime translation layer.
 */
export function getEditorJsI18nConfig(): undefined {
  return undefined;
}

/**
 * Translate an English tool title (the EditorJS `toolNames` key) for chrome
 * a tool renders itself, e.g. an inline button's `title` tooltip. Identity
 * shim — returns the input unchanged — so ported tools keep working without
 * depending on a runtime dictionary.
 */
export function translateEditorToolName(key: string): string {
  return key;
}

/**
 * Translate an arbitrary editor i18n key. Identity shim — many ported tool
 * sites did `i18n.t("editor.tools.foo.bar")` for button labels; those calls
 * are rewritten to pass the English copy directly, but this helper is left
 * here as a drop-in for anything that still wants to go through a function.
 */
export function translateEditorKey(key: string): string {
  return key;
}

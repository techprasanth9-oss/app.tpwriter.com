/**
 * Paragraph formatting — the single source of truth for block-level text
 * layout (alignment, indent, spacing, named style). Stored on every text
 * block as `tunes.format` and applied by ParagraphFormatTune.
 *
 * Before this, alignment/indent lived in three incompatible places
 * (ParagraphTool's own data, HeaderTool, and the Alignment/Indent tunes);
 * `normalizeBlocks` folds those legacy shapes into this one.
 */

export type Alignment = "left" | "center" | "right" | "justify";

export interface ParagraphFormat {
  alignment?: Alignment;
  /** Left indent in steps of INDENT_STEP_PX. */
  indent?: number;
  /** Unitless line-height multiplier, e.g. 1.15. */
  lineHeight?: number;
  /** Space above / below the paragraph in px. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** Named style id (see styles/namedStyles.ts), e.g. "title". */
  styleId?: string;
}

export const FORMAT_TUNE = "format";
export const INDENT_STEP_PX = 40;
export const MAX_INDENT = 8;

const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right", "justify"];
const STYLE_ID = /^[a-z][a-z0-9-]{0,31}$/;

function finite(n: unknown, min: number, max: number): number | undefined {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max
    ? n
    : undefined;
}

/** Validate untrusted tune data into a clean ParagraphFormat (unknown or
 *  out-of-range values are dropped, never passed into CSS). */
export function cleanFormat(raw: unknown): ParagraphFormat {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: ParagraphFormat = {};
  if (ALIGNMENTS.includes(r.alignment as Alignment)) {
    out.alignment = r.alignment as Alignment;
  }
  const indent = finite(r.indent, 0, MAX_INDENT);
  if (indent) out.indent = Math.round(indent);
  const lineHeight = finite(r.lineHeight, 0.5, 4);
  if (lineHeight !== undefined) out.lineHeight = lineHeight;
  const spaceBefore = finite(r.spaceBefore, 0, 400);
  if (spaceBefore !== undefined) out.spaceBefore = spaceBefore;
  const spaceAfter = finite(r.spaceAfter, 0, 400);
  if (spaceAfter !== undefined) out.spaceAfter = spaceAfter;
  if (typeof r.styleId === "string" && STYLE_ID.test(r.styleId)) {
    out.styleId = r.styleId;
  }
  return out;
}

/** Apply a format to the tune's wrapper element. Alignment is inherited by
 *  the tool's content; spacing goes on the wrapper so tools don't need to
 *  know about it. */
export function applyFormat(el: HTMLElement, format: ParagraphFormat): void {
  el.style.textAlign = format.alignment ?? "";
  el.style.paddingLeft = format.indent ? `${format.indent * INDENT_STEP_PX}px` : "";
  el.style.lineHeight = format.lineHeight ? String(format.lineHeight) : "";
  el.style.paddingTop = format.spaceBefore !== undefined ? `${format.spaceBefore}px` : "";
  el.style.paddingBottom = format.spaceAfter !== undefined ? `${format.spaceAfter}px` : "";

  // Direct spacing replaces the named style's margins instead of adding to
  // them (styles.css zeroes the child margin when these are set).
  el.classList.toggle("tp-has-space-before", format.spaceBefore !== undefined);
  el.classList.toggle("tp-has-space-after", format.spaceAfter !== undefined);

  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith("tp-style-")) el.classList.remove(cls);
  }
  if (format.styleId) el.classList.add(`tp-style-${format.styleId}`);
  el.dataset.alignment = format.alignment ?? "left";
}

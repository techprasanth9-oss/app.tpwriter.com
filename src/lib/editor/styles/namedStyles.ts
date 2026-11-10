/**
 * Named paragraph styles (Word's Styles gallery). Stored per document in
 * `document.styles`; missing styles fall back to DEFAULT_STYLES. Rendered as
 * one generated stylesheet scoped to the document surface, so changing a
 * style restyles every paragraph that uses it.
 *
 * Headings map to header blocks by level; the other styles are applied to
 * paragraph blocks through `tunes.format.styleId`.
 */

export interface NamedStyle {
  label: string;
  fontFamily?: string;
  /** px */
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  lineHeight?: number;
  /** px */
  spaceBefore?: number;
  spaceAfter?: number;
}

export type StyleId =
  | "normal"
  | "title"
  | "subtitle"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "quote";

export type StyleSheet = Record<StyleId, NamedStyle>;

const SERIF = 'var(--tp-font-serif)';
const SANS = 'var(--tp-font-sans)';

export const DEFAULT_STYLES: StyleSheet = {
  normal: { label: "Normal", fontFamily: SANS, fontSize: 16, lineHeight: 1.65, spaceAfter: 6 },
  title: { label: "Title", fontFamily: SERIF, fontSize: 40, fontWeight: 600, lineHeight: 1.15, spaceAfter: 12 },
  subtitle: { label: "Subtitle", fontFamily: SANS, fontSize: 20, color: "#475569", lineHeight: 1.35, spaceAfter: 12 },
  heading1: { label: "Heading 1", fontFamily: SERIF, fontSize: 30, fontWeight: 600, lineHeight: 1.2, spaceBefore: 18, spaceAfter: 8 },
  heading2: { label: "Heading 2", fontFamily: SERIF, fontSize: 24, fontWeight: 600, lineHeight: 1.25, spaceBefore: 14, spaceAfter: 6 },
  heading3: { label: "Heading 3", fontFamily: SERIF, fontSize: 20, fontWeight: 600, lineHeight: 1.3, spaceBefore: 12, spaceAfter: 4 },
  heading4: { label: "Heading 4", fontFamily: SANS, fontSize: 17, fontWeight: 700, lineHeight: 1.35, spaceBefore: 10, spaceAfter: 4 },
  quote: { label: "Quote", fontFamily: SERIF, fontSize: 18, italic: true, color: "#475569", lineHeight: 1.5, spaceBefore: 8, spaceAfter: 8 },
};

/** Paragraph styles selectable through `tunes.format.styleId`. */
export const PARAGRAPH_STYLE_IDS = ["title", "subtitle", "quote"] as const;

export const HEADING_LEVELS = [1, 2, 3, 4] as const;

export function headingStyleId(level: number): StyleId {
  return `heading${Math.min(Math.max(level, 1), 4)}` as StyleId;
}

/** Overlay a document's stored styles on the defaults, ignoring junk. */
export function resolveStyles(stored: unknown): StyleSheet {
  const out = { ...DEFAULT_STYLES };
  if (!stored || typeof stored !== "object") return out;
  for (const id of Object.keys(DEFAULT_STYLES) as StyleId[]) {
    const s = (stored as Record<string, unknown>)[id];
    if (s && typeof s === "object") out[id] = { ...DEFAULT_STYLES[id], ...(s as NamedStyle) };
  }
  return out;
}

// Values end up in a <style> element, so only let through what's
// unambiguously safe — anything else is dropped.
const SAFE_FONT = /^(var\(--[a-z0-9-]+\)|[\w\s"',.-]{1,120})$/i;
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

function declarations(s: NamedStyle): string {
  const d: string[] = [];
  if (s.fontFamily && SAFE_FONT.test(s.fontFamily)) d.push(`font-family:${s.fontFamily}`);
  if (Number.isFinite(s.fontSize)) d.push(`font-size:${s.fontSize}px`);
  if (Number.isFinite(s.fontWeight)) d.push(`font-weight:${s.fontWeight}`);
  if (s.italic) d.push("font-style:italic");
  if (s.color && SAFE_COLOR.test(s.color)) d.push(`color:${s.color}`);
  if (Number.isFinite(s.lineHeight)) d.push(`line-height:${s.lineHeight}`);
  return d.join(";");
}

function spacing(s: NamedStyle): string {
  const d: string[] = [];
  if (Number.isFinite(s.spaceBefore)) d.push(`margin-top:${s.spaceBefore}px`);
  if (Number.isFinite(s.spaceAfter)) d.push(`margin-bottom:${s.spaceAfter}px`);
  return d.join(";");
}

/** Generate the stylesheet for a document surface identified by `scope`. */
export function stylesToCss(styles: StyleSheet, scope: string): string {
  const rules: string[] = [];
  const add = (selector: string, style: NamedStyle) => {
    const text = declarations(style);
    if (text) rules.push(`${selector}{${text}}`);
    const space = spacing(style);
    if (space) rules.push(`${selector}{${space}}`);
  };

  add(`${scope} .ce-paragraph`, styles.normal);
  add(`${scope} .cdx-list`, { ...styles.normal, spaceBefore: undefined, spaceAfter: undefined });
  for (const level of HEADING_LEVELS) {
    add(`${scope} .ce-header[data-level="${level}"]`, styles[headingStyleId(level)]);
  }
  for (const id of PARAGRAPH_STYLE_IDS) {
    add(`${scope} .tp-style-${id} .ce-paragraph`, styles[id]);
  }
  return rules.join("\n");
}

/**
 * Run (w:rPr) and paragraph (w:pPr) properties, parsed into plain objects
 * that can be layered: docDefaults → style chain → direct formatting.
 * Only properties present in the XML are set, so `merge` overlays cleanly.
 */

import type { Alignment } from "../../format/paragraphFormat";
import { attr, child, intAttr, onOff, toggle, val } from "./xml";

export interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: "superscript" | "subscript" | "baseline";
  /** Hex "#rrggbb"; "auto" is left unset. */
  color?: string;
  /** Background from w:highlight / w:shd, hex. */
  highlight?: string;
  shading?: string;
  /** Font name (theme fonts already resolved). */
  font?: string;
  sizePt?: number;
  caps?: boolean;
  hidden?: boolean;
  rStyle?: string;
}

export interface ParaProps {
  styleId?: string;
  alignment?: Alignment;
  /** twips */
  indLeft?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** w:spacing line + lineRule */
  line?: number;
  lineRule?: "auto" | "exact" | "atLeast";
  pageBreakBefore?: boolean;
  numId?: string;
  ilvl?: number;
  /** 0-based; 9 = body text. */
  outlineLvl?: number;
}

export interface ThemeFonts {
  major?: string;
  minor?: string;
}

export function mergeProps<T extends object>(base: T, over: T): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) if (v !== undefined) out[k] = v;
  return out as T;
}

function hex(v: string | null): string | undefined {
  if (!v) return undefined;
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : undefined;
}

const HIGHLIGHT_NAMES = new Set([
  "yellow", "green", "cyan", "magenta", "blue", "red", "darkBlue", "darkCyan", "darkGreen",
  "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray", "black", "white",
]);

export function parseRunProps(rPr: Element | null, theme: ThemeFonts): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  p.bold = toggle(rPr, "w:b");
  p.italic = toggle(rPr, "w:i");
  const u = child(rPr, "w:u");
  if (u) {
    const v = attr(u, "w:val");
    p.underline = v === null ? true : v !== "none" && onOff(v);
  }
  const strike = toggle(rPr, "w:strike");
  const dstrike = toggle(rPr, "w:dstrike");
  if (strike !== undefined || dstrike !== undefined) p.strike = !!(strike || dstrike);
  const va = val(rPr, "w:vertAlign");
  if (va === "superscript" || va === "subscript" || va === "baseline") p.vertAlign = va;
  const color = val(rPr, "w:color");
  if (color) p.color = hex(color);
  const hl = val(rPr, "w:highlight");
  if (hl && HIGHLIGHT_NAMES.has(hl)) p.highlight = hl;
  const shd = child(rPr, "w:shd");
  if (shd) {
    const fill = hex(attr(shd, "w:fill"));
    if (fill) p.shading = fill;
  }
  const fonts = child(rPr, "w:rFonts");
  if (fonts) {
    const theme1 = attr(fonts, "w:asciiTheme") ?? attr(fonts, "w:hAnsiTheme");
    const name =
      attr(fonts, "w:ascii") ??
      attr(fonts, "w:hAnsi") ??
      (theme1 ? (theme1.startsWith("major") ? theme.major : theme.minor) : undefined) ??
      attr(fonts, "w:cs") ??
      attr(fonts, "w:eastAsia");
    if (name) p.font = name;
  }
  const sz = intAttr(child(rPr, "w:sz"), "w:val");
  if (sz !== null && sz > 0) p.sizePt = sz / 2;
  const caps = toggle(rPr, "w:caps");
  if (caps !== undefined) p.caps = caps;
  const vanish = toggle(rPr, "w:vanish");
  if (vanish !== undefined) p.hidden = vanish;
  const rs = val(rPr, "w:rStyle");
  if (rs) p.rStyle = rs;
  for (const k of Object.keys(p) as (keyof RunProps)[]) if (p[k] === undefined) delete p[k];
  return p;
}

const JC: Record<string, Alignment> = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  distribute: "justify",
  justify: "justify",
  lowKashida: "justify",
  mediumKashida: "justify",
  highKashida: "justify",
  thaiDistribute: "justify",
};

export function parseParaProps(pPr: Element | null): ParaProps {
  const p: ParaProps = {};
  if (!pPr) return p;
  const style = val(pPr, "w:pStyle");
  if (style) p.styleId = style;
  const jc = val(pPr, "w:jc");
  if (jc && JC[jc]) p.alignment = JC[jc];
  const ind = child(pPr, "w:ind");
  if (ind) {
    const left = intAttr(ind, "w:left") ?? intAttr(ind, "w:start");
    if (left !== null) p.indLeft = left;
  }
  const sp = child(pPr, "w:spacing");
  if (sp) {
    const before = intAttr(sp, "w:before");
    const after = intAttr(sp, "w:after");
    if (before !== null) p.spaceBefore = before;
    if (after !== null) p.spaceAfter = after;
    const line = intAttr(sp, "w:line");
    if (line !== null && line > 0) {
      p.line = line;
      const rule = attr(sp, "w:lineRule");
      p.lineRule = rule === "exact" || rule === "atLeast" ? rule : "auto";
    }
  }
  const pbb = toggle(pPr, "w:pageBreakBefore");
  if (pbb !== undefined) p.pageBreakBefore = pbb;
  const numPr = child(pPr, "w:numPr");
  if (numPr) {
    const numId = val(numPr, "w:numId");
    if (numId !== null) p.numId = numId;
    const ilvl = intAttr(child(numPr, "w:ilvl"), "w:val");
    if (ilvl !== null) p.ilvl = ilvl;
  }
  const ol = intAttr(child(pPr, "w:outlineLvl"), "w:val");
  if (ol !== null) p.outlineLvl = ol;
  return p;
}

/** Major / minor Latin fonts from word/theme/theme1.xml. */
export function parseThemeFonts(root: Element | null): ThemeFonts {
  const out: ThemeFonts = {};
  if (!root) return out;
  // a:theme / a:themeElements / a:fontScheme / a:majorFont|a:minorFont / a:latin
  const scheme = child(child(root, "a:themeElements"), "a:fontScheme");
  const major = attr(child(child(scheme, "a:majorFont"), "a:latin"), "typeface");
  const minor = attr(child(child(scheme, "a:minorFont"), "a:latin"), "typeface");
  if (major) out.major = major;
  if (minor) out.minor = minor;
  return out;
}

// ── Fonts → safe CSS stacks ───────────────────────────────────────────

const KNOWN_STACKS: Record<string, string> = {
  inter: "Inter, sans-serif",
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  calibri: "Calibri, Carlito, sans-serif",
  "calibri light": "'Calibri Light', Calibri, Carlito, sans-serif",
  aptos: "Aptos, Calibri, Carlito, sans-serif",
  cambria: "Cambria, Caladea, Georgia, serif",
  verdana: "Verdana, Geneva, sans-serif",
  georgia: "Georgia, serif",
  lora: "Lora, Georgia, serif",
  "times new roman": "'Times New Roman', Times, serif",
  garamond: "Garamond, serif",
  "courier new": "'Courier New', Courier, monospace",
  "liberation serif": "'Liberation Serif', 'Times New Roman', Times, serif",
  "liberation sans": "'Liberation Sans', Arial, Helvetica, sans-serif",
  "liberation mono": "'Liberation Mono', 'Courier New', monospace",
  "dejavu sans": "'DejaVu Sans', Verdana, sans-serif",
};

/** A font name → CSS font-family stack with a generic fallback; only
 *  characters that are safe inside a style attribute survive. */
export function fontStack(name: string): string | null {
  const clean = name.replace(/[^\w\s.-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) return null;
  const known = KNOWN_STACKS[clean.toLowerCase()];
  if (known) return known;
  const generic = /mono|courier|consolas|menlo|code/i.test(clean)
    ? "monospace"
    : /times|georgia|garamond|cambria|serif|book|roman|minion|palatino|baskerville/i.test(clean) &&
        !/sans/i.test(clean)
      ? "serif"
      : "sans-serif";
  const quoted = /^[A-Za-z-]+$/.test(clean) ? clean : `'${clean}'`;
  return `${quoted}, ${generic}`;
}

/**
 * styles.xml: docDefaults, basedOn inheritance, paragraph / character /
 * table styles, and the mapping of Word styles onto the editor's named
 * styles. Mapping is by style NAME ("heading 1", "Title", …) and outline
 * level — never by style id, which Word localises ("berschrift1").
 */

import type { NamedStyle, StyleId } from "../../styles/namedStyles";
import { round, ptToPx, twipsToPx } from "./html";
import {
  fontStack,
  mergeProps,
  parseParaProps,
  parseRunProps,
  type ParaProps,
  type RunProps,
  type ThemeFonts,
} from "./props";
import { attr, child, kids, tag, val } from "./xml";

export interface StyleDef {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  isDefault: boolean;
  ppr: ParaProps;
  rpr: RunProps;
  /** Table style: w:tblPr / w:tcPr elements, for borders + shading. */
  tblPr?: Element | null;
}

export interface Resolved {
  ppr: ParaProps;
  rpr: RunProps;
}

/** What a paragraph style becomes in the editor. */
export interface StyleMapping {
  styleId: StyleId;
  /** 1–4 for header blocks. */
  headingLevel?: number;
  /** Original Word heading level when > 4. */
  deepHeading?: number;
}

// Word stores English names for built-in styles, but documents from other
// tools (or hand-made templates) may carry localised names.
const TITLE_NAMES = new Set(["title", "titel", "titre", "título", "titulo", "titolo", "tytuł", "заголовок"]);
const SUBTITLE_NAMES = new Set(["subtitle", "untertitel", "sous-titre", "subtítulo", "subtitulo", "sottotitolo", "ondertitel", "podtytuł"]);
const QUOTE_NAMES = new Set([
  "quote", "intense quote", "zitat", "intensives zitat", "citation", "citation intense", "cita", "cita destacada",
  "citazione", "citazione intensa", "citaat", "duidelijk citaat", "cytat", "citação",
]);

function nameMapping(name: string): StyleMapping | null {
  const n = name.trim().toLowerCase();
  const h = /^heading\s*([1-9])$/.exec(n);
  if (h) {
    const level = Number(h[1]);
    return level <= 4
      ? { styleId: `heading${level}` as StyleId, headingLevel: level }
      : { styleId: "heading4", headingLevel: 4, deepHeading: level };
  }
  if (TITLE_NAMES.has(n)) return { styleId: "title" };
  if (SUBTITLE_NAMES.has(n)) return { styleId: "subtitle" };
  if (QUOTE_NAMES.has(n)) return { styleId: "quote" };
  if (n === "normal" || n === "standard" || n === "normale") return { styleId: "normal" };
  return null;
}

export function outlineMapping(level: number): StyleMapping | null {
  if (!(level >= 0 && level <= 8)) return null;
  const l = level + 1;
  return l <= 4
    ? { styleId: `heading${l}` as StyleId, headingLevel: l }
    : { styleId: "heading4", headingLevel: 4, deepHeading: l };
}

export class StyleTable {
  readonly byId = new Map<string, StyleDef>();
  defaults: Resolved = { ppr: {}, rpr: {} };
  defaultParagraphId: string | null = null;
  private resolvedCache = new Map<string, Resolved>();
  private mappingCache = new Map<string, StyleMapping | null>();
  private repCache = new Map<StyleId, string | null>();

  constructor(root: Element | null, theme: ThemeFonts) {
    if (!root) return;
    for (const el of kids(root)) {
      const t = tag(el);
      if (t === "w:docDefaults") {
        this.defaults = {
          rpr: parseRunProps(child(child(el, "w:rPrDefault"), "w:rPr"), theme),
          ppr: parseParaProps(child(child(el, "w:pPrDefault"), "w:pPr")),
        };
      } else if (t === "w:style") {
        const id = attr(el, "w:styleId");
        if (!id) continue;
        const def: StyleDef = {
          id,
          type: attr(el, "w:type") ?? "paragraph",
          name: val(el, "w:name") ?? id,
          basedOn: val(el, "w:basedOn") ?? undefined,
          isDefault: attr(el, "w:default") === "1" || attr(el, "w:default") === "true",
          ppr: parseParaProps(child(el, "w:pPr")),
          rpr: parseRunProps(child(el, "w:rPr"), theme),
          tblPr: child(el, "w:tblPr"),
        };
        // A style's own pStyle makes no sense; numbering via style is kept.
        delete def.ppr.styleId;
        this.byId.set(id, def);
        if (def.type === "paragraph" && def.isDefault && !this.defaultParagraphId) {
          this.defaultParagraphId = id;
        }
      }
    }
  }

  get(id: string | undefined | null): StyleDef | null {
    return id ? (this.byId.get(id) ?? null) : null;
  }

  /** Style chain, most-derived first (cycle-safe). */
  chain(id: string | undefined | null): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = this.get(id);
    while (cur && !seen.has(cur.id) && out.length < 32) {
      seen.add(cur.id);
      out.push(cur);
      cur = this.get(cur.basedOn);
    }
    return out;
  }

  /** docDefaults + full basedOn chain of a paragraph style (or the
   *  default paragraph style when `id` is unknown). */
  resolveParagraph(id: string | undefined | null): Resolved {
    const key = id && this.byId.has(id) ? id : (this.defaultParagraphId ?? "");
    const hit = this.resolvedCache.get(key);
    if (hit) return hit;
    let ppr = { ...this.defaults.ppr };
    let rpr = { ...this.defaults.rpr };
    for (const s of this.chain(key).reverse()) {
      ppr = mergeProps(ppr, s.ppr);
      rpr = mergeProps(rpr, s.rpr);
    }
    const out = { ppr, rpr };
    this.resolvedCache.set(key, out);
    return out;
  }

  /** Character style chain (without docDefaults). */
  resolveCharacter(id: string | undefined | null): RunProps {
    let rpr: RunProps = {};
    for (const s of this.chain(id).reverse()) rpr = mergeProps(rpr, s.rpr);
    return rpr;
  }

  /** Editor mapping of a paragraph style: own name, outline level, then
   *  the basedOn chain's names. Unmapped styles render as Normal. */
  mapping(id: string | undefined | null): StyleMapping | null {
    const key = id ?? "";
    if (this.mappingCache.has(key)) return this.mappingCache.get(key)!;
    let result: StyleMapping | null = null;
    const chain = this.chain(id);
    const own = chain[0];
    if (own) result = nameMapping(own.name) ?? nameMapping(own.id);
    if (!result) {
      const ol = this.resolveParagraph(id).ppr.outlineLvl;
      if (ol !== undefined) result = outlineMapping(ol);
    }
    if (!result) {
      for (const s of chain.slice(1)) {
        const m = nameMapping(s.name);
        if (m && m.styleId !== "normal") {
          result = m;
          break;
        }
      }
    }
    this.mappingCache.set(key, result);
    return result;
  }

  /** The Word style that represents an editor named style (preferring an
   *  exact name match). */
  representative(styleId: StyleId): string | null {
    if (this.repCache.has(styleId)) return this.repCache.get(styleId)!;
    const found = this.findRepresentative(styleId);
    this.repCache.set(styleId, found);
    return found;
  }

  private findRepresentative(styleId: StyleId): string | null {
    let fallback: string | null = null;
    for (const s of this.byId.values()) {
      if (s.type !== "paragraph") continue;
      const m = nameMapping(s.name) ?? nameMapping(s.id);
      if (m && m.styleId === styleId && !m.deepHeading) return s.id;
      if (!fallback && styleId === "normal" && s.isDefault) fallback = s.id;
    }
    return fallback;
  }

  /** Resolved props the editor shows for a named style by default (after
   *  the `styles` overrides derived below are applied). */
  base(styleId: StyleId): Resolved {
    const rep = this.representative(styleId);
    return rep ? this.resolveParagraph(rep) : this.resolveParagraph(this.representative("normal"));
  }
}

const NAMED: StyleId[] = [
  "normal", "title", "subtitle", "heading1", "heading2", "heading3", "heading4", "quote",
];

/** Named-style overrides the editor should apply (values the document's
 *  styles actually define, including docDefaults). */
export function deriveNamedStyles(table: StyleTable): Partial<Record<StyleId, Partial<NamedStyle>>> {
  const out: Partial<Record<StyleId, Partial<NamedStyle>>> = {};
  for (const id of NAMED) {
    const rep = table.representative(id);
    if (!rep && id !== "normal") continue;
    if (!rep && table.byId.size === 0 && !Object.keys(table.defaults.rpr).length) continue;
    const { ppr, rpr } = table.resolveParagraph(rep);
    const s: Partial<NamedStyle> = {};
    if (rpr.font) {
      const stack = fontStack(rpr.font);
      if (stack) s.fontFamily = stack;
    }
    if (rpr.sizePt) s.fontSize = round(ptToPx(rpr.sizePt), 1);
    if (rep) {
      // The style exists: whether it's bold / italic is a real value.
      s.fontWeight = rpr.bold ? 700 : 400;
      s.italic = !!rpr.italic;
    } else {
      if (rpr.bold !== undefined) s.fontWeight = rpr.bold ? 700 : 400;
      if (rpr.italic !== undefined) s.italic = rpr.italic;
    }
    if (rpr.color) s.color = rpr.color;
    if (ppr.line && ppr.lineRule === "auto") s.lineHeight = round(ppr.line / 240, 2);
    if (ppr.spaceBefore !== undefined) s.spaceBefore = Math.round(twipsToPx(ppr.spaceBefore));
    if (ppr.spaceAfter !== undefined) s.spaceAfter = Math.round(twipsToPx(ppr.spaceAfter));
    if (Object.keys(s).length > 0) out[id] = s;
  }
  return out;
}

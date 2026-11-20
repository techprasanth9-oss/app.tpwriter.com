/**
 * Inline content of a paragraph (runs, hyperlinks, fields, notes, inline
 * math, drawings) → pieces. Text is always escaped; hrefs are allow-listed
 * (unsafe schemes keep their text, lose the link).
 *
 * Formatting is emitted only where a run differs from what the editor
 * already shows for the paragraph's named style (`base`).
 */

import { isSafeLinkUrl } from "../../safeUrl";
import type { Alignment } from "../../format/paragraphFormat";
import type { ImportContext, PartScope } from "./context";
import { block } from "./context";
import { convertDrawing, convertPict, type DrawingEnv } from "./drawings";
import { classifyField, fieldAtom } from "./fields";
import { escapeText, HIGHLIGHT } from "./html";
import { ommlToLatex } from "./math";
import { NO_FMT, type Fmt, type Piece } from "./pieces";
import { fontStack, mergeProps, parseRunProps, type RunProps } from "./props";
import { cleanLatex } from "../../tools/objectData";
import { alternateContent, attr, child, childrenNamed, kids, tag } from "./xml";

export interface InlineEnv {
  /** Run props the paragraph's runs inherit (docDefaults + para style). */
  inherited: RunProps;
  /** What the editor renders without inline formatting. */
  base: RunProps;
  alignment?: Alignment;
  inCell: boolean;
  /** Inline HTML for a text box body. */
  textboxHtml(content: Element): string;
}

const TAB = "    ";

/** Symbol-font private-use code points → Unicode (common ones). */
const SYMBOL_FONT: Record<number, string> = {
  0x61: "α", 0x62: "β", 0x63: "χ", 0x64: "δ", 0x65: "ε", 0x66: "φ", 0x67: "γ", 0x68: "η", 0x69: "ι",
  0x6b: "κ", 0x6c: "λ", 0x6d: "μ", 0x6e: "ν", 0x6f: "ο", 0x70: "π", 0x71: "θ", 0x72: "ρ", 0x73: "σ",
  0x74: "τ", 0x75: "υ", 0x77: "ω", 0x78: "ξ", 0x79: "ψ", 0x7a: "ζ", 0x44: "Δ", 0x46: "Φ", 0x47: "Γ",
  0x4c: "Λ", 0x50: "Π", 0x51: "Θ", 0x53: "Σ", 0x57: "Ω", 0x58: "Ξ", 0x59: "Ψ", 0xa3: "≤", 0xa5: "∞",
  0xab: "↔", 0xac: "←", 0xae: "→", 0xb0: "°", 0xb1: "±", 0xb3: "≥", 0xb4: "×", 0xb7: "•", 0xb8: "÷",
  0xb9: "≠", 0xbb: "≈", 0xd6: "√", 0xe5: "∑", 0xf2: "∫", 0xd7: "·", 0xa7: "♣", 0xa8: "♦", 0xa9: "♥",
  0xaa: "♠", 0xe2: "®", 0xe3: "©", 0xe4: "™",
};
const WINGDINGS: Record<number, string> = {
  0xfc: "✓", 0xfb: "✗", 0xfd: "☒", 0xfe: "☑", 0xa8: "☐", 0x6f: "☐", 0x71: "❑", 0x6c: "●", 0x6e: "■",
  0xa7: "▪", 0x9f: "•", 0xd8: "➢", 0xe0: "→", 0xe8: "➔", 0x4a: "☺", 0x4c: "☹", 0x76: "❖", 0x77: "⬥",
};

function symbolChar(font: string, code: number): string {
  const c = code >= 0xf000 ? code - 0xf000 : code;
  const f = font.toLowerCase();
  if (f.startsWith("symbol")) return SYMBOL_FONT[c] ?? String.fromCodePoint(c);
  if (f.startsWith("wingdings")) return WINGDINGS[c] ?? "•";
  return String.fromCodePoint(code);
}

function bg(p: RunProps): string | undefined {
  return p.highlight ? HIGHLIGHT[p.highlight] : p.shading;
}

/** Formatting to emit for a run given what the editor already shows. */
export function fmtFor(eff: RunProps, base: RunProps): Fmt {
  const tags: string[] = [];
  const css: string[] = [];
  const b = !!eff.bold;
  const i = !!eff.italic;
  if (b && !base.bold) tags.push("b");
  if (!b && base.bold) css.push("font-weight: normal");
  if (i && !base.italic) tags.push("i");
  if (!i && base.italic) css.push("font-style: normal");
  if (eff.underline && !base.underline) tags.push("u");
  if (eff.strike && !base.strike) tags.push("s");
  if (eff.vertAlign === "superscript" && base.vertAlign !== "superscript") tags.push("sup");
  if (eff.vertAlign === "subscript" && base.vertAlign !== "subscript") tags.push("sub");
  if (eff.font && eff.font !== base.font) {
    const stack = fontStack(eff.font);
    if (stack) css.push(`font-family: ${stack}`);
  }
  if (eff.sizePt && eff.sizePt !== base.sizePt) css.push(`font-size: ${eff.sizePt}pt`);
  if (eff.color && eff.color !== base.color) css.push(`color: ${eff.color}`);
  const back = bg(eff);
  if (back && back !== bg(base)) css.push(`background-color: ${back}`);
  return { tags, style: css.join("; ") };
}

export class InlineConverter {
  readonly pieces: Piece[] = [];
  private drawingEnv: DrawingEnv;

  constructor(
    private ctx: ImportContext,
    private scope: PartScope,
    private env: InlineEnv,
  ) {
    this.drawingEnv = { alignment: env.alignment, inCell: env.inCell, textboxHtml: env.textboxHtml };
  }

  /** True while field instructions or a dropped field result are being read. */
  private suppressed(): boolean {
    for (const f of this.ctx.fields) {
      if (f.phase === "instr" || f.mode === "toc" || f.mode === "drop" || f.mode === "atom") return true;
    }
    return false;
  }

  private fieldLink(): string | null {
    for (let i = this.ctx.fields.length - 1; i >= 0; i--) {
      const f = this.ctx.fields[i]!;
      if (f.mode === "link") return f.link ?? null;
    }
    return null;
  }

  private safeHref(href: string): string | null {
    if (!href) return null;
    if (isSafeLinkUrl(href)) return href;
    this.ctx.warnings.add("Links with unsafe addresses were removed (their text was kept).");
    return null;
  }

  private text(html: string, fmt: Fmt, link: string | null) {
    if (this.suppressed()) return;
    this.pieces.push({ kind: "seg", html, fmt, link: link ?? this.fieldLink() });
  }

  /** Walk a paragraph-like container's inline children. */
  walk(container: Element | null, link: string | null = null): void {
    // An equation alone in its paragraph is a display equation — Word
    // renders it that way even without an m:oMathPara wrapper (and that's
    // how equations come back from our own export).
    if (container && tag(container) === "w:p" && isLoneEquation(container)) {
      this.displayMath(container);
      return;
    }
    this.walkList(kids(container), link);
  }

  private walkList(elements: Element[], link: string | null): void {
    for (const el of elements) {
      const t = tag(el);
      switch (t) {
        case "w:r":
          this.run(el, link);
          break;
        case "w:hyperlink": {
          const rid = attr(el, "r:id");
          const anchor = attr(el, "w:anchor");
          let href = "";
          if (rid) {
            const rel = this.scope.rels.get(rid);
            if (rel) href = rel.external ? rel.target : "";
          }
          if (anchor) href = `${href}#${anchor}`;
          this.walk(el, href ? this.safeHref(href) : link);
          break;
        }
        case "w:fldSimple":
          this.simpleField(el, link);
          break;
        case "w:smartTag":
        case "w:customXml":
        case "w:ins":
        case "w:moveTo":
        case "w:dir":
        case "w:bdo":
          if (t === "w:ins" || t === "w:moveTo") this.ctx.warnings.add("Tracked changes were imported as accepted.");
          this.walk(el, link);
          break;
        case "w:del":
        case "w:moveFrom":
          this.ctx.warnings.add("Tracked changes were imported as accepted.");
          break;
        case "w:sdt":
          this.walk(child(el, "w:sdtContent"), link);
          break;
        case "mc:AlternateContent":
          this.walkList(alternateContent(el), link);
          break;
        case "m:oMath":
          this.inlineMath(el);
          break;
        case "m:oMathPara":
          this.displayMath(el);
          break;
        default:
          break; // pPr, bookmarks, comments, proofErr, permStart…
      }
    }
  }

  private inlineMath(el: Element) {
    if (this.suppressed()) return;
    const latex = ommlToLatex(el, (m) => this.ctx.warnings.add(m));
    if (latex) {
      this.ctx.warnings.add("Inline equations were imported as LaTeX text.");
      this.pieces.push({ kind: "seg", html: escapeText(`$${latex}$`), fmt: NO_FMT, link: null });
    }
  }

  private displayMath(el: Element) {
    if (this.suppressed()) return;
    for (const m of childrenNamed(el, "m:oMath")) {
      const latex = ommlToLatex(m, (w) => this.ctx.warnings.add(w));
      if (!latex) continue;
      if (this.env.inCell) {
        this.pieces.push({ kind: "seg", html: escapeText(`$${latex}$`), fmt: NO_FMT, link: null });
      } else {
        const b = block(this.ctx, "equation", { latex: cleanLatex(latex), display: true });
        this.pieces.push({ kind: "block", block: b, float: false, placeholder: escapeText(latex) });
      }
    }
  }

  private simpleField(el: Element, link: string | null) {
    const action = classifyField(attr(el, "w:instr") ?? "");
    if (this.suppressed()) return;
    switch (action.kind) {
      case "atom":
        this.pieces.push({ kind: "seg", html: fieldAtom(action.field), fmt: NO_FMT, link: null });
        return;
      case "toc":
        this.pieces.push({ kind: "toc", maxLevel: action.maxLevel });
        return;
      case "link":
        this.walk(el, this.safeHref(action.href));
        return;
      default:
        this.walk(el, link);
    }
  }

  private fieldChar(type: string | null) {
    const fields = this.ctx.fields;
    if (type === "begin") {
      fields.push({ instr: "", phase: "instr" });
      return;
    }
    const top = fields[fields.length - 1];
    if (!top) return;
    if (type === "separate" || type === "end") {
      if (top.phase === "instr") {
        top.phase = "result";
        const outerSuppressed = fields.slice(0, -1).some(
          (f) => f.phase === "instr" || f.mode === "toc" || f.mode === "drop" || f.mode === "atom",
        );
        const action = classifyField(top.instr);
        if (outerSuppressed) top.mode = "drop";
        else if (action.kind === "atom") {
          this.pieces.push({ kind: "seg", html: fieldAtom(action.field), fmt: NO_FMT, link: null });
          top.mode = "atom";
        } else if (action.kind === "toc") {
          this.pieces.push({ kind: "toc", maxLevel: action.maxLevel });
          top.mode = "toc";
        } else if (action.kind === "link") {
          top.mode = "link";
          top.link = this.safeHref(action.href);
        } else top.mode = "keep";
      }
      if (type === "end") fields.pop();
    }
  }

  private run(r: Element, link: string | null) {
    const rPr = child(r, "w:rPr");
    const direct = parseRunProps(rPr, this.ctx.theme);
    let eff = this.env.inherited;
    let base = this.env.base;
    if (direct.rStyle) {
      const cs = this.ctx.styles.get(direct.rStyle);
      let charProps = this.ctx.styles.resolveCharacter(direct.rStyle);
      // Links get the editor's own link look.
      if (link && cs && /hyperlink/i.test(cs.name)) {
        charProps = { ...charProps, color: undefined, underline: undefined };
      }
      eff = mergeProps(eff, charProps);
    }
    eff = mergeProps(eff, direct);
    if (link && eff.underline && !direct.underline) base = { ...base, underline: true };
    if (eff.hidden) {
      // Hidden text: still track fields so they stay balanced.
      for (const c of kids(r)) {
        const t = tag(c);
        if (t === "w:fldChar") this.fieldChar(attr(c, "w:fldCharType"));
        else if (t === "w:instrText") this.instr(c);
      }
      return;
    }
    const fmt = fmtFor(eff, base);
    this.runContent(kids(r), eff, fmt, link);
  }

  private instr(el: Element) {
    const top = this.ctx.fields[this.ctx.fields.length - 1];
    if (top && top.phase === "instr") top.instr += el.textContent ?? "";
  }

  private runContent(children: Element[], eff: RunProps, fmt: Fmt, link: string | null) {
    for (const c of children) {
      const t = tag(c);
      switch (t) {
        case "w:t": {
          const s = c.textContent ?? "";
          if (s) this.text(escapeText(eff.caps ? s.toUpperCase() : s), fmt, link);
          break;
        }
        case "w:fldChar":
          this.fieldChar(attr(c, "w:fldCharType"));
          break;
        case "w:instrText":
          this.instr(c);
          break;
        case "w:tab":
        case "w:ptab":
          this.text(escapeText(TAB), fmt, link);
          break;
        case "w:br": {
          const type = attr(c, "w:type");
          if (type === "page") {
            if (!this.suppressed()) {
              if (this.env.inCell) this.text("<br>", NO_FMT, null);
              else this.pieces.push({ kind: "pageBreak" });
            }
          } else this.text("<br>", NO_FMT, null);
          break;
        }
        case "w:cr":
          this.text("<br>", NO_FMT, null);
          break;
        case "w:sym": {
          const code = Number.parseInt(attr(c, "w:char") ?? "", 16);
          if (Number.isFinite(code) && code > 0) {
            this.text(escapeText(symbolChar(attr(c, "w:font") ?? eff.font ?? "", code)), fmt, link);
          }
          break;
        }
        case "w:softHyphen":
          this.text("­", fmt, link);
          break;
        case "w:noBreakHyphen":
          this.text("‑", fmt, link);
          break;
        case "w:footnoteReference":
        case "w:endnoteReference":
          if (!this.suppressed()) this.noteRef(attr(c, "w:id"), t === "w:endnoteReference" ? "endnote" : "footnote");
          break;
        case "w:drawing":
          if (!this.suppressed()) this.pieces.push(...convertDrawing(c, this.ctx, this.scope, this.drawingEnv));
          break;
        case "w:pict":
          if (!this.suppressed()) this.pieces.push(...convertPict(c, this.ctx, this.scope, this.drawingEnv));
          break;
        case "w:object":
          if (!this.suppressed()) {
            this.ctx.warnings.add("Embedded objects (OLE) were imported as their preview image, if any.");
            this.pieces.push(...convertPict(c, this.ctx, this.scope, this.drawingEnv));
          }
          break;
        case "mc:AlternateContent":
          this.runContent(alternateContent(c), eff, fmt, link);
          break;
        case "w:ruby":
          this.runContent(
            kids(child(c, "w:rubyBase")).flatMap((r) => (tag(r) === "w:r" ? kids(r) : [])),
            eff,
            fmt,
            link,
          );
          break;
        default:
          break; // rPr, lastRenderedPageBreak, footnoteRef, separators…
      }
    }
  }

  private noteRef(wordId: string | null, source: "footnote" | "endnote") {
    if (wordId === null) return;
    const clean = wordId.replace(/[^A-Za-z0-9_-]/g, "");
    const id = `${source === "footnote" ? "fn" : "en"}${clean}`;
    let ref = this.ctx.notes.get(id);
    if (!ref) {
      ref = { id, number: this.ctx.notes.size + 1, source, wordId };
      this.ctx.notes.set(id, ref);
    }
    this.pieces.push({
      kind: "seg",
      html: `<sup class="tp-fn-ref" data-fn-id="${id}" contenteditable="false" data-mutation-free="true">${ref.number}</sup>`,
      fmt: NO_FMT,
      link: null,
    });
  }
}

/** Paragraph whose only content is a single m:oMath (ignoring properties,
 *  bookmarks, proofing marks and runs without text). */
function isLoneEquation(p: Element): boolean {
  let maths = 0;
  for (const el of kids(p)) {
    const t = tag(el);
    if (t === "m:oMath") maths++;
    else if (t === "w:r") {
      if (kids(el).some((c) => tag(c) === "w:t" && (c.textContent ?? "").trim() !== "")) return false;
    } else if (!["w:pPr", "w:bookmarkStart", "w:bookmarkEnd", "w:proofErr"].includes(t)) {
      return false;
    }
  }
  return maths === 1;
}

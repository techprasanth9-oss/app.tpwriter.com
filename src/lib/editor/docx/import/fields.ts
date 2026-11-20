/**
 * Word fields (w:fldSimple and complex w:fldChar / w:instrText runs):
 * PAGE / NUMPAGES / DATE / TITLE become the editor's field atoms, TOC
 * becomes a toc block, HYPERLINK becomes a link; anything else keeps its
 * cached result text.
 */

import { fieldHtml, type FieldKind } from "../../pageSetup";

const PLACEHOLDER: Record<FieldKind, string> = { page: "#", pages: "##", date: "date", title: "title" };

export type FieldAction =
  | { kind: "atom"; field: FieldKind }
  | { kind: "toc"; maxLevel: number }
  | { kind: "link"; href: string }
  | { kind: "keep" };

/** First word of a field instruction, upper-cased. */
function keyword(instr: string): string {
  return (/^\s*([A-Za-z]+)/.exec(instr)?.[1] ?? "").toUpperCase();
}

export function tocMaxLevel(instr: string): number {
  const m = /\\o\s+"?\s*(\d)\s*-\s*(\d)/i.exec(instr);
  const n = m ? Number(m[2]) : 3;
  return Math.min(4, Math.max(1, Number.isFinite(n) ? n : 3));
}

export function classifyField(instr: string): FieldAction {
  switch (keyword(instr)) {
    case "PAGE":
      return { kind: "atom", field: "page" };
    case "NUMPAGES":
    case "SECTIONPAGES":
      return { kind: "atom", field: "pages" };
    case "DATE":
    case "TIME":
    case "CREATEDATE":
    case "SAVEDATE":
    case "PRINTDATE":
      return { kind: "atom", field: "date" };
    case "TITLE":
      return { kind: "atom", field: "title" };
    case "TOC":
      // \f / \c (figure / caption tables) aren't heading TOCs.
      return /\\[fc]\s/i.test(instr) && !/\\o/i.test(instr) ? { kind: "keep" } : { kind: "toc", maxLevel: tocMaxLevel(instr) };
    case "HYPERLINK": {
      const url = /HYPERLINK\s+"([^"]*)"/i.exec(instr)?.[1] ?? /HYPERLINK\s+(\S+)/i.exec(instr)?.[1] ?? "";
      const anchor = /\\l\s+"([^"]*)"/i.exec(instr)?.[1];
      const href = anchor ? `${url}#${anchor}` : url;
      return href ? { kind: "link", href } : { kind: "keep" };
    }
    default:
      return { kind: "keep" };
  }
}

export function fieldAtom(kind: FieldKind): string {
  return fieldHtml(kind, PLACEHOLDER[kind]);
}

/**
 * Tables of contents: a w:sdt whose docPartGallery is "Table of Contents"
 * (or a bare TOC field, handled by the inline converter) becomes one toc
 * block; Word's cached entries are skipped — the editor builds its own.
 */

import type { ImportContext } from "./context";
import { tocMaxLevel } from "./fields";
import { attr, child, kids, path, tag } from "./xml";

export function isTocSdt(sdt: Element): boolean {
  const sdtPr = child(sdt, "w:sdtPr");
  const gallery =
    attr(path(sdtPr, "w:docPartObj", "w:docPartGallery"), "w:val") ??
    attr(path(sdtPr, "w:docPartList", "w:docPartGallery"), "w:val") ??
    "";
  return /table of contents/i.test(gallery);
}

/** maxLevel from the TOC field inside an sdt (scoped search). */
export function sdtTocLevel(sdt: Element): number {
  let instr = "";
  const its = sdt.getElementsByTagNameNS("*", "instrText");
  for (let i = 0; i < its.length && i < 50; i++) instr += its[i]!.textContent ?? "";
  if (!/TOC/i.test(instr)) {
    const simple = sdt.getElementsByTagNameNS("*", "fldSimple");
    for (let i = 0; i < simple.length; i++) {
      const a = attr(simple[i]!, "w:instr") ?? "";
      if (/TOC/i.test(a)) {
        instr = a;
        break;
      }
    }
  }
  return tocMaxLevel(instr);
}

export function sdtTocTitle(sdt: Element, ctx: ImportContext): string | null {
  for (const p of kids(child(sdt, "w:sdtContent"))) {
    if (tag(p) !== "w:p") continue;
    const sid = attr(path(p, "w:pPr", "w:pStyle"), "w:val");
    const name = ctx.styles.get(sid)?.name ?? sid ?? "";
    if (/toc\s*heading/i.test(name)) return (p.textContent ?? "").trim().slice(0, 120) || null;
    return null;
  }
  return null;
}

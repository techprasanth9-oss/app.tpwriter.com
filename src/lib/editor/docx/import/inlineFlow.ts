/**
 * Block content flattened to inline HTML lines, for places that hold one
 * rich-text string: table cells, text boxes, footnotes. Paragraphs become
 * lines (joined with <br>), list items get a "•" / "n." prefix, nested
 * tables are flattened to text.
 */

import type { Alignment } from "../../format/paragraphFormat";
import type { ImportContext, PartScope } from "./context";
import { escapeText } from "./html";
import { convertParagraph } from "./paragraphs";
import { isBlankHtml, renderSegs, type Piece } from "./pieces";
import { alternateContent, child, childrenNamed, kids, tag } from "./xml";

export interface FlowResult {
  lines: string[];
  /** Alignment of the first paragraph (cell text alignment). */
  alignment?: Alignment;
}

type Seg = Extract<Piece, { kind: "seg" }>;

function piecesToHtml(pieces: Piece[]): string {
  const segs: Seg[] = [];
  for (const p of pieces) {
    if (p.kind === "seg") segs.push(p);
    else if (p.kind === "block") segs.push({ kind: "seg", html: p.placeholder, fmt: { tags: [], style: "" }, link: null });
  }
  return renderSegs(segs);
}

/** Text of a nested table: cells " | ", rows as lines. */
function flattenTable(tbl: Element, ctx: ImportContext, scope: PartScope): string[] {
  ctx.warnings.add("Nested tables were flattened to text.");
  const lines: string[] = [];
  for (const tr of childrenNamed(tbl, "w:tr")) {
    const cells = childrenNamed(tr, "w:tc").map((tc) => flowToInline(kids(tc), ctx, scope).lines.filter((l) => l).join(" "));
    lines.push(cells.join(" | "));
  }
  return lines;
}

export function flowToInline(elements: Element[], ctx: ImportContext, scope: PartScope): FlowResult {
  const out: FlowResult = { lines: [] };
  let first = true;
  const textboxHtml = (content: Element) => flowToInline(kids(content), ctx, scope).lines.join("<br>");
  const visit = (els: Element[]) => {
    for (const el of els) {
      const t = tag(el);
      if (t === "w:p") {
        const res = convertParagraph(el, ctx, scope, { inCell: true, textboxHtml });
        let html = piecesToHtml(res.pieces);
        if (res.startedSuppressed && isBlankHtml(html)) continue;
        if (res.list) {
          const kind = ctx.numbering.kind(res.list.numId, res.list.ilvl);
          const n = ctx.numbering.next(res.list.numId, res.list.ilvl);
          html = escapeText(kind.style === "ordered" ? `${n}. ` : "• ") + html;
        }
        if (first) {
          out.alignment = res.format.alignment;
          first = false;
        }
        out.lines.push(html);
      } else if (t === "w:tbl") {
        out.lines.push(...flattenTable(el, ctx, scope));
      } else if (t === "w:sdt") {
        visit(kids(child(el, "w:sdtContent")));
      } else if (t === "w:customXml") {
        visit(kids(el));
      } else if (t === "mc:AlternateContent") {
        visit(alternateContent(el));
      }
    }
  };
  visit(elements);
  return out;
}

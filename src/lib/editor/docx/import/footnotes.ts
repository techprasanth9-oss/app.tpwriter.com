/**
 * Footnote / endnote texts for the references found while converting:
 * footnotes.xml / endnotes.xml content → pageSetup.footnotes inline HTML
 * (paragraphs joined with <br>). Separators are never referenced, so
 * they're skipped. Endnotes become footnotes (with a warning).
 */

import type { ImportContext } from "./context";
import { flowToInline } from "./inlineFlow";
import { relOfKind, REL, type Rels } from "./package";
import { attr, kids, tag } from "./xml";

async function noteMap(ctx: ImportContext, part: string | null) {
  const map = new Map<string, Element>();
  if (!part) return { map, rels: new Map() as Rels };
  const xml = await ctx.pkg.readXml(part);
  for (const n of kids(xml?.root)) {
    const t = tag(n);
    if (t !== "w:footnote" && t !== "w:endnote") continue;
    const type = attr(n, "w:type");
    if (type === "separator" || type === "continuationSeparator" || type === "continuationNotice") continue;
    const id = attr(n, "w:id");
    if (id !== null) map.set(id, n);
  }
  return { map, rels: await ctx.pkg.rels(part) };
}

export async function convertNotes(ctx: ImportContext, docRels: Rels): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const refs = [...ctx.notes.values()];
  if (refs.length === 0) return out;
  const fnPart = relOfKind(docRels, REL.footnotes)?.target ?? null;
  const enPart = relOfKind(docRels, REL.endnotes)?.target ?? null;
  const fn = refs.some((r) => r.source === "footnote") ? await noteMap(ctx, fnPart) : null;
  const en = refs.some((r) => r.source === "endnote") ? await noteMap(ctx, enPart) : null;
  if (en) ctx.warnings.add("Endnotes were imported as footnotes.");

  const saved = ctx.fields;
  for (const ref of refs) {
    const src = ref.source === "footnote" ? fn : en;
    const el = src?.map.get(ref.wordId);
    if (!el || !src) {
      ctx.warnings.add("Some footnote texts were missing.");
      out[ref.id] = "";
      continue;
    }
    ctx.fields = [];
    const part = (ref.source === "footnote" ? fnPart : enPart) ?? "";
    const flow = flowToInline(kids(el), ctx, { path: part, rels: src.rels, kind: "note" });
    out[ref.id] = flow.lines.join("<br>").replace(/^(\s|&nbsp;)+/, "");
  }
  ctx.fields = saved;
  return out;
}

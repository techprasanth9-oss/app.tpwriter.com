/**
 * Headers / footers of the first section → pageSetup.headers / footers.
 * Each part has its own relationships (images, links) and field state;
 * text watermarks found in a header go to ctx.watermark.
 */

import type { EditorBlock } from "~/lib/api/documents";
import type { HeaderFooterKind, HeaderFooterSet } from "../../pageSetup";
import { convertBlocks } from "./blocks";
import type { ImportContext } from "./context";
import type { Rels } from "./package";
import { isBlankHtml } from "./pieces";
import type { SectionInfo } from "./sections";
import { kids } from "./xml";

const KINDS: HeaderFooterKind[] = ["default", "first", "even"];

function blank(blocks: EditorBlock[]): boolean {
  return blocks.every((b) => b.type === "paragraph" && isBlankHtml(String(b.data.text ?? "")));
}

async function convertPart(ctx: ImportContext, part: string, kind: "header" | "footer"): Promise<EditorBlock[]> {
  const xml = await ctx.pkg.readXml(part);
  if (!xml) return [];
  const savedFields = ctx.fields;
  ctx.fields = [];
  try {
    const before = ctx.watermark;
    let blocks = await convertBlocks(kids(xml.root), ctx, { path: part, rels: await ctx.pkg.rels(part), kind });
    // The watermark's anchor paragraph is left empty; drop it.
    if (ctx.watermark !== before) blocks = blocks.filter((b) => !blank([b]));
    return blank(blocks) ? [] : blocks;
  } finally {
    ctx.fields = savedFields;
  }
}

export async function convertHeadersFooters(
  ctx: ImportContext,
  docRels: Rels,
  sections: SectionInfo[],
): Promise<{ headers: HeaderFooterSet; footers: HeaderFooterSet }> {
  const headers: HeaderFooterSet = { default: [], first: [], even: [] };
  const footers: HeaderFooterSet = { default: [], first: [], even: [] };
  const first = sections[0];
  if (!first) return { headers, footers };

  for (const k of KINDS) {
    for (const [refs, set, kind] of [
      [first.headerRefs, headers, "header"],
      [first.footerRefs, footers, "footer"],
    ] as const) {
      const id = refs[k];
      const rel = id ? docRels.get(id) : undefined;
      if (!rel || rel.external) continue;
      set[k] = await convertPart(ctx, rel.target, kind);
    }
  }

  // Later sections that define their own (different) headers / footers.
  const targetOf = (id: string | undefined) => (id ? (docRels.get(id)?.target ?? id) : undefined);
  const differs = sections.slice(1).some((s) =>
    KINDS.some(
      (k) =>
        (s.headerRefs[k] && targetOf(s.headerRefs[k]) !== targetOf(first.headerRefs[k])) ||
        (s.footerRefs[k] && targetOf(s.footerRefs[k]) !== targetOf(first.footerRefs[k])),
    ),
  );
  if (differs) {
    ctx.warnings.add("Later sections have their own headers/footers; the first section's are used throughout.");
  }
  return { headers, footers };
}

/**
 * Block-level content (body, header, footer) → editor blocks: paragraphs,
 * headings, lists, tables, TOCs, page breaks, objects. Yields to the event
 * loop every 200 paragraphs so large documents don't freeze the UI.
 */

import type { EditorBlock } from "~/lib/api/documents";
import { FORMAT_TUNE } from "../../format/paragraphFormat";
import { block, type ImportContext, type PartScope } from "./context";
import { flowToInline } from "./inlineFlow";
import { ListBuilder } from "./lists";
import { DocxImportError } from "./package";
import { convertParagraph, type ParagraphResult } from "./paragraphs";
import { chunkPieces, isBlankHtml } from "./pieces";
import { convertTable } from "./tables";
import { isTocSdt, sdtTocLevel, sdtTocTitle } from "./toc";
import { alternateContent, child, kids, path, tag } from "./xml";

export interface BlockHooks {
  /** A paragraph-level sectPr (end of a section): blocks to insert. */
  onSectPr?(sectPr: Element): EditorBlock[];
}

const YIELD_EVERY = 200;

const plain = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();

export async function convertBlocks(
  elements: Element[],
  ctx: ImportContext,
  scope: PartScope,
  hooks: BlockHooks = {},
): Promise<EditorBlock[]> {
  const out: EditorBlock[] = [];
  const lists = new ListBuilder(ctx);
  const flushList = () => {
    const b = lists.flush();
    if (b) out.push(b);
  };
  const textboxHtml = (content: Element) => flowToInline(kids(content), ctx, scope).lines.join("<br>");
  const pageBreak = () => {
    flushList();
    if (out[out.length - 1]?.type !== "pageBreak") out.push(block(ctx, "pageBreak", {}));
  };

  const tocBlock = (maxLevel: number, title?: string | null) => {
    flushList();
    let t = title ?? null;
    const prev = out[out.length - 1];
    if (!t && prev && (prev.type === "paragraph" || prev.type === "header")) {
      const text = plain(String(prev.data.text ?? ""));
      if (/^(table of contents|contents)$/i.test(text)) {
        t = text;
        out.pop();
      }
    }
    out.push(block(ctx, "toc", { maxLevel, title: t ?? "Contents" }));
  };

  const emitText = (res: ParagraphResult, html: string) => {
    if (res.list) {
      const flushed = lists.add(res.list.numId, res.list.ilvl, html);
      if (flushed) out.push(flushed);
      return;
    }
    flushList();
    const tunes = Object.keys(res.format).length ? { [FORMAT_TUNE]: { ...res.format } } : undefined;
    if (res.kind === "heading") out.push(block(ctx, "header", { text: html, level: res.level ?? 1 }, tunes));
    else out.push(block(ctx, "paragraph", { text: html }, tunes));
  };

  const emitParagraph = (res: ParagraphResult) => {
    const chunks = chunkPieces(res.pieces);
    // Cached TOC entries / other dropped field results.
    if (res.startedSuppressed && chunks.every((c) => c.kind === "text" && isBlankHtml(c.html ?? ""))) return;
    if (res.pageBreakBefore) pageBreak();
    const hasOther = chunks.some((c) => c.kind !== "text");
    if (chunks.length === 0) {
      emitText(res, "");
      return;
    }
    for (const c of chunks) {
      if (c.kind === "text") {
        if (hasOther && isBlankHtml(c.html ?? "")) continue;
        emitText(res, c.html ?? "");
      } else if (c.kind === "pageBreak") pageBreak();
      else if (c.kind === "toc") tocBlock(c.maxLevel ?? 3);
      else if (c.block) {
        flushList();
        out.push(c.block);
      }
    }
  };

  const visit = async (els: Element[]): Promise<void> => {
    for (const el of els) {
      try {
        await visitOne(el);
      } catch (e) {
        if (e instanceof DocxImportError) throw e;
        ctx.warnings.add("Some content could not be read and was skipped.");
      }
      // Section ends are honoured even if the paragraph itself failed.
      const sp = tag(el) === "w:p" ? path(el, "w:pPr", "w:sectPr") : null;
      if (sp && hooks.onSectPr) {
        flushList();
        out.push(...hooks.onSectPr(sp));
      }
    }
  };

  const visitOne = async (el: Element): Promise<void> => {
    {
      switch (tag(el)) {
        case "w:p": {
          emitParagraph(convertParagraph(el, ctx, scope, { textboxHtml }));
          if (++ctx.paragraphCount % YIELD_EVERY === 0) await ctx.maybeYield();
          break;
        }
        case "w:tbl":
          flushList();
          out.push(convertTable(el, ctx, scope));
          if (++ctx.paragraphCount % YIELD_EVERY === 0) await ctx.maybeYield();
          break;
        case "w:sdt":
          if (isTocSdt(el)) tocBlock(sdtTocLevel(el), sdtTocTitle(el, ctx));
          else await visit(kids(child(el, "w:sdtContent")));
          break;
        case "w:customXml":
          await visit(kids(el));
          break;
        case "mc:AlternateContent":
          await visit(alternateContent(el));
          break;
        case "w:altChunk":
          ctx.warnings.add("Embedded documents (altChunk) were not imported.");
          break;
        default:
          break; // sectPr, bookmarks, proofErr…
      }
    }
  };

  await visit(elements);
  flushList();
  return out;
}

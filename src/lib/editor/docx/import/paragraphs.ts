/**
 * One w:p → what it is (heading / paragraph / list item), its paragraph
 * format tune, and its inline pieces. Formatting that the named style
 * already provides is not repeated in the tune.
 */

import type { ParagraphFormat } from "../../format/paragraphFormat";
import { INDENT_STEP_PX, MAX_INDENT } from "../../format/paragraphFormat";
import type { StyleId } from "../../styles/namedStyles";
import type { ImportContext, PartScope } from "./context";
import { clamp, round, twipsToPx } from "./html";
import type { Piece } from "./pieces";
import { mergeProps, parseParaProps, type ParaProps } from "./props";
import { InlineConverter } from "./runs";
import { outlineMapping, type StyleMapping } from "./styles";
import { child } from "./xml";

export interface ParagraphResult {
  kind: "heading" | "paragraph" | "list";
  level?: number;
  list?: { numId: string; ilvl: number };
  format: ParagraphFormat;
  pieces: Piece[];
  pageBreakBefore: boolean;
  /** The paragraph started inside a dropped field result (TOC entries). */
  startedSuppressed: boolean;
}

export interface ParagraphOptions {
  inCell?: boolean;
  /** Inline HTML for a text box body (provided by the block converter). */
  textboxHtml(content: Element): string;
}

const STYLE_TUNE: Partial<Record<StyleId, string>> = { title: "title", subtitle: "subtitle", quote: "quote" };

function isSuppressed(ctx: ImportContext): boolean {
  return ctx.fields.some((f) => f.phase === "instr" || f.mode === "toc" || f.mode === "drop" || f.mode === "atom");
}

function lineHeightOf(p: ParaProps, sizePt: number | undefined): number | undefined {
  if (!p.line) return undefined;
  const lh = p.lineRule === "auto" || !p.lineRule ? p.line / 240 : p.line / 20 / (sizePt ?? 11);
  return round(clamp(lh, 0.5, 4), 2);
}

export function convertParagraph(
  p: Element,
  ctx: ImportContext,
  scope: PartScope,
  opts: ParagraphOptions,
): ParagraphResult {
  const startedSuppressed = isSuppressed(ctx);
  const direct = parseParaProps(child(p, "w:pPr"));
  const styleId = direct.styleId ?? ctx.styles.defaultParagraphId ?? undefined;
  const resolved = ctx.styles.resolveParagraph(styleId);
  const eff = mergeProps(resolved.ppr, direct);

  let mapping: StyleMapping | null = ctx.styles.mapping(styleId);
  if (direct.outlineLvl !== undefined) {
    mapping = direct.outlineLvl >= 9 ? (mapping?.headingLevel ? null : mapping) : (outlineMapping(direct.outlineLvl) ?? mapping);
  }
  if (mapping?.deepHeading) ctx.warnings.add("Heading levels 5–9 were imported as heading 4.");
  const editorStyle: StyleId = mapping?.styleId ?? "normal";
  const base = ctx.styles.base(editorStyle);

  const heading = !!mapping?.headingLevel && !opts.inCell;
  let list: ParagraphResult["list"];
  if (eff.numId && ctx.numbering.has(eff.numId)) {
    if (heading) ctx.warnings.add("Numbered headings were imported without their numbers.");
    else list = { numId: eff.numId, ilvl: clamp(eff.ilvl ?? 0, 0, 8) };
  }

  const format: ParagraphFormat = {};
  if (eff.alignment && eff.alignment !== "left") format.alignment = eff.alignment;
  if (!list && eff.indLeft && eff.indLeft > 0) {
    const steps = Math.round(twipsToPx(eff.indLeft) / INDENT_STEP_PX);
    if (steps > 0) format.indent = Math.min(MAX_INDENT, steps);
  }
  if (eff.spaceBefore !== undefined && eff.spaceBefore !== base.ppr.spaceBefore) {
    format.spaceBefore = clamp(Math.round(twipsToPx(eff.spaceBefore)), 0, 400);
  }
  if (eff.spaceAfter !== undefined && eff.spaceAfter !== base.ppr.spaceAfter) {
    format.spaceAfter = clamp(Math.round(twipsToPx(eff.spaceAfter)), 0, 400);
  }
  if (eff.line && (eff.line !== base.ppr.line || (eff.lineRule ?? "auto") !== (base.ppr.lineRule ?? "auto"))) {
    const lh = lineHeightOf(eff, resolved.rpr.sizePt);
    if (lh !== undefined) format.lineHeight = lh;
  }
  if (!heading && STYLE_TUNE[editorStyle] && !opts.inCell) format.styleId = STYLE_TUNE[editorStyle];

  const inline = new InlineConverter(ctx, scope, {
    inherited: resolved.rpr,
    base: base.rpr,
    alignment: eff.alignment,
    inCell: !!opts.inCell,
    textboxHtml: opts.textboxHtml,
  });
  inline.walk(p);

  return {
    kind: heading ? "heading" : list ? "list" : "paragraph",
    level: heading ? mapping!.headingLevel : undefined,
    list,
    format,
    pieces: inline.pieces,
    pageBreakBefore: !!eff.pageBreakBefore,
    startedSuppressed,
  };
}

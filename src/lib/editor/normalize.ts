import { cleanFormat, FORMAT_TUNE, type ParagraphFormat } from "./format/paragraphFormat";

export interface EditorBlockLike {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

/** Block types whose alignment/indent belong to the shared format tune. */
export const TEXT_BLOCK_TYPES = new Set(["paragraph", "header", "list"]);

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Fold the legacy alignment / indent shapes into `tunes.format`:
 *   - ParagraphTool / HeaderTool data: `data.alignment`, `data.indentLevel`
 *   - nested `data.tunes.alignment.alignment` / `data.tunes.indentTune`
 *   - the old Alignment / Indent tunes: `tunes.alignment`, `tunes.indent`,
 *     `tunes.indentTune`
 * An explicit `tunes.format` always wins. Non-text blocks are untouched.
 */
export function normalizeBlock<T extends EditorBlockLike>(block: T): T {
  // The Delimiter tool was retired in favour of HorizontalLineTool.
  if (block.type === "delimiter") return { ...block, type: "horizontalLine", data: {} };
  if (!TEXT_BLOCK_TYPES.has(block.type)) return block;

  const data = { ...(block.data ?? {}) };
  const tunes = { ...(block.tunes ?? {}) };
  const nested = (data.tunes ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const legacyTunes = tunes as Record<string, Record<string, unknown> | undefined>;

  const legacy: ParagraphFormat = cleanFormat({
    alignment:
      data.alignment ??
      legacyTunes.alignment?.alignment ??
      nested.alignment?.alignment,
    indent:
      num(data.indentLevel) ??
      num(legacyTunes.indent?.indentLevel) ??
      num(legacyTunes.indentTune?.indentLevel) ??
      num(nested.indentTune?.indentLevel),
  });

  delete data.alignment;
  delete data.indentLevel;
  delete data.tunes;
  delete tunes.alignment;
  delete tunes.indent;
  delete tunes.indentTune;

  const format = { ...legacy, ...cleanFormat(tunes[FORMAT_TUNE]) };
  if (Object.keys(format).length > 0) tunes[FORMAT_TUNE] = format;
  else delete tunes[FORMAT_TUNE];

  const out = { ...block, data };
  if (Object.keys(tunes).length > 0) out.tunes = tunes;
  else delete out.tunes;
  return out;
}

export function normalizeBlocks<T extends EditorBlockLike>(blocks: T[]): T[] {
  return blocks.map(normalizeBlock);
}

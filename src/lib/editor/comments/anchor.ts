/**
 * Comment anchors — a W3C-style text quote selector (quote + a little
 * context) inside one block — and re-finding them after edits.
 *
 * `locateAnchor` tries, in order:
 *   1. the quote with matching prefix/suffix in the anchor's block;
 *   2. the quote alone in that block (best surrounding context wins, so
 *      duplicates resolve to the right occurrence);
 *   3. text between the surviving prefix and suffix in that block, when it
 *      still resembles the quote (the quote itself was edited);
 *   4. the quote in another block — nearest to the original block (text
 *      moved or the block was re-created);
 *   otherwise the anchor is orphaned (`null`).
 */
import type { CommentAnchor } from "~/lib/api/collab";
import {
  ATOM,
  HOST_BREAK,
  allBlocks,
  blockText,
  closestBlock,
  findBlock,
  inTextHost,
  offsetOf,
  rangeFor,
  type BlockText,
} from "./blockText";

export const CONTEXT_CHARS = 32;
/** Quotes shorter than this are only matched in their own block. */
const MIN_MOVED_QUOTE = 4;

export type AnchorMatchKind = "exact" | "quote" | "edited" | "moved";

export interface AnchorMatch {
  blockId: string;
  start: number;
  end: number;
  kind: AnchorMatchKind;
  range: Range;
}

function isTrimmable(ch: string): boolean {
  return ch === HOST_BREAK || ch === ATOM || /\s/.test(ch);
}

/** Capture the current selection as an anchor (null unless it is a
 *  non-empty selection inside one block's text). */
export function anchorFromSelection(root: HTMLElement, selection?: Selection | null): CommentAnchor | null {
  const sel = selection ?? root.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  return anchorFromRange(root, sel.getRangeAt(0));
}

export function anchorFromRange(root: HTMLElement, range: Range): CommentAnchor | null {
  if (range.collapsed) return null;
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const block = closestBlock(range.startContainer);
  if (!block || closestBlock(range.endContainer) !== block || !block.dataset.id) return null;
  if (!inTextHost(range.startContainer, block) || !inTextHost(range.endContainer, block)) return null;

  const bt = blockText(block);
  let start = offsetOf(bt, range.startContainer, range.startOffset);
  let end = offsetOf(bt, range.endContainer, range.endOffset);
  if (end < start) [start, end] = [end, start];
  while (start < end && isTrimmable(bt.text[start])) start++;
  while (end > start && isTrimmable(bt.text[end - 1])) end--;
  if (end <= start) return null;

  return {
    blockId: block.dataset.id,
    quote: bt.text.slice(start, end),
    prefix: bt.text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: bt.text.slice(end, end + CONTEXT_CHARS),
  };
}

/** Quote as shown to people (atoms and breaks flattened). */
export function displayQuote(quote: string): string {
  return quote.split(ATOM).join("").replace(/\s+/g, " ").trim();
}

function indexesOf(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** How well the text around [start, end) agrees with the anchor's context. */
function contextScore(text: string, start: number, end: number, a: CommentAnchor): number {
  const before = text.slice(Math.max(0, start - a.prefix.length), start);
  const after = text.slice(end, end + a.suffix.length);
  return commonSuffix(before, a.prefix) + commonPrefix(after, a.suffix);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice coefficient over character bigrams (0…1). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + (b.length - 1));
}

function bestOccurrence(bt: BlockText, a: CommentAnchor): { start: number; score: number } | null {
  let best: { start: number; score: number } | null = null;
  for (const i of indexesOf(bt.text, a.quote)) {
    const score = contextScore(bt.text, i, i + a.quote.length, a);
    if (!best || score > best.score) best = { start: i, score };
  }
  return best;
}

function contextTails(s: string, fromEnd: boolean): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const n of [s.length, 16, 8, 4]) {
    if (n > s.length || (out.length && n >= out[out.length - 1].length)) continue;
    out.push(fromEnd ? s.slice(s.length - n) : s.slice(0, n));
  }
  return out;
}

/** Positions where the surviving context begins/ends the quote. */
function contextPositions(text: string, ctx: string, isPrefix: boolean): number[] {
  if (!ctx) return [isPrefix ? 0 : text.length];
  for (const t of contextTails(ctx, isPrefix)) {
    const hits = indexesOf(text, t);
    if (hits.length) return isPrefix ? hits.map((i) => i + t.length) : hits;
  }
  return [];
}

/** The quote was edited: take what now sits between prefix and suffix. */
function bracketMatch(bt: BlockText, a: CommentAnchor): { start: number; end: number } | null {
  const q = a.quote.length;
  const starts = contextPositions(bt.text, a.prefix, true);
  const ends = contextPositions(bt.text, a.suffix, false);
  let best: { start: number; end: number; sim: number } | null = null;
  for (const s of starts) {
    for (const e of ends) {
      const len = e - s;
      if (len <= 0 || len > q * 2 + 16) continue;
      const sim = similarity(bt.text.slice(s, e), a.quote);
      if (sim < 0.5) continue;
      if (!best || sim > best.sim) best = { start: s, end: e, sim };
    }
  }
  if (!best) return null;
  // Don't hand back leading/trailing whitespace the edit left behind.
  let { start, end } = best;
  while (start < end && isTrimmable(bt.text[start])) start++;
  while (end > start && isTrimmable(bt.text[end - 1])) end--;
  return end > start ? { start, end } : null;
}

function match(bt: BlockText, start: number, end: number, kind: AnchorMatchKind): AnchorMatch | null {
  const range = rangeFor(bt, start, end);
  return range ? { blockId: bt.id, start, end, kind, range } : null;
}

export function locateAnchorMatch(root: HTMLElement, a: CommentAnchor): AnchorMatch | null {
  if (!a.quote) return null;
  const blocks = allBlocks(root);
  const home = findBlock(root, a.blockId);

  if (home) {
    const bt = blockText(home);
    const occ = bestOccurrence(bt, a);
    if (occ) {
      const exact = occ.score === a.prefix.length + a.suffix.length;
      const m = match(bt, occ.start, occ.start + a.quote.length, exact ? "exact" : "quote");
      if (m) return m;
    }
    const edited = bracketMatch(bt, a);
    if (edited) {
      const m = match(bt, edited.start, edited.end, "edited");
      if (m) return m;
    }
  }

  if (a.quote.trim().length < MIN_MOVED_QUOTE) return null;
  const homeIndex = home ? blocks.indexOf(home) : -1;
  let best: { bt: BlockText; start: number; score: number; distance: number } | null = null;
  blocks.forEach((block, index) => {
    if (block === home) return;
    const bt = blockText(block);
    const occ = bestOccurrence(bt, a);
    if (!occ) return;
    const distance = homeIndex >= 0 ? Math.abs(index - homeIndex) : index;
    const better =
      !best ||
      (homeIndex >= 0
        ? distance < best.distance || (distance === best.distance && occ.score > best.score)
        : occ.score > best.score || (occ.score === best.score && distance < best.distance));
    if (better) best = { bt, start: occ.start, score: occ.score, distance };
  });
  if (!best) return null;
  const found = best as { bt: BlockText; start: number };
  return match(found.bt, found.start, found.start + a.quote.length, "moved");
}

/** Re-find an anchor in the live document; null when orphaned. */
export function locateAnchor(root: HTMLElement, anchor: CommentAnchor): Range | null {
  return locateAnchorMatch(root, anchor)?.range ?? null;
}

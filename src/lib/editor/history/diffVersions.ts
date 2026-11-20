/**
 * Block-level diff between two versions of a document, for the version
 * history "Compare with current" view.
 *
 * Blocks are paired by id first; blocks left over on both sides (deleted
 * and re-created, pasted, imported…) are paired by content similarity.
 * Paired blocks are `same` or `changed` (with a word-level diff of their
 * text for text blocks); the rest are `added` / `removed`. The result
 * follows the new document's order, with removed blocks placed where they
 * used to be.
 */
import type { EditorBlock } from "~/lib/api/documents";

export interface WordOp {
  op: "equal" | "insert" | "delete";
  text: string;
}

export type BlockDiff =
  | { kind: "same"; block: EditorBlock }
  | { kind: "added"; block: EditorBlock }
  | { kind: "removed"; block: EditorBlock }
  | {
      kind: "changed";
      before: EditorBlock;
      after: EditorBlock;
      /** Word diff of the blocks' text (null for non-text blocks). */
      words: WordOp[] | null;
      /** Text is identical — only formatting / attributes changed. */
      formatOnly: boolean;
    };

/** Block types whose content is text we can word-diff. */
const TEXT_TYPES = new Set(["paragraph", "header", "list", "quote", "table", "textBox", "checklist"]);
/** Minimum similarity for pairing blocks that lost their id. */
const PAIR_THRESHOLD = 0.5;
/** Above this many candidate pairs, only identical content is paired. */
const MAX_PAIR_CHECKS = 40_000;
/** Token-matrix cap for the word LCS; beyond it, replace wholesale. */
const MAX_LCS_CELLS = 1_000_000;

let inert: Document | null = null;
function stripHtml(html: string): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return html;
  inert ??= document.implementation.createHTMLDocument("");
  const div = inert.createElement("div");
  div.innerHTML = html;
  // Line breaks inside a block read as spaces.
  div.querySelectorAll("br").forEach((br) => br.replaceWith(" "));
  return div.textContent ?? "";
}

const SKIP_KEYS = /^(url|src|href|file|style|id|type|color|width|height|dimensions|meta|withHeadings?|stretched|level|align|alignment|counterType|start)$/i;

function collectStrings(value: unknown, out: string[], key = ""): void {
  if (SKIP_KEYS.test(key)) return;
  if (typeof value === "string") {
    const t = stripHtml(value).trim();
    if (t) out.push(t);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectStrings(v, out, k);
  }
}

function listText(items: unknown, out: string[]): void {
  if (!Array.isArray(items)) return;
  for (const it of items) {
    if (typeof it === "string") out.push(stripHtml(it));
    else if (it && typeof it === "object") {
      const o = it as { content?: unknown; text?: unknown; items?: unknown };
      const c = typeof o.content === "string" ? o.content : typeof o.text === "string" ? o.text : "";
      out.push(stripHtml(c));
      listText(o.items, out);
    }
  }
}

/** A block's visible text (whitespace-normalised). */
export function blockPlainText(block: EditorBlock): string {
  const data = (block.data ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  switch (block.type) {
    case "paragraph":
    case "header":
      parts.push(stripHtml(typeof data.text === "string" ? data.text : ""));
      break;
    case "list":
    case "checklist":
      listText(data.items, parts);
      break;
    case "table":
      for (const row of Array.isArray(data.content) ? data.content : []) {
        parts.push((Array.isArray(row) ? row : []).map((c) => stripHtml(typeof c === "string" ? c : "")).join(" "));
      }
      break;
    case "image":
      if (typeof data.caption === "string") parts.push(stripHtml(data.caption));
      break;
    default:
      collectStrings(data, parts);
  }
  return parts.join("\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function blockKey(b: EditorBlock): string {
  return JSON.stringify([b.type, b.data ?? {}, b.tunes ?? {}]);
}

function tokenize(s: string): string[] {
  return s.match(/\s+|[\p{L}\p{M}\p{N}_'’]+|[^\s\p{L}\p{M}\p{N}_]/gu) ?? [];
}

function push(ops: WordOp[], op: WordOp["op"], text: string) {
  if (!text) return;
  const last = ops[ops.length - 1];
  if (last && last.op === op) last.text += text;
  else ops.push({ op, text });
}

/** Word-level diff (LCS over word / space / punctuation tokens). */
export function diffWords(before: string, after: string): WordOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);

  const ops: WordOp[] = [];
  push(ops, "equal", a.slice(0, pre).join(""));
  const n = A.length;
  const m = B.length;
  if (n * m > MAX_LCS_CELLS) {
    push(ops, "delete", A.join(""));
    push(ops, "insert", B.join(""));
  } else if (n || m) {
    // dp[i][j] = LCS length of A[i..], B[j..]
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    // Collect a run of deletes and inserts before emitting, so a replaced
    // phrase reads "old" then "new" rather than interleaved words.
    let del = "";
    let ins = "";
    const flush = () => {
      push(ops, "delete", del);
      push(ops, "insert", ins);
      del = "";
      ins = "";
    };
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) {
        // Whitespace alone between two changes stays inside the change.
        if (/^\s+$/.test(A[i]) && (del || ins) && i + 1 < n && j + 1 < m && A[i + 1] !== B[j + 1]) {
          del += A[i];
          ins += B[j];
        } else {
          flush();
          push(ops, "equal", A[i]);
        }
        i++;
        j++;
      } else if (j < m && (i >= n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
        ins += B[j++];
      } else {
        del += A[i++];
      }
    }
    flush();
  }
  push(ops, "equal", a.slice(a.length - suf).join(""));
  return ops;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  const ta = tokenize(a.toLowerCase()).filter((t) => !/^\s+$/.test(t));
  const tb = tokenize(b.toLowerCase()).filter((t) => !/^\s+$/.test(t));
  if (!ta.length || !tb.length) return 0;
  const counts = new Map<string, number>();
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of tb) {
    const c = counts.get(t) ?? 0;
    if (c > 0) {
      shared++;
      counts.set(t, c - 1);
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

const isText = (b: EditorBlock) => TEXT_TYPES.has(b.type);

function pairScore(a: EditorBlock, b: EditorBlock, ta: string, tb: string): number {
  if (blockKey(a) === blockKey(b)) return 2; // identical content: always pair first
  const comparable = a.type === b.type || (isText(a) && isText(b));
  if (!comparable || !ta || !tb) return 0;
  return dice(ta, tb);
}

export function diffVersions(oldBlocks: readonly EditorBlock[], newBlocks: readonly EditorBlock[]): BlockDiff[] {
  const oldIndexById = new Map<string, number>();
  oldBlocks.forEach((b, i) => {
    if (b.id && !oldIndexById.has(b.id)) oldIndexById.set(b.id, i);
  });

  /** new index → old index */
  const pairOf = new Map<number, number>();
  const usedOld = new Set<number>();
  newBlocks.forEach((b, i) => {
    const j = b.id ? oldIndexById.get(b.id) : undefined;
    if (j !== undefined && !usedOld.has(j)) {
      pairOf.set(i, j);
      usedOld.add(j);
    }
  });

  // Similarity pairing for the leftovers.
  const freeOld = oldBlocks.map((_, i) => i).filter((i) => !usedOld.has(i));
  const freeNew = newBlocks.map((_, i) => i).filter((i) => !pairOf.has(i));
  if (freeOld.length && freeNew.length) {
    const textOld = new Map(freeOld.map((i) => [i, blockPlainText(oldBlocks[i])]));
    const textNew = new Map(freeNew.map((i) => [i, blockPlainText(newBlocks[i])]));
    const candidates: Array<{ i: number; j: number; s: number }> = [];
    if (freeOld.length * freeNew.length <= MAX_PAIR_CHECKS) {
      for (const i of freeNew) {
        for (const j of freeOld) {
          const s = pairScore(oldBlocks[j], newBlocks[i], textOld.get(j)!, textNew.get(i)!);
          if (s >= PAIR_THRESHOLD) candidates.push({ i, j, s });
        }
      }
    } else {
      const byKey = new Map<string, number[]>();
      for (const j of freeOld) {
        const k = blockKey(oldBlocks[j]);
        byKey.set(k, [...(byKey.get(k) ?? []), j]);
      }
      for (const i of freeNew) {
        for (const j of byKey.get(blockKey(newBlocks[i])) ?? []) candidates.push({ i, j, s: 2 });
      }
    }
    // Best first; ties keep document order (and prefer nearby positions).
    candidates.sort((x, y) => y.s - x.s || Math.abs(x.i - x.j) - Math.abs(y.i - y.j) || x.i - y.i);
    for (const c of candidates) {
      if (pairOf.has(c.i) || usedOld.has(c.j)) continue;
      pairOf.set(c.i, c.j);
      usedOld.add(c.j);
    }
  }

  const out: BlockDiff[] = [];
  let nextOld = 0;
  const flushRemovedBefore = (limit: number) => {
    for (; nextOld < limit; nextOld++) {
      if (!usedOld.has(nextOld)) out.push({ kind: "removed", block: oldBlocks[nextOld] });
    }
  };

  // Old index of the next paired block at/after each new index, so text
  // removed at a spot reads before what was added there.
  const nextPaired: number[] = new Array(newBlocks.length + 1);
  nextPaired[newBlocks.length] = oldBlocks.length;
  for (let i = newBlocks.length - 1; i >= 0; i--) nextPaired[i] = pairOf.get(i) ?? nextPaired[i + 1];

  newBlocks.forEach((b, i) => {
    const j = pairOf.get(i);
    if (j === undefined) {
      flushRemovedBefore(nextPaired[i]);
      out.push({ kind: "added", block: b });
      return;
    }
    flushRemovedBefore(j);
    const before = oldBlocks[j];
    if (blockKey(before) === blockKey(b)) {
      out.push({ kind: "same", block: b });
      return;
    }
    const ta = blockPlainText(before);
    const tb = blockPlainText(b);
    out.push({
      kind: "changed",
      before,
      after: b,
      words: isText(before) || isText(b) ? diffWords(ta, tb) : null,
      formatOnly: ta === tb,
    });
  });
  flushRemovedBefore(oldBlocks.length);
  return out;
}

export function diffStats(diff: readonly BlockDiff[]): { added: number; removed: number; changed: number } {
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const d of diff) {
    if (d.kind === "added") added++;
    else if (d.kind === "removed") removed++;
    else if (d.kind === "changed") changed++;
  }
  return { added, removed, changed };
}

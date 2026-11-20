/**
 * Normalised summary of an imported document (for round-trip comparison)
 * and a readable diff between two summaries.
 */
import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import type { ImportedDocument } from "../import/types";
import {
  flattenItems,
  footnoteHtmls,
  footnoteRefIds,
  formatOf,
  formatSignature,
  formattedChars,
  headerFooterBlocks,
  htmlText,
  imageAlt,
  imageSize,
  imageWrap,
  listItems,
  listMeta,
  sectionLayouts,
  tableInfo,
} from "./inspect";

export interface BlockSummary {
  type: string;
  text: string;
  details: string[];
}

export interface DocSummary {
  blocks: BlockSummary[];
  sections: string[];
  stories: Record<string, string>;
  pageSetup: string[];
  footnotes: string[];
}

/** Fields → "{kind}", footnote refs → "[fn]" so texts compare across exports. */
function canonHtml(html: string): string {
  if (!html || !/tp-field|tp-fn-ref/.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll(".tp-field"))) {
    el.replaceWith(doc.createTextNode(`{${el.getAttribute("data-field") ?? "?"}}`));
  }
  for (const el of Array.from(doc.body.querySelectorAll("sup.tp-fn-ref"))) el.replaceWith(doc.createTextNode("[fn]"));
  return doc.body.innerHTML;
}

const text = (html: string) => htmlText(canonHtml(html));

/** Non-plain formatted runs of a fragment: `b,i:"text"`. */
function runs(html: string): string[] {
  const { text: t, formats } = formattedChars(canonHtml(html));
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    const sig = formatSignature(formats[i]!);
    let j = i + 1;
    while (j < t.length && formatSignature(formats[j]!) === sig) j++;
    const seg = t.slice(i, j).replace(/\s+/g, " ").trim();
    if (sig && seg) out.push(`${sig}:${JSON.stringify(seg.length > 40 ? `${seg.slice(0, 39)}…` : seg)}`);
    i = j;
  }
  return out;
}

const layoutStr = (l: PageLayout | undefined) =>
  l
    ? `${l.paperSize} ${l.orientation} ${[l.marginTop, l.marginRight, l.marginBottom, l.marginLeft].map((m) => Math.round(m)).join("/")}`
    : "none";

function paraDetails(b: EditorBlock): string[] {
  const f = formatOf(b);
  const d: string[] = [];
  if (b.type === "header") d.push(`level=${String(b.data?.level)}`);
  if (f.alignment && f.alignment !== "left") d.push(`align=${String(f.alignment)}`);
  if (f.indent) d.push(`indent=${String(f.indent)}`);
  if (typeof f.lineHeight === "number") d.push(`lineHeight=${Math.round(f.lineHeight * 100) / 100}`);
  if (typeof f.spaceBefore === "number") d.push(`spaceBefore=${Math.round(f.spaceBefore)}`);
  if (typeof f.spaceAfter === "number") d.push(`spaceAfter=${Math.round(f.spaceAfter)}`);
  if (f.styleId) d.push(`style=${String(f.styleId)}`);
  return d;
}

export function summarizeBlock(b: EditorBlock): BlockSummary {
  const d = (b.data ?? {}) as Record<string, unknown>;
  switch (b.type) {
    case "paragraph":
    case "header":
      return { type: b.type, text: text(String(d.text ?? "")), details: [...paraDetails(b), ...runs(String(d.text ?? ""))] };
    case "list": {
      const meta = listMeta(b);
      const items = flattenItems(listItems(b));
      return {
        type: "list",
        text: items.map((i) => text(i.html)).join(" | "),
        details: [
          `style=${meta.style}`,
          ...(meta.style === "ordered" ? [`counter=${meta.counterType ?? "numeric"}`, `start=${meta.start ?? 1}`] : []),
          `shape=${items.map((i) => i.depth).join("")}`,
          ...items.flatMap((i) => runs(i.html)),
        ],
      };
    }
    case "table": {
      const t = tableInfo(b);
      const spans = t.cells.filter((c) => c.colSpan > 1 || c.rowSpan > 1).map((c) => `${c.r},${c.c}:${c.colSpan}x${c.rowSpan}`);
      return {
        type: "table",
        text: t.content.map((r) => r.map(text).join(" ¦ ")).join(" / "),
        details: [
          `grid=${t.rows}x${t.cols}`,
          `spans=${spans.join(" ") || "none"}`,
          `headerRows=${JSON.stringify(t.headerRows)}`,
          `repeatHeader=${String(t.repeatHeader ?? true)}`,
          ...t.content.flat().flatMap(runs),
        ],
      };
    }
    case "image": {
      const s = imageSize(b);
      return {
        type: "image",
        text: imageAlt(b),
        details: [`wrap=${imageWrap(b)}`, `size=${Math.round(s.width ?? 0)}x${Math.round(s.height ?? 0)}`],
      };
    }
    case "equation":
      return { type: "equation", text: String(d.latex ?? ""), details: [`display=${String(d.display ?? true)}`] };
    case "toc":
      return { type: "toc", text: "", details: [`maxLevel=${String(d.maxLevel)}`] };
    case "sectionBreak":
      return { type: "sectionBreak", text: "", details: [layoutStr(d.layout as PageLayout)] };
    case "textBox":
      return { type: "textBox", text: text(String(d.text ?? "")), details: runs(String(d.text ?? "")) };
    default:
      return { type: b.type, text: typeof d.text === "string" ? text(d.text) : "", details: [] };
  }
}

export function summarize(doc: ImportedDocument): DocSummary {
  const stories: Record<string, string> = {};
  for (const part of ["headers", "footers"] as const) {
    for (const v of ["default", "first", "even"] as const) {
      const blocks = headerFooterBlocks(doc, part, v);
      if (blocks.length === 0) continue;
      stories[`${part}.${v}`] = blocks
        .map((b) => (b.type === "image" ? `[image ${imageAlt(b)}]` : summarizeBlock(b).text))
        .filter(Boolean)
        .join(" | ");
    }
  }
  const notes = new Map(footnoteHtmls(doc));
  const ps = doc.pageSetup;
  return {
    blocks: doc.blocks.map(summarizeBlock),
    sections: sectionLayouts(doc).map(layoutStr),
    stories,
    pageSetup: [
      `differentFirstPage=${ps.differentFirstPage}`,
      `differentOddEven=${ps.differentOddEven}`,
      `pageColor=${ps.pageColor ?? "none"}`,
      `pageBorder=${ps.pageBorder ? `${ps.pageBorder.style} ${ps.pageBorder.color}` : "none"}`,
      `watermark=${ps.watermark?.text ?? "none"}`,
    ],
    // Ids are renumbered on export: compare texts in body reference order.
    footnotes: footnoteRefIds(doc.blocks).map((id) => text(notes.get(id) ?? "(missing)")),
  };
}

// ── Diff ────────────────────────────────────────────────────────────────

const key = (b: BlockSummary) => `${b.type}\u0000${b.text}`;
const show = (b: BlockSummary) => `${b.type}${b.text ? ` ${JSON.stringify(b.text.length > 50 ? `${b.text.slice(0, 49)}…` : b.text)}` : ""}`;

/** LCS alignment of two block lists by (type, text). */
function align(a: BlockSummary[], b: BlockSummary[]): Array<[number | null, number | null]> {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = key(a[i]!) === key(b[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: Array<[number | null, number | null]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]!) === key(b[j]!)) out.push([i++, j++]);
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push([i++, null]);
    else out.push([null, j++]);
  }
  while (i < n) out.push([i++, null]);
  while (j < m) out.push([null, j++]);
  return out;
}

function listDiff(label: string, a: string[], b: string[]): string[] {
  const missing = a.filter((x) => !b.includes(x));
  const added = b.filter((x) => !a.includes(x));
  const out: string[] = [];
  if (missing.length) out.push(`${label}: lost ${missing.join("; ")}`);
  if (added.length) out.push(`${label}: gained ${added.join("; ")}`);
  return out;
}

/** Differences from `before` (first import) to `after` (re-import). */
export function diffSummaries(before: DocSummary, after: DocSummary): string[] {
  const out: string[] = [];
  const pairs = align(before.blocks, after.blocks);
  // Pair up adjacent lost/gained blocks of the same type as "changed".
  for (let k = 0; k < pairs.length; k++) {
    const [i, j] = pairs[k]!;
    if (i !== null && j !== null) {
      out.push(...listDiff(`#${i} ${show(before.blocks[i]!)}`, before.blocks[i]!.details, after.blocks[j]!.details));
      continue;
    }
    const next = pairs[k + 1];
    if (i !== null && next && next[0] === null && next[1] !== null && after.blocks[next[1]]!.type === before.blocks[i]!.type) {
      const a = before.blocks[i]!;
      const b = after.blocks[next[1]]!;
      out.push(`#${i} ${a.type} text changed: ${JSON.stringify(a.text.slice(0, 60))} → ${JSON.stringify(b.text.slice(0, 60))}`);
      out.push(...listDiff(`#${i} ${a.type}`, a.details, b.details));
      k++;
      continue;
    }
    if (i !== null) out.push(`#${i} lost ${show(before.blocks[i]!)}`);
    else out.push(`+ gained ${show(after.blocks[j!]!)}`);
  }
  out.push(...listDiff("sections", before.sections, after.sections));
  if (before.sections.length !== after.sections.length) out.push(`sections: ${before.sections.length} → ${after.sections.length}`);
  for (const k of new Set([...Object.keys(before.stories), ...Object.keys(after.stories)])) {
    if (before.stories[k] !== after.stories[k]) {
      out.push(`${k}: ${JSON.stringify(before.stories[k] ?? null)} → ${JSON.stringify(after.stories[k] ?? null)}`);
    }
  }
  out.push(...listDiff("pageSetup", before.pageSetup, after.pageSetup));
  if (JSON.stringify(before.footnotes) !== JSON.stringify(after.footnotes)) {
    out.push(`footnotes: ${JSON.stringify(before.footnotes)} → ${JSON.stringify(after.footnotes)}`);
  }
  return out;
}

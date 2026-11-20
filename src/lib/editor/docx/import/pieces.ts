/**
 * The inline converter's output: a flat list of pieces. Text segments
 * carry their (already escaped) HTML plus the formatting to wrap them in;
 * neighbours with identical formatting are merged when rendering, so
 * Word's run fragmentation doesn't turn into nested tag soup.
 */

import type { EditorBlock } from "~/lib/api/documents";
import { escapeAttr } from "./html";

export interface Fmt {
  /** Wrapping tags, outermost first: b, i, u, s, sup, sub. */
  tags: string[];
  /** Inline CSS for a wrapping <span style>, "" for none. */
  style: string;
}

export const NO_FMT: Fmt = { tags: [], style: "" };

export type Piece =
  | { kind: "seg"; html: string; fmt: Fmt; link: string | null }
  | { kind: "pageBreak" }
  /** `float`: anchored object that belongs before the paragraph text. */
  | { kind: "block"; block: EditorBlock; float: boolean; placeholder: string }
  | { kind: "toc"; maxLevel: number };

const fmtKey = (f: Fmt) => `${f.tags.join(",")}|${f.style}`;

function wrap(html: string, fmt: Fmt): string {
  let out = html;
  for (let i = fmt.tags.length - 1; i >= 0; i--) out = `<${fmt.tags[i]}>${out}</${fmt.tags[i]}>`;
  if (fmt.style) out = `<span style="${escapeAttr(fmt.style)}">${out}</span>`;
  return out;
}

type Seg = Extract<Piece, { kind: "seg" }>;

/** Render text segments to inline HTML. */
export function renderSegs(segs: Seg[]): string {
  let out = "";
  let i = 0;
  while (i < segs.length) {
    const link = segs[i]!.link;
    let inner = "";
    while (i < segs.length && segs[i]!.link === link) {
      const key = fmtKey(segs[i]!.fmt);
      const fmt = segs[i]!.fmt;
      let html = "";
      while (i < segs.length && segs[i]!.link === link && fmtKey(segs[i]!.fmt) === key) {
        html += segs[i]!.html;
        i++;
      }
      inner += html ? wrap(html, fmt) : "";
    }
    out += link ? `<a href="${escapeAttr(link)}">${inner}</a>` : inner;
  }
  return out;
}

export interface Chunk {
  kind: "text" | "pageBreak" | "block" | "toc";
  html?: string;
  block?: EditorBlock;
  maxLevel?: number;
}

/**
 * Split pieces into ordered chunks: text runs between breaks/blocks,
 * page breaks, blocks (floats are hoisted before the text they're
 * anchored in) and TOC markers.
 */
export function chunkPieces(pieces: Piece[]): Chunk[] {
  const out: Chunk[] = [];
  let segs: Seg[] = [];
  let floats: Chunk[] = [];
  let textStart = 0;
  const flush = () => {
    const html = renderSegs(segs);
    segs = [];
    // Floats anchored in this text go before it.
    if (floats.length) {
      out.splice(textStart, 0, ...floats);
      floats = [];
    }
    out.push({ kind: "text", html });
  };
  for (const p of pieces) {
    if (p.kind === "seg") {
      if (segs.length === 0) textStart = out.length;
      segs.push(p);
    } else if (p.kind === "block" && p.float) {
      if (segs.length === 0) textStart = out.length;
      floats.push({ kind: "block", block: p.block });
    } else {
      if (segs.length || floats.length) flush();
      if (p.kind === "pageBreak") out.push({ kind: "pageBreak" });
      else if (p.kind === "block") out.push({ kind: "block", block: p.block });
      else out.push({ kind: "toc", maxLevel: p.maxLevel });
      textStart = out.length;
    }
  }
  if (segs.length || floats.length) flush();
  return out;
}

/** True when rendered inline HTML has no visible content. */
export function isBlankHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "") === "" && !/<br|tp-field|tp-fn-ref/.test(html);
}

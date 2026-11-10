import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { paginate, type PageGeometry, type Split } from "./paginate";

export interface PageSummary {
  /** Block ids on this page (a split block appears on every page it spans). */
  blockIds: string[];
  heading: string | null;
  text: string | null;
}

interface Result {
  pageCount: number;
  pages: PageSummary[];
  /** Re-run layout on the next frame (cheap to call often). */
  schedule: () => void;
}

const BLOCK_SELECTOR = ".codex-editor__redactor > .ce-block";
const SPLIT_CLASS = "tp-split";
const MEASURING_CLASS = "tp-measuring";

type SplitKind = "lines" | "rows";

/**
 * Lays the single editor's blocks out on pages.
 *
 * Each pass: switch to a "measuring" state where everything the paginator
 * added is neutralised, measure natural block heights (and, lazily, line /
 * row positions for blocks that cross a page edge), run `paginate`, then
 * apply the result:
 *   - pushes and table padding → one generated stylesheet keyed by block
 *     id, so nothing is written into the editor's DOM;
 *   - paragraph / list splits → invisible full-width floats inserted at the
 *     front of the block. Floats push the lines that would cross the page
 *     edge down to the next sheet without touching the text. They carry
 *     `data-mutation-free`, so EditorJS doesn't treat them as edits, and
 *     they're outside the tool's element, so they're never saved;
 *   - table splits → rows after the break are offset with `position:
 *     relative`; TableTool doesn't persist row positioning.
 */
export function usePagination(
  surfaceRef: RefObject<HTMLElement | null>,
  geometry: PageGeometry,
): Result {
  const [pageCount, setPageCount] = useState(1);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const frameRef = useRef<number | null>(null);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const pagesKeyRef = useRef("");
  const resizeRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Element | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const shiftedRowsRef = useRef<Set<HTMLTableRowElement>>(new Set());

  const run = useCallback(() => {
    frameRef.current = null;
    const surface = surfaceRef.current;
    const style = styleRef.current;
    if (!surface || !style) return;

    // The redactor is created by EditorJS after init; it grows with the
    // content, so it's the element whose size tells us to re-paginate.
    const redactor = surface.querySelector(".codex-editor__redactor");
    if (redactor && redactor !== observedRef.current && resizeRef.current) {
      if (observedRef.current) resizeRef.current.unobserve(observedRef.current);
      resizeRef.current.observe(redactor);
      observedRef.current = redactor;
    }

    const blocks = Array.from(surface.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    const kinds = blocks.map(splitKind);

    // ── Measure (paginator effects switched off) ─────────────────────────
    surface.classList.add(MEASURING_CLASS);
    style.media = "not all";
    const scale = surface.offsetWidth ? surface.getBoundingClientRect().width / surface.offsetWidth : 1;
    const metrics = blocks.map((el, i) => {
      const kind = kinds[i]!;
      return {
        // Fractional heights: integer offsetHeight drifts by up to 0.5px
        // per block, which adds up to lines overflowing the bottom margin.
        height: el.getBoundingClientRect().height / (scale || 1),
        breakBefore: i > 0 && isPageBreak(blocks[i - 1]!),
        keepTogether: kind === "lines" ? 2 : 1,
        getBreaks: kind ? () => measureBreaks(el, kind, scale || 1) : undefined,
      };
    });
    const trailingBreak = blocks.length > 0 && isPageBreak(blocks[blocks.length - 1]!);
    const result = paginate(metrics, geometryRef.current, trailingBreak);
    surface.classList.remove(MEASURING_CLASS);
    style.media = "";

    // ── Apply ────────────────────────────────────────────────────────────
    const rules: string[] = [];
    const shifted = new Set<HTMLTableRowElement>();
    blocks.forEach((el, i) => {
      const id = el.dataset.id;
      const push = result.pushes[i] ?? 0;
      const splits = result.splits[i] ?? [];
      const sel = id ? `.ce-block[data-id="${CSS.escape(id)}"]` : null;
      if (sel && push > 0) rules.push(`${sel}{margin-top:${round(push)}px}`);

      syncFloats(el, kinds[i] === "lines" ? splits : []);
      if (kinds[i] === "rows" && splits.length > 0) {
        shiftRows(el, splits, shifted);
        const total = splits.reduce((sum, s) => sum + s.gap, 0);
        if (sel) rules.push(`${sel}{padding-bottom:${round(total)}px}`);
      }
    });
    for (const row of shiftedRowsRef.current) {
      if (!shifted.has(row)) {
        row.style.removeProperty("position");
        row.style.removeProperty("top");
      }
    }
    shiftedRowsRef.current = shifted;
    const css = rules.join("\n");
    if (style.textContent !== css) style.textContent = css;

    setPageCount((prev) => (prev === result.pageCount ? prev : result.pageCount));

    // ── Page summaries for the sidebar ───────────────────────────────────
    const summaries: PageSummary[] = Array.from({ length: result.pageCount }, () => ({
      blockIds: [],
      heading: null,
      text: null,
    }));
    blocks.forEach((el, i) => {
      const first = result.pageOf[i] ?? 0;
      const last = first + (result.splits[i]?.length ?? 0);
      const heading = el.querySelector(".ce-header")?.textContent?.trim();
      const text = el.querySelector(".ce-paragraph, .cdx-list, table")?.textContent?.trim();
      for (let p = first; p <= last; p++) {
        const page = summaries[p];
        if (!page) continue;
        if (el.dataset.id) page.blockIds.push(el.dataset.id);
        if (!page.heading && heading) page.heading = heading.slice(0, 80);
        // Pages a split block continues onto show it as a continuation.
        if (!page.text && text) page.text = (p > first ? "…" : "") + text.slice(0, 160);
      }
    });
    // Only re-render the sidebar when what it shows actually changed.
    const key = JSON.stringify(summaries.map((s) => [s.heading, s.text, s.blockIds.length]));
    if (key !== pagesKeyRef.current) {
      pagesKeyRef.current = key;
      setPages(summaries);
    }
  }, [surfaceRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(run);
  }, [run]);

  useEffect(() => {
    schedule();
  }, [geometry.pageHeight, geometry.marginTop, geometry.marginBottom, geometry.gap, schedule]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const style = document.createElement("style");
    style.dataset.tpPagination = "";
    document.head.appendChild(style);
    styleRef.current = style;

    const resize = new ResizeObserver(schedule);
    resizeRef.current = resize;
    // Blocks added/removed — the redactor may not resize if a block of the
    // same height replaced another, so watch the child list too (ignoring
    // our own split floats).
    const mutations = new MutationObserver((records) => {
      if (records.some((r) => !isOwnMutation(r))) schedule();
    });
    mutations.observe(surface, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      resizeRef.current = null;
      observedRef.current = null;
      mutations.disconnect();
      style.remove();
      styleRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [surfaceRef, schedule]);

  return { pageCount, pages, schedule };
}

function isPageBreak(block: HTMLElement): boolean {
  return block.querySelector(".tp-page-break") !== null;
}

function splitKind(block: HTMLElement): SplitKind | null {
  if (block.querySelector(".ce-paragraph, .cdx-list")) return "lines";
  if (block.querySelector("table")) return "rows";
  return null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Where the block may break, as offsets from its top: the boundaries
 * between text lines (midway between one line's glyphs and the next's,
 * i.e. the line-box edge) or the tops of table rows after the first.
 */
function measureBreaks(block: HTMLElement, kind: SplitKind, scale: number): number[] {
  const blockTop = block.getBoundingClientRect().top;
  const toLocal = (y: number) => (y - blockTop) / scale;

  if (kind === "rows") {
    const table = block.querySelector("table");
    if (!table) return [];
    return Array.from(table.rows)
      .slice(1)
      .map((row) => toLocal(row.getBoundingClientRect().top));
  }

  const content = block.querySelector(".ce-block__content") ?? block;
  const rects: Array<{ top: number; bottom: number }> = [];
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const r of Array.from(range.getClientRects())) {
      if (r.height > 0) rects.push({ top: r.top, bottom: r.bottom });
    }
  }
  rects.sort((a, b) => a.top - b.top);

  // Merge fragments on the same visual line.
  const lines: Array<{ top: number; bottom: number }> = [];
  for (const r of rects) {
    const line = lines[lines.length - 1];
    if (line && r.top < line.bottom - 1) {
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }

  const breaks: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    breaks.push(toLocal((lines[i - 1]!.bottom + lines[i]!.top) / 2));
  }
  return breaks;
}

/**
 * Make the block's split floats match `splits` (no-op when unchanged).
 *
 * Each split is two floats: a zero-width "strut" as tall as the text above
 * the break, then a full-width gap below it (`clear: left`). Lines wrap
 * around a float's *margin* box, so positioning the gap with margin-top
 * would push every line below it; a zero-width strut takes no horizontal
 * room, so the lines above the break flow beside it untouched.
 */
function syncFloats(block: HTMLElement, splits: Split[]): void {
  const existing = Array.from(block.children).filter((c) =>
    c.classList.contains(SPLIT_CLASS),
  ) as HTMLElement[];
  const specs: Array<{ strut: boolean; height: number }> = [];
  splits.forEach((s, j) => {
    specs.push({ strut: true, height: s.at - (j > 0 ? splits[j - 1]!.at : 0) });
    specs.push({ strut: false, height: s.gap });
  });
  const key = (spec: { strut: boolean; height: number }) =>
    `${spec.strut ? "s" : "g"}${round(spec.height)}`;
  if (
    existing.length === specs.length &&
    existing.every((el, j) => el.dataset.spec === key(specs[j]!))
  ) {
    return;
  }
  existing.forEach((el) => el.remove());
  const anchor = block.firstChild;
  for (const spec of specs) {
    const el = document.createElement("div");
    el.className = spec.strut ? `${SPLIT_CLASS} ${SPLIT_CLASS}--strut` : SPLIT_CLASS;
    el.dataset.mutationFree = "true";
    el.dataset.spec = key(spec);
    el.contentEditable = "false";
    el.setAttribute("aria-hidden", "true");
    el.style.height = `${round(spec.height)}px`;
    block.insertBefore(el, anchor);
  }
}

/** Offset table rows after each break so they start on the next page. */
function shiftRows(block: HTMLElement, splits: Split[], shifted: Set<HTMLTableRowElement>): void {
  const table = block.querySelector("table");
  if (!table) return;
  const rows = Array.from(table.rows);
  let offset = 0;
  let next = 0;
  rows.forEach((row, r) => {
    // Break i sits before row i + 1.
    while (next < splits.length && splits[next]!.index + 1 <= r) {
      offset += splits[next]!.gap;
      next += 1;
    }
    if (offset === 0) return;
    const top = `${round(offset)}px`;
    if (row.style.position !== "relative") row.style.position = "relative";
    if (row.style.top !== top) row.style.top = top;
    shifted.add(row);
  });
}

function isOwnMutation(record: MutationRecord): boolean {
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return (
    nodes.length > 0 &&
    nodes.every((n) => n instanceof HTMLElement && n.classList.contains(SPLIT_CLASS))
  );
}

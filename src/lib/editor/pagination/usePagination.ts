import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PageLayout } from "~/lib/api/documents";
import { publishOutline, type OutlineEntry } from "./outline";
import { paginate, type BlockMetrics, type PageBox, type SectionGeometry, type Split } from "./paginate";
import { pageSize } from "./paper";

export interface PageView extends PageBox {
  /** Horizontal offset of the sheet within the document column. */
  left: number;
  /** Space reserved for this page's footnotes, px. */
  footnoteHeight: number;
  /** Block ids on this page (a split block appears on every page it spans). */
  blockIds: string[];
  heading: string | null;
  text: string | null;
}

/** Back-compat name used by the sidebar. */
export type PageSummary = PageView;

export interface PaginationOptions {
  defaultLayout: PageLayout;
  gap: number;
  /** Height the given footnotes need at the bottom of a page whose text
   *  column is `width` px wide (0 when there are none). */
  measureFootnotes: (ids: string[], width: number) => number;
}

interface Result {
  pages: PageView[];
  pageCount: number;
  /** Width of the widest sheet: the document column's width. */
  columnWidth: number;
  /** Footnote ids in document order (their numbers are index + 1). */
  footnoteOrder: string[];
  /** Re-run layout on the next frame (cheap to call often). */
  schedule: () => void;
}

const BLOCK_SELECTOR = ".codex-editor__redactor > .ce-block";
const SPLIT_CLASS = "tp-split";
const MEASURING_CLASS = "tp-measuring";
/** Generated content inside blocks (TOC entries, footnote numbers). */
const GENERATED = "[data-tp-generated], .tp-fn-ref";

type SplitKind = "lines" | "rows";

export function sectionGeometry(layout: PageLayout): SectionGeometry {
  const { width, height } = pageSize(layout);
  return {
    pageWidth: width,
    pageHeight: height,
    marginTop: layout.marginTop,
    marginBottom: layout.marginBottom,
    marginLeft: layout.marginLeft,
    marginRight: layout.marginRight,
  };
}

/**
 * Lays the single editor's blocks out on pages.
 *
 * Each pass: switch to a "measuring" state where everything the paginator
 * added is neutralised, measure natural block heights (and, lazily, line /
 * row positions for blocks that cross a page edge), run `paginate`, then
 * apply the result:
 *   - pushes and table padding → a generated stylesheet keyed by block id,
 *     so nothing is written into the editor's DOM;
 *   - blocks in sections whose page width / margins differ from the first
 *     section get their horizontal position from a second stylesheet that
 *     stays on while measuring (width changes line wrapping);
 *   - paragraph / list splits → invisible full-width floats at the front of
 *     the block (`data-mutation-free`, outside the tool's element — never
 *     saved, ignored by EditorJS);
 *   - table splits → rows after the break offset with `position: relative`.
 * Footnotes: references are measured per block, notes are measured for
 * each page's set, and the page is re-paginated with that space reserved
 * until the assignment settles.
 */
export function usePagination(surfaceRef: RefObject<HTMLElement | null>, options: PaginationOptions): Result {
  const [pages, setPages] = useState<PageView[]>([]);
  const [columnWidth, setColumnWidth] = useState(() => pageSize(options.defaultLayout).width);
  const [footnoteOrder, setFootnoteOrder] = useState<string[]>([]);
  const frameRef = useRef<number | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pagesKeyRef = useRef("");
  const resizeRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Element | null>(null);
  const pushStyleRef = useRef<HTMLStyleElement | null>(null);
  const layoutStyleRef = useRef<HTMLStyleElement | null>(null);
  const shiftedRowsRef = useRef<Set<HTMLTableRowElement>>(new Set());

  const run = useCallback(() => {
    frameRef.current = null;
    const surface = surfaceRef.current;
    const pushStyle = pushStyleRef.current;
    const layoutStyle = layoutStyleRef.current;
    if (!surface || !pushStyle || !layoutStyle) return;
    const { defaultLayout, gap, measureFootnotes } = optionsRef.current;

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

    // ── Sections (from section-break blocks, in order) ───────────────────
    const sections: SectionGeometry[] = [sectionGeometry(defaultLayout)];
    const sectionStart: Array<number | undefined> = [];
    const sectionOfBlock: number[] = [];
    let current = 0;
    blocks.forEach((el, i) => {
      const prev = blocks[i - 1];
      const layout = prev ? sectionBreakLayout(prev) : null;
      if (layout) {
        sections.push(sectionGeometry({ ...defaultLayout, ...layout }));
        current = sections.length - 1;
        sectionStart[i] = current;
      }
      sectionOfBlock.push(current);
    });
    const lastLayout = blocks.length > 0 ? sectionBreakLayout(blocks[blocks.length - 1]!) : null;
    if (lastLayout) sections.push(sectionGeometry({ ...defaultLayout, ...lastLayout }));

    // Horizontal placement per section: sheets are centred in a column as
    // wide as the widest one; the flow's padding matches section 0.
    const width = Math.max(...sections.map((s) => s.pageWidth));
    const sheetLeft = (s: SectionGeometry) => (width - s.pageWidth) / 2;
    const base = sections[0]!;
    const flowLeft = sheetLeft(base) + base.marginLeft;
    const layoutRules: string[] = [];
    blocks.forEach((el, i) => {
      const s = sections[sectionOfBlock[i]!]!;
      if (sectionOfBlock[i] === 0 || !el.dataset.id) return;
      const delta = sheetLeft(s) + s.marginLeft - flowLeft;
      const contentWidth = s.pageWidth - s.marginLeft - s.marginRight;
      layoutRules.push(
        `.ce-block[data-id="${CSS.escape(el.dataset.id)}"]{margin-left:${round(delta)}px;width:${round(contentWidth)}px;max-width:none}`,
      );
    });
    const layoutCss = layoutRules.join("\n");
    if (layoutStyle.textContent !== layoutCss) layoutStyle.textContent = layoutCss;

    // ── Measure (paginator effects switched off) ─────────────────────────
    surface.classList.add(MEASURING_CLASS);
    pushStyle.media = "not all";
    const scale = surface.offsetWidth ? surface.getBoundingClientRect().width / surface.offsetWidth : 1;
    const breaksCache = new Map<number, number[]>();
    const metrics: BlockMetrics[] = blocks.map((el, i) => {
      const kind = kinds[i]!;
      const rect = el.getBoundingClientRect();
      const footnotes = Array.from(el.querySelectorAll<HTMLElement>(".tp-fn-ref[data-fn-id]")).map((ref) => ({
        id: ref.dataset.fnId!,
        at: (ref.getBoundingClientRect().top - rect.top) / (scale || 1),
      }));
      return {
        // Fractional heights: integer offsetHeight drifts by up to 0.5px
        // per block, which adds up to lines overflowing the bottom margin.
        height: rect.height / (scale || 1),
        breakBefore: i > 0 && isPageBreak(blocks[i - 1]!),
        sectionStart: sectionStart[i],
        keepTogether: kind === "lines" ? 2 : 1,
        getBreaks: kind
          ? () => {
              if (!breaksCache.has(i)) breaksCache.set(i, measureBreaks(el, kind, scale || 1));
              return breaksCache.get(i)!;
            }
          : undefined,
        footnotes: footnotes.length > 0 ? footnotes : undefined,
      };
    });
    const lastBlock = blocks[blocks.length - 1];
    const trailingBreak = !!lastBlock && (isPageBreak(lastBlock) || !!lastLayout);

    // Footnote space ↔ pagination: iterate until each page's notes settle.
    let reserves = new Map<number, number>();
    let result = paginate(metrics, {
      sections,
      gap,
      trailingBreak,
      trailingSection: lastLayout ? sections.length - 1 : undefined,
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      const next = new Map<number, number>();
      result.pages.forEach((p, i) => {
        if (p.footnoteIds.length > 0) {
          next.set(i, measureFootnotes(p.footnoteIds, p.pageWidth - p.marginLeft - p.marginRight));
        }
      });
      if (sameReserves(next, reserves)) break;
      reserves = next;
      result = paginate(metrics, {
        sections,
        gap,
        trailingBreak,
        trailingSection: lastLayout ? sections.length - 1 : undefined,
        reserve: (p) => reserves.get(p) ?? 0,
      });
    }
    surface.classList.remove(MEASURING_CLASS);
    pushStyle.media = "";

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
    if (pushStyle.textContent !== css) pushStyle.textContent = css;

    // Footnote numbers follow document order.
    const order: string[] = [];
    surface.querySelectorAll<HTMLElement>(".codex-editor__redactor .tp-fn-ref[data-fn-id]").forEach((ref) => {
      const fid = ref.dataset.fnId!;
      if (!order.includes(fid)) order.push(fid);
      const label = String(order.indexOf(fid) + 1);
      if (ref.textContent !== label) ref.textContent = label;
    });
    setFootnoteOrder((prev) => (prev.join() === order.join() ? prev : order));
    setColumnWidth((prev) => (prev === width ? prev : width));

    // ── Page views, outline ──────────────────────────────────────────────
    const views: PageView[] = result.pages.map((p, i) => ({
      ...p,
      left: sheetLeft(p),
      footnoteHeight: reserves.get(i) ?? 0,
      blockIds: [],
      heading: null,
      text: null,
    }));
    const outline: OutlineEntry[] = [];
    blocks.forEach((el, i) => {
      const first = result.pageOf[i] ?? 0;
      const last = first + (result.splits[i]?.length ?? 0);
      const headingEl = el.querySelector<HTMLElement>(".ce-header");
      const heading = headingEl?.textContent?.trim();
      const text = el.querySelector(".ce-paragraph, .cdx-list, table")?.textContent?.trim();
      if (heading && el.dataset.id) {
        outline.push({ blockId: el.dataset.id, text: heading, level: Number(headingEl!.dataset.level) || 1, page: first + 1 });
      }
      for (let p = first; p <= last; p++) {
        const page = views[p];
        if (!page) continue;
        if (el.dataset.id) page.blockIds.push(el.dataset.id);
        if (!page.heading && heading) page.heading = heading.slice(0, 80);
        // Pages a split block continues onto show it as a continuation.
        if (!page.text && text) page.text = (p > first ? "…" : "") + text.slice(0, 160);
      }
    });
    publishOutline(outline);

    // Only re-render the pages when something they show changed.
    const key = JSON.stringify(
      views.map((v) => [v.top, v.pageWidth, v.pageHeight, v.left, v.section, v.pageInSection, v.footnoteIds, v.footnoteHeight, v.heading, v.text, v.blockIds.length]),
    );
    if (key !== pagesKeyRef.current) {
      pagesKeyRef.current = key;
      setPages(views);
    }
  }, [surfaceRef]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(run);
  }, [run]);

  const layoutKey = JSON.stringify(options.defaultLayout);
  useEffect(() => {
    schedule();
  }, [layoutKey, options.gap, schedule]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const makeStyle = (name: string) => {
      const style = document.createElement("style");
      style.dataset.tpPagination = name;
      document.head.appendChild(style);
      return style;
    };
    pushStyleRef.current = makeStyle("push");
    layoutStyleRef.current = makeStyle("layout");

    const resize = new ResizeObserver(schedule);
    resizeRef.current = resize;
    // Blocks added/removed — the redactor may not resize if a block of the
    // same height replaced another, so watch the child list too (ignoring
    // our own split floats and generated numbers).
    const mutations = new MutationObserver((records) => {
      if (records.some((r) => !isOwnMutation(r))) schedule();
    });
    mutations.observe(surface, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      resizeRef.current = null;
      observedRef.current = null;
      mutations.disconnect();
      pushStyleRef.current?.remove();
      layoutStyleRef.current?.remove();
      pushStyleRef.current = null;
      layoutStyleRef.current = null;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [surfaceRef, schedule]);

  return { pages, pageCount: Math.max(pages.length, 1), columnWidth, footnoteOrder, schedule };
}

function sameReserves(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (Math.abs((b.get(k) ?? -1) - v) > 0.5) return false;
  return true;
}

function isPageBreak(block: HTMLElement): boolean {
  return block.querySelector(".tp-page-break") !== null;
}

/** Layout carried by a section-break block (for the section after it). */
function sectionBreakLayout(block: HTMLElement): Partial<PageLayout> | null {
  const el = block.querySelector<HTMLElement>(".tp-section-break[data-layout]");
  if (!el) return null;
  try {
    return JSON.parse(el.dataset.layout!) as Partial<PageLayout>;
  } catch {
    return {};
  }
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
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  if (target?.closest(GENERATED)) return true;
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return (
    nodes.length > 0 &&
    nodes.every((n) => n instanceof HTMLElement && n.classList.contains(SPLIT_CLASS))
  );
}

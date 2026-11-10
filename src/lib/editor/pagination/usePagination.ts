import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { paginate, type PageGeometry } from "./paginate";

export interface PageSummary {
  /** Block ids starting on this page. */
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

/**
 * Lays the single editor's blocks out on pages: measures each block,
 * runs `paginate`, and pushes blocks that don't fit down to the next
 * sheet by setting their top margin.
 *
 * Runs on every layout-relevant change: the redactor resizing (typing,
 * images loading, fonts arriving), geometry changes, and explicit
 * `schedule()` calls from the editor's onChange.
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

  const run = useCallback(() => {
    frameRef.current = null;
    const surface = surfaceRef.current;
    if (!surface) return;

    // The redactor is created by EditorJS after init; it grows with the
    // content, so it's the element whose size tells us to re-paginate.
    const redactor = surface.querySelector(".codex-editor__redactor");
    if (redactor && redactor !== observedRef.current && resizeRef.current) {
      if (observedRef.current) resizeRef.current.unobserve(observedRef.current);
      resizeRef.current.observe(redactor);
      observedRef.current = redactor;
    }

    const blocks = Array.from(surface.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));

    // Border-box heights exclude margins, so our own pushes don't feed
    // back into the measurement. Use the fractional rect height — integer
    // offsetHeight drifts by up to 0.5px per block, which adds up to a line
    // overflowing the bottom margin — and undo the zoom transform.
    const scale = surface.offsetWidth
      ? surface.getBoundingClientRect().width / surface.offsetWidth
      : 1;
    const metrics = blocks.map((el, i) => ({
      height: el.getBoundingClientRect().height / (scale || 1),
      breakBefore: i > 0 && isPageBreak(blocks[i - 1]!),
    }));
    const trailingBreak = blocks.length > 0 && isPageBreak(blocks[blocks.length - 1]!);
    const result = paginate(metrics, geometryRef.current, trailingBreak);

    blocks.forEach((el, i) => {
      const push = result.pushes[i] ?? 0;
      const next = push > 0 ? `${push}px` : "";
      if (el.style.marginTop !== next) el.style.marginTop = next;
    });

    setPageCount((prev) => (prev === result.pageCount ? prev : result.pageCount));

    const summaries: PageSummary[] = Array.from({ length: result.pageCount }, () => ({
      blockIds: [],
      heading: null,
      text: null,
    }));
    blocks.forEach((el, i) => {
      const page = summaries[result.pageOf[i] ?? 0];
      if (!page) return;
      if (el.dataset.id) page.blockIds.push(el.dataset.id);
      if (!page.heading) {
        const h = el.querySelector(".ce-header")?.textContent?.trim();
        if (h) page.heading = h.slice(0, 80);
      }
      if (!page.text) {
        const p = el.querySelector(".ce-paragraph, .cdx-list")?.textContent?.trim();
        if (p) page.text = p.slice(0, 160);
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
    const resize = new ResizeObserver(schedule);
    resizeRef.current = resize;
    // Blocks added/removed — the redactor may not resize if a block of the
    // same height replaced another, so watch the child list too.
    const mutations = new MutationObserver(schedule);
    mutations.observe(surface, { childList: true, subtree: true });
    return () => {
      resize.disconnect();
      resizeRef.current = null;
      observedRef.current = null;
      mutations.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [surfaceRef, schedule]);

  return { pageCount, pages, schedule };
}

function isPageBreak(block: HTMLElement): boolean {
  return block.querySelector(".tp-page-break") !== null;
}

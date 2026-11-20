/**
 * Paints comment anchors with the CSS Custom Highlight API (no DOM writes
 * into blocks), tracks where each anchor sits vertically for the comments
 * panel, and maps clicks on highlighted text back to threads.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentAnchor, CommentThread } from "~/lib/api/collab";
import { locateAnchor } from "./anchor";

export const HL_COMMENT = "tp-comment";
export const HL_COMMENT_ACTIVE = "tp-comment-active";
/** Key used in `positions` for the not-yet-posted draft anchor. */
export const DRAFT_KEY = "__draft__";

export function highlightsSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    !!CSS.highlights &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === "function"
  );
}

export interface CommentHighlightOptions {
  /** Scroll container of the document column (`.doc-scroll`); positions
   *  are measured in its content coordinates. Defaults to the page. */
  scrollContainer?: HTMLElement | null;
  /** Click on highlighted text → its thread id; elsewhere in the
   *  document → null. */
  onActivate?(threadId: string | null): void;
  /** Anchor of a comment being written (painted as active). */
  draftAnchor?: CommentAnchor | null;
  /** Also paint resolved threads (normally only open ones). */
  showResolved?: boolean;
  debounceMs?: number;
}

export interface CommentHighlights {
  /** Anchor top per thread id (and `DRAFT_KEY`), px in scroll-content
   *  coordinates. */
  positions: Map<string, number>;
  /** Threads whose text is gone. */
  orphaned: string[];
  /** Located threads in document order. */
  order: string[];
  /** Live ranges by thread id (valid until the next recompute). */
  ranges: Map<string, Range>;
  /** Threads whose highlighted text covers a viewport point, shortest first. */
  threadsAt(x: number, y: number): string[];
  /** Recompute now. */
  refresh(): void;
}

interface Computed {
  positions: Map<string, number>;
  orphaned: string[];
  order: string[];
  ranges: Map<string, Range>;
}

const EMPTY: Computed = { positions: new Map(), orphaned: [], order: [], ranges: new Map() };

function rectOf(range: Range): DOMRect | null {
  if (typeof range.getClientRects === "function") {
    const rects = range.getClientRects();
    if (rects && rects.length) return rects[0];
  }
  if (typeof range.getBoundingClientRect === "function") return range.getBoundingClientRect();
  return null;
}

function compareRanges(a: Range, b: Range): number {
  try {
    return a.compareBoundaryPoints(Range.START_TO_START, b);
  } catch {
    return 0;
  }
}

function signature(c: Computed): string {
  return [
    [...c.positions].map(([k, v]) => `${k}:${Math.round(v)}`).join(","),
    c.orphaned.join(","),
    c.order.join(","),
  ].join("|");
}

export function useCommentHighlights(
  root: HTMLElement | null,
  threads: readonly CommentThread[] | undefined,
  activeThreadId: string | null,
  version: number,
  options: CommentHighlightOptions = {},
): CommentHighlights {
  const { scrollContainer = null, draftAnchor = null, showResolved = false, debounceMs = 200 } = options;
  const [computed, setComputed] = useState<Computed>(EMPTY);
  const computedRef = useRef<Computed>(EMPTY);
  const sigRef = useRef("");
  const onActivateRef = useRef(options.onActivate);
  onActivateRef.current = options.onActivate;

  const inputs = useRef({ root, threads, activeThreadId, scrollContainer, draftAnchor, showResolved });
  inputs.current = { root, threads, activeThreadId, scrollContainer, draftAnchor, showResolved };

  const compute = useCallback(() => {
    const { root, threads, activeThreadId, scrollContainer, draftAnchor, showResolved } = inputs.current;
    const ranges = new Map<string, Range>();
    const orphaned: string[] = [];
    if (root && root.isConnected) {
      for (const t of threads ?? []) {
        const r = locateAnchor(root, t.anchor);
        if (r) ranges.set(t.id, r);
        else orphaned.push(t.id);
      }
      if (draftAnchor) {
        const r = locateAnchor(root, draftAnchor);
        if (r) ranges.set(DRAFT_KEY, r);
      }
    }

    const order = [...ranges.keys()].filter((k) => k !== DRAFT_KEY);
    order.sort((a, b) => compareRanges(ranges.get(a)!, ranges.get(b)!));

    const positions = new Map<string, number>();
    const base = scrollContainer
      ? scrollContainer.getBoundingClientRect().top - scrollContainer.scrollTop
      : -(root?.ownerDocument.defaultView?.scrollY ?? 0);
    for (const [id, r] of ranges) {
      const rect = rectOf(r);
      if (rect) positions.set(id, rect.top - base);
    }

    // Paint.
    if (highlightsSupported()) {
      const byId = new Map((threads ?? []).map((t) => [t.id, t]));
      const normal: Range[] = [];
      const active: Range[] = [];
      for (const [id, r] of ranges) {
        if (id === DRAFT_KEY || id === activeThreadId) active.push(r);
        else if (showResolved || !byId.get(id)?.resolved) normal.push(r);
      }
      const H = (globalThis as unknown as { Highlight: new (...r: Range[]) => Highlight }).Highlight;
      if (normal.length) CSS.highlights.set(HL_COMMENT, new H(...normal));
      else CSS.highlights.delete(HL_COMMENT);
      if (active.length) {
        const h = new H(...active);
        h.priority = 1;
        CSS.highlights.set(HL_COMMENT_ACTIVE, h);
      } else CSS.highlights.delete(HL_COMMENT_ACTIVE);
    }

    const next: Computed = { positions, orphaned, order, ranges };
    computedRef.current = next;
    const sig = signature(next);
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setComputed(next);
    }
  }, []);

  // Immediate recompute when the thread set / selection / draft changes.
  useEffect(() => {
    compute();
  }, [compute, root, threads, activeThreadId, draftAnchor, showResolved, scrollContainer]);

  // Debounced recompute after document edits and layout changes.
  const timer = useRef<number | undefined>(undefined);
  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(compute, debounceMs);
  }, [compute, debounceMs]);

  useEffect(() => {
    schedule();
  }, [version, schedule]);

  useEffect(() => {
    if (!root) return;
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => schedule()) : null;
    ro?.observe(root);
    window.addEventListener("resize", schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
      window.clearTimeout(timer.current);
    };
  }, [root, schedule]);

  // Clear paint on unmount.
  useEffect(
    () => () => {
      if (highlightsSupported()) {
        CSS.highlights.delete(HL_COMMENT);
        CSS.highlights.delete(HL_COMMENT_ACTIVE);
      }
    },
    [],
  );

  const threadsAt = useCallback((x: number, y: number): string[] => {
    const hits: Array<{ id: string; len: number }> = [];
    for (const [id, r] of computedRef.current.ranges) {
      if (id === DRAFT_KEY || typeof r.getClientRects !== "function") continue;
      const rects = Array.from(r.getClientRects());
      if (rects.some((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1)) {
        hits.push({ id, len: r.toString().length });
      }
    }
    hits.sort((a, b) => a.len - b.len);
    return hits.map((h) => h.id);
  }, []);

  // Click on highlighted text activates its thread.
  useEffect(() => {
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const cb = onActivateRef.current;
      if (!cb || e.button !== 0) return;
      const sel = root.ownerDocument.getSelection();
      if (sel && !sel.isCollapsed) return; // finishing a drag-selection
      const { threads, showResolved } = inputs.current;
      const visible = new Set(
        (threads ?? []).filter((t) => showResolved || !t.resolved).map((t) => t.id),
      );
      const id = threadsAt(e.clientX, e.clientY).find((t) => visible.has(t)) ?? null;
      cb(id);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [root, threadsAt]);

  return {
    positions: computed.positions,
    orphaned: computed.orphaned,
    order: computed.order,
    ranges: computedRef.current.ranges,
    threadsAt,
    refresh: compute,
  };
}

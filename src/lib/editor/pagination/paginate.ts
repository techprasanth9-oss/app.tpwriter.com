/**
 * Pure page-layout pass. Given each block's rendered height, decide which
 * page it lands on and how far it must be pushed down to start there.
 *
 * Coordinates are px from the top of the first sheet. Sheet i spans
 * [i * (pageHeight + gap), i * (pageHeight + gap) + pageHeight]; its writable
 * area is inset by the top/bottom margins.
 *
 * Breaks happen at block boundaries. A block taller than a page's writable
 * area starts at the top of a page and spills over; splitting long
 * paragraphs/tables across pages comes later.
 */

export interface PageGeometry {
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  /** Visual gap between sheets. */
  gap: number;
}

export interface BlockMetrics {
  height: number;
  /** Start this block on a new page (it follows a page break). */
  breakBefore?: boolean;
}

export interface PaginationResult {
  /** Extra top margin to apply to each block. */
  pushes: number[];
  /** Page index (0-based) each block starts on. */
  pageOf: number[];
  pageCount: number;
}

const EPSILON = 0.5;

export function paginate(
  blocks: BlockMetrics[],
  geo: PageGeometry,
  /** Force an empty trailing page (the document ends with a page break). */
  trailingBreak = false,
): PaginationResult {
  const stride = geo.pageHeight + geo.gap;
  const top = (p: number) => p * stride + geo.marginTop;
  const bottom = (p: number) => p * stride + geo.pageHeight - geo.marginBottom;

  const pushes: number[] = [];
  const pageOf: number[] = [];
  let page = 0;
  let y = top(0);
  let pageHasContent = false;

  for (const block of blocks) {
    let push = 0;
    if (block.breakBefore && pageHasContent) {
      page += 1;
      pageHasContent = false;
    }
    if (y < top(page)) {
      push += top(page) - y;
      y = top(page);
    }
    // Doesn't fit in what's left of this page → next page. A block already
    // at the top of a page stays put even if it's too tall.
    if (y + block.height > bottom(page) + EPSILON && y > top(page) + EPSILON) {
      page += 1;
      push += top(page) - y;
      y = top(page);
    }

    pushes.push(push);
    pageOf.push(page);
    pageHasContent = true;
    y += block.height;

    // A too-tall block ends on a later page (or in the gap after one).
    while (y > bottom(page) + EPSILON) {
      page += 1;
      pageHasContent = y > top(page);
    }
  }

  // A spill that stopped in the gap doesn't put anything on the next page.
  const lastPage = pageHasContent ? page : Math.max(page - 1, pageOf[pageOf.length - 1] ?? 0);
  const pageCount = lastPage + 1 + (trailingBreak ? 1 : 0);
  return { pushes, pageOf, pageCount };
}

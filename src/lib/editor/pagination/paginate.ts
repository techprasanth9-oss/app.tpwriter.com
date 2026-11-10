/**
 * Pure page-layout pass. Given each block's rendered height, decide which
 * page it lands on, how far it must be pushed down to start there, and —
 * for splittable blocks (paragraphs, lists, tables) — where to break it
 * across pages and how much space to open at each break.
 *
 * Coordinates are px from the top of the first sheet. Sheet i spans
 * [i * (pageHeight + gap), i * (pageHeight + gap) + pageHeight]; its writable
 * area is inset by the top/bottom margins.
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
  /**
   * Offsets (px from the block's top, ascending) where the block may be
   * split — the boundaries between lines or table rows. Called only when
   * the block doesn't fit, so measuring can be lazy.
   */
  getBreaks?: () => number[];
  /** Minimum lines/rows kept together on each side of a split (widow /
   *  orphan control). Defaults to 1. */
  keepTogether?: number;
}

export interface Split {
  /** Offset within the block's unsplit layout where the break goes. */
  at: number;
  /** Index into the block's breaks (break i sits before line/row i + 1). */
  index: number;
  /** Space to open at the break so what follows starts on the next page. */
  gap: number;
}

export interface PaginationResult {
  /** Extra top margin to apply to each block. */
  pushes: number[];
  /** Splits per block (empty for blocks that fit on one page). */
  splits: Split[][];
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
  const splits: Split[][] = [];
  const pageOf: number[] = [];
  let page = 0;
  let y = top(0);
  let pageHasContent = false;

  for (const block of blocks) {
    let push = 0;
    const blockSplits: Split[] = [];

    if (block.breakBefore && pageHasContent) {
      page += 1;
      pageHasContent = false;
    }
    if (y < top(page)) {
      push += top(page) - y;
      y = top(page);
    }

    let breaks: number[] | null = null;
    const loadBreaks = () => (breaks ??= block.getBreaks?.() ?? []);
    let consumed = 0; // how much of the block's own height is already placed
    let startPage = page;

    while (y + (block.height - consumed) > bottom(page) + EPSILON) {
      const atTop = y <= top(page) + EPSILON;
      const choice = chooseBreak(
        loadBreaks(),
        consumed,
        bottom(page) - y,
        block.keepTogether ?? 1,
        blockSplits,
        // Moving the block on can't help at a page top, and a block that's
        // already split must keep going: take any break that fits.
        atTop || blockSplits.length > 0,
      );

      if (choice === null) {
        if (!atTop && blockSplits.length === 0) {
          // Nothing fits here: move the whole block to the next page.
          page += 1;
          push += top(page) - y;
          y = top(page);
          startPage = page;
          continue;
        }
        // At the top of a page and still no usable break (one line or row
        // taller than a page): let it spill.
        break;
      }

      const gap = top(page + 1) - (y + (choice.at - consumed));
      blockSplits.push({ at: choice.at, index: choice.index, gap });
      consumed = choice.at;
      page += 1;
      y = top(page);
    }

    pushes.push(push);
    splits.push(blockSplits);
    pageOf.push(startPage);
    pageHasContent = true;
    y += block.height - consumed;

    // A spilling block ends on a later page (or in the gap after one).
    while (y > bottom(page) + EPSILON) {
      page += 1;
      pageHasContent = y > top(page);
    }
  }

  // A spill that stopped in the gap doesn't put anything on the next page.
  const lastPage = pageHasContent ? page : Math.max(page - 1, pageOf[pageOf.length - 1] ?? 0);
  const pageCount = lastPage + 1 + (trailingBreak ? 1 : 0);
  return { pushes, splits, pageOf, pageCount };
}

/**
 * The latest break that fits in `room` px past `consumed`, keeping at
 * least `keep` lines on each side (widow / orphan control). With `relax`,
 * falls back to a single line when the strict rule finds nothing.
 */
function chooseBreak(
  breaks: number[],
  consumed: number,
  room: number,
  keep: number,
  done: Split[],
  relax: boolean,
): { at: number; index: number } | null {
  const firstLine = done.length > 0 ? done[done.length - 1]!.index + 1 : 0;
  const totalLines = breaks.length + 1;
  const attempts = keep > 1 && relax ? [keep, 1] : [keep];
  for (const k of attempts) {
    for (let i = breaks.length - 1; i >= 0; i--) {
      const at = breaks[i]!;
      if (at <= consumed + EPSILON || at - consumed > room + EPSILON) continue;
      const linesAbove = i + 1 - firstLine;
      const linesBelow = totalLines - (i + 1);
      if (linesAbove >= k && linesBelow >= k) return { at, index: i };
    }
  }
  return null;
}

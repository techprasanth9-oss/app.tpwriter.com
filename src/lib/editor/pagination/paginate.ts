/**
 * Pure page-layout pass. Given each block's rendered height, decide which
 * page it lands on, how far it must be pushed down to start there, and —
 * for splittable blocks (paragraphs, lists, tables) — where to break it
 * across pages and how much space to open at each break.
 *
 * Pages are stacked vertically with `gap` between them and may differ in
 * size: a section break starts a new page in the next section's geometry
 * (paper size, orientation, margins). Coordinates are px from the top of
 * the first page.
 *
 * Footnotes: blocks report where their footnote references sit; the page
 * each reference lands on collects its id, and `reserve(page)` shrinks that
 * page's writable area so the notes fit above the bottom margin. The
 * caller measures the notes and re-runs with the new reserves until the
 * assignment is stable.
 */

export interface SectionGeometry {
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

/** Kept for callers that paginate a single uniform section. */
export interface PageGeometry {
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  gap: number;
}

export interface BlockMetrics {
  height: number;
  /** Start this block on a new page (it follows a page break). */
  breakBefore?: boolean;
  /** This block starts section N (it follows a section break): new page
   *  in that section's geometry. */
  sectionStart?: number;
  /**
   * Offsets (px from the block's top, ascending) where the block may be
   * split — the boundaries between lines or table rows. Called only when
   * the block doesn't fit, so measuring can be lazy.
   */
  getBreaks?: () => number[];
  /** Minimum lines/rows kept together on each side of a split (widow /
   *  orphan control). Defaults to 1. */
  keepTogether?: number;
  /** Footnote references in the block: id and offset from the block top. */
  footnotes?: Array<{ id: string; at: number }>;
}

export interface Split {
  /** Offset within the block's unsplit layout where the break goes. */
  at: number;
  /** Index into the block's breaks (break i sits before line/row i + 1). */
  index: number;
  /** Space to open at the break so what follows starts on the next page. */
  gap: number;
}

export interface PageBox extends SectionGeometry {
  /** px from the top of the first page. */
  top: number;
  section: number;
  /** 0-based page index within its section. */
  pageInSection: number;
  /** Footnote ids referenced on this page, in order. */
  footnoteIds: string[];
}

export interface PaginationResult {
  /** Extra top margin to apply to each block. */
  pushes: number[];
  /** Splits per block (empty for blocks that fit on one page). */
  splits: Split[][];
  /** Page index (0-based) each block starts on. */
  pageOf: number[];
  /** Section each block belongs to. */
  sectionOf: number[];
  pages: PageBox[];
  pageCount: number;
}

export interface PaginateOptions {
  /** Section geometries; section 0 is the document default. */
  sections: SectionGeometry[];
  gap: number;
  /** Force an empty trailing page (the document ends with a break). */
  trailingBreak?: boolean;
  /** Section of that trailing page (a trailing section break). */
  trailingSection?: number;
  /** Space reserved for footnotes at the bottom of each page. */
  reserve?: (page: number) => number;
}

const EPSILON = 0.5;

export function paginate(
  blocks: BlockMetrics[],
  geoOrOptions: PageGeometry | PaginateOptions,
  trailingBreakArg = false,
): PaginationResult {
  const opts: PaginateOptions =
    "sections" in geoOrOptions
      ? geoOrOptions
      : {
          sections: [
            {
              pageWidth: 0,
              pageHeight: geoOrOptions.pageHeight,
              marginTop: geoOrOptions.marginTop,
              marginBottom: geoOrOptions.marginBottom,
              marginLeft: 0,
              marginRight: 0,
            },
          ],
          gap: geoOrOptions.gap,
          trailingBreak: trailingBreakArg,
        };
  const reserve = opts.reserve ?? (() => 0);
  const geometry = (section: number) => opts.sections[section] ?? opts.sections[0]!;

  const pages: PageBox[] = [];
  const addPage = (section: number): number => {
    const prev = pages[pages.length - 1];
    const sameSection = prev && prev.section === section;
    pages.push({
      ...geometry(section),
      top: prev ? prev.top + prev.pageHeight + opts.gap : 0,
      section,
      pageInSection: sameSection ? prev.pageInSection + 1 : 0,
      footnoteIds: [],
    });
    return pages.length - 1;
  };
  /** The page after `p`, created in the same section if needed. */
  const nextPage = (p: number) => (p + 1 < pages.length ? p + 1 : addPage(pages[p]!.section));
  const top = (p: number) => pages[p]!.top + pages[p]!.marginTop;
  const bottom = (p: number) =>
    pages[p]!.top + pages[p]!.pageHeight - pages[p]!.marginBottom - reserve(p);

  const pushes: number[] = [];
  const splits: Split[][] = [];
  const pageOf: number[] = [];
  const sectionOf: number[] = [];
  let page = addPage(0);
  let section = 0;
  let y = top(page);
  let pageHasContent = false;
  let lastPiecePage = 0;

  for (const block of blocks) {
    let push = 0;
    const blockSplits: Split[] = [];

    if (block.sectionStart !== undefined && block.sectionStart !== section) {
      section = block.sectionStart;
      if (pageHasContent) {
        page = addPage(section);
      } else {
        // Nothing on this page yet: it simply becomes the new section's,
        // writing from its own top margin.
        Object.assign(pages[page]!, geometry(section), { section, pageInSection: 0 });
        y = top(page);
      }
      pageHasContent = false;
    } else if (block.breakBefore && pageHasContent) {
      page = nextPage(page);
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
    const piecePages: number[] = [page];

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
          page = nextPage(page);
          push += top(page) - y;
          y = top(page);
          startPage = page;
          piecePages[0] = page;
          continue;
        }
        // At the top of a page and still no usable break (one line or row
        // taller than a page): let it spill.
        break;
      }

      const next = nextPage(page);
      const gap = top(next) - (y + (choice.at - consumed));
      blockSplits.push({ at: choice.at, index: choice.index, gap });
      consumed = choice.at;
      page = next;
      piecePages.push(page);
      y = top(page);
    }

    // Footnotes go on the page holding the piece their reference is in.
    for (const fn of block.footnotes ?? []) {
      let piece = 0;
      while (piece < blockSplits.length && fn.at >= blockSplits[piece]!.at) piece++;
      pages[piecePages[piece] ?? page]!.footnoteIds.push(fn.id);
    }

    pushes.push(push);
    splits.push(blockSplits);
    pageOf.push(startPage);
    sectionOf.push(section);
    pageHasContent = true;
    y += block.height - consumed;

    // A spilling block ends on a later page (or in the gap after one).
    while (y > bottom(page) + EPSILON) {
      page = nextPage(page);
      pageHasContent = y > top(page);
    }
    lastPiecePage = Math.max(lastPiecePage, piecePages[piecePages.length - 1] ?? page);
  }

  // A spill that stopped in the gap doesn't put anything on the next page.
  const lastUsed = pageHasContent ? page : Math.max(page - 1, lastPiecePage, 0);
  pages.length = lastUsed + 1;
  if (opts.trailingBreak) addPage(opts.trailingSection ?? section);
  return { pushes, splits, pageOf, sectionOf, pages, pageCount: pages.length };
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

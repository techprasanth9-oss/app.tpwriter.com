import type { PageLayout } from "~/lib/api/documents";

/** Paper sizes in CSS px at 96 dpi (portrait). */
export const PAPER_SIZES: Record<PageLayout["paperSize"], { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  LETTER: { w: 816, h: 1056 },
  LEGAL: { w: 816, h: 1344 },
  A3: { w: 1123, h: 1587 },
  A5: { w: 559, h: 794 },
};

export const DEFAULT_LAYOUT: PageLayout = {
  paperSize: "A4",
  orientation: "portrait",
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
};

/** Visual gap between page sheets, in px. */
export const PAGE_GAP = 28;

export function pageSize(layout: PageLayout): { width: number; height: number } {
  const base = PAPER_SIZES[layout.paperSize] ?? PAPER_SIZES.A4;
  return layout.orientation === "landscape"
    ? { width: base.h, height: base.w }
    : { width: base.w, height: base.h };
}

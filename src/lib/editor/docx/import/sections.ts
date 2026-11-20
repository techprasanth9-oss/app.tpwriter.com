/**
 * w:sectPr → page layout + header/footer references. A sectPr inside a
 * paragraph ENDS its section; the body-level sectPr is the last section.
 */

import type { PageLayout, PaperSize } from "~/lib/api/documents";
import type { HeaderFooterKind, PageBorder } from "../../pageSetup";
import { PAPER_SIZES, DEFAULT_LAYOUT } from "../../pagination/paper";
import { clamp, hexColor, twipsToPx } from "./html";
import { attr, child, childrenNamed, intAttr, kids, onOff, tag } from "./xml";

export interface SectionInfo {
  layout: PageLayout;
  /** w:type: how this section starts. */
  type: string;
  headerRefs: Partial<Record<HeaderFooterKind, string>>;
  footerRefs: Partial<Record<HeaderFooterKind, string>>;
  titlePg: boolean;
  headerDistance?: number;
  footerDistance?: number;
  pageBorder: PageBorder | null;
  /** Paper size didn't match a supported size within 2%. */
  approxPaper?: string;
  /** Text-area width in px. */
  contentWidth: number;
}

function nearestPaper(wPx: number, hPx: number): { size: PaperSize; error: number } {
  const short = Math.min(wPx, hPx);
  const long = Math.max(wPx, hPx);
  let best: PaperSize = "A4";
  let bestErr = Infinity;
  for (const [name, s] of Object.entries(PAPER_SIZES) as [PaperSize, { w: number; h: number }][]) {
    const err = Math.max(Math.abs(short - s.w) / s.w, Math.abs(long - s.h) / s.h);
    if (err < bestErr) {
      bestErr = err;
      best = name;
    }
  }
  return { size: best, error: bestErr };
}

const BORDER: Record<string, PageBorder["style"]> = {
  single: "solid",
  thick: "solid",
  double: "double",
  dashed: "dashed",
  dashSmallGap: "dashed",
  dotted: "dotted",
};

const margin = (twips: number | null, fallback: number) =>
  twips === null ? fallback : clamp(Math.round(twipsToPx(Math.abs(twips))), 0, 400);

export function parseSection(sectPr: Element | null): SectionInfo {
  const pgSz = child(sectPr, "w:pgSz");
  const pgMar = child(sectPr, "w:pgMar");
  const w = intAttr(pgSz, "w:w");
  const h = intAttr(pgSz, "w:h");
  let paperSize: PaperSize = DEFAULT_LAYOUT.paperSize;
  let orientation: PageLayout["orientation"] = "portrait";
  let approxPaper: string | undefined;
  let pageW = PAPER_SIZES.A4.w;
  if (w && h && w > 0 && h > 0) {
    const wp = twipsToPx(w);
    const hp = twipsToPx(h);
    const near = nearestPaper(wp, hp);
    paperSize = near.size;
    if (near.error > 0.02) {
      approxPaper = `${Math.round((w / 1440) * 254) / 10} × ${Math.round((h / 1440) * 254) / 10} cm`;
    }
    const orient = attr(pgSz, "w:orient");
    orientation = orient === "landscape" || (orient !== "portrait" && w > h) ? "landscape" : "portrait";
    pageW = wp;
  } else if (attr(pgSz, "w:orient") === "landscape") {
    orientation = "landscape";
    pageW = PAPER_SIZES.A4.h;
  }

  const layout: PageLayout = {
    paperSize,
    orientation,
    marginTop: margin(intAttr(pgMar, "w:top"), DEFAULT_LAYOUT.marginTop),
    marginRight: margin(intAttr(pgMar, "w:right"), DEFAULT_LAYOUT.marginRight),
    marginBottom: margin(intAttr(pgMar, "w:bottom"), DEFAULT_LAYOUT.marginBottom),
    marginLeft: margin(intAttr(pgMar, "w:left"), DEFAULT_LAYOUT.marginLeft),
  };

  const headerRefs: SectionInfo["headerRefs"] = {};
  const footerRefs: SectionInfo["footerRefs"] = {};
  for (const c of kids(sectPr)) {
    const t = tag(c);
    if (t !== "w:headerReference" && t !== "w:footerReference") continue;
    const kind = (attr(c, "w:type") ?? "default") as HeaderFooterKind;
    const id = attr(c, "r:id");
    if (!id || !["default", "first", "even"].includes(kind)) continue;
    (t === "w:headerReference" ? headerRefs : footerRefs)[kind] = id;
  }

  let pageBorder: PageBorder | null = null;
  const pgBorders = child(sectPr, "w:pgBorders");
  if (pgBorders) {
    for (const name of ["w:top", "w:left", "w:bottom", "w:right"]) {
      const b = childrenNamed(pgBorders, name)[0];
      const v = attr(b, "w:val");
      if (!b || !v || v === "nil" || v === "none") continue;
      const sz = intAttr(b, "w:sz") ?? 4;
      pageBorder = {
        style: BORDER[v] ?? "solid",
        width: clamp(Math.round(sz / 6), 1, 12),
        color: hexColor(attr(b, "w:color")) ?? "#000000",
      };
      break;
    }
  }

  const hd = intAttr(pgMar, "w:header");
  const fd = intAttr(pgMar, "w:footer");
  const titlePg = child(sectPr, "w:titlePg");
  return {
    layout,
    type: attr(child(sectPr, "w:type"), "w:val") ?? "nextPage",
    headerRefs,
    footerRefs,
    titlePg: !!titlePg && onOff(attr(titlePg, "w:val")),
    headerDistance: hd !== null ? clamp(Math.round(twipsToPx(hd)), 0, 200) : undefined,
    footerDistance: fd !== null ? clamp(Math.round(twipsToPx(fd)), 0, 200) : undefined,
    pageBorder,
    approxPaper,
    contentWidth: Math.max(100, pageW - layout.marginLeft - layout.marginRight),
  };
}

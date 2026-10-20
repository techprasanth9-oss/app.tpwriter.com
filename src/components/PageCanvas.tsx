import { forwardRef, type ReactNode } from "react";
import type { PageLayout } from "~/lib/api/documents";

/**
 * One physical page of the document. Width/height derived from the layout's
 * paperSize + orientation; margins come from the layout too. The EditorJSComponent
 * mounts inside this box. Multiple PageCanvas instances stack vertically to
 * make the document "feel like pages" (eSigns-style per-page editor model).
 */

export const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 816, h: 1123 },
  LETTER: { w: 816, h: 1056 },
  LEGAL: { w: 816, h: 1344 },
  A3: { w: 1123, h: 1588 },
  A5: { w: 559, h: 816 },
};

export const DEFAULT_LAYOUT: PageLayout = {
  paperSize: "A4",
  orientation: "portrait",
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
};

interface Props {
  layout?: PageLayout;
  children: ReactNode;
}

export const PageCanvas = forwardRef<HTMLDivElement, Props>(function PageCanvas(
  { layout = DEFAULT_LAYOUT, children },
  ref,
) {
  const base = PAPER_SIZES[layout.paperSize] ?? PAPER_SIZES["A4"]!;
  const isLandscape = layout.orientation === "landscape";
  const width = isLandscape ? base.h : base.w;
  const height = isLandscape ? base.w : base.h;

  return (
    <div
      ref={ref}
      className="page-canvas"
      style={{
        width,
        minHeight: height,
        paddingTop: layout.marginTop,
        paddingRight: layout.marginRight,
        paddingBottom: layout.marginBottom,
        paddingLeft: layout.marginLeft,
      }}
    >
      {children}
    </div>
  );
});

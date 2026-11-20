import { memo, useEffect, useMemo, useRef, type Ref } from "react";
import type { EditorBlock } from "~/lib/api/documents";
import type { PageView } from "~/lib/editor/pagination/usePagination";
import { headerFooterKind, type FieldValues, type HeaderFooterKind, type PageSetup } from "~/lib/editor/pageSetup";
import { renderBlocksHtml } from "~/lib/editor/render/staticHtml";
import { sanitizeHtml } from "~/lib/editor/sanitizeData";
import { HeaderFooterEditor, type HeaderFooterEditorHandle } from "./HeaderFooterEditor";

export type HeaderFooterArea = "header" | "footer";

export interface HeaderFooterTarget {
  area: HeaderFooterArea;
  kind: HeaderFooterKind;
  page: number;
}

/** The paper behind the text: colour, border, watermark. */
export const PageSheet = memo(function PageSheet({
  page,
  index,
  setup,
  sheetRef,
}: {
  page: PageView;
  index: number;
  setup: PageSetup;
  sheetRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={sheetRef}
      className="tp-sheet"
      data-margin-top={page.marginTop}
      data-margin-bottom={page.marginBottom + page.footnoteHeight}
      style={{
        top: page.top,
        left: page.left,
        width: page.pageWidth,
        height: page.pageHeight,
        background: setup.pageColor ?? undefined,
      }}
      aria-hidden
    >
      {setup.pageBorder && (
        <div
          className="tp-sheet-border"
          style={{ border: `${setup.pageBorder.width}px ${setup.pageBorder.style} ${setup.pageBorder.color}` }}
        />
      )}
      {setup.watermark && (
        <div className="tp-watermark" style={{ color: setup.watermark.color, opacity: setup.watermark.opacity }}>
          {setup.watermark.text}
        </div>
      )}
      <span className="tp-sheet-number">{index + 1}</span>
    </div>
  );
});

interface OverlayProps {
  page: PageView;
  index: number;
  pageCount: number;
  setup: PageSetup;
  fields: Omit<FieldValues, "page" | "pages">;
  footnoteOrder: string[];
  editing: HeaderFooterTarget | null;
  editorRef: Ref<HeaderFooterEditorHandle>;
  onEdit: (target: HeaderFooterTarget) => void;
  onHeaderFooterChange: (area: HeaderFooterArea, kind: HeaderFooterKind, blocks: EditorBlock[]) => void;
  onFootnoteChange: (id: string, html: string) => void;
  onImageUpload: (file: File) => Promise<{ url: string }>;
}

/** Interactive layer for one page: header / footer zones and footnotes. */
export function PageOverlay(props: OverlayProps) {
  const { page, index, setup } = props;
  const kind = headerFooterKind(setup, page.pageInSection, index + 1);
  const values: FieldValues = { ...props.fields, page: index + 1, pages: props.pageCount };
  const contentWidth = page.pageWidth - page.marginLeft - page.marginRight;

  const zone = (area: HeaderFooterArea) => {
    const blocks = (area === "header" ? setup.headers : setup.footers)[kind];
    const isEditing =
      props.editing?.area === area && props.editing.kind === kind && props.editing.page === index;
    const label = `${kind === "first" ? "First page " : kind === "even" ? "Even page " : ""}${area === "header" ? "Header" : "Footer"}`;
    const style =
      area === "header"
        ? { top: setup.headerDistance, minHeight: Math.max(page.marginTop - setup.headerDistance, 16) }
        : { bottom: setup.footerDistance, minHeight: Math.max(page.marginBottom - setup.footerDistance, 16) };
    return (
      <div
        className={`tp-hf tp-hf--${area}${isEditing ? " is-editing" : ""}`}
        style={{ ...style, left: page.marginLeft, width: contentWidth }}
        onDoubleClick={() => !isEditing && props.onEdit({ area, kind, page: index })}
        title={isEditing ? undefined : `Double-click to edit the ${label.toLowerCase()}`}
        data-testid={`${area}-${index}`}
      >
        {isEditing ? (
          <>
            <span className="tp-hf-tag">{label}</span>
            <HeaderFooterEditor
              ref={props.editorRef}
              blocks={blocks}
              placeholder={`Type the ${label.toLowerCase()}…`}
              onImageUpload={props.onImageUpload}
              onChange={(next) => props.onHeaderFooterChange(area, kind, next)}
            />
          </>
        ) : (
          <StaticBlocks blocks={blocks} values={values} />
        )}
      </div>
    );
  };

  return (
    <div className="tp-page-overlay" style={{ top: page.top, left: page.left, width: page.pageWidth, height: page.pageHeight }}>
      {zone("header")}
      {zone("footer")}
      {page.footnoteIds.length > 0 && (
        <div
          className="tp-footnotes"
          style={{ bottom: page.marginBottom, left: page.marginLeft, width: contentWidth, height: page.footnoteHeight }}
          aria-label={`Footnotes on page ${index + 1}`}
        >
          {page.footnoteIds.map((id) => (
            <div className="tp-fn" key={id}>
              <span className="tp-fn__num">{props.footnoteOrder.indexOf(id) + 1}</span>
              <FootnoteText id={id} html={setup.footnotes[id] ?? ""} onChange={props.onFootnoteChange} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const StaticBlocks = memo(function StaticBlocks({ blocks, values }: { blocks: EditorBlock[]; values: FieldValues }) {
  const html = useMemo(() => renderBlocksHtml(blocks, { fields: values }), [blocks, values.page, values.pages, values.date, values.title]);
  return <div className="tp-hf-static" dangerouslySetInnerHTML={{ __html: html }} />;
});

/** Editable footnote text. Uncontrolled while focused so typing isn't
 *  clobbered by re-renders. */
function FootnoteText({ id, html, onChange }: { id: string; html: string; onChange: (id: string, html: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.innerHTML = sanitizeHtml(html);
  }, [html]);
  return (
    <div
      ref={ref}
      className="tp-fn__text"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Footnote text"
      data-fn-text={id}
      onInput={(e) => onChange(id, sanitizeHtml((e.target as HTMLElement).innerHTML))}
    />
  );
}

/** Hidden element used to measure how tall a page's footnotes are. */
export function measureFootnotesIn(
  el: HTMLElement | null,
  setup: PageSetup,
  ids: string[],
  width: number,
): number {
  if (!el || ids.length === 0) return 0;
  el.style.width = `${width}px`;
  el.innerHTML = ids
    .map(
      (id, i) =>
        `<div class="tp-fn"><span class="tp-fn__num">${i + 1}</span><div class="tp-fn__text">${sanitizeHtml(setup.footnotes[id] ?? "") || "&nbsp;"}</div></div>`,
    )
    .join("");
  return Math.ceil(el.getBoundingClientRect().height);
}

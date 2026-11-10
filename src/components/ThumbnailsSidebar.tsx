import type { PageSummary } from "~/lib/editor/pagination/usePagination";

interface Props {
  pages: PageSummary[];
  activePageIndex: number;
  onSelectPage: (index: number) => void;
  onInsertPageBreak: () => void;
}

/**
 * Page navigator. Pages are computed by the paginator, so this only
 * reflects them — there's nothing to add or delete per page. "New page"
 * inserts a page break, as in a word processor.
 */
export function ThumbnailsSidebar({
  pages,
  activePageIndex,
  onSelectPage,
  onInsertPageBreak,
}: Props) {
  return (
    <aside className="thumbs-sidebar" aria-label="Pages">
      <div className="thumbs-scroll">
        {pages.map((page, index) => {
          const isActive = index === activePageIndex;
          return (
            <button
              key={index}
              type="button"
              className={`thumb${isActive ? " thumb-active" : ""}`}
              onClick={() => onSelectPage(index)}
              title={`Go to page ${index + 1}`}
              aria-current={isActive ? "page" : undefined}
            >
              <div className="thumb-paper">
                <div className="thumb-paper-inner">
                  {page.heading && <div className="thumb-h">{truncate(page.heading, 32)}</div>}
                  {page.text && <div className="thumb-p">{truncate(page.text, 90)}</div>}
                  {!page.heading && !page.text && <div className="thumb-empty">Empty page</div>}
                  <div className="thumb-lines" aria-hidden>
                    <span /><span /><span /><span /><span />
                  </div>
                </div>
              </div>
              <div className="thumb-footer">
                <span className="thumb-index">{index + 1}</span>
              </div>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="thumbs-add-btn"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onInsertPageBreak}
        title="Insert a page break after the current paragraph (⌘/Ctrl + Enter)"
      >
        + Page break
      </button>
    </aside>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

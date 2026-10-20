import type EditorJS from "@editorjs/editorjs";
import { useEffect, useState } from "react";

interface PageSummary {
  id: string;
  blockCount: number;
  firstHeading: string | null;
  firstParagraph: string | null;
}

interface Props {
  pageIds: string[];
  editors: Map<string, EditorJS>;
  activePageIndex: number;
  onSelectPage: (index: number) => void;
  onAddPage: () => void;
  onDeletePage: (index: number) => void;
  version: number;
}

export function ThumbnailsSidebar({
  pageIds,
  editors,
  activePageIndex,
  onSelectPage,
  onAddPage,
  onDeletePage,
  version,
}: Props) {
  const [summaries, setSummaries] = useState<PageSummary[]>([]);

  useEffect(() => {
    const handle = window.setTimeout(() => void refresh(), 300);
    return () => window.clearTimeout(handle);

    async function refresh() {
      const next: PageSummary[] = [];
      for (const id of pageIds) {
        const editor = editors.get(id);
        if (!editor) {
          next.push({ id, blockCount: 0, firstHeading: null, firstParagraph: null });
          continue;
        }
        try {
          await editor.isReady;
          const data = await editor.save();
          next.push(summarise(id, data.blocks));
        } catch {
          next.push({ id, blockCount: 0, firstHeading: null, firstParagraph: null });
        }
      }
      setSummaries(next);
    }
  }, [pageIds, editors, version]);

  return (
    <aside className="thumbs-sidebar" aria-label="Page thumbnails">
      <div className="thumbs-scroll">
        {pageIds.map((id, index) => {
          const summary = summaries[index];
          const isActive = index === activePageIndex;
          return (
            <button
              key={id}
              type="button"
              className={`thumb${isActive ? " thumb-active" : ""}`}
              onClick={() => onSelectPage(index)}
              title={`Go to page ${index + 1}`}
            >
              <div className="thumb-paper">
                <div className="thumb-paper-inner">
                  {summary?.firstHeading && (
                    <div className="thumb-h">{truncate(summary.firstHeading, 32)}</div>
                  )}
                  {summary?.firstParagraph && (
                    <div className="thumb-p">{truncate(summary.firstParagraph, 90)}</div>
                  )}
                  {!summary?.firstHeading && !summary?.firstParagraph && (
                    <div className="thumb-empty">Empty page</div>
                  )}
                  <div className="thumb-lines" aria-hidden>
                    <span /><span /><span /><span /><span />
                  </div>
                </div>
              </div>
              <div className="thumb-footer">
                <span className="thumb-index">{index + 1}</span>
                {pageIds.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="thumb-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete page ${index + 1}?`)) onDeletePage(index);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        if (confirm(`Delete page ${index + 1}?`)) onDeletePage(index);
                      }
                    }}
                    title="Delete page"
                  >×</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <button type="button" className="thumbs-add-btn" onClick={onAddPage}>
        + Add page
      </button>
    </aside>
  );
}

function summarise(
  id: string,
  blocks: Array<{ type: string; data?: Record<string, unknown> }>,
): PageSummary {
  let firstHeading: string | null = null;
  let firstParagraph: string | null = null;
  for (const block of blocks) {
    const text = String(block.data?.text ?? "");
    if (block.type === "header" && !firstHeading) firstHeading = stripHtml(text);
    else if (block.type === "paragraph" && !firstParagraph) firstParagraph = stripHtml(text);
    if (firstHeading && firstParagraph) break;
  }
  return { id, blockCount: blocks.length, firstHeading, firstParagraph };
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || "").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

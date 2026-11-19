import EditorJS from "@editorjs/editorjs";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type MouseEvent,
  type Ref,
} from "react";
import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import { configureBaseTools } from "~/lib/editor";
import { normalizeBlocks } from "~/lib/editor/normalize";
import type { HeaderFooterKind, PageSetup } from "~/lib/editor/pageSetup";
import { PAGE_GAP } from "~/lib/editor/pagination/paper";
import { sectionGeometry, usePagination, type PageView } from "~/lib/editor/pagination/usePagination";
import { sanitizeEditorData } from "~/lib/editor/sanitizeData";
import type { HeaderFooterEditorHandle } from "./HeaderFooterEditor";
import {
  measureFootnotesIn,
  PageOverlay,
  PageSheet,
  type HeaderFooterArea,
  type HeaderFooterTarget,
} from "./PageChrome";

interface Props {
  /** Content to load. Read once on mount — remount (change `key`) to load
   *  a different document. */
  initialBlocks: EditorBlock[];
  layout: PageLayout;
  pageSetup: PageSetup;
  /** Document title, for the title field in headers / footers. */
  title: string;
  zoom: number;
  /** Generated named-style CSS, scoped to `.tp-document`. */
  stylesCss: string;
  editingHeaderFooter: HeaderFooterTarget | null;
  headerFooterEditorRef: Ref<HeaderFooterEditorHandle>;
  onEditHeaderFooter: (target: HeaderFooterTarget | null) => void;
  onHeaderFooterChange: (area: HeaderFooterArea, kind: HeaderFooterKind, blocks: EditorBlock[]) => void;
  onFootnoteChange: (id: string, html: string) => void;
  onReady: (editor: EditorJS) => void;
  /** Every content change (typing, block add/remove/move, format). */
  onChange: () => void;
  onImageUpload: (file: File) => Promise<{ url: string }>;
  onPagesChange: (pages: PageView[]) => void;
}

export interface DocumentSurfaceHandle {
  scrollToPage: (index: number) => void;
  /** Re-run pagination (e.g. after footnote text changed). */
  relayout: () => void;
}

const PLACEHOLDER = "Start writing…";
const TODAY = new Date().toLocaleDateString();

/**
 * The document: ONE EditorJS instance for all content, with page sheets
 * drawn behind it and per-page chrome (headers, footers, footnotes) in an
 * overlay above it. The paginator pushes blocks down so each starts inside
 * a sheet's writable area — pages are computed, never stored.
 */
export const DocumentSurface = forwardRef<DocumentSurfaceHandle, Props>(function DocumentSurface(props, ref) {
  const { layout, pageSetup, zoom, stylesCss, editingHeaderFooter } = props;
  const holderRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const sheetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const editorRef = useRef<EditorJS | null>(null);

  // EditorJS lives for the component's lifetime; its callbacks read the
  // latest props through this ref instead of closing over the first ones.
  const propsRef = useRef(props);
  propsRef.current = props;
  const initialBlocksRef = useRef(props.initialBlocks);

  const measureFootnotes = useCallback(
    (ids: string[], width: number) => measureFootnotesIn(measureRef.current, propsRef.current.pageSetup, ids, width),
    [],
  );
  const options = useMemo(
    () => ({ defaultLayout: layout, gap: PAGE_GAP, measureFootnotes }),
    [layout, measureFootnotes],
  );
  const { pages: measured, columnWidth, footnoteOrder, schedule } = usePagination(flowRef, options);

  // Before the first layout pass, show one sheet in the document layout.
  const pages: PageView[] = useMemo(() => {
    if (measured.length > 0) return measured;
    const geo = sectionGeometry(layout);
    return [{ ...geo, top: 0, left: 0, section: 0, pageInSection: 0, footnoteIds: [], footnoteHeight: 0, blockIds: [], heading: null, text: null }];
  }, [measured, layout]);
  const width = Math.max(columnWidth, pages[0]!.pageWidth);
  const last = pages[pages.length - 1]!;
  const totalHeight = last.top + last.pageHeight;

  // Flow padding places section 0's text column; other sections are
  // positioned per block by the paginator.
  const base = sectionGeometry(layout);
  const sheetLeft = (width - base.pageWidth) / 2;
  const flowStyle = {
    paddingTop: base.marginTop,
    paddingLeft: sheetLeft + base.marginLeft,
    paddingRight: width - (sheetLeft + base.pageWidth - base.marginRight),
    minHeight: totalHeight,
  };

  useEffect(() => {
    propsRef.current.onPagesChange(pages);
  }, [pages]);

  // Footnote text and page decoration change layout without touching the
  // editor; re-run pagination when they do.
  useEffect(() => {
    schedule();
  }, [pageSetup.footnotes, schedule]);

  useEffect(() => {
    let cancelled = false;
    const holder = holderRef.current;
    if (!holder) return;
    // Each instance gets its own mount node: under StrictMode the effect
    // runs twice, and the discarded instance's destroy() would otherwise
    // wipe the live instance's DOM out of a shared holder.
    const mount = document.createElement("div");
    holder.appendChild(mount);

    const blocks = sanitizeEditorData(normalizeBlocks(initialBlocksRef.current));
    const editor = new EditorJS({
      holder: mount,
      // No bottom padding: the paginator owns vertical space.
      minHeight: 0,
      placeholder: blocks.length === 0 ? PLACEHOLDER : undefined,
      autofocus: blocks.length === 0,
      tools: configureBaseTools({
        imageUploader: (file: File) => propsRef.current.onImageUpload(file),
      }) as never,
      data: { time: Date.now(), blocks },
      onReady: () => {
        if (cancelled) return;
        editorRef.current = editor;
        propsRef.current.onReady(editor);
        schedule();
      },
      onChange: () => {
        if (cancelled) return;
        schedule();
        propsRef.current.onChange();
      },
    });

    return () => {
      cancelled = true;
      editorRef.current = null;
      // Hide it now — destroy() waits for init to finish, and until then
      // a discarded instance (StrictMode) would render a second copy.
      mount.style.display = "none";
      // destroy() throws if called before EditorJS finished initialising.
      editor.isReady
        .then(() => editor.destroy())
        .catch(() => undefined)
        .finally(() => mount.remove());
    };
  }, [schedule]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(index: number) {
        sheetRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
      relayout: schedule,
    }),
    [schedule],
  );

  // Clicks in the empty area below the last block focus the end of the
  // document, like clicking below the text in a word processor.
  const onFlowMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== flowRef.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    e.preventDefault();
    if (editingHeaderFooter) props.onEditHeaderFooter(null);
    editor.caret.setToLastBlock("end");
  };

  const fields = useMemo(() => ({ date: TODAY, title: props.title }), [props.title]);

  return (
    <div className="tp-zoom-box" style={{ width: width * zoom, height: totalHeight * zoom }}>
      <div
        className={`tp-document${editingHeaderFooter ? " tp-editing-hf" : ""}`}
        style={{ width, height: totalHeight, transform: zoom !== 1 ? `scale(${zoom})` : undefined }}
      >
        <style>{stylesCss}</style>
        {pages.map((page, i) => (
          <PageSheet
            key={i}
            page={page}
            index={i}
            setup={pageSetup}
            sheetRef={(el) => {
              sheetRefs.current[i] = el;
            }}
          />
        ))}
        <div
          ref={flowRef}
          className="page-canvas tp-flow"
          style={flowStyle}
          onMouseDown={onFlowMouseDown}
          onFocusCapture={() => editingHeaderFooter && props.onEditHeaderFooter(null)}
        >
          <div ref={holderRef} />
        </div>
        <div className="tp-overlay">
          {pages.map((page, i) => (
            <PageOverlay
              key={i}
              page={page}
              index={i}
              pageCount={pages.length}
              setup={pageSetup}
              fields={fields}
              footnoteOrder={footnoteOrder}
              editing={editingHeaderFooter}
              editorRef={props.headerFooterEditorRef}
              onEdit={props.onEditHeaderFooter}
              onHeaderFooterChange={props.onHeaderFooterChange}
              onFootnoteChange={props.onFootnoteChange}
              onImageUpload={props.onImageUpload}
            />
          ))}
        </div>
        <div ref={measureRef} className="tp-footnotes tp-footnotes--measure page-canvas" aria-hidden />
      </div>
    </div>
  );
});

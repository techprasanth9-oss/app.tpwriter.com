import EditorJS from "@editorjs/editorjs";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type MouseEvent,
} from "react";
import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import { configureBaseTools } from "~/lib/editor";
import { normalizeBlocks } from "~/lib/editor/normalize";
import { PAGE_GAP, pageSize } from "~/lib/editor/pagination/paper";
import { usePagination, type PageSummary } from "~/lib/editor/pagination/usePagination";
import { sanitizeEditorData } from "~/lib/editor/sanitizeData";


interface Props {
  /** Content to load. Read once on mount — remount (change `key`) to load
   *  a different document. */
  initialBlocks: EditorBlock[];
  layout: PageLayout;
  zoom: number;
  /** Generated named-style CSS, scoped to `.tp-document`. */
  stylesCss: string;
  onReady: (editor: EditorJS) => void;
  /** Every content change (typing, block add/remove/move, format). */
  onChange: () => void;
  onImageUpload: (file: File) => Promise<{ url: string }>;
  onPagesChange: (pages: PageSummary[]) => void;
}

export interface DocumentSurfaceHandle {
  scrollToPage: (index: number) => void;
}

const PLACEHOLDER = "Start writing…";

/**
 * The document: ONE EditorJS instance for all content, with page sheets
 * drawn behind it. The paginator pushes blocks down so each starts inside
 * a sheet's writable area — pages are computed, never stored.
 */
export const DocumentSurface = forwardRef<DocumentSurfaceHandle, Props>(
  function DocumentSurface(
    {
      initialBlocks,
      layout,
      zoom,
      stylesCss,
      onReady,
      onChange,
      onImageUpload,
      onPagesChange,
    },
    ref,
  ) {
    const holderRef = useRef<HTMLDivElement>(null);
    const flowRef = useRef<HTMLDivElement>(null);
    const sheetRefs = useRef<Array<HTMLDivElement | null>>([]);
    const editorRef = useRef<EditorJS | null>(null);

    // EditorJS lives for the component's lifetime; its callbacks read the
    // latest props through this ref instead of closing over the first ones.
    const propsRef = useRef({ onReady, onChange, onImageUpload, onPagesChange });
    propsRef.current = { onReady, onChange, onImageUpload, onPagesChange };
    const initialBlocksRef = useRef(initialBlocks);

    const { width, height } = pageSize(layout);
    const geometry = useMemo(
      () => ({
        pageHeight: height,
        marginTop: layout.marginTop,
        marginBottom: layout.marginBottom,
        gap: PAGE_GAP,
      }),
      [height, layout.marginTop, layout.marginBottom],
    );
    const { pageCount, pages, schedule } = usePagination(flowRef, geometry);
    const stride = height + PAGE_GAP;
    const totalHeight = pageCount * stride - PAGE_GAP;

    useEffect(() => {
      propsRef.current.onPagesChange(pages);
    }, [pages]);

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
      }),
      [],
    );

    // Clicks in the empty area below the last block focus the end of the
    // document, like clicking below the text in a word processor.
    const onFlowMouseDown = (e: MouseEvent<HTMLDivElement>) => {
      if (e.target !== flowRef.current) return;
      const editor = editorRef.current;
      if (!editor) return;
      e.preventDefault();
      editor.caret.setToLastBlock("end");
    };

    return (
      <div className="tp-zoom-box" style={{ width: width * zoom, height: totalHeight * zoom }}>
        <div
          className="tp-document"
          style={{
            width,
            height: totalHeight,
            transform: zoom !== 1 ? `scale(${zoom})` : undefined,
          }}
        >
          <style>{stylesCss}</style>
          {Array.from({ length: pageCount }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                sheetRefs.current[i] = el;
              }}
              className="tp-sheet"
              style={{ top: i * stride, height }}
              aria-hidden
            >
              <span className="tp-sheet-number">{i + 1}</span>
            </div>
          ))}
          <div
            ref={flowRef}
            className="page-canvas tp-flow"
            style={{
              paddingTop: layout.marginTop,
              paddingLeft: layout.marginLeft,
              paddingRight: layout.marginRight,
              minHeight: totalHeight,
            }}
            onMouseDown={onFlowMouseDown}
          >
            <div ref={holderRef} />
          </div>
        </div>
      </div>
    );
  },
);

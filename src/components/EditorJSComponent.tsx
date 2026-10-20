import EditorJS, { type OutputData } from "@editorjs/editorjs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { configureBaseTools } from "../lib/editor";

export interface EditorJSComponentProps {
  /** Initial content. Omit to start with an empty page. */
  data?: OutputData;
  /** Fires on every user-driven block change. Not fired during programmatic
   *  re-renders (external data refresh). Single-arg contract. */
  onChange?: (data: OutputData) => void;
  /** Which page this editor instance renders — used in the holder id
   *  (`tp-editor-${pageIndex}`), placeholder/autofocus gating, and height
   *  callbacks. */
  pageIndex: number;
  /** Pluggable image upload. Return `{ url }` of the hosted image.
   *  When omitted, ImageTool falls back to an inline base64 data URL. */
  onImageUpload?: (file: File) => Promise<{ url: string }>;
  /** Fires when the summed block heights exceed the page threshold. */
  onContentOverflow?: (data: OutputData, pageIndex: number) => void;
  /** Fires after each content change / mount with the measured content height. */
  onHeightChange?: (pageIndex: number, height: number) => void;
  /** Readonly EditorJS instance exposed to the parent so it can call
   *  `.save()` / `.render()` imperatively. */
  editorRef: MutableRefObject<EditorJS | null>;
  /** Additional EditorJS tools merged into the base tool-map. */
  additionalTools?: Record<string, unknown>;
  /** Hard page height in px — used as the overflow threshold. */
  pageHeight?: number;
  /** Renders the editor read-only. */
  isReadOnly?: boolean;
}

const DEFAULT_PAGE_HEIGHT = 1123;
const PAGE_MARGIN = 80;
// Placeholder is only shown on the first page while the doc is empty so
// subsequent appended pages don't flash a "Start writing…" row.
const PLACEHOLDER = "Start writing…";

/**
 * EditorJS wrapper component for a single page.
 *
 * Lifecycle: mount → initialize → onReady → onChange (user edits) → destroy.
 * StrictMode double-mount is guarded via `mountedRef` + `initializingRef`
 * so a cleanup from the discarded first mount doesn't race with the second
 * mount's init.
 */
export function EditorJSComponent({
  data,
  onChange,
  pageIndex,
  onImageUpload,
  onContentOverflow,
  onHeightChange,
  editorRef,
  additionalTools,
  pageHeight,
  isReadOnly,
}: EditorJSComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const localEditorRef = useRef<EditorJS | null>(null);
  const heightObserverRef = useRef<ResizeObserver | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const mountedRef = useRef(false);
  const initializingRef = useRef(false);
  const lastDataRef = useRef<string>("");
  // True while we're programmatically replaying `data` into EditorJS via
  // clear() + render(). Without this guard, the parent's onChange fires
  // once per editor instance during external renders.
  const isExternalRenderRef = useRef(false);

  const basePageHeight = pageHeight || DEFAULT_PAGE_HEIGHT;
  const holderId = `tp-editor-${pageIndex}`;

  const measureContentHeight = useCallback(async (): Promise<number> => {
    if (!containerRef.current) return basePageHeight;
    // Small tick so EditorJS has rendered the newly-added block(s) before
    // we measure them.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const editorElement = containerRef.current.querySelector(`#${holderId}`);
    if (!editorElement) return basePageHeight;

    const blocks = editorElement.querySelectorAll(".ce-block");
    let totalHeight = PAGE_MARGIN * 2;

    blocks.forEach((block) => {
      const blockElement = block as HTMLElement;
      const rect = blockElement.getBoundingClientRect();
      const styles = window.getComputedStyle(blockElement);
      const marginTop = Number.parseInt(styles.marginTop) || 0;
      const marginBottom = Number.parseInt(styles.marginBottom) || 0;
      const paddingTop = Number.parseInt(styles.paddingTop) || 0;
      const paddingBottom = Number.parseInt(styles.paddingBottom) || 0;
      totalHeight +=
        rect.height + marginTop + marginBottom + paddingTop + paddingBottom;
    });

    return Math.max(basePageHeight, totalHeight + 50);
  }, [basePageHeight, holderId]);

  const checkOverflow = useCallback(
    async (editor: EditorJS) => {
      if (!onContentOverflow) return;
      try {
        const saved = await editor.save();
        const measured = await measureContentHeight();
        if (measured > basePageHeight) {
          onContentOverflow(saved, pageIndex);
        }
      } catch (error) {
        console.warn("Error checking content overflow:", error);
      }
    },
    [basePageHeight, measureContentHeight, onContentOverflow, pageIndex],
  );

  const emitHeight = useCallback(async () => {
    if (!mountedRef.current) return;
    const next = await measureContentHeight();
    onHeightChange?.(pageIndex, next);
  }, [measureContentHeight, onHeightChange, pageIndex]);

  const setupHeightObserver = useCallback(() => {
    if (!containerRef.current || !mountedRef.current) return;

    heightObserverRef.current?.disconnect();

    heightObserverRef.current = new ResizeObserver(() => {
      setTimeout(() => {
        emitHeight();
      }, 200);
    });

    const editorElement = containerRef.current.querySelector(`#${holderId}`);
    if (editorElement) {
      heightObserverRef.current.observe(editorElement);
    }
  }, [emitHeight, holderId]);

  const cleanupEditor = useCallback(async () => {
    heightObserverRef.current?.disconnect();
    heightObserverRef.current = null;

    if (localEditorRef.current) {
      try {
        if (typeof localEditorRef.current.destroy === "function") {
          await localEditorRef.current.destroy();
        }
      } catch (error) {
        console.warn("Error destroying editor:", error);
      }
      localEditorRef.current = null;
    }

    const editorElement = containerRef.current?.querySelector(`#${holderId}`);
    if (editorElement) {
      editorElement.innerHTML = "";
    }

    if (editorRef) {
      editorRef.current = null;
    }

    setIsEditorReady(false);
    initializingRef.current = false;
  }, [editorRef, holderId]);

  const initializeEditor = useCallback(async () => {
    if (initializingRef.current || !mountedRef.current) return;

    initializingRef.current = true;

    try {
      await cleanupEditor();
      // Give the DOM a tick after cleanup before we re-create the editor,
      // otherwise EditorJS trips over its own disposed container.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!mountedRef.current) return;

      const editorElement = containerRef.current?.querySelector(`#${holderId}`);
      if (editorElement) {
        editorElement.innerHTML = "";
      }

      const hasInitialBlocks = !!data?.blocks?.length;
      const isFirstPage = pageIndex === 0;

      const editor = new EditorJS({
        holder: holderId,
        readOnly: !!isReadOnly,
        placeholder: isFirstPage && !hasInitialBlocks ? PLACEHOLDER : undefined,
        autofocus: isFirstPage && !hasInitialBlocks,
        tools: {
          ...configureBaseTools({ imageUploader: onImageUpload }),
          ...(additionalTools ?? {}),
          // TODO: tighten this once configureBaseTools exports a typed tool map.
        } as never,
        data: data || {
          time: Date.now(),
          blocks: [],
          version: "2.30.8",
        },
        onReady: () => {
          if (!mountedRef.current) return;
          setIsEditorReady(true);
          lastDataRef.current = JSON.stringify(data || {});

          setTimeout(() => {
            if (mountedRef.current) {
              setupHeightObserver();
              emitHeight();
            }
          }, 100);
        },
        onChange: async () => {
          if (!mountedRef.current) return;
          // Block-changed events that fire during a programmatic re-render
          // came from us, not the user — ignore.
          if (isExternalRenderRef.current) return;

          try {
            const content = await editor.save();
            if (!content) return;

            // Preserve the stable block ids the parent assigned so a save
            // round-trips with the same ids.
            if (data && data.blocks) {
              content.blocks = content.blocks.map((block, index) => {
                const original = data.blocks[index];
                if (original && original.id) {
                  return { ...block, id: original.id };
                }
                return block;
              });
            }
            onChange?.(content);

            setTimeout(() => {
              if (mountedRef.current) {
                emitHeight();
                void checkOverflow(editor);
              }
            }, 200);
          } catch (error) {
            console.warn("Error in onChange:", error);
          }
        },
      });

      localEditorRef.current = editor;
      editorRef.current = editor;
    } catch (error) {
      console.error("Error initializing editor:", error);
    } finally {
      initializingRef.current = false;
    }
    // Intentionally only re-initialize when pageIndex changes. The data /
    // tools / handlers are read fresh inside the init closure or updated
    // via the external-render effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  // External `data` updates: replay via clear() + render() rather than
  // tearing the whole editor down — faster, preserves focus/selection in
  // most cases, and lets the overflow / height effects re-measure once the
  // replay settles.
  useEffect(() => {
    const currentDataString = JSON.stringify(data || {});

    if (
      isEditorReady &&
      localEditorRef.current &&
      data &&
      currentDataString !== lastDataRef.current &&
      mountedRef.current
    ) {
      const renderData = async () => {
        try {
          isExternalRenderRef.current = true;
          const holder = document.getElementById(holderId);
          const lockedHeight = holder?.getBoundingClientRect().height ?? 0;
          if (holder && lockedHeight > 0) {
            holder.style.minHeight = `${lockedHeight}px`;
          }
          await localEditorRef.current?.clear();
          await localEditorRef.current?.render(data);
          lastDataRef.current = currentDataString;

          setTimeout(() => {
            isExternalRenderRef.current = false;
            if (mountedRef.current) {
              emitHeight();
            }
            if (holder) holder.style.minHeight = "";
          }, 300);
        } catch (error) {
          isExternalRenderRef.current = false;
          const holder = document.getElementById(holderId);
          if (holder) holder.style.minHeight = "";
          console.warn("Error rendering data:", error);
          initializeEditor();
        }
      };

      renderData();
    }
  }, [data, isEditorReady, emitHeight, holderId, initializeEditor]);

  useEffect(() => {
    mountedRef.current = true;
    initializeEditor();

    return () => {
      mountedRef.current = false;
      cleanupEditor();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex]);

  return (
    <div
      ref={containerRef}
      className="editor-container"
      style={{ width: "100%", minHeight: `${basePageHeight}px` }}
    >
      <div
        id={holderId}
        className="tp-editor"
        style={{ minHeight: "100px" }}
        aria-label={`Editor for page ${pageIndex + 1}`}
      />
    </div>
  );
}

export default EditorJSComponent;

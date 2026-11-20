import { useEffect, useMemo, useRef, useState } from "react";
import { useDocument } from "~/hooks/useDocuments";
import { ApiError } from "~/lib/api/client";
import type { FullDocument } from "~/lib/api/documents";
import { cleanPageSetup } from "~/lib/editor/pageSetup";
import type { PageView } from "~/lib/editor/pagination/usePagination";
import { layoutSignature, waitForPrintAssets, waitForStableLayout } from "~/lib/editor/print/printDocument";
import { buildPrintLayout } from "~/lib/editor/print/printLayout";
import { resolveStyles, stylesToCss } from "~/lib/editor/styles/namedStyles";
import type { HeaderFooterEditorHandle } from "./HeaderFooterEditor";
import { DocumentSurface } from "./DocumentSurface";
import "~/lib/editor/print/print.css";

declare global {
  interface Window {
    /** Set once the print DOM is built and its assets are loaded. */
    __TP_PRINT_READY__?: boolean;
    /** Set when the print view can't be produced ("not_found", …). */
    __TP_PRINT_ERROR__?: string;
    /** Number of page containers in the print DOM. */
    __TP_PRINT_PAGES__?: number;
  }
}

/** If the editor never becomes ready (or never settles), give up. */
const GIVE_UP_MS = 25_000;

const noop = () => undefined;
const noUpload = () => Promise.reject(new Error("read-only"));

/**
 * `/documents/:id/print` — the document rendered read-only, paginated
 * exactly as in the editor, then replaced by the print DOM (one container
 * per page). Used by the server-side PDF renderer, which waits for
 * `window.__TP_PRINT_READY__`; printing the page from a browser works too.
 */
export function PrintView({ documentId }: { documentId: string }) {
  const docQuery = useDocument(documentId);

  useEffect(() => {
    window.__TP_PRINT_READY__ = false;
    return () => {
      delete window.__TP_PRINT_READY__;
      delete window.__TP_PRINT_ERROR__;
      delete window.__TP_PRINT_PAGES__;
    };
  }, []);

  useEffect(() => {
    if (!docQuery.error) return;
    const err = docQuery.error;
    window.__TP_PRINT_ERROR__ =
      err instanceof ApiError && (err.status === 404 || err.status === 401) ? (err.status === 404 ? "not_found" : "unauthorized") : "load_failed";
  }, [docQuery.error]);

  if (docQuery.isLoading) return <div className="doc-full-loading">Preparing document…</div>;
  if (docQuery.error || !docQuery.data) return <div className="doc-full-loading">Couldn't load this document.</div>;
  return <PrintBuilder key={documentId} doc={docQuery.data} />;
}

function PrintBuilder({ doc }: { doc: FullDocument }) {
  const pageSetup = useMemo(() => cleanPageSetup(doc.pageSetup, doc.headerBlocks, doc.footerBlocks), [doc]);
  const stylesCss = useMemo(() => stylesToCss(resolveStyles(doc.styles ?? {}), ".tp-document"), [doc]);
  const hfRef = useRef<HeaderFooterEditorHandle>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<PageView[]>([]);
  const [editorReady, setEditorReady] = useState(false);
  const [built, setBuilt] = useState(false);

  useEffect(() => {
    document.title = doc.title || "Untitled document";
  }, [doc.title]);

  useEffect(() => {
    if (!editorReady) return;
    let cancelled = false;
    const docEl = () => sourceRef.current?.querySelector<HTMLElement>(".tp-document") ?? null;
    const signature = () =>
      layoutSignature(docEl()) +
      JSON.stringify(pagesRef.current.map((p) => [p.top, p.left, p.pageWidth, p.pageHeight, p.footnoteHeight]));
    const giveUp = window.setTimeout(() => {
      if (!window.__TP_PRINT_READY__) window.__TP_PRINT_ERROR__ ??= "layout_timeout";
    }, GIVE_UP_MS);

    void (async () => {
      // Fonts and images change block heights: let them load, then wait
      // for the paginator to stop moving things.
      if (sourceRef.current) await waitForPrintAssets(sourceRef.current);
      await waitForStableLayout(signature, { quietMs: 500 });
      const el = docEl();
      if (cancelled || !el || !outRef.current) return;
      const { root, pages } = buildPrintLayout(el, pagesRef.current);
      outRef.current.replaceChildren(root);
      setBuilt(true);
      await waitForPrintAssets(root);
      if (cancelled) return;
      window.clearTimeout(giveUp);
      window.__TP_PRINT_PAGES__ = pages.length;
      window.__TP_PRINT_READY__ = true;
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(giveUp);
    };
  }, [editorReady]);

  useEffect(() => {
    const giveUp = window.setTimeout(() => {
      if (!editorReady) window.__TP_PRINT_ERROR__ ??= "editor_timeout";
    }, GIVE_UP_MS);
    return () => window.clearTimeout(giveUp);
  }, [editorReady]);

  return (
    <div className="tp-print-route">
      <div ref={outRef} />
      {/* The live, read-only document the print DOM is built from; dropped
          once the print DOM exists. */}
      {!built && (
        <div ref={sourceRef} className="tp-print-source">
          <DocumentSurface
            initialBlocks={doc.blocks}
            layout={doc.defaultLayout}
            pageSetup={pageSetup}
            title={doc.title}
            zoom={1}
            stylesCss={stylesCss}
            editingHeaderFooter={null}
            headerFooterEditorRef={hfRef}
            onEditHeaderFooter={noop}
            onHeaderFooterChange={noop}
            onFootnoteChange={noop}
            onReady={() => setEditorReady(true)}
            onChange={noop}
            onImageUpload={noUpload}
            onPagesChange={(pages) => {
              pagesRef.current = pages;
            }}
            readOnly
          />
        </div>
      )}
    </div>
  );
}

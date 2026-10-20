import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type EditorJS from "@editorjs/editorjs";
import type { OutputData } from "@editorjs/editorjs";
import { exportDocx, importDocx, type EditorOutput } from "~/lib/editor";
import type {
  FullDocument,
  PageLayout,
  PageLayoutOverride,
} from "~/lib/api/documents";
import {
  useAppendPage,
  useDeletePage,
  useDocument,
  useUpdateDocument,
  useUpsertPage,
} from "~/hooks/useDocuments";
import { useAutosave } from "~/hooks/useAutosave";
import { DocumentHeader } from "./DocumentHeader";
import { EditorRibbon } from "./EditorRibbon";
import { EditorJSComponent } from "./EditorJSComponent";
import { LayoutDialog } from "./LayoutDialog";
import { PageCanvas, DEFAULT_LAYOUT } from "./PageCanvas";
import { ThumbnailsSidebar } from "./ThumbnailsSidebar";

async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: form, credentials: "include" });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const data = (await res.json()) as { url: string };
  return { url: data.url.startsWith("/uploads") ? `/api${data.url}` : data.url };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim() || "Untitled document";
  return trimmed.replace(/[\/\\:*?"<>|]+/g, "_");
}

/** Return only the keys of `next` that differ from `base`. Returns null when
 *  nothing differs — the caller stores null to mean "inherit the default". */
function diffAgainst(
  base: PageLayout,
  next: PageLayout,
): PageLayoutOverride | null {
  const out: PageLayoutOverride = {};
  for (const key of Object.keys(next) as Array<keyof PageLayout>) {
    if (next[key] !== base[key]) {
      (out as Record<string, unknown>)[key] = next[key];
    }
  }
  return Object.keys(out).length === 0 ? null : out;
}

interface PageSlot {
  /** Mongo _id from the backend. */
  id: string;
  initialData?: OutputData;
  layoutOverride: PageLayoutOverride | null;
}

interface EditorHandle {
  current: EditorJS | null;
}

interface Props {
  documentId: string;
}

export function DocumentEditor({ documentId }: Props) {
  const navigate = useNavigate();

  const docQuery = useDocument(documentId);
  const appendPageMut = useAppendPage();
  const deletePageMut = useDeletePage();
  const updateDocMut = useUpdateDocument();
  const upsertPageMut = useUpsertPage();

  const [title, setTitle] = useState("Untitled document");
  const [zoom, setZoom] = useState(1);
  const [defaultLayout, setDefaultLayout] = useState<PageLayout>(DEFAULT_LAYOUT);
  const [pages, setPages] = useState<PageSlot[]>([]);
  const [activePageIndex, setActivePageIndex] = useState(0);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);

  const editorHandlesRef = useRef<Map<string, EditorHandle>>(new Map());
  const activeEditorRef = useRef<EditorJS | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageSlotRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Hydrate from the loaded doc once per documentId change.
  useEffect(() => {
    if (!docQuery.data || hasHydrated) return;
    hydrateFromDoc(docQuery.data);
    setHasHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docQuery.data, hasHydrated]);

  useEffect(() => {
    setHasHydrated(false);
    editorHandlesRef.current.clear();
    pageSlotRefs.current.clear();
  }, [documentId]);

  function hydrateFromDoc(doc: FullDocument) {
    setTitle(doc.title);
    setDefaultLayout(doc.defaultLayout);
    setPages(
      doc.pages.map((p) => ({
        id: p.id,
        initialData: p.content as OutputData,
        layoutOverride: p.layoutOverride,
      })),
    );
    setActivePageIndex(0);
  }

  const getOrCreateHandle = useCallback((pageId: string): EditorHandle => {
    let handle = editorHandlesRef.current.get(pageId);
    if (!handle) {
      handle = { current: null };
      editorHandlesRef.current.set(pageId, handle);
    }
    return handle;
  }, []);

  const editorsForSidebar = useMemo(() => {
    const out = new Map<string, EditorJS>();
    for (const [id, handle] of editorHandlesRef.current.entries()) {
      if (handle.current) out.set(id, handle.current);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewVersion, pages]);

  const bumpPreviews = useCallback(() => setPreviewVersion((v) => v + 1), []);

  const handleChange = useCallback(
    (pageId: string) => (_data: OutputData) => {
      bumpPreviews();
      const idx = pages.findIndex((p) => p.id === pageId);
      if (idx === activePageIndex) {
        const handle = editorHandlesRef.current.get(pageId);
        if (handle?.current) activeEditorRef.current = handle.current;
      }
    },
    [activePageIndex, bumpPreviews, pages],
  );

  // When the current page overflows its height, add a new blank page.
  // Only fires for the last page so middle-pages can grow freely.
  const handleOverflow = useCallback(
    async (overflowingPageId: string) => {
      const idx = pages.findIndex((p) => p.id === overflowingPageId);
      if (idx !== pages.length - 1) return;
      try {
        const next = await appendPageMut.mutateAsync(documentId);
        hydrateFromDoc(next);
      } catch (err) {
        console.error("[appendPage] failed:", err);
      }
    },
    [appendPageMut, documentId, pages],
  );

  const handlePageFocus = useCallback(
    (pageId: string, index: number) => () => {
      setActivePageIndex(index);
      const handle = editorHandlesRef.current.get(pageId);
      if (handle?.current) activeEditorRef.current = handle.current;
    },
    [],
  );

  const addPage = useCallback(async () => {
    try {
      const next = await appendPageMut.mutateAsync(documentId);
      hydrateFromDoc(next);
    } catch (err) {
      console.error("[addPage] failed:", err);
    }
  }, [appendPageMut, documentId]);

  const deletePage = useCallback(
    async (index: number) => {
      const page = pages[index];
      if (!page || pages.length <= 1) return;
      editorHandlesRef.current.delete(page.id);
      pageSlotRefs.current.delete(page.id);
      try {
        await deletePageMut.mutateAsync({ documentId, pageId: page.id });
        const refreshed = await docQuery.refetch();
        if (refreshed.data) hydrateFromDoc(refreshed.data);
      } catch (err) {
        console.error("[deletePage] failed:", err);
      }
    },
    [deletePageMut, docQuery, documentId, pages],
  );

  const scrollToPage = useCallback(
    (index: number) => {
      const pageId = pages[index]?.id;
      if (!pageId) return;
      pageSlotRefs.current.get(pageId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [pages],
  );

  const selectPage = useCallback(
    (index: number) => {
      setActivePageIndex(index);
      scrollToPage(index);
      const pageId = pages[index]?.id;
      if (!pageId) return;
      const handle = editorHandlesRef.current.get(pageId);
      if (handle?.current) activeEditorRef.current = handle.current;
    },
    [pages, scrollToPage],
  );

  const registerPageSlotRef = useCallback(
    (pageId: string) => (el: HTMLElement | null) => {
      if (el) pageSlotRefs.current.set(pageId, el);
      else pageSlotRefs.current.delete(pageId);
    },
    [],
  );

  useEffect(() => {
    const pageId = pages[activePageIndex]?.id;
    if (!pageId) return;
    const handle = editorHandlesRef.current.get(pageId);
    activeEditorRef.current = handle?.current ?? null;
  }, [pages, activePageIndex, previewVersion]);

  // Autosave snapshot: per-page content + the document title.
  const getAutosaveSnapshot = useCallback(async () => {
    const snapshot: {
      title: string;
      pages: Array<{ pageId: string; content: EditorOutput; layoutOverride?: PageLayoutOverride | null }>;
    } = { title, pages: [] };
    for (const page of pages) {
      const editor = editorHandlesRef.current.get(page.id)?.current;
      if (!editor) continue;
      await editor.isReady;
      const data = await editor.save();
      snapshot.pages.push({
        pageId: page.id,
        content: data as EditorOutput,
        layoutOverride: page.layoutOverride,
      });
    }
    return snapshot;
  }, [pages, title]);

  const autosaveSignal = useMemo(
    () => `${previewVersion}|${title}`,
    [previewVersion, title],
  );

  const autosave = useAutosave({
    documentId,
    getSnapshot: getAutosaveSnapshot,
    changeSignal: autosaveSignal,
    enabled: hasHydrated,
  });

  const handleImportClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setBusy(true);
      try {
        const data = await importDocx(file);
        // Replace current page content with the imported document on page 1.
        // Delete all other pages first.
        for (let i = pages.length - 1; i > 0; i--) {
          const p = pages[i];
          if (p) {
            await deletePageMut.mutateAsync({ documentId, pageId: p.id });
          }
        }
        // Reload to get fresh state after deletes.
        const refreshed = await docQuery.refetch();
        if (refreshed.data) hydrateFromDoc(refreshed.data);

        // Render the imported data into the (now sole) first editor.
        const first = pages[0] ?? refreshed.data?.pages[0];
        if (first) {
          const handle = editorHandlesRef.current.get(first.id);
          const editor = handle?.current;
          if (editor) {
            await editor.isReady;
            await editor.render(data as never);
            bumpPreviews();
          }
        }
        const niceTitle = file.name.replace(/\.docx$/i, "");
        if (niceTitle) setTitle(niceTitle);
      } catch (err) {
        console.error("[importDocx] failed:", err);
        alert(`Couldn't import that DOCX.\n\n${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [bumpPreviews, deletePageMut, docQuery, documentId, pages],
  );

  const handleExportClick = useCallback(async () => {
    setBusy(true);
    try {
      const concat: EditorOutput["blocks"] = [];
      for (const page of pages) {
        const editor = editorHandlesRef.current.get(page.id)?.current;
        if (!editor) continue;
        await editor.isReady;
        const data = await editor.save();
        concat.push(...(data.blocks as EditorOutput["blocks"]));
      }
      const blob = await exportDocx(
        { time: Date.now(), blocks: concat, version: "2.30.7" },
        { title },
      );
      triggerDownload(blob, `${sanitizeFilename(title)}.docx`);
    } catch (err) {
      console.error("[exportDocx] failed:", err);
      alert(`Couldn't export.\n\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [pages, title]);

  const handleLayoutApply = useCallback(
    async (scope: "default" | "page", nextLayout: PageLayout) => {
      if (scope === "default") {
        // Document-wide default — every page inherits unless overridden.
        const updated = await updateDocMut.mutateAsync({
          id: documentId,
          patch: { defaultLayout: nextLayout },
        });
        hydrateFromDoc(updated);
        return;
      }
      // Per-page override: store only the keys that differ from the default
      // so the inherited "pure" relationship stays clean. If the override
      // matches the default exactly, we clear it to null.
      const active = pages[activePageIndex];
      if (!active) return;
      const editor = editorHandlesRef.current.get(active.id)?.current;
      const content =
        editor && (await editor.save().catch(() => ({ blocks: [] })));
      const diff = diffAgainst(defaultLayout, nextLayout);
      await upsertPageMut.mutateAsync({
        documentId,
        pageId: active.id,
        content: (content ?? { blocks: [] }) as EditorOutput,
        layoutOverride: diff,
      });
      // Reflect the override locally without a full refetch to avoid
      // thrashing every page's editor.
      setPages((prev) =>
        prev.map((p, i) =>
          i === activePageIndex ? { ...p, layoutOverride: diff } : p,
        ),
      );
    },
    [
      activePageIndex,
      defaultLayout,
      documentId,
      pages,
      updateDocMut,
      upsertPageMut,
    ],
  );

  if (docQuery.isLoading) {
    return <div className="doc-full-loading">Loading document…</div>;
  }
  if (docQuery.error) {
    return (
      <div className="doc-full-loading">
        Couldn't load this document.{" "}
        <button type="button" onClick={() => navigate({ to: "/" })} className="doc-btn">
          Back to list
        </button>
      </div>
    );
  }

  return (
    <div className="doc-root">
      <DocumentHeader
        title={title}
        onTitleChange={setTitle}
        pageCount={pages.length}
        zoom={zoom}
        onZoomChange={setZoom}
        onImportClick={handleImportClick}
        onExportClick={handleExportClick}
        onSaveClick={() => void autosave.saveNow()}
        onBackClick={() => navigate({ to: "/" })}
        onLayoutClick={() => setLayoutDialogOpen(true)}
        layout={defaultLayout}
        autosaveStatus={autosave.status}
        lastSavedAt={autosave.lastSavedAt}
        busy={busy}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />

      <EditorRibbon activeEditorRef={activeEditorRef} />

      <div className="doc-body">
        <ThumbnailsSidebar
          pageIds={pages.map((p) => p.id)}
          editors={editorsForSidebar}
          activePageIndex={activePageIndex}
          onSelectPage={selectPage}
          onAddPage={addPage}
          onDeletePage={deletePage}
          version={previewVersion}
        />

        <main className="doc-scroll" ref={scrollRef}>
          <div className="doc-pages-column">
            {pages.map((page, index) => {
              const effectiveLayout: PageLayout = page.layoutOverride
                ? { ...defaultLayout, ...page.layoutOverride }
                : defaultLayout;
              return (
                <div
                  key={page.id}
                  ref={registerPageSlotRef(page.id)}
                  className="doc-page-slot"
                  style={{
                    transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                    transformOrigin: "top left",
                    marginBottom: 24 * zoom,
                  }}
                  onFocusCapture={handlePageFocus(page.id, index)}
                  onClick={handlePageFocus(page.id, index)}
                >
                  <div className="doc-page">
                    <div className="doc-page-badge">Page {index + 1}</div>
                    <PageCanvas layout={effectiveLayout}>
                      <EditorJSComponent
                        pageIndex={index}
                        data={page.initialData}
                        editorRef={getOrCreateHandle(page.id)}
                        onChange={handleChange(page.id)}
                        onContentOverflow={() => void handleOverflow(page.id)}
                        onImageUpload={uploadImage}
                      />
                    </PageCanvas>
                  </div>
                </div>
              );
            })}

            <button
              type="button"
              className="add-page-inline"
              onClick={addPage}
              style={{
                transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                transformOrigin: "top left",
              }}
            >
              + Add page
            </button>
          </div>
        </main>
      </div>

      <LayoutDialog
        open={layoutDialogOpen}
        onClose={() => setLayoutDialogOpen(false)}
        defaultLayout={defaultLayout}
        currentPageOverride={pages[activePageIndex]?.layoutOverride ?? null}
        currentPageIndex={activePageIndex}
        totalPages={pages.length}
        onApply={handleLayoutApply}
      />
    </div>
  );
}

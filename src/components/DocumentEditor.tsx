import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type EditorJS from "@editorjs/editorjs";
import { exportDocx, MAX_DOCX_BYTES, parseDocx } from "~/lib/editor";
import type { EditorBlock, FullDocument, PageLayout } from "~/lib/api/documents";
import { updateDocument } from "~/lib/api/documents";
import { uploadImage as uploadImageToApi } from "~/lib/api/uploads";
import { useDocument } from "~/hooks/useDocuments";
import { useAutosave } from "~/hooks/useAutosave";
import { EditorCommands } from "~/lib/editor/commands";
import { diffContent, isEmptyDiff, stateFromBlocks, type DiffBlock } from "~/lib/editor/contentDiff";
import { deleteDraft, loadDraft, type Draft } from "~/lib/editor/drafts";
import { EditorHistory } from "~/lib/editor/history";
import { normalizeBlocks } from "~/lib/editor/normalize";
import { PAGE_GAP, pageSize } from "~/lib/editor/pagination/paper";
import type { PageSummary } from "~/lib/editor/pagination/usePagination";
import { sanitizeEditorData } from "~/lib/editor/sanitizeData";
import { resolveStyles, stylesToCss } from "~/lib/editor/styles/namedStyles";
import { DocumentHeader } from "./DocumentHeader";
import { DocumentSurface, type DocumentSurfaceHandle, type SurfaceKeyCommand } from "./DocumentSurface";
import { EditorRibbon } from "./EditorRibbon";
import { LayoutDialog } from "./LayoutDialog";
import { ThumbnailsSidebar } from "./ThumbnailsSidebar";

async function uploadImage(file: File): Promise<{ url: string }> {
  const { url } = await uploadImageToApi(file);
  return { url };
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

/** EditorJS output → the block shape autosave diffs and the API stores.
 *  Tunes with no data (an unformatted paragraph's `format: {}`) are dropped
 *  so they don't register as changes against the stored blocks. */
async function readBlocks(editor: EditorJS): Promise<DiffBlock[]> {
  const out = await editor.save();
  return out.blocks.map((b) => {
    const tunes = Object.fromEntries(
      Object.entries((b.tunes ?? {}) as Record<string, unknown>).filter(
        ([, v]) => v && typeof v === "object" && Object.keys(v).length > 0,
      ),
    );
    return {
      id: b.id!,
      type: b.type,
      data: b.data,
      ...(Object.keys(tunes).length > 0 ? { tunes } : {}),
    };
  });
}

interface Props {
  documentId: string;
}

/** Loads the document, then hands it to the editor workspace. */
export function DocumentEditor({ documentId }: Props) {
  const navigate = useNavigate();
  const docQuery = useDocument(documentId);

  if (docQuery.isLoading) {
    return <div className="doc-full-loading">Loading document…</div>;
  }
  if (docQuery.error || !docQuery.data) {
    return (
      <div className="doc-full-loading">
        Couldn't load this document.{" "}
        <button type="button" onClick={() => navigate({ to: "/" })} className="doc-btn">
          Back to list
        </button>
      </div>
    );
  }
  // Keyed so switching documents gives a fresh editor + autosave baseline.
  return <EditorWorkspace key={documentId} doc={docQuery.data} />;
}

function EditorWorkspace({ doc }: { doc: FullDocument }) {
  const navigate = useNavigate();
  const documentId = doc.id;

  const [title, setTitle] = useState(doc.title);
  const [layout, setLayout] = useState<PageLayout>(doc.defaultLayout);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [activePage, setActivePage] = useState(0);
  const [commands, setCommands] = useState<EditorCommands | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const editorRef = useRef<EditorJS | null>(null);
  const historyRef = useRef<EditorHistory | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const surfaceRef = useRef<DocumentSurfaceHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const styles = useMemo(() => resolveStyles(doc.styles), [doc.styles]);
  const stylesCss = useMemo(() => stylesToCss(styles, ".tp-document"), [styles]);

  const autosave = useAutosave({
    documentId,
    initialRevision: doc.revision,
    // Baseline is what the server has. Blocks that load-time normalisation
    // changed (legacy alignment shapes) differ from it, so the first save
    // after an edit rewrites exactly those — migrating them for good.
    initialBlocks: doc.blocks as DiffBlock[],
    getBlocks: async () => (editorRef.current ? readBlocks(editorRef.current) : null),
  });

  // ── Editor lifecycle ─────────────────────────────────────────────────

  const handleReady = useCallback((editor: EditorJS) => {
    editorRef.current = editor;
    const history = new EditorHistory(editor);
    historyRef.current = history;
    void history.record();
    const root = document.querySelector<HTMLElement>(".tp-document");
    setCommands(new EditorCommands(editor, history, root ?? document.body));
  }, []);

  useEffect(() => () => commands?.dispose(), [commands]);

  const handleChange = useCallback(() => {
    autosave.markDirty();
    // Group a burst of typing into one undo step.
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null;
      void historyRef.current?.record();
    }, 500);
  }, [autosave]);

  const handleKeyCommand = useCallback(
    (command: SurfaceKeyCommand) => {
      if (!commands) return;
      if (command === "undo") void commands.undo();
      else if (command === "redo") void commands.redo();
      else void commands.insertPageBreak();
    },
    [commands],
  );

  // ── Unsaved local draft (crash / closed tab while offline) ───────────

  useEffect(() => {
    let cancelled = false;
    void loadDraft(documentId).then((found) => {
      if (cancelled || !found) return;
      // Only offer it if it actually differs from what the server has.
      if (isEmptyDiff(diffContent(stateFromBlocks(doc.blocks as DiffBlock[]), found.blocks))) {
        void deleteDraft(documentId);
        return;
      }
      setDraft(found);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, doc.blocks]);

  const restoreDraft = useCallback(async () => {
    const editor = editorRef.current;
    if (!draft || !editor) return;
    await editor.render({
      time: draft.savedAt,
      blocks: sanitizeEditorData(normalizeBlocks(draft.blocks as EditorBlock[])),
    });
    await historyRef.current?.reset();
    setDraft(null);
    // The autosave baseline is still the server copy, so this saves exactly
    // the recovered differences.
    autosave.markDirty();
  }, [autosave, draft]);

  const discardDraft = useCallback(async () => {
    // Wait for the delete: navigating away aborts an unfinished IndexedDB
    // transaction, and the draft would be offered again next time.
    await deleteDraft(documentId);
    setDraft(null);
  }, [documentId]);

  // ── Title (metadata, saved separately from content) ──────────────────

  const savedTitleRef = useRef(doc.title);
  useEffect(() => {
    if (title === savedTitleRef.current) return;
    const timer = window.setTimeout(() => {
      const next = title.trim() || "Untitled document";
      updateDocument(documentId, { title: next })
        .then(() => {
          savedTitleRef.current = title;
        })
        .catch((err) => console.error("[title] save failed:", err));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [documentId, title]);

  // ── Page navigation ──────────────────────────────────────────────────

  const stride = (pageSize(layout).height + PAGE_GAP) * zoom;
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The page under the upper third of the viewport.
    const probe = el.scrollTop + el.clientHeight / 3;
    setActivePage(Math.max(0, Math.min(Math.floor(probe / stride), pages.length - 1)));
  }, [pages.length, stride]);

  const selectPage = useCallback((index: number) => {
    setActivePage(index);
    surfaceRef.current?.scrollToPage(index);
  }, []);

  // ── Import / export ──────────────────────────────────────────────────

  const handleImportClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      const editor = editorRef.current;
      if (!file || !editor) return;

      if (file.size > MAX_DOCX_BYTES) {
        alert(`That file is too large to import (max ${Math.round(MAX_DOCX_BYTES / 1024 / 1024)} MB).`);
        return;
      }

      setBusy(true);
      try {
        // Parse fully before touching anything — the importer throws on a
        // bad file and nothing is replaced unless there's content.
        const parsed = await parseDocx(file);
        // Keep the source's explicit page breaks.
        const blocks = parsed.pages.flatMap((page, i) =>
          i === 0 ? page.blocks : [{ type: "pageBreak", data: {} }, ...page.blocks],
        ) as EditorBlock[];
        if (!blocks.some((b) => b.type !== "pageBreak")) {
          throw new Error("The file doesn't contain any content we can import.");
        }
        if (!confirm(`Replace the contents of "${title}" with "${file.name}"?`)) return;

        await historyRef.current?.record();
        await editor.render({
          time: Date.now(),
          blocks: sanitizeEditorData(normalizeBlocks(blocks)),
        });
        autosave.markDirty();
        await historyRef.current?.reset();

        // Headers / footers and page setup are document metadata. They
        // aren't rendered yet (headers & sections come in Phase 3), but
        // keep them so nothing from the source file is lost.
        const nextLayout: PageLayout = parsed.defaultLayout
          ? { ...layout, ...parsed.defaultLayout }
          : layout;
        const meta = await updateDocument(documentId, {
          headerBlocks: parsed.headerBlocks,
          footerBlocks: parsed.footerBlocks,
          defaultLayout: nextLayout,
        });
        setLayout(meta.defaultLayout);

        const niceTitle = file.name.replace(/\.docx$/i, "");
        if (niceTitle) setTitle(niceTitle);
      } catch (err) {
        console.error("[importDocx] failed:", err);
        alert(`Couldn't import that DOCX.\n\n${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [autosave, documentId, layout, title],
  );

  const handleExportClick = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy(true);
    try {
      const out = await editor.save();
      const blob = await exportDocx(
        { time: Date.now(), blocks: out.blocks as never, version: out.version },
        { title },
      );
      triggerDownload(blob, `${sanitizeFilename(title)}.docx`);
    } catch (err) {
      console.error("[exportDocx] failed:", err);
      alert(`Couldn't export.\n\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [title]);

  // ── Layout ───────────────────────────────────────────────────────────

  const handleLayoutApply = useCallback(
    async (next: PageLayout) => {
      const meta = await updateDocument(documentId, { defaultLayout: next });
      setLayout(meta.defaultLayout);
    },
    [documentId],
  );

  const handleBack = useCallback(async () => {
    await autosave.saveNow().catch(() => undefined);
    navigate({ to: "/" });
  }, [autosave, navigate]);

  const handleKeepMine = useCallback(async () => {
    if (
      !confirm(
        "Overwrite the other version with yours?\n\nChanges made elsewhere since you opened this document will be lost.",
      )
    ) {
      return;
    }
    await autosave.overwriteServer();
  }, [autosave]);

  return (
    <div className="doc-root">
      <DocumentHeader
        title={title}
        onTitleChange={setTitle}
        pageCount={pages.length || 1}
        zoom={zoom}
        onZoomChange={setZoom}
        onImportClick={handleImportClick}
        onExportClick={handleExportClick}
        onSaveClick={() => void autosave.saveNow()}
        onBackClick={() => void handleBack()}
        onLayoutClick={() => setLayoutDialogOpen(true)}
        layout={layout}
        autosaveStatus={autosave.status}
        lastSavedAt={autosave.lastSavedAt}
        busy={busy}
      />

      {autosave.status === "conflict" && (
        <div className="doc-conflict" role="alert">
          <span>
            This document was changed in another tab or on another device. Your edits here
            aren't being saved.
          </span>
          <button type="button" className="doc-btn" onClick={() => window.location.reload()}>
            Load latest version
          </button>
          <button type="button" className="doc-btn" onClick={() => void handleKeepMine()}>
            Keep my version
          </button>
        </div>
      )}

      {draft && autosave.status !== "conflict" && (
        <div className="doc-conflict" role="alert">
          <span>
            {draft.baseRevision === doc.revision
              ? `You have unsaved changes from ${new Date(draft.savedAt).toLocaleString()} that didn't reach the server.`
              : `You have unsaved changes from ${new Date(draft.savedAt).toLocaleString()}, but the document has changed since. Restoring replaces the newer version.`}
          </span>
          <button type="button" className="doc-btn" onClick={() => void restoreDraft()} disabled={!commands}>
            Restore my changes
          </button>
          <button type="button" className="doc-btn" onClick={() => void discardDraft()}>
            Discard
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        style={{ display: "none" }}
        onChange={handleFileSelected}
      />

      <EditorRibbon commands={commands} />

      <div className="doc-body">
        <ThumbnailsSidebar
          pages={pages}
          activePageIndex={activePage}
          onSelectPage={selectPage}
          onInsertPageBreak={() => void commands?.insertPageBreak()}
        />

        <main className="doc-scroll" ref={scrollRef} onScroll={handleScroll}>
          <div className="doc-pages-column">
            <DocumentSurface
              ref={surfaceRef}
              initialBlocks={doc.blocks}
              layout={layout}
              zoom={zoom}
              stylesCss={stylesCss}
              onReady={handleReady}
              onChange={handleChange}
              onImageUpload={uploadImage}
              onPagesChange={setPages}
              onKeyCommand={handleKeyCommand}
            />
          </div>
        </main>
      </div>

      <LayoutDialog
        open={layoutDialogOpen}
        onClose={() => setLayoutDialogOpen(false)}
        defaultLayout={layout}
        onApply={handleLayoutApply}
      />
    </div>
  );
}

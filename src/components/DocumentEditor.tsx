import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type EditorJS from "@editorjs/editorjs";
import { DEFAULT_IMPORT_LIMITS } from "~/lib/editor/docx/import/types";
import { uploadEmbeddedImages } from "~/lib/editor/docx/uploadEmbedded";
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
import { DocumentSurface, type DocumentSurfaceHandle } from "./DocumentSurface";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { LinkBubble, LinkDialog } from "./LinkDialog";
import { StatusBar } from "./StatusBar";
import { StylesDialog } from "./StylesDialog";
import type { CopiedFormat } from "~/lib/editor/commands";
import { matchShortcut } from "~/lib/editor/shortcuts";
import { cleanPageSetup, type FieldKind, type HeaderFooterKind, type PageSetup } from "~/lib/editor/pageSetup";
import type { HeaderFooterEditorHandle } from "./HeaderFooterEditor";
import type { HeaderFooterArea, HeaderFooterTarget } from "./PageChrome";
import type { StyleSheet } from "~/lib/editor/styles/namedStyles";
import { EditorRibbon } from "./EditorRibbon";
import { LayoutDialog } from "./LayoutDialog";
import { ThumbnailsSidebar } from "./ThumbnailsSidebar";
import { usePrintActions } from "~/lib/editor/print/usePrintActions";
import { canAtLeast, listPeople } from "~/lib/api/collab";
import { useAuth } from "~/hooks/useAuth";
import { CommentsPanel, NotificationsBell, useCommentsUi } from "./comments";
import { VersionHistoryPanel } from "./history";
import { applyToEditor } from "~/lib/editor/collab/applyToEditor";
import { usePresence } from "~/hooks/usePresence";
import { ShareDialog } from "./ShareDialog";
import { FileMenu } from "./FileMenu";
import { alertDialog, confirmDialog } from "./ui/dialogs";

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
  /** Bumped after a version restore: a fresh editor on the restored content. */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(async () => {
    await docQuery.refetch();
    setReloadKey((k) => k + 1);
  }, [docQuery]);

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
  return <EditorWorkspace key={`${documentId}:${reloadKey}`} doc={docQuery.data} onReload={reload} />;
}

function EditorWorkspace({ doc, onReload }: { doc: FullDocument; onReload: () => Promise<void> }) {
  const navigate = useNavigate();
  const documentId = doc.id;
  const role = doc.role ?? "owner";
  const canEdit = canAtLeast(role, "editor");
  const canComment = canAtLeast(role, "commenter");

  const [title, setTitle] = useState(doc.title);
  const [layout, setLayout] = useState<PageLayout>(doc.defaultLayout);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [layoutDialogOpen, setLayoutDialogOpen] = useState(false);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [activePage, setActivePage] = useState(0);
  const [commands, setCommands] = useState<EditorCommands | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** What a DOCX import couldn't bring over faithfully. */
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [styleOverrides, setStyleOverrides] = useState<Record<string, unknown>>(doc.styles ?? {});
  const [pageSetup, setPageSetup] = useState<PageSetup>(() =>
    cleanPageSetup(doc.pageSetup, doc.headerBlocks, doc.footerBlocks),
  );
  const [editingHF, setEditingHF] = useState<HeaderFooterTarget | null>(null);
  const editingHFRef = useRef(editingHF);
  editingHFRef.current = editingHF;
  /** Layout of the caret's section (the document's, or a section break's). */
  const [section, setSection] = useState<{ breakId: string; layout: PageLayout } | null>(null);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [find, setFind] = useState<{ open: boolean; mode: "find" | "replace" }>({ open: false, mode: "find" });
  const [linkDialog, setLinkDialog] = useState<{ url: string; text: string } | null>(null);
  const [bubbleLink, setBubbleLink] = useState<HTMLAnchorElement | null>(null);
  const [painterArmed, setPainterArmed] = useState(false);
  const [showStatusBar, setShowStatusBar] = useState(() => readPref("tp.statusBar", true));
  /** Bumps on every content change (find re-search, word count). */
  const [version, setVersion] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  /** Paragraphs someone else also edited (this person's version kept). */
  const [collisions, setCollisions] = useState(0);
  /** The server's comment counter — comments refetch when it moves. */
  const [commentsVersion, setCommentsVersion] = useState(0);

  const editorRef = useRef<EditorJS | null>(null);
  const historyRef = useRef<EditorHistory | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const surfaceRef = useRef<DocumentSurfaceHandle>(null);
  const hfEditorRef = useRef<HeaderFooterEditorHandle>(null);
  const pageSetupTimerRef = useRef<number | null>(null);
  const pendingPageSetupRef = useRef<PageSetup | null>(null);
  const flushPageSetupRef = useRef<() => Promise<void>>(async () => undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docRootRef = useRef<HTMLElement | null>(null);
  const copiedFormatRef = useRef<CopiedFormat | null>(null);
  const savedTitleRef = useRef(doc.title);
  const viewerBlocksRef = useRef<DiffBlock[]>(doc.blocks as DiffBlock[]);

  const styles = useMemo(() => resolveStyles(styleOverrides), [styleOverrides]);
  const stylesCss = useMemo(() => stylesToCss(styles, ".tp-document"), [styles]);

  const autosave = useAutosave({
    documentId,
    initialRevision: doc.revision,
    // Baseline is what the server has. Blocks that load-time normalisation
    // changed (legacy alignment shapes) differ from it, so the first save
    // after an edit rewrites exactly those — migrating them for good.
    initialBlocks: doc.blocks as DiffBlock[],
    // A read-only editor can't save(); it shows exactly what it was last
    // given, so that is its content.
    getBlocks: async () =>
      !canEdit ? viewerBlocksRef.current : editorRef.current ? readBlocks(editorRef.current) : null,
    readOnly: !canEdit,
    // Others' saves, merged in block by block. Blocks that came from the
    // server are sanitised like any loaded content; the rest are the
    // editor's own (same objects) and are left alone.
    onRemoteContent: async ({ current, next }) => {
      const editor = editorRef.current;
      if (!editor) return;
      const mine = new Set(current);
      const clean = next.map((b) =>
        mine.has(b) ? b : (sanitizeEditorData(normalizeBlocks([b as EditorBlock]))[0] as DiffBlock),
      );
      if (!canEdit) {
        await editor.render({ time: Date.now(), blocks: clean as EditorBlock[] });
        viewerBlocksRef.current = next;
      } else if (historyRef.current) {
        await historyRef.current.applyRemote({ current, next: clean });
      } else {
        await applyToEditor(editor, current, clean);
      }
      setVersion((v) => v + 1);
    },
    onCollisions: (ids) => setCollisions((n) => n + ids.length),
    onRemoteMeta: (meta) => {
      savedTitleRef.current = meta.title;
      // Not while this person is typing a new title.
      if (!document.activeElement?.classList.contains("doc-title-input")) setTitle(meta.title);
      setLayout(meta.defaultLayout);
      setStyleOverrides(meta.styles ?? {});
      // Don't yank headers / footers / footnotes from under someone typing
      // in them; the next local change saves the merged object anyway.
      if (!pendingPageSetupRef.current && !editingHFRef.current) {
        setPageSetup(cleanPageSetup(meta.pageSetup, meta.headerBlocks, meta.footerBlocks));
      }
    },
    onCommentsVersion: setCommentsVersion,
  });

  const closeShare = useCallback(() => setShareOpen(false), []);


  // ── Comments, mentions, version history ─────────────────────────────
  const { user } = useAuth();
  const comments = useCommentsUi();
  const people = useQuery({
    queryKey: ["people", documentId],
    queryFn: () => listPeople(documentId),
    enabled: canComment,
    staleTime: 60_000,
  });
  const search = useSearch({ strict: false }) as { thread?: string };
  const { showThread } = comments;
  useEffect(() => {
    if (search.thread) showThread(search.thread);
  }, [search.thread, showThread]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBlocks, setHistoryBlocks] = useState<EditorBlock[]>([]);
  const openHistory = useCallback(async () => {
    const editor = editorRef.current;
    setHistoryBlocks(editor ? ((await readBlocks(editor)) as EditorBlock[]) : []);
    setHistoryOpen(true);
  }, []);
  const startComment = useCallback(() => {
    if (!comments.beginComment(docRootRef.current)) {
      void alertDialog({
        tone: "info",
        title: "Select text to comment on",
        message: "Highlight a word or phrase within one paragraph, then add your comment.",
      });
    }
  }, [comments]);

  const present = usePresence({
    documentId,
    canEdit,
    getRoot: useCallback(() => docRootRef.current, []),
  });

  const printActions = usePrintActions({
    documentId,
    title,
    getDocumentEl: useCallback(() => docRootRef.current, []),
    pages,
    // The server renders what's stored: flush pending content and page
    // setup (headers/footers, footnotes) edits first.
    beforeServerPdf: async () => {
      await autosave.saveNow();
      await flushPageSetupRef.current();
    },
  });

  // ── Editor lifecycle ─────────────────────────────────────────────────

  const handleReady = useCallback((editor: EditorJS) => {
    editorRef.current = editor;
    const root = document.querySelector<HTMLElement>(".tp-document");
    docRootRef.current = root;
    // Read-only: nothing to undo, and save() (which history uses) throws.
    if (!canEdit) return;
    const history = new EditorHistory(editor);
    historyRef.current = history;
    void history.record();
    setCommands(new EditorCommands(editor, history, root ?? document.body));
  }, [canEdit]);

  useEffect(() => () => commands?.dispose(), [commands]);

  const versionTimerRef = useRef<number | null>(null);
  const handleChange = useCallback(() => {
    autosave.markDirty();
    // Find and word count only need to catch up after a pause; bumping on
    // every keystroke would re-render the whole workspace while typing.
    if (versionTimerRef.current !== null) window.clearTimeout(versionTimerRef.current);
    versionTimerRef.current = window.setTimeout(() => {
      versionTimerRef.current = null;
      setVersion((v) => v + 1);
    }, 250);
    // Group a burst of typing into one undo step.
    if (historyTimerRef.current !== null) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null;
      void historyRef.current?.record();
    }, 500);
  }, [autosave]);

  // ── Links ────────────────────────────────────────────────────────────

  const openLinkDialog = useCallback(() => {
    if (!commands) return;
    setLinkDialog({ url: commands.inlineState().link ?? "", text: commands.selectedText() });
  }, [commands]);

  // Show the link bubble while the caret is inside a link.
  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection();
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const link = el?.closest("a");
      setBubbleLink(link && docRootRef.current?.contains(link) && sel?.isCollapsed ? link : null);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  // ── Format painter ───────────────────────────────────────────────────

  const togglePainter = useCallback(() => {
    if (painterArmed) {
      setPainterArmed(false);
      return;
    }
    const copied = commands?.copyFormat();
    if (!copied) return;
    copiedFormatRef.current = copied;
    setPainterArmed(true);
  }, [commands, painterArmed]);

  // Armed painter: the next selection made in the document gets the format.
  useEffect(() => {
    if (!painterArmed || !commands) return;
    const onUp = (e: MouseEvent) => {
      if (!docRootRef.current?.contains(e.target as Node)) return;
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !copiedFormatRef.current) return;
      void commands.pasteFormat(copiedFormatRef.current);
      setPainterArmed(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPainterArmed(false);
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [commands, painterArmed]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────

  const handleKeyDownCapture = useCallback(
    (e: React.KeyboardEvent) => {
      const action = matchShortcut(e.nativeEvent);
      if (!action || !commands) return;
      const inDocument = docRootRef.current?.contains(e.target as Node) ?? false;
      // Outside the document (ribbon inputs, dialogs) only the global
      // shortcuts apply; Ctrl+Z there should undo the input, not the doc.
      if (!inDocument && action.type !== "find" && action.type !== "replace") return;
      // Native contenteditable undo only knows one block and would fight
      // the document-level history.
      e.preventDefault();
      e.stopPropagation();
      switch (action.type) {
        case "undo": void commands.undo(); break;
        case "redo": void commands.redo(); break;
        case "pageBreak": void commands.insertPageBreak(); break;
        case "link": openLinkDialog(); break;
        case "find": setFind({ open: true, mode: "find" }); break;
        case "replace": setFind({ open: true, mode: "replace" }); break;
        case "align": void commands.setAlignment(action.alignment); break;
        case "style": void commands.applyStyle(action.styleId); break;
        case "fontSize": void commands.stepFontSize(action.direction); break;
        case "clearFormatting": void commands.clearFormatting(); break;
        case "superscript": commands.inline("superscript"); break;
        case "subscript": commands.inline("subscript"); break;
        case "strike": commands.inline("strikeThrough"); break;
        case "list": void commands.toggleList(action.style); break;
        case "copyFormat": copiedFormatRef.current = commands.copyFormat(); break;
        case "pasteFormat":
          if (copiedFormatRef.current) void commands.pasteFormat(copiedFormatRef.current);
          break;
      }
    },
    [commands, openLinkDialog],
  );

  // Ctrl/⌘+Alt+M: comment on the selection. Document-level, because in a
  // read-only editor focus stays on <body> rather than in the document.
  useEffect(() => {
    if (!canComment) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === "KeyM") {
        e.preventDefault();
        startComment();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canComment, startComment]);

  // ── Page setup: headers / footers, footnotes, decoration ────────────

  /** Update page setup locally now and save it after a short pause. */
  const savePageSetup = useCallback(
    (next: PageSetup) =>
      updateDocument(documentId, { pageSetup: next as unknown as Record<string, unknown> }).catch((err) =>
        console.error("[pageSetup] save failed:", err),
      ),
    [documentId],
  );

  const updatePageSetup = useCallback(
    (fn: (prev: PageSetup) => PageSetup) => {
      setPageSetup((prev) => {
        const next = fn(prev);
        pendingPageSetupRef.current = next;
        if (pageSetupTimerRef.current !== null) window.clearTimeout(pageSetupTimerRef.current);
        pageSetupTimerRef.current = window.setTimeout(() => {
          pageSetupTimerRef.current = null;
          pendingPageSetupRef.current = null;
          void savePageSetup(next);
        }, 600);
        return next;
      });
    },
    [savePageSetup],
  );

  /** Save a debounced page-setup change right now (before server PDF). */
  flushPageSetupRef.current = async () => {
    const pending = pendingPageSetupRef.current;
    if (pageSetupTimerRef.current !== null) window.clearTimeout(pageSetupTimerRef.current);
    pageSetupTimerRef.current = null;
    pendingPageSetupRef.current = null;
    if (pending) await savePageSetup(pending);
  };

  const handleHeaderFooterChange = useCallback(
    (area: HeaderFooterArea, kind: HeaderFooterKind, blocks: EditorBlock[]) => {
      updatePageSetup((prev) => {
        const key = area === "header" ? "headers" : "footers";
        return { ...prev, [key]: { ...prev[key], [kind]: blocks } };
      });
    },
    [updatePageSetup],
  );

  const handleFootnoteChange = useCallback(
    (id: string, html: string) => {
      updatePageSetup((prev) => ({ ...prev, footnotes: { ...prev.footnotes, [id]: html } }));
    },
    [updatePageSetup],
  );

  const insertFootnote = useCallback(async () => {
    const id = await commands?.insertFootnote();
    if (!id) return;
    updatePageSetup((prev) => ({ ...prev, footnotes: { ...prev.footnotes, [id]: "" } }));
    // Put the caret in the new note once the paginator has laid it out.
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-fn-text="${CSS.escape(id)}"]`)?.focus();
    }, 400);
  }, [commands, updatePageSetup]);

  /** Open the header / footer of the page in view — via the page's own
   *  zone, which knows whether that page uses the first / even variant. */
  const editHeaderFooter = useCallback(
    (area: HeaderFooterArea) => {
      const zone = document.querySelector<HTMLElement>(`[data-testid="${area}-${Math.max(0, activePage)}"]`);
      zone?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      zone?.scrollIntoView({ block: "nearest" });
    },
    [activePage],
  );

  const insertField = useCallback((kind: FieldKind) => hfEditorRef.current?.insertField(kind), []);

  // Esc leaves header / footer editing.
  useEffect(() => {
    if (!editingHF) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingHF(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editingHF]);

  // Track which section the caret is in, so Layout changes go there.
  useEffect(() => {
    if (!commands) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(async () => {
        const current = await commands.currentSection();
        setSection((prev) => {
          const next = current ? { breakId: current.breakId, layout: { ...layout, ...current.layout } } : null;
          return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
        });
      });
    };
    document.addEventListener("selectionchange", refresh);
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", refresh);
    };
  }, [commands, layout, version]);

  // ── Styles ───────────────────────────────────────────────────────────

  const saveStyles = useCallback(
    async (next: StyleSheet) => {
      const meta = await updateDocument(documentId, { styles: next as unknown as Record<string, unknown> });
      setStyleOverrides(meta.styles);
    },
    [documentId],
  );

  const toggleStatusBar = useCallback(() => {
    setShowStatusBar((v) => {
      writePref("tp.statusBar", !v);
      return !v;
    });
  }, []);

  // ── Unsaved local draft (crash / closed tab while offline) ───────────

  useEffect(() => {
    let cancelled = false;
    void loadDraft(documentId).then((found) => {
      if (cancelled || !found || !canEdit) return;
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

  useEffect(() => {
    if (!canEdit || title === savedTitleRef.current) return;
    const timer = window.setTimeout(() => {
      const next = title.trim() || "Untitled document";
      updateDocument(documentId, { title: next })
        .then(() => {
          savedTitleRef.current = title;
        })
        .catch((err) => console.error("[title] save failed:", err));
    }, 800);
    return () => window.clearTimeout(timer);
  }, [canEdit, documentId, title]);

  // ── Page navigation ──────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || pages.length === 0) return;
    // The page under the upper third of the viewport (pages can differ in
    // height across sections).
    const probe = (el.scrollTop + el.clientHeight / 3) / zoom;
    let index = 0;
    pages.forEach((p, i) => {
      if (p.top <= probe) index = i;
    });
    setActivePage(index);
  }, [pages, zoom]);

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

      if (file.size > DEFAULT_IMPORT_LIMITS.maxBytes) {
        void alertDialog({
          title: "That file is too large",
          message: `Word documents up to ${Math.round(DEFAULT_IMPORT_LIMITS.maxBytes / 1024 / 1024)} MB can be imported.`,
        });
        return;
      }

      setBusy(true);
      try {
        // Parse fully before touching anything — the importer throws on a
        // bad file and nothing is replaced unless there's content.
        // Loaded on demand: the importer and JSZip aren't needed until now.
        const { importDocxFile } = await import("~/lib/editor/docx/import");
        const imported = await importDocxFile(file);
        if (!imported.blocks.some((b) => b.type !== "pageBreak" && b.type !== "sectionBreak")) {
          throw new Error("The file doesn't contain any content we can import.");
        }
        const replace = await confirmDialog({
          title: "Replace this document's content?",
          message: `Everything in “${title}” will be replaced with “${file.name}”. You can undo this from Version history.`,
          confirmLabel: "Replace content",
          danger: true,
        });
        if (!replace) return;

        // Embedded images become normal uploads (the document stays small).
        const { value: content, failed } = await uploadEmbeddedImages(
          { blocks: imported.blocks, pageSetup: imported.pageSetup },
          uploadImage,
        );
        const warnings = [...imported.warnings];
        if (failed > 0) warnings.push(`${failed} image(s) couldn't be uploaded and are embedded in the document.`);

        await historyRef.current?.record();
        await editor.render({
          time: Date.now(),
          blocks: sanitizeEditorData(normalizeBlocks(content.blocks)),
        });
        autosave.markDirty();
        await historyRef.current?.reset();

        // Page setup, headers / footers, footnotes and named styles are
        // document metadata.
        const nextStyles = { ...styleOverrides, ...imported.styles } as Record<string, unknown>;
        const meta = await updateDocument(documentId, {
          defaultLayout: imported.defaultLayout,
          pageSetup: content.pageSetup as unknown as Record<string, unknown>,
          styles: nextStyles,
        });
        setLayout(meta.defaultLayout);
        setPageSetup(cleanPageSetup(meta.pageSetup));
        setStyleOverrides(meta.styles);

        const niceTitle = imported.title?.trim() || file.name.replace(/\.docx$/i, "");
        if (niceTitle) setTitle(niceTitle);
        setImportWarnings(warnings);
      } catch (err) {
        console.error("[importDocx] failed:", err);
        void alertDialog({
          title: "Couldn't import that DOCX",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(false);
      }
    },
    [autosave, documentId, styleOverrides, title],
  );

  const handleExportClick = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    setBusy(true);
    try {
      const out = await editor.save();
      const { exportDocx } = await import("~/lib/editor/docx/exporter");
      const blob = await exportDocx(
        { time: Date.now(), blocks: out.blocks as never, version: out.version },
        { title, defaultLayout: layout, pageSetup, styles },
      );
      triggerDownload(blob, `${sanitizeFilename(title)}.docx`);
    } catch (err) {
      console.error("[exportDocx] failed:", err);
      void alertDialog({ title: "Couldn't export", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [layout, pageSetup, styles, title]);

  // ── Layout ───────────────────────────────────────────────────────────

  const handleLayoutApply = useCallback(
    async (next: PageLayout) => {
      const meta = await updateDocument(documentId, { defaultLayout: next });
      setLayout(meta.defaultLayout);
    },
    [documentId],
  );

  const handleLayoutPatch = useCallback(
    (patch: Partial<PageLayout>) => {
      // Inside a later section, Layout changes apply to that section
      // (Word's default "Apply to: This section").
      if (section && commands) {
        void commands.setSectionLayout(section.breakId, { ...section.layout, ...patch });
        return;
      }
      const next = { ...layout, ...patch };
      setLayout(next); // optimistic; the server echoes the merged layout
      void handleLayoutApply(next).catch((err) => {
        console.error("[layout] failed:", err);
        setLayout(layout);
      });
    },
    [commands, handleLayoutApply, layout, section],
  );

  const handleBack = useCallback(async () => {
    await autosave.saveNow().catch(() => undefined);
    navigate({ to: "/" });
  }, [autosave, navigate]);

  const handleKeepMine = useCallback(async () => {
    const ok = await confirmDialog({
      title: "Overwrite the other version?",
      message: "Changes made elsewhere since you opened this document will be lost.",
      confirmLabel: "Overwrite",
      danger: true,
    });
    if (!ok) return;
    await autosave.overwriteServer();
  }, [autosave]);

  const fileMenu = (
    <FileMenu
      onSave={canEdit ? () => void autosave.saveNow() : undefined}
      onShare={() => setShareOpen(true)}
      onImport={canEdit ? handleImportClick : undefined}
      onExportDocx={() => void handleExportClick()}
      onPrint={() => void printActions.print()}
      onDownloadPdf={() => void printActions.downloadPdf()}
      pdfAvailable={printActions.pdfAvailable}
      pdfBusy={printActions.busy}
      onPageSetup={canEdit ? () => setLayoutDialogOpen(true) : undefined}
      onVersionHistory={canEdit ? () => void openHistory() : undefined}
      busy={busy}
    />
  );

  // Ctrl/⌘+S saves now; Ctrl/⌘+P prints this layout (not the app chrome).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        if (canEdit) void autosave.saveNow();
      } else if (key === "p") {
        e.preventDefault();
        void printActions.print();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [autosave, canEdit, printActions]);

  return (
    <div className={`doc-root${painterArmed ? " tp-painter-armed" : ""}`} onKeyDownCapture={handleKeyDownCapture}>
      <DocumentHeader
        title={title}
        onTitleChange={setTitle}
        onBackClick={() => void handleBack()}
        autosaveStatus={autosave.status}
        lastSavedAt={autosave.lastSavedAt}
        readOnly={!canEdit}
        accessLabel={canEdit ? null : canComment ? "Comment only" : "View only"}
        present={present}
        onShareClick={() => setShareOpen(true)}
        commentsOpen={comments.open}
        onToggleComments={comments.toggle}
        onAddComment={canComment ? startComment : undefined}
        onHistoryClick={canEdit ? () => void openHistory() : undefined}
        notifications={
          <NotificationsBell
            onNavigate={(docId, threadId) =>
              navigate({ to: "/documents/$documentId", params: { documentId: docId }, search: { thread: threadId } })
            }
          />
        }
      />

      {autosave.status === "conflict" && (
        <div className="doc-conflict" role="alert">
          <span>
            This document changed too much elsewhere to merge your edits automatically. Your edits
            here aren't being saved.
          </span>
          <button type="button" className="doc-btn" onClick={() => window.location.reload()}>
            Load latest version
          </button>
          <button type="button" className="doc-btn" onClick={() => void handleKeepMine()}>
            Keep my version
          </button>
        </div>
      )}

      {collisions > 0 && (
        <div className="doc-conflict tp-collision-note" role="status">
          <span>
            Someone else edited {collisions === 1 ? "a paragraph" : `${collisions} paragraphs`} you were also
            editing. Your version was kept.
          </span>
          <button type="button" className="doc-btn" onClick={() => setCollisions(0)}>
            Dismiss
          </button>
        </div>
      )}

      {importWarnings.length > 0 && (
        <div className="doc-conflict tp-import-warnings" role="status">
          <details>
            <summary>
              Imported with {importWarnings.length} note{importWarnings.length === 1 ? "" : "s"} about things
              that couldn't be brought over exactly.
            </summary>
            <ul>
              {importWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
          <button type="button" className="doc-btn" onClick={() => setImportWarnings([])}>
            Dismiss
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

      {canEdit ? <EditorRibbon
        leading={fileMenu}
        styles={styles}
        commands={commands}
        layout={layout}
        onLayoutChange={handleLayoutPatch}
        onOpenPageSetup={() => setLayoutDialogOpen(true)}
        zoom={zoom}
        onZoomChange={setZoom}
        onOpenFind={(mode) => setFind({ open: true, mode })}
        onOpenLink={openLinkDialog}
        onOpenStyles={() => setStylesOpen(true)}
        painterArmed={painterArmed}
        onTogglePainter={togglePainter}
        showStatusBar={showStatusBar}
        onToggleStatusBar={toggleStatusBar}
        sectionLayout={section?.layout ?? null}
        pageSetup={pageSetup}
        onPageSetupChange={(patch) => updatePageSetup((prev) => ({ ...prev, ...patch }))}
        editingHeaderFooter={editingHF}
        onEditHeaderFooter={editHeaderFooter}
        onCloseHeaderFooter={() => setEditingHF(null)}
        onInsertField={insertField}
        onInsertFootnote={() => void insertFootnote()}
      /> : <div className="dh-menubar">{fileMenu}</div>}

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
              readOnly={!canEdit}
              layout={layout}
              pageSetup={pageSetup}
              title={title}
              editingHeaderFooter={editingHF}
              headerFooterEditorRef={hfEditorRef}
              onEditHeaderFooter={setEditingHF}
              onHeaderFooterChange={handleHeaderFooterChange}
              onFootnoteChange={handleFootnoteChange}
              zoom={zoom}
              stylesCss={stylesCss}
              onReady={handleReady}
              onChange={handleChange}
              onImageUpload={uploadImage}
              onPagesChange={setPages}
            />
          </div>
          <LinkBubble
            link={bubbleLink}
            container={scrollRef.current}
            onEdit={openLinkDialog}
            onRemove={() => void commands?.removeLink()}
          />
        </main>

        <CommentsPanel
          documentId={documentId}
          role={role}
          currentUser={user ? { id: user.id, email: user.email, displayName: user.displayName } : null}
          members={people.data ?? []}
          root={docRootRef.current}
          scrollContainer={scrollRef.current}
          version={version}
          commentsVersion={commentsVersion}
          ui={comments}
        />

        <FindReplaceDialog
          open={find.open}
          mode={find.mode}
          root={docRootRef.current}
          version={version}
          onClose={() => setFind((f) => ({ ...f, open: false }))}
          onBeforeReplace={() => historyRef.current?.record()}
        />
      </div>

      {showStatusBar && (
        <StatusBar
          root={docRootRef.current}
          version={version}
          page={activePage}
          pageCount={pages.length || 1}
          zoom={zoom}
          onZoomChange={setZoom}
        />
      )}

      <LinkDialog
        open={linkDialog !== null}
        initialUrl={linkDialog?.url ?? ""}
        selectedText={linkDialog?.text ?? ""}
        onApply={(url, text) => commands?.setLink(url, text) ?? false}
        onRemove={() => void commands?.removeLink()}
        onClose={() => setLinkDialog(null)}
      />

      <VersionHistoryPanel
        documentId={documentId}
        role={role}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentBlocks={historyBlocks}
        currentLayout={layout}
        currentStyles={styleOverrides}
        onFlush={async () => {
          await autosave.saveNow();
          await flushPageSetupRef.current();
        }}
        onRestored={() => void onReload()}
      />

      <ShareDialog
        open={shareOpen}
        documentId={documentId}
        title={title}
        role={role}
        onClose={closeShare}
      />

      <StylesDialog open={stylesOpen} styles={styles} onSave={saveStyles} onClose={() => setStylesOpen(false)} />

      <LayoutDialog
        open={layoutDialogOpen}
        onClose={() => setLayoutDialogOpen(false)}
        defaultLayout={layout}
        onApply={handleLayoutApply}
      />
    </div>
  );
}

/** Per-browser UI preference (not document data). */
function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* storage unavailable — preference just won't persist */
  }
}

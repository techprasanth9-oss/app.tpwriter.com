import "./print.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrintPageGeometry } from "./printLayout";
import { fetchServerPdf, isServerPdfAvailable, PdfNotConfiguredError, printDocument } from "./printDocument";

interface Options {
  documentId: string;
  title: string;
  /** The live `.tp-document` element. */
  getDocumentEl: () => HTMLElement | null;
  /** The paginator's current pages. */
  pages: PrintPageGeometry[];
  /** Runs before the server renders (e.g. flush autosave so it prints
   *  what's on screen). */
  beforeServerPdf?: () => Promise<unknown>;
}

export interface PrintActions {
  /** Browser print dialog (also "Save as PDF" there). */
  print: () => Promise<void>;
  /** Server-rendered PDF download. */
  downloadPdf: () => Promise<void>;
  /** null while unknown; false when the API answered 501. */
  pdfAvailable: boolean | null;
  busy: boolean;
}

export function usePrintActions({ documentId, title, getDocumentEl, pages, beforeServerPdf }: Options): PrintActions {
  const [pdfAvailable, setPdfAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  useEffect(() => {
    const ctrl = new AbortController();
    void isServerPdfAvailable(ctrl.signal).then((ok) => {
      if (!ctrl.signal.aborted) setPdfAvailable(ok);
    });
    return () => ctrl.abort();
  }, []);

  const print = useCallback(async () => {
    const el = getDocumentEl();
    if (!el || pagesRef.current.length === 0) return;
    try {
      await printDocument(el, pagesRef.current);
    } catch (err) {
      console.error("[print] failed:", err);
      alert(`Couldn't print.\n\n${err instanceof Error ? err.message : String(err)}`);
    }
  }, [getDocumentEl]);

  const downloadPdf = useCallback(async () => {
    setBusy(true);
    try {
      await beforeServerPdf?.().catch(() => undefined);
      const blob = await fetchServerPdf(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(title.trim() || "Untitled document").replace(/[/\\:*?"<>|]+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      if (err instanceof PdfNotConfiguredError) {
        setPdfAvailable(false);
        alert("PDF download isn't available on this server. Use Print… and choose “Save as PDF”.");
        return;
      }
      console.error("[pdf] failed:", err);
      alert(`Couldn't create the PDF.\n\n${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [beforeServerPdf, documentId, title]);

  return { print, downloadPdf, pdfAvailable, busy };
}

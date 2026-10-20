import { api } from "./client";

/** Mirrors tp-writer-api response shapes 1:1 — don't drift. */

export type PaperSize = "A4" | "LETTER" | "LEGAL" | "A3" | "A5";
export type Orientation = "portrait" | "landscape";

export interface PageLayout {
  paperSize: PaperSize;
  orientation: Orientation;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
}

export interface PageLayoutOverride {
  paperSize?: PaperSize;
  orientation?: Orientation;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
}

export interface EditorBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

export interface EditorOutput {
  time?: number;
  blocks: EditorBlock[];
  version?: string;
}

export interface DocumentPage {
  id: string;
  pageIndex: number;
  content: EditorOutput;
  layoutOverride: PageLayoutOverride | null;
  createdAt: string;
  updatedAt: string;
}

export interface FullDocument {
  id: string;
  title: string;
  defaultLayout: PageLayout;
  headerBlocks: unknown[];
  footerBlocks: unknown[];
  pageIds: string[];
  pages: DocumentPage[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentListItem {
  id: string;
  title: string;
  pageCount: number;
  defaultLayout: PageLayout;
  createdAt: string;
  updatedAt: string;
}

export function listDocuments(signal?: AbortSignal): Promise<DocumentListItem[]> {
  return api<DocumentListItem[]>("/documents", { signal });
}

export function getDocument(id: string, signal?: AbortSignal): Promise<FullDocument> {
  return api<FullDocument>(`/documents/${id}`, { signal });
}

export function createDocument(
  title: string,
  defaultLayout?: PageLayoutOverride,
): Promise<FullDocument> {
  return api<FullDocument>("/documents", {
    method: "POST",
    body: { title, ...(defaultLayout && { defaultLayout }) },
  });
}

export interface UpdateDocumentPatch {
  title?: string;
  defaultLayout?: PageLayoutOverride;
  headerBlocks?: unknown[];
  footerBlocks?: unknown[];
}

export function updateDocument(id: string, patch: UpdateDocumentPatch): Promise<FullDocument> {
  return api<FullDocument>(`/documents/${id}`, { method: "PATCH", body: patch });
}

export function deleteDocument(id: string): Promise<void> {
  return api<void>(`/documents/${id}`, { method: "DELETE" });
}

export function appendPage(documentId: string): Promise<FullDocument> {
  return api<FullDocument>(`/documents/${documentId}/pages`, { method: "POST" });
}

export function upsertPage(
  documentId: string,
  pageId: string,
  content: EditorOutput,
  layoutOverride: PageLayoutOverride | null = null,
): Promise<DocumentPage> {
  return api<DocumentPage>(`/documents/${documentId}/pages/${pageId}`, {
    method: "PUT",
    body: { content, layoutOverride },
  });
}

export function deletePage(documentId: string, pageId: string): Promise<void> {
  return api<void>(`/documents/${documentId}/pages/${pageId}`, { method: "DELETE" });
}

export function reorderPages(documentId: string, pageIds: string[]): Promise<FullDocument> {
  return api<FullDocument>(`/documents/${documentId}/pages/reorder`, {
    method: "POST",
    body: { pageIds },
  });
}

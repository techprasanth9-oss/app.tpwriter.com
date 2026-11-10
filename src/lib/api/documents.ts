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

export interface EditorBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

export interface EditorOutput {
  time?: number;
  blocks: EditorBlock[];
  version?: string;
}

/** Document metadata — everything except the content blocks. */
export interface DocumentMeta {
  id: string;
  title: string;
  /** Increments on every content save; sent back as `baseRevision`. */
  revision: number;
  defaultLayout: PageLayout;
  headerBlocks: unknown[];
  footerBlocks: unknown[];
  /** Named-style overrides (see lib/editor/styles/namedStyles.ts). */
  styles: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FullDocument extends DocumentMeta {
  blocks: EditorBlock[];
}

export interface DocumentListItem {
  id: string;
  title: string;
  defaultLayout: PageLayout;
  blockCount: number;
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
  defaultLayout?: Partial<PageLayout>,
): Promise<FullDocument> {
  return api<FullDocument>("/documents", {
    method: "POST",
    body: { title, ...(defaultLayout && { defaultLayout }) },
  });
}

export interface UpdateDocumentPatch {
  title?: string;
  defaultLayout?: Partial<PageLayout>;
  headerBlocks?: unknown[];
  footerBlocks?: unknown[];
  styles?: Record<string, unknown>;
}

export function updateDocument(id: string, patch: UpdateDocumentPatch): Promise<DocumentMeta> {
  return api<DocumentMeta>(`/documents/${id}`, { method: "PATCH", body: patch });
}

export function deleteDocument(id: string): Promise<void> {
  return api<void>(`/documents/${id}`, { method: "DELETE" });
}

export interface ContentSave {
  baseRevision: number;
  upserts: EditorBlock[];
  deletes: string[];
  /** Required when blocks are added, removed or reordered. */
  order?: string[];
}

/**
 * Save a block-level diff. Rejects with ApiError 409 `revision_conflict`
 * when the document changed since `baseRevision` (another tab / device).
 */
export function saveContent(
  id: string,
  body: ContentSave,
): Promise<{ revision: number; updatedAt: string }> {
  return api(`/documents/${id}/content`, { method: "PUT", body });
}

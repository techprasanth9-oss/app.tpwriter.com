import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as docsApi from "~/lib/api/documents";
import type {
  EditorOutput,
  PageLayoutOverride,
  UpdateDocumentPatch,
} from "~/lib/api/documents";

const LIST_KEY = ["documents", "list"] as const;
const DETAIL_KEY = (id: string) => ["documents", "detail", id] as const;

export function useDocumentList() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: ({ signal }) => docsApi.listDocuments(signal),
    staleTime: 30_000,
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: id ? DETAIL_KEY(id) : ["documents", "detail", "none"],
    queryFn: ({ signal }) => docsApi.getDocument(id!, signal),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { title: string; defaultLayout?: PageLayoutOverride }) =>
      docsApi.createDocument(vars.title, vars.defaultLayout),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.setQueryData(DETAIL_KEY(doc.id), doc);
    },
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateDocumentPatch }) =>
      docsApi.updateDocument(vars.id, vars.patch),
    onSuccess: (doc) => {
      qc.setQueryData(DETAIL_KEY(doc.id), doc);
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => docsApi.deleteDocument(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: DETAIL_KEY(id) });
      qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
}

export function useAppendPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => docsApi.appendPage(documentId),
    onSuccess: (doc) => qc.setQueryData(DETAIL_KEY(doc.id), doc),
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { documentId: string; pageId: string }) =>
      docsApi.deletePage(vars.documentId, vars.pageId),
    onSuccess: (_void, { documentId }) =>
      qc.invalidateQueries({ queryKey: DETAIL_KEY(documentId) }),
  });
}

export function useUpsertPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      documentId: string;
      pageId: string;
      content: EditorOutput;
      layoutOverride?: PageLayoutOverride | null;
    }) =>
      docsApi.upsertPage(
        vars.documentId,
        vars.pageId,
        vars.content,
        vars.layoutOverride ?? null,
      ),
    onSuccess: (_page, { documentId }) =>
      qc.invalidateQueries({ queryKey: DETAIL_KEY(documentId) }),
  });
}

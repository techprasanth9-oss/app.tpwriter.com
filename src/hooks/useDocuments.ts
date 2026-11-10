import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as docsApi from "~/lib/api/documents";
import type { FullDocument, PageLayout, UpdateDocumentPatch } from "~/lib/api/documents";

const LIST_KEY = ["documents", "list"] as const;
const DETAIL_KEY = (id: string) => ["documents", "detail", id] as const;

export function useDocumentList() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: ({ signal }) => docsApi.listDocuments(signal),
    staleTime: 30_000,
  });
}

/**
 * The full document (metadata + every block). Used to seed the editor
 * once; after that the editor is the source of truth, so this never
 * refetches in the background — a refetch would download the whole
 * document on every window focus for nothing.
 */
export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: id ? DETAIL_KEY(id) : ["documents", "detail", "none"],
    queryFn: ({ signal }) => docsApi.getDocument(id!, signal),
    enabled: !!id,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { title: string; defaultLayout?: Partial<PageLayout> }) =>
      docsApi.createDocument(vars.title, vars.defaultLayout),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.setQueryData<FullDocument>(DETAIL_KEY(doc.id), doc);
    },
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateDocumentPatch }) =>
      docsApi.updateDocument(vars.id, vars.patch),
    onSuccess: () => {
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

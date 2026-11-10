import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { deleteDraft, loadDraft, saveDraft } from "./drafts";

describe("drafts", () => {
  it("saves, loads, replaces and deletes a draft per document", async () => {
    expect(await loadDraft("doc1")).toBeNull();
    const blocks = [{ id: "a", type: "paragraph", data: { text: "unsaved" } }];
    await saveDraft({ documentId: "doc1", baseRevision: 3, blocks, savedAt: 1 });
    await saveDraft({ documentId: "doc2", baseRevision: 1, blocks: [], savedAt: 2 });
    expect(await loadDraft("doc1")).toEqual({ documentId: "doc1", baseRevision: 3, blocks, savedAt: 1 });

    await saveDraft({ documentId: "doc1", baseRevision: 4, blocks: [], savedAt: 5 });
    expect((await loadDraft("doc1"))?.baseRevision).toBe(4);

    await deleteDraft("doc1");
    expect(await loadDraft("doc1")).toBeNull();
    expect(await loadDraft("doc2")).not.toBeNull();
  });
});

import { NotificationsBell } from "~/components/comments";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { UserMenu } from "~/components/UserMenu";
import {
  useCreateDocument,
  useDeleteDocument,
  useDocumentList,
} from "~/hooks/useDocuments";

export function DocumentListPage() {
  const navigate = useNavigate();
  const { data: docs, isLoading, error } = useDocumentList();
  const createMut = useCreateDocument();
  const deleteMut = useDeleteDocument();
  const [newTitle, setNewTitle] = useState("");

  const handleCreate = async () => {
    const title = newTitle.trim() || "Untitled document";
    const doc = await createMut.mutateAsync({ title });
    setNewTitle("");
    navigate({ to: "/documents/$documentId", params: { documentId: doc.id } });
  };

  const handleOpen = (id: string) => {
    navigate({ to: "/documents/$documentId", params: { documentId: id } });
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
    await deleteMut.mutateAsync(id);
  };

  const mine = (docs ?? []).filter((d) => (d.role ?? "owner") === "owner");
  const shared = (docs ?? []).filter((d) => d.role && d.role !== "owner");

  const renderGrid = (list: typeof mine) => (
    <ul className="docs-grid">
      {list.map((doc) => {
        const owned = (doc.role ?? "owner") === "owner";
        return (
          <li key={doc.id} className="doc-card">
            <button type="button" className="doc-card-main" onClick={() => handleOpen(doc.id)}>
              <div className="doc-card-paper">
                <div className="doc-card-paper-inner">
                  <div className="doc-card-lines" aria-hidden>
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
              <div className="doc-card-title">{doc.title}</div>
              <div className="doc-card-meta">
                {owned ? `Updated ${formatRelative(doc.updatedAt)}` : `${doc.owner?.displayName ?? doc.owner?.email ?? "Someone"} · ${ROLE_NOUN[doc.role]}`}
              </div>
            </button>
            {owned && (
              <button
                type="button"
                className="doc-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(doc.id, doc.title);
                }}
                title="Delete document"
                aria-label={`Delete ${doc.title}`}
              >
                ×
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="docs-root">
      <header className="docs-header">
        <div className="docs-header-left">
          <h1 className="doc-brand">TP Writer</h1>
        </div>
        <div className="docs-header-right">
          <NotificationsBell
            onNavigate={(docId, threadId) =>
              navigate({ to: "/documents/$documentId", params: { documentId: docId }, search: { thread: threadId } })
            }
          />
          <UserMenu />
        </div>
      </header>

      <main className="docs-main">
        <section className="docs-new">
          <h2 className="docs-section-title">Create a document</h2>
          <div className="docs-new-row">
            <input
              type="text"
              className="docs-new-input"
              placeholder="Untitled document"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
            />
            <button
              type="button"
              className="doc-btn doc-btn-primary"
              onClick={handleCreate}
              disabled={createMut.isPending}
            >
              {createMut.isPending ? "Creating…" : "+ New document"}
            </button>
          </div>
        </section>

        <section className="docs-list">
          <h2 className="docs-section-title">Your documents</h2>
          {isLoading && <div className="docs-empty">Loading…</div>}
          {error && (
            <div className="docs-empty docs-error">
              Couldn't load your documents.
            </div>
          )}
          {!isLoading && !error && mine.length === 0 && (
            <div className="docs-empty">
              No documents yet. Create your first one above.
            </div>
          )}

          {mine.length > 0 && renderGrid(mine)}
        </section>

        {shared.length > 0 && (
          <section className="docs-list">
            <h2 className="docs-section-title">Shared with you</h2>
            {renderGrid(shared)}
          </section>
        )}
      </main>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

const ROLE_NOUN: Record<string, string> = { viewer: "can view", commenter: "can comment", editor: "can edit", owner: "owner" };

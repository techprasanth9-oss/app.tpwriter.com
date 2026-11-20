import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { canAtLeast, type PublicUser, type Role } from "~/lib/api/collab";
import { layoutCards } from "~/lib/editor/comments/layout";
import { initials, userName } from "~/lib/editor/comments/mentions";
import { DRAFT_KEY, useCommentHighlights } from "~/lib/editor/comments/useCommentHighlights";
import { CommentComposer, SEND_HINT } from "./CommentComposer";
import { CommentThreadCard } from "./CommentThreadCard";
import { useCommentMutations, useCommentThreads, useMediaQuery, useNow, type CommentsUi } from "./useComments";
import "./comments.css";

/** Below this viewport width the panel is an overlay drawer. */
export const COMMENTS_DRAWER_QUERY = "(max-width: 1099px)";
const CARD_GAP = 8;
const DEFAULT_CARD_HEIGHT = 96;

export interface CommentsPanelProps {
  documentId: string;
  /** The caller's role: viewers read, commenters+ write. */
  role: Role | null | undefined;
  currentUser: PublicUser | null;
  /** People who can be @mentioned (owner + members). */
  members: PublicUser[];
  /** The document element (`.tp-document`, the Editor.js root). */
  root: HTMLElement | null;
  /** The document's scroll container (`.doc-scroll`). */
  scrollContainer: HTMLElement | null;
  /** Bumps on document edits (debounced re-anchoring). */
  version: number;
  /** From the live-changes feed; any change refetches comments. */
  commentsVersion: number;
  /** State from `useCommentsUi()`. */
  ui: CommentsUi;
}

function revealInScroller(range: Range, scroller: HTMLElement | null) {
  const rect = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
  if (!rect || !scroller) return;
  const view = scroller.getBoundingClientRect();
  if (rect.top >= view.top + 40 && rect.bottom <= view.bottom - 40) return;
  scroller.scrollTo({ top: scroller.scrollTop + rect.top - view.top - view.height / 3, behavior: "smooth" });
}

/**
 * Comments side panel. Wide screens: a rail beside the document whose
 * cards sit level with their anchors and scroll with the document. Narrow
 * screens (< 1100px): an overlay drawer listing threads in document order.
 * Stays mounted while closed so highlights keep painting and clicking a
 * highlight opens its thread.
 */
export function CommentsPanel({
  documentId,
  role,
  currentUser,
  members,
  root,
  scrollContainer,
  version,
  commentsVersion,
  ui,
}: CommentsPanelProps) {
  const canComment = canAtLeast(role, "commenter") && !!currentUser;
  const drawer = useMediaQuery(COMMENTS_DRAWER_QUERY);
  const now = useNow();
  const [showResolved, setShowResolved] = useState(false);
  const titleId = useId();

  const query = useCommentThreads(documentId, commentsVersion, !!role);
  const threads = query.data;
  const mutations = useCommentMutations(documentId, currentUser);

  const { open, setOpen, activeThreadId, setActiveThreadId } = ui;
  const draft = canComment ? ui.draft : null;
  const activeRef = useRef(activeThreadId);
  activeRef.current = activeThreadId;

  const hl = useCommentHighlights(root, threads, activeThreadId, version, {
    scrollContainer,
    draftAnchor: draft?.anchor ?? null,
    showResolved,
    onActivate: (id) => {
      if (id) {
        setActiveThreadId(id);
        setOpen(true);
      } else if (activeRef.current) {
        setActiveThreadId(null);
      }
    },
  });

  const byId = useMemo(() => new Map((threads ?? []).map((t) => [t.id, t])), [threads]);
  const orphanSet = useMemo(() => new Set(hl.orphaned), [hl.orphaned]);
  const visible = useCallback(
    (id: string) => {
      const t = byId.get(id);
      return !!t && (showResolved || !t.resolved || id === activeThreadId);
    },
    [byId, showResolved, activeThreadId],
  );
  const placed = useMemo(() => hl.order.filter(visible), [hl.order, visible]);
  const orphans = useMemo(
    () => (threads ?? []).filter((t) => orphanSet.has(t.id) && (showResolved || !t.resolved || t.id === activeThreadId)),
    [threads, orphanSet, showResolved, activeThreadId],
  );
  const resolvedCount = (threads ?? []).filter((t) => t.resolved).length;

  // ── activation side effects ───────────────────────────────────────
  // A thread opened from elsewhere (URL, notification) that is resolved
  // should still be visible; reveal its anchor once it's located.
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!activeThreadId) {
      revealed.current = null;
      return;
    }
    if (revealed.current === activeThreadId) return;
    const range = hl.ranges.get(activeThreadId);
    if (orphanSet.has(activeThreadId)) {
      revealed.current = activeThreadId;
      return;
    }
    if (!range) return;
    revealed.current = activeThreadId;
    revealInScroller(range, scrollContainer);
  }, [activeThreadId, hl.positions, hl.ranges, orphanSet, scrollContainer]);

  // Follow the id swap when an optimistic thread is saved.
  const followCreated = (tempId: string, done: Promise<{ id: string } | null>) => {
    void done.then((saved) => {
      if (activeRef.current !== tempId) return;
      setActiveThreadId(saved ? saved.id : null);
    });
  };

  // ── rail layout ───────────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<Map<string, number>>(new Map());
  const [offset, setOffset] = useState(0);
  const [trackHeight, setTrackHeight] = useState(0);

  const measure = useCallback(() => {
    let changed = false;
    const next = new Map<string, number>();
    for (const [id, el] of cardEls.current) {
      const h = el.offsetHeight;
      next.set(id, h);
      if (heights.get(id) !== h) changed = true;
    }
    if (changed || next.size !== heights.size) setHeights(next);
    const vp = viewportRef.current;
    if (vp && scrollContainer) {
      const o = Math.round(scrollContainer.getBoundingClientRect().top - vp.getBoundingClientRect().top);
      if (o !== offset) setOffset(o);
      const th = scrollContainer.scrollHeight;
      if (th !== trackHeight) setTrackHeight(th);
    }
  }, [heights, offset, trackHeight, scrollContainer]);

  useLayoutEffect(() => {
    if (open && !drawer) measure();
  });

  useEffect(() => {
    if (!open || drawer || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => measure());
    cardEls.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [open, drawer, measure, placed.length, draft]);

  // Scroll the track with the document.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!open || drawer || !scrollContainer || !track) return;
    const sync = () => {
      track.style.transform = `translateY(${-scrollContainer.scrollTop}px)`;
    };
    sync();
    scrollContainer.addEventListener("scroll", sync, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", sync);
  }, [open, drawer, scrollContainer]);

  const tops = useMemo(() => {
    if (drawer) return new Map<string, number>();
    const slots = placed.map((id) => ({
      id,
      top: (hl.positions.get(id) ?? 0) + offset,
      height: heights.get(id) ?? DEFAULT_CARD_HEIGHT,
    }));
    if (draft) {
      slots.push({
        id: DRAFT_KEY,
        top: (hl.positions.get(DRAFT_KEY) ?? scrollContainer?.scrollTop ?? 0) + offset,
        height: heights.get(DRAFT_KEY) ?? 140,
      });
    }
    return layoutCards(slots, draft ? DRAFT_KEY : activeThreadId, CARD_GAP);
  }, [drawer, placed, hl.positions, offset, heights, draft, activeThreadId, scrollContainer]);

  const cardRef = (id: string) => (el: HTMLElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  };

  // ── keyboard ──────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (activeThreadId) {
      setActiveThreadId(null);
      e.preventDefault();
    } else if (drawer) {
      setOpen(false);
      e.preventDefault();
    }
  };

  if (!open) return null;

  const renderThread = (id: string, opts: { orphaned?: boolean; positioned?: boolean }) => {
    const t = byId.get(id);
    if (!t) return null;
    const top = tops.get(id);
    return (
      <CommentThreadCard
        key={id}
        ref={opts.positioned ? cardRef(id) : undefined}
        thread={t}
        active={activeThreadId === id}
        now={now}
        currentUser={currentUser}
        canComment={canComment}
        members={members}
        showQuote={drawer}
        orphaned={opts.orphaned}
        style={opts.positioned && top !== undefined ? { transform: `translateY(${top}px)` } : undefined}
        onActivate={() => {
          setActiveThreadId(id);
          const r = hl.ranges.get(id);
          if (r && drawer) revealInScroller(r, scrollContainer);
        }}
        onDeactivate={() => setActiveThreadId(null)}
        onReply={(body) => mutations.reply(id, body)}
        onResolve={(resolved) => {
          mutations.setResolved(id, resolved);
          if (resolved && !showResolved) setActiveThreadId(null);
        }}
        onEdit={(commentId, body) => mutations.edit(id, commentId, body)}
        onDelete={(commentId) => {
          if (t.comments[0]?.id === commentId) setActiveThreadId(null);
          mutations.remove(id, commentId);
        }}
      />
    );
  };

  const draftCard = draft && currentUser && (
    <div
      key={`draft-${draft.key}`}
      ref={drawer ? undefined : cardRef(DRAFT_KEY)}
      className="tp-thread tp-thread--draft is-active"
      style={!drawer && tops.has(DRAFT_KEY) ? { transform: `translateY(${tops.get(DRAFT_KEY)}px)` } : undefined}
      aria-label="New comment"
      role="group"
    >
      <div className="tp-comment-head">
        <span className="tp-avatar" aria-hidden="true">
          {initials(currentUser)}
        </span>
        <span className="tp-comment-author">{userName(currentUser)}</span>
      </div>
      <CommentComposer
        key={draft.key}
        members={members}
        label="New comment"
        autoFocus
        onSubmit={(body) => {
          const created = mutations.createThread(draft.anchor, body);
          ui.cancelDraft();
          if (created) {
            setActiveThreadId(created.temp.id);
            followCreated(created.temp.id, created.done);
          }
        }}
        onCancel={ui.cancelDraft}
      />
    </div>
  );

  const empty = query.isSuccess && !draft && placed.length === 0 && orphans.length === 0;

  return (
    <>
      {drawer && <div className="tp-comments-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        className={`tp-comments ${drawer ? "is-drawer" : "is-rail"}`}
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <header className="tp-comments-header">
          <h2 id={titleId} className="tp-comments-title">
            Comments
          </h2>
          <label className="tp-comments-toggle">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />
            Show resolved{resolvedCount ? ` (${resolvedCount})` : ""}
          </label>
          <button type="button" className="tp-cicon" aria-label="Close comments" onClick={() => setOpen(false)}>
            ×
          </button>
        </header>

        {mutations.error && (
          <div className="tp-comments-error" role="alert">
            <span>{mutations.error}</span>
            <button type="button" className="tp-cbtn tp-cbtn--quiet" onClick={mutations.clearError}>
              Dismiss
            </button>
          </div>
        )}
        {query.isError && (
          <div className="tp-comments-error" role="alert">
            <span>Couldn't load comments.</span>
            <button type="button" className="tp-cbtn tp-cbtn--quiet" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        )}

        {orphans.length > 0 && (
          <details className="tp-comments-orphans" open={orphans.some((t) => t.id === activeThreadId) || undefined}>
            <summary>
              {orphans.length} {orphans.length === 1 ? "comment" : "comments"} on deleted text
            </summary>
            <div className="tp-comments-stack">
              {orphans.map((t) => renderThread(t.id, { orphaned: true }))}
            </div>
          </details>
        )}

        <div
          ref={viewportRef}
          className="tp-comments-viewport"
          onWheel={
            drawer || !scrollContainer
              ? undefined
              : (e) => {
                  scrollContainer.scrollTop += e.deltaY;
                }
          }
        >
          {query.isPending && <p className="tp-comments-empty">Loading comments…</p>}
          {empty && (
            <p className="tp-comments-empty">
              {canComment
                ? "No comments yet. Select text and choose Comment (Ctrl+Alt+M) to start a discussion."
                : "No comments yet."}
            </p>
          )}
          {drawer ? (
            <div className="tp-comments-stack">
              {draftCard}
              {placed.map((id) => renderThread(id, {}))}
            </div>
          ) : (
            <div ref={trackRef} className="tp-comments-track" style={{ height: trackHeight || undefined }}>
              {placed.map((id) => renderThread(id, { positioned: true }))}
              {draftCard}
            </div>
          )}
        </div>
        <p className="tp-sr-only" aria-live="polite">
          {draft ? `Writing a new comment. ${SEND_HINT} to post.` : ""}
        </p>
      </aside>
    </>
  );
}

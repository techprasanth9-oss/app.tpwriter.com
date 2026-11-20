import { forwardRef, useState } from "react";
import type { Comment, CommentThread, PublicUser } from "~/lib/api/collab";
import { displayQuote } from "~/lib/editor/comments/anchor";
import { initials, parseBody, userName } from "~/lib/editor/comments/mentions";
import { isTemp } from "~/lib/editor/comments/threadCache";
import { fullTime, relativeTime } from "~/lib/editor/comments/time";
import { CommentComposer } from "./CommentComposer";

export function CommentBody({ body }: { body: string }) {
  return (
    <div className="tp-comment-body">
      {parseBody(body).map((p, i) =>
        p.type === "text" ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i} className="tp-mention-chip" data-user-id={p.userId}>
            @{p.name}
          </span>
        ),
      )}
    </div>
  );
}

export interface CommentThreadCardProps {
  thread: CommentThread;
  active: boolean;
  now: Date;
  currentUser: PublicUser | null;
  canComment: boolean;
  members: PublicUser[];
  /** Show the quoted text (stacked / orphaned layouts). */
  showQuote?: boolean;
  orphaned?: boolean;
  style?: React.CSSProperties;
  onActivate(): void;
  onDeactivate(): void;
  onReply(body: string): void;
  onResolve(resolved: boolean): void;
  onEdit(commentId: string, body: string): void;
  onDelete(commentId: string): void;
}

export const CommentThreadCard = forwardRef<HTMLElement, CommentThreadCardProps>(function CommentThreadCard(
  {
    thread,
    active,
    now,
    currentUser,
    canComment,
    members,
    showQuote,
    orphaned,
    style,
    onActivate,
    onDeactivate,
    onReply,
    onResolve,
    onEdit,
    onDelete,
  },
  ref,
) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const pending = isTemp(thread.id);
  const first = thread.comments[0];
  const replies = thread.comments.length - 1;
  const shown = active ? thread.comments : thread.comments.slice(0, 1);
  const author = first ? userName(first.author) : "Someone";

  const renderComment = (c: Comment, index: number) => {
    const own = !!currentUser && c.author.id === currentUser.id;
    const canManage = own && canComment && !pending && !isTemp(c.id);
    const isFirst = index === 0;
    return (
      <li key={c.id} className={`tp-comment${isTemp(c.id) ? " is-pending" : ""}`}>
        <div className="tp-comment-head">
          <span className="tp-avatar" aria-hidden="true">
            {initials(c.author)}
          </span>
          <span className="tp-comment-meta">
            <span className="tp-comment-author">{userName(c.author)}</span>
            <time className="tp-comment-time" dateTime={c.createdAt} title={fullTime(c.createdAt)}>
              {isTemp(c.id) ? "Posting…" : relativeTime(c.createdAt, now)}
              {c.editedAt ? " (edited)" : ""}
            </time>
          </span>
          {active && canManage && editing !== c.id && (
            <span className="tp-comment-tools">
              <button
                type="button"
                className="tp-cicon"
                aria-label={isFirst ? "Edit comment" : "Edit reply"}
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(c.id);
                  setConfirmDelete(null);
                }}
              >
                ✎
              </button>
              <button
                type="button"
                className="tp-cicon"
                aria-label={isFirst ? "Delete comment thread" : "Delete reply"}
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(c.id);
                }}
              >
                🗑
              </button>
            </span>
          )}
        </div>
        {editing === c.id ? (
          <CommentComposer
            members={members}
            initialBody={c.body}
            label="Edit comment"
            submitLabel="Save"
            autoFocus
            onSubmit={(body) => {
              setEditing(null);
              if (body !== c.body) onEdit(c.id, body);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <CommentBody body={c.body} />
        )}
        {confirmDelete === c.id && (
          <div className="tp-comment-confirm" role="alertdialog" aria-label="Confirm delete">
            <span>{isFirst ? "Delete this comment thread?" : "Delete this reply?"}</span>
            <button type="button" className="tp-cbtn" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="tp-cbtn tp-cbtn--danger"
              autoFocus
              onClick={() => {
                setConfirmDelete(null);
                onDelete(c.id);
              }}
            >
              Delete
            </button>
          </div>
        )}
      </li>
    );
  };

  const classes = [
    "tp-thread",
    active && "is-active",
    thread.resolved && "is-resolved",
    pending && "is-pending",
    orphaned && "is-orphaned",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      ref={ref}
      className={classes}
      style={style}
      data-thread-id={thread.id}
      aria-label={`Comment by ${author}${thread.resolved ? " (resolved)" : ""}`}
      aria-current={active ? "true" : undefined}
      tabIndex={active ? -1 : 0}
      onClick={() => {
        if (!active) onActivate();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if ((e.key === "Enter" || e.key === " ") && !active) {
          e.preventDefault();
          onActivate();
        } else if (e.key === "Escape" && active) {
          e.preventDefault();
          onDeactivate();
        }
      }}
    >
      <div className="tp-thread-top">
        {thread.resolved ? (
          <span className="tp-thread-status">
            ✓ Resolved{thread.resolvedBy ? ` by ${userName(thread.resolvedBy)}` : ""}
          </span>
        ) : orphaned ? (
          <span className="tp-thread-status tp-thread-status--warn">Text was deleted</span>
        ) : (
          <span />
        )}
        {canComment && !pending && (
          <button
            type="button"
            className="tp-cbtn tp-cbtn--quiet"
            aria-label={thread.resolved ? "Reopen thread" : "Resolve thread"}
            title={thread.resolved ? "Reopen" : "Mark as resolved and hide"}
            onClick={(e) => {
              e.stopPropagation();
              onResolve(!thread.resolved);
            }}
          >
            {thread.resolved ? "Reopen" : "✓ Resolve"}
          </button>
        )}
      </div>

      {(showQuote || orphaned) && thread.anchor.quote && (
        <blockquote className="tp-thread-quote">{displayQuote(thread.anchor.quote)}</blockquote>
      )}

      <ul className="tp-thread-comments">{shown.map(renderComment)}</ul>

      {!active && replies > 0 && (
        <div className="tp-thread-more">
          {replies} {replies === 1 ? "reply" : "replies"}
        </div>
      )}

      {active && canComment && !pending && !thread.resolved && (
        <div className="tp-thread-reply" onClick={(e) => e.stopPropagation()}>
          <CommentComposer
            members={members}
            label="Reply"
            placeholder="Reply or add others with @"
            submitLabel="Reply"
            collapsible
            onSubmit={onReply}
            onCancel={() => {}}
          />
        </div>
      )}
    </article>
  );
});

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listNotifications, markNotificationsRead, type MentionNotification } from "~/lib/api/collab";
import { bodyToPlain, initials, userName } from "~/lib/editor/comments/mentions";
import { fullTime, relativeTime } from "~/lib/editor/comments/time";
import { useNow } from "./useComments";
import "./comments.css";

export const notificationsKey = ["notifications"] as const;
export const NOTIFICATIONS_POLL_MS = 30_000;

/** `/documents/$id?thread=…` for a notification. */
export function notificationHref(n: Pick<MentionNotification, "documentId" | "threadId">): string {
  return `/documents/${encodeURIComponent(n.documentId)}?thread=${encodeURIComponent(n.threadId)}`;
}

export interface NotificationsBellProps {
  /** Navigate to the mention (e.g. `navigate({ to: "/documents/$id",
   *  params: { id: documentId }, search: { thread: threadId } })`). */
  onNavigate(documentId: string, threadId: string, notification: MentionNotification): void;
  /** Poll interval; defaults to 30s. */
  pollMs?: number;
}

function markRead(list: MentionNotification[] | undefined, ids: string[]): MentionNotification[] | undefined {
  return list?.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n));
}

/** Header button with the unread-mention count and a popover list. */
export function NotificationsBell({ onNavigate, pollMs = NOTIFICATIONS_POLL_MS }: NotificationsBellProps) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const now = useNow();
  const popId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const query = useQuery({
    queryKey: notificationsKey,
    queryFn: listNotifications,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  });
  const items = query.data ?? [];
  const unread = items.filter((n) => !n.read);

  const mark = useMutation({
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: notificationsKey });
      const prev = qc.getQueryData<MentionNotification[]>(notificationsKey);
      qc.setQueryData<MentionNotification[] | undefined>(notificationsKey, (l) => markRead(l, ids));
      return { prev };
    },
    onError: (_e, _ids, ctx) => qc.setQueryData(notificationsKey, ctx?.prev),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = unread.length
    ? `Notifications, ${unread.length} unread mention${unread.length === 1 ? "" : "s"}`
    : "Notifications";

  return (
    <div className="tp-bell" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="tp-bell-button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void query.refetch();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread.length > 0 && (
          <span className="tp-bell-badge" aria-hidden="true">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="tp-bell-popover" id={popId} role="dialog" aria-label="Mentions">
          <div className="tp-bell-head">
            <span className="tp-bell-title">Mentions</span>
            {unread.length > 0 && (
              <button type="button" className="tp-cbtn tp-cbtn--quiet" onClick={() => mark.mutate(unread.map((n) => n.id))}>
                Mark all as read
              </button>
            )}
          </div>
          {query.isPending ? (
            <p className="tp-bell-empty">Loading…</p>
          ) : query.isError && !items.length ? (
            <p className="tp-bell-empty">Couldn't load notifications.</p>
          ) : items.length === 0 ? (
            <p className="tp-bell-empty">No mentions yet. When someone @mentions you, it shows up here.</p>
          ) : (
            <ul className="tp-bell-list">
              {items.map((n) => (
                <li key={n.id}>
                  <a
                    href={notificationHref(n)}
                    className={`tp-bell-item${n.read ? "" : " is-unread"}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      if (!n.read) mark.mutate([n.id]);
                      setOpen(false);
                      onNavigate(n.documentId, n.threadId, n);
                    }}
                  >
                    <span className="tp-avatar" aria-hidden="true">
                      {initials(n.from)}
                    </span>
                    <span className="tp-bell-text">
                      <span className="tp-bell-line">
                        <strong>{userName(n.from)}</strong> mentioned you in <strong>{n.documentTitle || "Untitled"}</strong>
                      </span>
                      <span className="tp-bell-excerpt">{bodyToPlain(n.excerpt)}</span>
                      <time className="tp-bell-time" dateTime={n.createdAt} title={fullTime(n.createdAt)}>
                        {relativeTime(n.createdAt, now)}
                      </time>
                    </span>
                    {!n.read && <span className="tp-sr-only">(unread)</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

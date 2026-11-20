import type { ReactNode } from "react";
import { ArrowLeft, Check, CloudOff, CloudUpload, History, MessageSquare, MessageSquarePlus, UserPlus } from "lucide-react";
import type { AutosaveStatus } from "~/hooks/useAutosave";
import type { Presence } from "~/lib/api/collab";
import { initials } from "./ShareDialog";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

interface Props {
  title: string;
  onTitleChange: (next: string) => void;
  onBackClick?: () => void;
  autosaveStatus?: AutosaveStatus;
  lastSavedAt?: Date | null;
  /** Viewers / commenters can't rename. */
  readOnly?: boolean;
  /** Shown next to the title for read-only roles ("View only"). */
  accessLabel?: string | null;
  /** Other people on the document right now. */
  present?: Presence[];
  onShareClick?: () => void;
  /** Comments: panel toggle, and "add" when the person may comment. */
  commentsOpen?: boolean;
  onToggleComments?: () => void;
  onAddComment?: () => void;
  onHistoryClick?: () => void;
  /** Notifications bell. */
  notifications?: ReactNode;
}

/**
 * Document title bar: who/what on the left (back, document, title, save
 * state), collaboration on the right (people, comments, history,
 * notifications, Share). File actions live in the File menu, view
 * controls in the status bar — the header stays one calm row.
 */
export function DocumentHeader(props: Props) {
  const { title, readOnly = false, present = [] } = props;
  return (
    <header className="doc-header">
      <div className="dh-left">
        {props.onBackClick && (
          <button type="button" className="dh-icon-btn" onClick={props.onBackClick} title="All documents" aria-label="Back to documents">
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden />
          </button>
        )}
        <span className="dh-logo" aria-hidden>TP</span>
        <h1 className="sr-only">TP Writer</h1>
        <div className="dh-title">
          <input
            className="doc-title-input"
            type="text"
            value={title}
            onChange={(e) => props.onTitleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            placeholder="Untitled document"
            aria-label="Document title"
            readOnly={readOnly}
            size={Math.min(Math.max(title.length, 16), 48)}
            title={readOnly ? title : "Rename"}
          />
          {props.accessLabel && <span className="doc-access-badge">{props.accessLabel}</span>}
          {props.autosaveStatus && !readOnly && (
            <AutosaveIndicator status={props.autosaveStatus} lastSavedAt={props.lastSavedAt} />
          )}
        </div>
      </div>

      <div className="dh-right">
        {present.length > 0 && <PresenceAvatars present={present} />}
        <div className="dh-tools">
          {props.onAddComment && (
            <button
              type="button"
              className="dh-icon-btn"
              // Keep the document selection: don't take focus on press.
              onMouseDown={(e) => e.preventDefault()}
              onClick={props.onAddComment}
              aria-label="Add comment"
              title={`Add comment (${MOD}${MOD === "⌘" ? "⌥" : "Alt+"}M)`}
            >
              <MessageSquarePlus size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          {props.onToggleComments && (
            <button
              type="button"
              className={`dh-icon-btn${props.commentsOpen ? " is-active" : ""}`}
              onClick={props.onToggleComments}
              aria-label="Comments"
              aria-pressed={!!props.commentsOpen}
              title="Show comments"
            >
              <MessageSquare size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          {props.onHistoryClick && (
            <button type="button" className="dh-icon-btn" onClick={props.onHistoryClick} aria-label="Version history" title="Version history">
              <History size={18} strokeWidth={1.75} aria-hidden />
            </button>
          )}
          {props.notifications}
        </div>
        {props.onShareClick && (
          <button type="button" className="dh-share" onClick={props.onShareClick} title="Share with people or get a link">
            <UserPlus size={16} strokeWidth={2} aria-hidden />
            Share
          </button>
        )}
      </div>
    </header>
  );
}

function AutosaveIndicator({
  status,
  lastSavedAt,
}: {
  status: AutosaveStatus;
  lastSavedAt?: Date | null;
}) {
  const label =
    status === "saving"
      ? "Saving…"
      : status === "pending"
        ? "Saving…"
        : status === "error"
          ? "Offline — retrying…"
          : status === "conflict"
            ? "Not saved — conflict"
            : status === "saved"
              ? lastSavedAt
                ? `Saved ${formatRelative(lastSavedAt)}`
                : "Saved"
              : "";
  if (!label) return null;
  const tone = status === "error" || status === "conflict" ? "error" : status === "saving" || status === "pending" ? "saving" : "saved";
  const Icon = tone === "error" ? CloudOff : tone === "saving" ? CloudUpload : Check;
  return (
    <span
      className={`doc-save-status doc-save-status-${tone}`}
      role="status"
      title={lastSavedAt ? `Last saved ${lastSavedAt.toLocaleString()}` : undefined}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {label}
    </span>
  );
}

function formatRelative(then: Date): string {
  const diff = Date.now() - then.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return then.toLocaleString();
}

/** Everyone else on the document; editors show where their caret is. */
function PresenceAvatars({ present }: { present: Presence[] }) {
  const shown = present.slice(0, 4);
  return (
    <div className="doc-presence" role="group" aria-label={`${present.length} other ${present.length === 1 ? "person" : "people"} here`}>
      {shown.map((p) => {
        const name = p.displayName ?? p.email;
        return (
          <span
            key={p.id}
            className="tp-avatar doc-presence__avatar"
            style={{ background: p.color }}
            title={`${name} — ${p.state === "editing" ? "editing" : "viewing"}`}
            data-testid="presence-avatar"
          >
            {initials(name)}
          </span>
        );
      })}
      {present.length > shown.length && <span className="tp-avatar doc-presence__more">+{present.length - shown.length}</span>}
    </div>
  );
}

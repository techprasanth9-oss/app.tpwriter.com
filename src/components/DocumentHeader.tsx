import type { AutosaveStatus } from "~/hooks/useAutosave";
import type { PageLayout } from "~/lib/api/documents";

interface Props {
  title: string;
  onTitleChange: (next: string) => void;
  pageCount: number;
  zoom: number;
  onZoomChange: (next: number) => void;
  onImportClick: () => void;
  onExportClick: () => void;
  onSaveClick?: () => void;
  onBackClick?: () => void;
  onLayoutClick?: () => void;
  layout?: PageLayout;
  autosaveStatus?: AutosaveStatus;
  lastSavedAt?: Date | null;
  busy?: boolean;
}

const ZOOM_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function DocumentHeader({
  title,
  onTitleChange,
  pageCount,
  zoom,
  onZoomChange,
  onImportClick,
  onExportClick,
  onSaveClick,
  onBackClick,
  onLayoutClick,
  layout,
  autosaveStatus,
  lastSavedAt,
  busy = false,
}: Props) {
  return (
    <header className="doc-header">
      <div className="doc-header-left">
        {onBackClick && (
          <button
            type="button"
            className="doc-back-btn"
            onClick={onBackClick}
            title="Back to all documents"
            aria-label="Back to documents"
          >
            ‹
          </button>
        )}
        <h1 className="doc-brand">TP Writer</h1>
        <input
          className="doc-title-input"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Untitled document"
          aria-label="Document title"
        />
      </div>

      <div className="doc-header-right">
        {autosaveStatus && (
          <AutosaveIndicator status={autosaveStatus} lastSavedAt={lastSavedAt} />
        )}
        {onSaveClick && (
          <button
            type="button"
            className="doc-btn"
            onClick={onSaveClick}
            disabled={busy || autosaveStatus === "saving"}
            title="Save now"
          >
            Save
          </button>
        )}
        <button type="button" className="doc-btn" onClick={onImportClick} disabled={busy}>
          Import DOCX
        </button>
        <button type="button" className="doc-btn" onClick={onExportClick} disabled={busy}>
          Export DOCX
        </button>
        {onLayoutClick && (
          <button
            type="button"
            className="doc-btn"
            onClick={onLayoutClick}
            title="Page setup — paper size, orientation, margins"
          >
            Layout {layout ? `· ${layout.paperSize} ${layout.orientation.charAt(0).toUpperCase()}` : ""}
          </button>
        )}

        <span className="doc-divider" aria-hidden />

        <span className="doc-page-count">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </span>

        <div className="doc-zoom">
          <label className="doc-zoom-label" htmlFor="doc-zoom-select">
            Zoom
          </label>
          <select
            id="doc-zoom-select"
            className="doc-zoom-select"
            value={String(zoom)}
            onChange={(e) => onZoomChange(Number(e.target.value))}
          >
            {ZOOM_STOPS.map((z) => (
              <option key={z} value={z}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
        </div>
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
      : status === "error"
        ? "Save failed"
        : status === "saved"
          ? lastSavedAt
            ? `Saved ${formatRelative(lastSavedAt)}`
            : "Saved"
          : "";
  if (!label) return null;
  const cls =
    status === "error"
      ? "doc-save-status doc-save-status-error"
      : status === "saving"
        ? "doc-save-status doc-save-status-saving"
        : "doc-save-status doc-save-status-saved";
  return <span className={cls}>{label}</span>;
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

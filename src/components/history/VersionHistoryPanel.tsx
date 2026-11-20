import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  canAtLeast,
  createNamedVersion,
  getVersion,
  listVersions,
  restoreVersion,
  type Role,
  type VersionSummary,
} from "~/lib/api/collab";
import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import { diffStats, diffVersions } from "~/lib/editor/history/diffVersions";
import { userName } from "~/lib/editor/comments/mentions";
import { dayLabel, fullTime } from "~/lib/editor/comments/time";
import { HistoryPaper, VersionBlocks, VersionDiff } from "./VersionPreview";
import "../comments/comments.css";
import "./history.css";

export const versionsKey = (documentId: string) => ["versions", documentId] as const;
export const versionKey = (documentId: string, versionId: string) => ["version", documentId, versionId] as const;

export interface VersionHistoryPanelProps {
  documentId: string;
  role: Role | null | undefined;
  open: boolean;
  onClose(): void;
  /** The live document's blocks (e.g. from `editor.save()` when opening). */
  currentBlocks: EditorBlock[];
  currentRevision?: number;
  currentLayout?: PageLayout | null;
  currentStyles?: Record<string, unknown> | null;
  /** Save pending edits before naming / restoring (autosave flush). */
  onFlush?(): Promise<void> | void;
  /** After a restore: reload the editor at `revision`. */
  onRestored(revision: number): void;
}

export interface VersionGroup {
  label: string;
  versions: VersionSummary[];
}

/** Named versions first (newest first), then automatic ones by day. */
export function groupVersions(versions: readonly VersionSummary[], now = new Date()): VersionGroup[] {
  const sorted = [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision);
  const named = sorted.filter((v) => v.label);
  const days: VersionGroup[] = [];
  for (const v of sorted) {
    if (v.label) continue;
    const label = dayLabel(v.createdAt, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.versions.push(v);
    else days.push({ label, versions: [v] });
  }
  return named.length ? [{ label: "Named versions", versions: named }, ...days] : days;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const CURRENT = "current";

/**
 * Version history: full-screen dialog with the version list on the right
 * and a read-only preview (or a diff against the current document) on the
 * left. Editors can name the current version and restore old ones.
 */
export function VersionHistoryPanel({
  documentId,
  role,
  open,
  onClose,
  currentBlocks,
  currentRevision,
  currentLayout,
  currentStyles,
  onFlush,
  onRestored,
}: VersionHistoryPanelProps) {
  const qc = useQueryClient();
  const canView = canAtLeast(role, "editor");
  const titleId = useId();
  const [selected, setSelected] = useState<string>(CURRENT);
  const [compare, setCompare] = useState(false);
  const [changesOnly, setChangesOnly] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement;
    setSelected(CURRENT);
    setCompare(false);
    setConfirming(false);
    setNaming(false);
    setError(null);
    requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      const el = restoreFocus.current as HTMLElement | null;
      el?.focus?.();
    };
  }, [open]);

  const list = useQuery({
    queryKey: versionsKey(documentId),
    queryFn: () => listVersions(documentId),
    enabled: open && canView,
    staleTime: 0,
  });

  const selectedSummary = list.data?.find((v) => v.id === selected) ?? null;
  const version = useQuery({
    queryKey: versionKey(documentId, selected),
    queryFn: () => getVersion(documentId, selected),
    enabled: open && canView && selected !== CURRENT,
    staleTime: Infinity,
  });

  const diff = useMemo(
    () => (compare && version.data ? diffVersions(version.data.blocks, currentBlocks) : null),
    [compare, version.data, currentBlocks],
  );
  const stats = diff ? diffStats(diff) : null;

  const nameMut = useMutation({
    mutationFn: async (label: string) => {
      await onFlush?.();
      return createNamedVersion(documentId, label);
    },
    onSuccess: (v) => {
      setNaming(false);
      setName("");
      setError(null);
      qc.setQueryData<VersionSummary[]>(versionsKey(documentId), (l) => [v, ...(l ?? []).filter((x) => x.id !== v.id)]);
      void qc.invalidateQueries({ queryKey: versionsKey(documentId) });
    },
    onError: (e) => setError(`Couldn't name the version: ${e instanceof Error ? e.message : "error"}`),
  });

  const restoreMut = useMutation({
    mutationFn: async (versionId: string) => {
      await onFlush?.();
      return restoreVersion(documentId, versionId);
    },
    onSuccess: ({ revision }) => {
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: versionsKey(documentId) });
      onRestored(revision);
      onClose();
    },
    onError: (e) => {
      setConfirming(false);
      setError(`Couldn't restore: ${e instanceof Error ? e.message : "error"}`);
    },
  });

  const groups = useMemo(() => groupVersions(list.data ?? []), [list.data]);

  if (!open) return null;

  const canEdit = canView;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    if (confirming) setConfirming(false);
    else if (naming) setNaming(false);
    else onClose();
  };

  const versionTitle = (v: VersionSummary) => v.label || shortDate(v.createdAt);

  let stage: React.ReactNode;
  if (!canView) {
    stage = <p className="tp-history-blank">Version history is available to people who can edit this document.</p>;
  } else if (selected === CURRENT) {
    stage = (
      <HistoryPaper layout={currentLayout} styles={currentStyles} label="Current version">
        <VersionBlocks blocks={currentBlocks} />
      </HistoryPaper>
    );
  } else if (version.isPending) {
    stage = <p className="tp-history-blank">Loading version…</p>;
  } else if (version.isError || !version.data) {
    stage = (
      <p className="tp-history-blank" role="alert">
        Couldn't load this version.{" "}
        <button type="button" className="tp-cbtn tp-cbtn--quiet" onClick={() => void version.refetch()}>
          Retry
        </button>
      </p>
    );
  } else {
    stage = (
      <HistoryPaper
        layout={version.data.defaultLayout}
        styles={version.data.styles}
        label={compare ? "Changes since this version" : `Version: ${versionTitle(version.data)}`}
      >
        {diff ? <VersionDiff diff={diff} changesOnly={changesOnly} /> : <VersionBlocks blocks={version.data.blocks} />}
      </HistoryPaper>
    );
  }

  return (
    <div className="tp-history-backdrop">
      <div
        ref={dialogRef}
        className="tp-history"
        role="dialog"
        aria-modal="true"
        aria-label="Version history"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="tp-history-bar">
          <button type="button" className="tp-cicon" aria-label="Close version history" onClick={onClose}>
            ←
          </button>
          <h2 id={titleId} className="tp-history-title">
            {selected === CURRENT
              ? "Current version"
              : selectedSummary
                ? versionTitle(selectedSummary)
                : "Version history"}
          </h2>
          {selected !== CURRENT && canView && (
            <>
              <label className="tp-history-switch">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                Compare with current
              </label>
              {compare && (
                <label className="tp-history-switch">
                  <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />
                  Changes only
                </label>
              )}
              {stats && (
                <span className="tp-history-stats" aria-live="polite">
                  <span className="tp-stat-add">{stats.added} added</span>
                  <span className="tp-stat-del">{stats.removed} removed</span>
                  <span className="tp-stat-chg">{stats.changed} changed</span>
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  className="tp-cbtn tp-cbtn--primary tp-history-restore"
                  disabled={!version.data || restoreMut.isPending}
                  onClick={() => setConfirming(true)}
                >
                  Restore this version
                </button>
              )}
            </>
          )}
        </header>

        {error && (
          <div className="tp-history-error" role="alert">
            <span>{error}</span>
            <button type="button" className="tp-cbtn tp-cbtn--quiet" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="tp-history-body">
          <main className="tp-history-stage">{stage}</main>

          <nav className="tp-history-list" aria-label="Versions">
            {canEdit && (
              <div className="tp-history-name">
                {naming ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const label = name.trim();
                      if (label) nameMut.mutate(label);
                    }}
                  >
                    <label className="tp-history-name-label">
                      Name the current version
                      <input
                        className="tp-history-input"
                        value={name}
                        maxLength={120}
                        autoFocus
                        placeholder="e.g. Sent to legal"
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <div className="tp-history-name-actions">
                      <button type="button" className="tp-cbtn" onClick={() => setNaming(false)}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="tp-cbtn tp-cbtn--primary"
                        disabled={!name.trim() || nameMut.isPending}
                      >
                        {nameMut.isPending ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className="tp-cbtn tp-history-name-btn" onClick={() => setNaming(true)}>
                    Name current version
                  </button>
                )}
              </div>
            )}

            <ul className="tp-history-groups">
              <li>
                <button
                  type="button"
                  className="tp-history-item"
                  aria-current={selected === CURRENT ? "true" : undefined}
                  onClick={() => {
                    setSelected(CURRENT);
                    setCompare(false);
                  }}
                >
                  <span className="tp-history-item-title">Current version</span>
                  {currentRevision !== undefined && (
                    <span className="tp-history-item-meta">Revision {currentRevision}</span>
                  )}
                </button>
              </li>
              {canView && list.isPending && <li className="tp-history-note">Loading versions…</li>}
              {canView && list.isError && (
                <li className="tp-history-note" role="alert">
                  Couldn't load versions.{" "}
                  <button type="button" className="tp-cbtn tp-cbtn--quiet" onClick={() => void list.refetch()}>
                    Retry
                  </button>
                </li>
              )}
              {list.isSuccess && list.data.length === 0 && (
                <li className="tp-history-note">No earlier versions yet. Versions are saved automatically as you edit.</li>
              )}
              {groups.map((g) => (
                <li key={g.label} className="tp-history-group">
                  <h3 className="tp-history-group-label">{g.label}</h3>
                  <ul>
                    {g.versions.map((v) => (
                      <li key={v.id}>
                        <button
                          type="button"
                          className={`tp-history-item${v.label ? " is-named" : ""}`}
                          aria-current={selected === v.id ? "true" : undefined}
                          onClick={() => setSelected(v.id)}
                          title={fullTime(v.createdAt)}
                        >
                          <span className="tp-history-item-title">{v.label || timeOf(v.createdAt)}</span>
                          <span className="tp-history-item-meta">
                            {v.label ? `${shortDate(v.createdAt)} · ` : ""}
                            {v.createdBy ? userName(v.createdBy) : "Automatic"} · Revision {v.revision}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {confirming && selectedSummary && (
          <div className="tp-history-confirm-backdrop">
            <div
              className="tp-history-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`${titleId}-confirm`}
              aria-describedby={`${titleId}-confirm-desc`}
            >
              <h3 id={`${titleId}-confirm`} className="tp-history-confirm-title">
                Restore this version?
              </h3>
              <p id={`${titleId}-confirm-desc`}>
                The document will be replaced with “{versionTitle(selectedSummary)}” (revision {selectedSummary.revision}).
                The current document is saved as a version first, so you can switch back from history.
              </p>
              <div className="tp-history-confirm-actions">
                <button type="button" className="tp-cbtn" onClick={() => setConfirming(false)} autoFocus>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tp-cbtn tp-cbtn--primary"
                  disabled={restoreMut.isPending}
                  onClick={() => restoreMut.mutate(selectedSummary.id)}
                >
                  {restoreMut.isPending ? "Restoring…" : "Restore"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

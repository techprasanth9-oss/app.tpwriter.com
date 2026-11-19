import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  findMatches,
  matchesQuery,
  owningEditable,
  replaceAll,
  replaceMatch,
  type FindOptions,
} from "~/lib/editor/find/findEngine";
import "./FindReplaceDialog.css";

export interface FindReplaceDialogProps {
  open: boolean;
  mode: "find" | "replace";
  /** Element containing the Editor.js document. */
  root: HTMLElement | null;
  /** Bumps on every document change. */
  version: number;
  onClose(): void;
  /** Lets the app snapshot undo history before a replacement. */
  onBeforeReplace?(): Promise<void> | void;
  onAfterReplace?(): void;
}

const HL_ALL = "tp-find";
const HL_CURRENT = "tp-find-current";
const DEBOUNCE_MS = 150;
const PREFILL_MAX = 100;

function highlightsSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    !!CSS.highlights &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === "function"
  );
}

function clearHighlights() {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HL_ALL);
  CSS.highlights.delete(HL_CURRENT);
}

function isScrollable(el: Element): boolean {
  const s = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(s.overflowY + s.overflow);
}

/** Scroll the match into view when it's outside its scroll container. */
function revealRange(range: Range) {
  const start = range.startContainer;
  const el = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
  if (!el) return;
  const rect =
    typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : el.getBoundingClientRect();
  let container: Element | null = el.parentElement;
  while (container && !isScrollable(container)) container = container.parentElement;
  const view = container
    ? container.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  const margin = 24;
  const hidden =
    (rect.width === 0 && rect.height === 0) ||
    rect.top < view.top + margin ||
    rect.bottom > view.bottom - margin ||
    rect.left < view.left ||
    rect.right > view.right;
  if (hidden && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  }
}

function rangeIsLive(range: Range, root: HTMLElement | null): boolean {
  return !!root && root.contains(range.startContainer) && root.contains(range.endContainer);
}

/** Index of the first match starting at/after `anchor` (wraps to 0). */
function indexFrom(matches: Range[], anchor: Range | null): number {
  if (!anchor || !matches.length) return 0;
  for (let i = 0; i < matches.length; i++) {
    try {
      if (matches[i].compareBoundaryPoints(Range.START_TO_START, anchor) >= 0) return i;
    } catch {
      return 0;
    }
  }
  return 0;
}

export function FindReplaceDialog({
  open,
  mode,
  root,
  version,
  onClose,
  onBeforeReplace,
  onAfterReplace,
}: FindReplaceDialogProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [showReplace, setShowReplace] = useState(mode === "replace");
  const [matches, setMatches] = useState<Range[]>([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  /** Live range that anchors the current position across recomputes. */
  const anchorRef = useRef<Range | null>(null);
  const matchesRef = useRef<Range[]>([]);
  const indexRef = useRef(0);
  const statusTimer = useRef<number | undefined>(undefined);
  /** False until the user navigates to the current match after a new search. */
  const visitedRef = useRef(false);
  matchesRef.current = matches;
  indexRef.current = index;

  const opts: FindOptions = { matchCase, wholeWord };
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const queryRef = useRef(query);
  queryRef.current = query;

  /** Recompute matches now; keeps the position at/after the anchor. */
  const recompute = useCallback(
    (anchor?: Range | null) => {
      const list = root && queryRef.current ? findMatches(root, queryRef.current, optsRef.current) : [];
      const a = anchor !== undefined ? anchor : anchorRef.current;
      const i = indexFrom(list, a && rangeIsLive(a, root) ? a : null);
      matchesRef.current = list;
      indexRef.current = i;
      setMatches(list);
      setIndex(i);
      return list;
    },
    [root],
  );

  // ── open / close lifecycle ────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // Prefill from the current document selection; anchor at the caret.
    const sel = window.getSelection();
    if (sel && sel.rangeCount && root && root.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      anchorRef.current = r.cloneRange();
      const text = sel.toString();
      if (text && text.length <= PREFILL_MAX && !/[\r\n]/.test(text)) {
        setQuery(text);
        queryRef.current = text;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setShowReplace(mode === "replace");
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const input = findRef.current;
    if (input) {
      input.focus({ preventScroll: true });
      input.select();
    }
  }, [open, mode]);

  useEffect(() => {
    if (open) return;
    clearHighlights();
    setStatus(null);
  }, [open]);

  useEffect(
    () => () => {
      clearHighlights();
      window.clearTimeout(statusTimer.current);
    },
    [],
  );

  // ── debounced recompute on query / options / document changes ─────
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => recompute(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [open, query, matchCase, wholeWord, version, recompute]);

  useEffect(() => {
    visitedRef.current = false;
  }, [query, matchCase, wholeWord]);

  // Keep the anchor on the current match so edits don't reset the position.
  useEffect(() => {
    const m = matches[index];
    if (m) anchorRef.current = m;
  }, [matches, index]);

  // ── highlights ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !highlightsSupported()) return;
    const current = matches[index];
    const others = matches.filter((_, i) => i !== index);
    CSS.highlights.set(HL_ALL, new Highlight(...others));
    if (current) CSS.highlights.set(HL_CURRENT, new Highlight(current));
    else CSS.highlights.delete(HL_CURRENT);
  }, [open, matches, index]);

  // ── navigation ───────────────────────────────────────────────────
  const selectInDocument = useCallback((range: Range) => {
    const keep = document.activeElement as HTMLElement | null;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range.cloneRange());
    // Some browsers move focus into the editing host; keep it in the panel.
    if (keep && keep !== document.activeElement && typeof keep.focus === "function") {
      keep.focus({ preventScroll: true });
    }
  }, []);

  /** Fresh matches if the query changed but the debounce hasn't fired yet. */
  const currentList = useCallback(() => {
    const list = matchesRef.current;
    const first = list[0];
    const stale =
      !!queryRef.current &&
      (!first || !rangeIsLive(first, root) || !matchesQuery(first.toString(), queryRef.current, optsRef.current));
    return stale ? recompute() : list;
  }, [recompute, root]);

  const go = useCallback(
    (delta: 1 | -1) => {
      const list = currentList();
      if (!list.length) return;
      // The first Enter after a new search lands on the current match itself.
      const i = visitedRef.current ? (indexRef.current + delta + list.length) % list.length : indexRef.current;
      visitedRef.current = true;
      indexRef.current = i;
      setIndex(i);
      anchorRef.current = list[i];
      revealRange(list[i]);
      selectInDocument(list[i]);
    },
    [currentList, selectInDocument],
  );

  const close = useCallback(() => {
    const m = matchesRef.current[indexRef.current];
    clearHighlights();
    if (m && rangeIsLive(m, root)) {
      const editable = owningEditable(m.startContainer);
      editable?.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(m.cloneRange());
    } else {
      const editable = root?.querySelector<HTMLElement>('[contenteditable="true"]');
      editable?.focus({ preventScroll: true });
    }
    onClose();
  }, [onClose, root]);

  // ── replace ──────────────────────────────────────────────────────
  const flash = useCallback((text: string) => {
    setStatus(text);
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 2500);
  }, []);

  const replaceOne = useCallback(async () => {
    if (!root || busy) return;
    let list = currentList();
    let m = list[indexRef.current];
    if (!m) return;
    setBusy(true);
    try {
      await onBeforeReplace?.();
      // The snapshot hook may have touched the DOM; re-validate the target.
      if (!rangeIsLive(m, root) || !matchesQuery(m.toString(), queryRef.current, optsRef.current)) {
        list = recompute(m);
        m = list[indexRef.current];
        if (!m) return;
      }
      const inserted = replaceMatch(m, replacement);
      const after = root.ownerDocument.createRange();
      after.setStart(inserted.endContainer, inserted.endOffset);
      const next = recompute(after);
      if (next.length) {
        const n = next[indexRef.current];
        anchorRef.current = n;
        visitedRef.current = true;
        revealRange(n);
      } else {
        anchorRef.current = after;
      }
      onAfterReplace?.();
    } finally {
      setBusy(false);
    }
  }, [root, busy, currentList, onBeforeReplace, recompute, replacement, onAfterReplace]);

  const replaceEvery = useCallback(async () => {
    if (!root || busy || !queryRef.current) return;
    setBusy(true);
    try {
      await onBeforeReplace?.();
      const n = replaceAll(root, queryRef.current, replacement, optsRef.current);
      recompute(null);
      flash(n === 1 ? "Replaced 1" : `Replaced ${n}`);
      onAfterReplace?.();
    } finally {
      setBusy(false);
    }
  }, [root, busy, onBeforeReplace, replacement, recompute, flash, onAfterReplace]);

  // ── keyboard ─────────────────────────────────────────────────────
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const onFindKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    }
  };

  const onReplaceKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) void replaceEvery();
      else void replaceOne();
    }
  };

  if (!open) return null;

  const total = matches.length;
  const counter = !query ? "" : total ? `${index + 1} of ${total}` : "No results";
  const canNav = total > 0;

  return (
    <div className="tp-find" role="dialog" aria-label={showReplace ? "Find and replace" : "Find"} onKeyDown={onPanelKeyDown}>
      <div className="tp-find-row">
        <button
          type="button"
          className="tp-find-icon tp-find-toggle-mode"
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
          title={showReplace ? "Hide replace" : "Show replace"}
          onClick={() => setShowReplace((v) => !v)}
        >
          <span aria-hidden="true" className={showReplace ? "tp-find-chevron open" : "tp-find-chevron"}>
            ›
          </span>
        </button>
        <div className="tp-find-field">
          <label htmlFor="tp-find-input" className="tp-find-sr">
            Find
          </label>
          <input
            id="tp-find-input"
            ref={findRef}
            className="tp-find-input"
            type="text"
            placeholder="Find in document"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFindKeyDown}
          />
          <span className="tp-find-count" aria-live="polite">
            {counter}
          </span>
        </div>
        <button
          type="button"
          className="tp-find-icon"
          aria-label="Previous match"
          title="Previous (Shift+Enter)"
          disabled={!canNav}
          onClick={() => go(-1)}
        >
          <span aria-hidden="true">↑</span>
        </button>
        <button
          type="button"
          className="tp-find-icon"
          aria-label="Next match"
          title="Next (Enter)"
          disabled={!canNav}
          onClick={() => go(1)}
        >
          <span aria-hidden="true">↓</span>
        </button>
        <button type="button" className="tp-find-icon" aria-label="Close find" title="Close (Esc)" onClick={close}>
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {showReplace && (
        <div className="tp-find-row tp-find-replace-row">
          <span className="tp-find-spacer" aria-hidden="true" />
          <div className="tp-find-field">
            <label htmlFor="tp-replace-input" className="tp-find-sr">
              Replace with
            </label>
            <input
              id="tp-replace-input"
              ref={replaceRef}
              className="tp-find-input"
              type="text"
              placeholder="Replace with"
              autoComplete="off"
              spellCheck={false}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={onReplaceKeyDown}
            />
          </div>
        </div>
      )}

      <div className="tp-find-row tp-find-options">
        <span className="tp-find-spacer" aria-hidden="true" />
        <button
          type="button"
          className="tp-find-chip"
          aria-pressed={matchCase}
          aria-label="Match case"
          title="Match case"
          onClick={() => setMatchCase((v) => !v)}
        >
          Aa
        </button>
        <button
          type="button"
          className="tp-find-chip"
          aria-pressed={wholeWord}
          aria-label="Whole word"
          title="Whole word"
          onClick={() => setWholeWord((v) => !v)}
        >
          <span className="tp-find-ww">ab</span>
        </button>
        {status && (
          <span className="tp-find-status" role="status">
            {status}
          </span>
        )}
        {showReplace && (
          <span className="tp-find-actions">
            <button
              type="button"
              className="tp-find-btn"
              aria-label="Replace current match"
              disabled={!canNav || busy}
              onClick={() => void replaceOne()}
            >
              Replace
            </button>
            <button
              type="button"
              className="tp-find-btn tp-find-btn-primary"
              aria-label="Replace all matches"
              disabled={!canNav || busy}
              onClick={() => void replaceEvery()}
            >
              Replace all
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export default FindReplaceDialog;

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STOPS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

export interface DocumentStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  paragraphs: number;
}

/** Count words etc. in the editable text under `root` (skips atoms like
 *  page-break labels). */
export function documentStats(root: HTMLElement | null): DocumentStats {
  const stats: DocumentStats = { words: 0, characters: 0, charactersNoSpaces: 0, paragraphs: 0 };
  if (!root) return stats;
  root.querySelectorAll<HTMLElement>('[contenteditable="true"]').forEach((el) => {
    if (el.parentElement?.closest('[contenteditable="true"]')) return;
    let text = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement?.closest('[contenteditable="false"]')) text += n.textContent;
    }
    text = text.replace(/ /g, " ");
    if (!text.trim()) return;
    stats.paragraphs += 1;
    stats.words += text.trim().split(/\s+/).length;
    stats.characters += text.length;
    stats.charactersNoSpaces += text.replace(/\s/g, "").length;
  });
  return stats;
}

interface Props {
  root: HTMLElement | null;
  /** Bumps on every document change. */
  version: number;
  page: number;
  pageCount: number;
  zoom: number;
  onZoomChange: (next: number) => void;
}

/** Bottom bar: page position and live word count (click for details). */
export function StatusBar({ root, version, page, pageCount, zoom, onZoomChange }: Props) {
  const [stats, setStats] = useState<DocumentStats>(() => documentStats(root));
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setStats(documentStats(root)), 300);
    return () => window.clearTimeout(t);
  }, [root, version]);

  return (
    <footer className="tp-statusbar">
      <span>
        Page {Math.min(page + 1, pageCount)} of {pageCount}
      </span>
      <button type="button" className="tp-statusbar-btn" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
        {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
      </button>
      <ZoomControl zoom={zoom} onChange={onZoomChange} />
      {details && (
        <div className="tp-wordcount" role="dialog" aria-label="Word count">
          <dl>
            <dt>Pages</dt><dd>{pageCount}</dd>
            <dt>Words</dt><dd>{stats.words.toLocaleString()}</dd>
            <dt>Characters (no spaces)</dt><dd>{stats.charactersNoSpaces.toLocaleString()}</dd>
            <dt>Characters (with spaces)</dt><dd>{stats.characters.toLocaleString()}</dd>
            <dt>Paragraphs</dt><dd>{stats.paragraphs.toLocaleString()}</dd>
          </dl>
        </div>
      )}
    </footer>
  );
}

/** Word-style zoom: step buttons around a slider, percentage resets. */
function ZoomControl({ zoom, onChange }: { zoom: number; onChange: (z: number) => void }) {
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_STOPS.find((z) => z > zoom + 0.001) : [...ZOOM_STOPS].reverse().find((z) => z < zoom - 0.001);
    if (next) onChange(next);
  };
  return (
    <div className="tp-zoom" role="group" aria-label="Zoom">
      <button type="button" className="tp-statusbar-icon" onClick={() => step(-1)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" title="Zoom out">
        <Minus size={14} strokeWidth={2} aria-hidden />
      </button>
      <input
        type="range"
        className="tp-zoom-slider"
        min={ZOOM_MIN * 100}
        max={ZOOM_MAX * 100}
        step={5}
        value={Math.round(zoom * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label="Zoom level"
        aria-valuetext={`${Math.round(zoom * 100)}%`}
      />
      <button type="button" className="tp-statusbar-icon" onClick={() => step(1)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" title="Zoom in">
        <Plus size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" className="tp-statusbar-btn tp-zoom-value" onClick={() => onChange(1)} title="Reset to 100%">
        {Math.round(zoom * 100)}%
      </button>
    </div>
  );
}

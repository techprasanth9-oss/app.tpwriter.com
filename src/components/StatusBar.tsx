import { useEffect, useState } from "react";

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
}

/** Bottom bar: page position and live word count (click for details). */
export function StatusBar({ root, version, page, pageCount }: Props) {
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

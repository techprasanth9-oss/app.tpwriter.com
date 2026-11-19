import { useEffect, useRef, useState } from "react";
import { normalizeUrl } from "~/lib/editor/commands";
import { isSafeLinkUrl } from "~/lib/editor/safeUrl";

interface Props {
  open: boolean;
  /** Link at the caret, when editing an existing one. */
  initialUrl: string;
  /** Selected text; when empty the dialog asks for the text to insert. */
  selectedText: string;
  onApply: (url: string, text?: string) => Promise<boolean> | boolean;
  onRemove: () => void;
  onClose: () => void;
}

/** Insert / edit a hyperlink (Ctrl/⌘+K). */
export function LinkDialog({ open, initialUrl, selectedText, onApply, onRemove, onClose }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const askText = !selectedText && !initialUrl;

  useEffect(() => {
    if (!open) return;
    setUrl(initialUrl);
    setText("");
    setError(null);
    requestAnimationFrame(() => urlRef.current?.select());
  }, [open, initialUrl]);

  if (!open) return null;

  const submit = async () => {
    const normalized = normalizeUrl(url);
    if (!normalized || !isSafeLinkUrl(normalized)) {
      setError("Enter a web address (https://…), an email address, or a phone link.");
      return;
    }
    const ok = await onApply(normalized, askText ? text.trim() || undefined : undefined);
    if (ok) onClose();
    else setError("That link isn't allowed.");
  };

  return (
    <div className="layout-backdrop" onMouseDown={onClose}>
      <div
        className="layout-dialog tp-small-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={initialUrl ? "Edit link" : "Insert link"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="layout-header">
          <h2 className="layout-title">{initialUrl ? "Edit link" : "Insert link"}</h2>
          <button type="button" className="layout-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <form
          className="layout-body"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {askText && (
            <label className="tp-field">
              <span className="layout-label">Text to display</span>
              <input className="layout-select" value={text} onChange={(e) => setText(e.target.value)} placeholder="Link text" />
            </label>
          )}
          <label className="tp-field">
            <span className="layout-label">Address</span>
            <input
              ref={urlRef}
              className="layout-select"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com or name@example.com"
              aria-invalid={error ? true : undefined}
              autoComplete="url"
            />
          </label>
          {error && <div className="layout-error">{error}</div>}
          <button type="submit" hidden />
        </form>
        <footer className="layout-footer">
          {initialUrl && (
            <button
              type="button"
              className="doc-btn tp-btn-left"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove link
            </button>
          )}
          <button type="button" className="doc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="doc-btn doc-btn-primary" onClick={() => void submit()} disabled={!url.trim()}>
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}

interface BubbleProps {
  /** The link the caret is in, or null. */
  link: HTMLAnchorElement | null;
  /** Element the bubble is positioned within (the scroll container). */
  container: HTMLElement | null;
  onEdit: () => void;
  onRemove: () => void;
}

/** Small popover under a link at the caret: open / edit / remove. */
export function LinkBubble({ link, container, onEdit, onRemove }: BubbleProps) {
  if (!link || !container) return null;
  const href = link.getAttribute("href") ?? "";
  const rect = link.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  const top = rect.bottom - box.top + container.scrollTop + 6;
  const left = Math.max(8, Math.min(rect.left - box.left + container.scrollLeft, container.scrollWidth - 340));
  return (
    <div className="tp-link-bubble" style={{ top, left }} role="dialog" aria-label="Link" onMouseDown={(e) => e.preventDefault()}>
      <a href={href} target="_blank" rel="noopener noreferrer" className="tp-link-bubble-url" title={href}>
        {href}
      </a>
      <button type="button" className="tp-link-bubble-btn" onClick={onEdit}>Edit</button>
      <button type="button" className="tp-link-bubble-btn" onClick={onRemove}>Remove</button>
    </div>
  );
}

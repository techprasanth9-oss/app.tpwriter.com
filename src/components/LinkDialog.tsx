import { useEffect, useRef, useState } from "react";
import { normalizeUrl } from "~/lib/editor/commands";
import { isSafeLinkUrl } from "~/lib/editor/safeUrl";
import { Link2, Unlink } from "lucide-react";
import { Dialog, DialogButton, Field } from "./ui/Dialog";

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
    <Dialog
      open
      size="sm"
      title={initialUrl ? "Edit link" : "Insert link"}
      description={selectedText ? <>Link “{selectedText.length > 60 ? `${selectedText.slice(0, 60)}…` : selectedText}”</> : undefined}
      onClose={onClose}
      initialFocus={() => urlRef.current}
      footerStart={
        initialUrl ? (
          <DialogButton
            variant="ghost"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            <Unlink size={14} strokeWidth={1.75} aria-hidden />
            Remove link
          </DialogButton>
        ) : undefined
      }
      footer={
        <>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton variant="primary" onClick={() => void submit()} disabled={!url.trim()}>
            Apply
          </DialogButton>
        </>
      }
    >
      <form
        className="tp-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {askText && (
          <Field label="Text to display">
            <input className="tp-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Link text" />
          </Field>
        )}
        <Field
          label="Address"
          error={error}
          hint={!error ? "A web page, an email address or a phone number." : undefined}
        >
          <span className="tp-input-group tp-input-group--icon">
            <Link2 size={16} strokeWidth={1.75} aria-hidden className="tp-input-icon" />
            <input
              ref={urlRef}
              className="tp-input"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder="https://example.com or name@example.com"
              aria-invalid={error ? true : undefined}
              autoComplete="url"
            />
          </span>
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
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

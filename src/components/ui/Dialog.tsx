import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./dialog.css";

export type DialogSize = "sm" | "md" | "lg" | "xl";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Optional icon tile left of the title (e.g. for confirmations). */
  icon?: ReactNode;
  tone?: "default" | "danger";
  size?: DialogSize;
  children?: ReactNode;
  /** Buttons, right-aligned; `footerStart` sits on the left. */
  footer?: ReactNode;
  footerStart?: ReactNode;
  /** Element to focus on open (defaults to the first field / button). */
  initialFocus?: () => HTMLElement | null;
  /** Clicking the backdrop closes (default true; off for forms with edits). */
  dismissible?: boolean;
  /** Extra class on the panel (layout of a specific dialog's body). */
  className?: string;
  /** Body without padding (lists / tables that run edge to edge). */
  flush?: boolean;
  role?: "dialog" | "alertdialog";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Dialogs open on top of each other; only the top one handles keys. */
const stack: HTMLElement[] = [];

/**
 * The one modal dialog of the app: header (title, description, close),
 * scrolling body, footer. Portal to <body>, focus trapped inside, Esc
 * closes, focus returns to where it was, background scroll locked.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  tone = "default",
  size = "md",
  children,
  footer,
  footerStart,
  initialFocus,
  dismissible = true,
  className,
  flush,
  role = "dialog",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;
  /** A press that starts inside the panel and ends on the backdrop (text
   *  selection drag) must not close it. */
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    stack.push(panel);
    const focusFirst = () => {
      const target =
        initialFocusRef.current?.() ??
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        panel.querySelector(".tp-dialog__body")?.querySelector<HTMLElement>(FOCUSABLE) ??
        panel.querySelector<HTMLElement>(`.tp-dialog__footer button`) ??
        panel;
      target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === "text") target.select();
    };
    const frame = requestAnimationFrame(focusFirst);

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== panel) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(panel);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) document.body.style.overflow = prevOverflow;
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="tp-dialog-backdrop"
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (dismissible && downOnBackdrop.current && e.target === e.currentTarget) onClose();
        downOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        className={`tp-dialog tp-dialog--${size}${tone === "danger" ? " tp-dialog--danger" : ""}${children === undefined || children === null ? " tp-dialog--compact" : ""}${className ? ` ${className}` : ""}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <header className="tp-dialog__header">
          {icon && <span className="tp-dialog__icon" aria-hidden>{icon}</span>}
          <div className="tp-dialog__heading">
            <h2 className="tp-dialog__title" id={titleId}>{title}</h2>
            {description && <p className="tp-dialog__description" id={descId}>{description}</p>}
          </div>
          <button type="button" className="tp-dialog__close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        {children !== undefined && children !== null && (
          <div className={`tp-dialog__body${flush ? " tp-dialog__body--flush" : ""}`}>{children}</div>
        )}
        {(footer || footerStart) && (
          <footer className="tp-dialog__footer">
            {footerStart && <div className="tp-dialog__footer-start">{footerStart}</div>}
            <div className="tp-dialog__actions">{footer}</div>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Dialog buttons: one look everywhere. */
export function DialogButton({
  variant = "secondary",
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return (
    <button type="button" {...rest} className={`tp-btn tp-btn--${variant}${rest.className ? ` ${rest.className}` : ""}`}>
      {children}
    </button>
  );
}

/** Label + one control + optional hint / error, stacked. The label wraps
 *  the control, so they're associated without ids. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="tp-field-row">
      <span className="tp-field-label">{label}</span>
      {children}
      {error ? <span className="tp-field-error" role="alert">{error}</span> : hint ? <span className="tp-field-hint">{hint}</span> : null}
    </label>
  );
}

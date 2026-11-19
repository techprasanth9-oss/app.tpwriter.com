import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

/** Mouse-down on any ribbon control must not take focus (and the caret)
 *  away from the document. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

interface ButtonProps {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** Show the label as text next to the icon. */
  wide?: boolean;
  style?: CSSProperties;
}

export function RibbonButton({ label, onClick, children, active, disabled, wide, style }: ButtonProps) {
  return (
    <button
      type="button"
      className={`rb-btn${active ? " is-active" : ""}${wide ? " is-wide" : ""}`}
      onMouseDown={keepFocus}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      style={style}
    >
      {children}
      {wide && <span className="rb-btn-text">{label}</span>}
    </button>
  );
}

export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rb-group" role="group" aria-label={label}>
      <div className="rb-group-body">{children}</div>
      <div className="rb-group-label" aria-hidden>
        {label}
      </div>
    </div>
  );
}

interface DropdownProps {
  label: string;
  /** Button content. */
  trigger: ReactNode;
  disabled?: boolean;
  /** Render prop gets `close` to dismiss after a choice. */
  children: (close: () => void) => ReactNode;
  wide?: boolean;
}

/**
 * Ribbon button with a popover menu. Closes on outside click / Escape /
 * scroll. The menu is fixed-positioned from the trigger's rect: the ribbon
 * scrolls horizontally on narrow screens, which would clip an absolutely
 * positioned menu.
 */
export function Dropdown({ label, trigger, disabled, children, wide }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const menuWidth = 260;
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - menuWidth - 8)) });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="rb-dropdown" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={`rb-btn rb-dropdown-trigger${open ? " is-active" : ""}${wide ? " is-wide" : ""}`}
        onMouseDown={keepFocus}
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
      >
        {trigger}
        <span className="rb-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className="rb-menu"
          id={menuId}
          role="menu"
          onMouseDown={keepFocus}
          style={pos ? { position: "fixed", top: pos.top, left: pos.left } : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  checked,
}: {
  onSelect: () => void;
  children: ReactNode;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={`rb-menu-item${checked ? " is-checked" : ""}`}
      onMouseDown={keepFocus}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

// ── Colour palette ───────────────────────────────────────────────────────

const PALETTE = [
  "#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff",
  "#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff",
  "#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc",
  "#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0",
  "#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47",
];

interface ColorMenuProps {
  label: string;
  /** Glyph shown on the button, underlined with the last-used colour. */
  glyph: ReactNode;
  /** Label of the "no colour" choice, e.g. "Automatic" / "No highlight". */
  noneLabel: string;
  initial: string;
  disabled?: boolean;
  onPick: (color: string | null) => void;
}

/** Split button: click applies the last colour, the arrow opens a palette. */
export function ColorMenu({ label, glyph, noneLabel, initial, disabled, onPick }: ColorMenuProps) {
  const [last, setLast] = useState(initial);
  const customRef = useRef<HTMLInputElement>(null);
  const pick = (color: string | null, close?: () => void) => {
    if (color) setLast(color);
    onPick(color);
    close?.();
  };
  return (
    <div className="rb-split">
      <button
        type="button"
        className="rb-btn rb-split-main"
        onMouseDown={keepFocus}
        onClick={() => pick(last)}
        title={label}
        aria-label={label}
        disabled={disabled}
      >
        <span className="rb-color-glyph">
          {glyph}
          <span className="rb-color-bar" style={{ background: last }} />
        </span>
      </button>
      <Dropdown label={`${label} options`} trigger={null} disabled={disabled}>
        {(close) => (
          <div className="rb-palette">
            <MenuItem onSelect={() => pick(null, close)}>{noneLabel}</MenuItem>
            <div className="rb-swatches" role="group" aria-label="Colours">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rb-swatch"
                  style={{ background: c }}
                  title={c}
                  aria-label={c}
                  onMouseDown={keepFocus}
                  onClick={() => pick(c, close)}
                />
              ))}
            </div>
            <MenuItem onSelect={() => customRef.current?.click()}>Custom colour…</MenuItem>
            <input
              ref={customRef}
              type="color"
              className="rb-hidden-input"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => pick(e.target.value, close)}
            />
          </div>
        )}
      </Dropdown>
    </div>
  );
}

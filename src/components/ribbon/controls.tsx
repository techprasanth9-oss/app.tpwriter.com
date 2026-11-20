import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { ArrowDownRight, ChevronDown, type LucideIcon } from "lucide-react";

/** Mouse-down on any ribbon control must not take focus (and the caret)
 *  away from the document. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/** Icon sizes: small (row) buttons and large (icon-above-label) buttons. */
export const ICON_SM = 16;
export const ICON_LG = 22;
const STROKE = 1.75;

function Glyph({ icon: Icon, large }: { icon: LucideIcon; large?: boolean }) {
  return <Icon size={large ? ICON_LG : ICON_SM} strokeWidth={STROKE} aria-hidden focusable={false} className="rb-icon" />;
}

function Caret() {
  return <ChevronDown size={12} strokeWidth={2} aria-hidden focusable={false} className="rb-caret" />;
}

interface ButtonProps {
  /** Accessible name and tooltip (name + shortcut). */
  label: string;
  onClick: () => void;
  /** Lucide icon. */
  icon?: LucideIcon;
  /** Custom content (e.g. a styled letter) used instead of / next to the icon. */
  children?: ReactNode;
  /** Visible caption; shown next to the icon (small) or under it (large). */
  text?: string;
  /** Large button: icon above the caption. */
  large?: boolean;
  active?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}

export function RibbonButton({ label, onClick, icon, children, text, large, active, disabled, style }: ButtonProps) {
  return (
    <button
      type="button"
      className={`rb-btn${large ? " rb-btn-lg" : ""}${text && !large ? " is-wide" : ""}${active ? " is-active" : ""}`}
      onMouseDown={keepFocus}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      style={style}
    >
      {icon && <Glyph icon={icon} large={large} />}
      {children}
      {text && <span className="rb-btn-text">{text}</span>}
    </button>
  );
}

export function RibbonGroup({
  label,
  children,
  launcher,
}: {
  label: string;
  children: ReactNode;
  /** Word's "dialog launcher": a small corner button opening the group's
   *  full dialog. */
  launcher?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="rb-group" role="group" aria-label={label}>
      <div className="rb-group-body">{children}</div>
      <div className="rb-group-label">
        <span aria-hidden>{label}</span>
        {launcher && (
          <button
            type="button"
            className="rb-launcher"
            onMouseDown={keepFocus}
            onClick={launcher.onClick}
            disabled={launcher.disabled}
            aria-label={launcher.label}
            title={launcher.label}
          >
            <ArrowDownRight size={11} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/** Vertical stack of small controls inside a group (one per row). */
export function RibbonStack({ children }: { children: ReactNode }) {
  return <div className="rb-stack">{children}</div>;
}

interface DropdownProps {
  /** Accessible name and tooltip. */
  label: string;
  icon?: LucideIcon;
  /** Custom trigger content (rendered after the icon). */
  trigger?: ReactNode;
  /** Visible caption. */
  text?: string;
  large?: boolean;
  /** Caret-only trigger (the arrow half of a split button). */
  caretOnly?: boolean;
  disabled?: boolean;
  /** Render prop gets `close` to dismiss after a choice. */
  children: (close: () => void) => ReactNode;
}

/**
 * Ribbon button with a popover menu. Closes on outside click / Escape /
 * scroll. The menu is fixed-positioned from the trigger's rect: the ribbon
 * scrolls horizontally on narrow screens, which would clip an absolutely
 * positioned menu.
 */
export function Dropdown({ label, icon, trigger, text, large, caretOnly, disabled, children }: DropdownProps) {
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

  const cls = [
    "rb-btn",
    "rb-dropdown-trigger",
    large && "rb-btn-lg",
    caretOnly && "rb-caret-only",
    text && !large && "is-wide",
    open && "is-open",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rb-dropdown" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className={cls}
        onMouseDown={keepFocus}
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
      >
        {icon && <Glyph icon={icon} large={large} />}
        {trigger}
        {large ? (
          <span className="rb-btn-text">
            {text}
            <Caret />
          </span>
        ) : (
          <>
            {text && <span className="rb-btn-text">{text}</span>}
            <Caret />
          </>
        )}
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
  /** Icon shown on the button, underlined with the last-used colour. */
  icon?: LucideIcon;
  /** Custom glyph (e.g. a styled "A") used when there is no icon. */
  glyph?: ReactNode;
  /** Label of the "no colour" choice, e.g. "Automatic" / "No highlight". */
  noneLabel: string;
  initial: string;
  disabled?: boolean;
  /** Large single dropdown (icon + swatch above the caption) instead of a split button. */
  large?: boolean;
  text?: string;
  onPick: (color: string | null) => void;
}

function Palette({ noneLabel, pick, close }: { noneLabel: string; pick: (c: string | null, close?: () => void) => void; close: () => void }) {
  const customRef = useRef<HTMLInputElement>(null);
  return (
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
  );
}

/** Split button: click applies the last colour, the arrow opens a palette. */
export function ColorMenu({ label, icon, glyph, noneLabel, initial, disabled, large, text, onPick }: ColorMenuProps) {
  const [last, setLast] = useState(initial);
  const pick = (color: string | null, close?: () => void) => {
    if (color) setLast(color);
    onPick(color);
    close?.();
  };
  const swatch = (
    <span className={`rb-color-glyph${large ? " is-large" : ""}`} aria-hidden>
      {icon ? <Glyph icon={icon} large={large} /> : glyph}
      <span className="rb-color-bar" style={{ background: last }} />
    </span>
  );

  if (large) {
    return (
      <Dropdown label={label} trigger={swatch} text={text} large disabled={disabled}>
        {(close) => <Palette noneLabel={noneLabel} pick={pick} close={close} />}
      </Dropdown>
    );
  }

  return (
    <div className={`rb-split${disabled ? " is-disabled" : ""}`}>
      <button
        type="button"
        className="rb-btn rb-split-main"
        onMouseDown={keepFocus}
        onClick={() => pick(last)}
        title={label}
        aria-label={label}
        disabled={disabled}
      >
        {swatch}
      </button>
      <Dropdown label={`${label} options`} caretOnly disabled={disabled}>
        {(close) => <Palette noneLabel={noneLabel} pick={pick} close={close} />}
      </Dropdown>
    </div>
  );
}

/** Wraps a main button and a caret-only Dropdown so they read as one split button. */
export function SplitGroup({ children }: { children: ReactNode }) {
  return <div className="rb-split">{children}</div>;
}

/**
 * Horizontally scrollable ribbon panel: no wrapping, hidden scrollbar,
 * fade edges where content is clipped, and vertical wheel → horizontal scroll.
 */
export function RibbonPanel({ children, label }: { children: ReactNode; label: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Fade state is written straight to the wrapper's classList (no React
  // state), so measuring can never feed back into a re-render loop.
  const measure = () => {
    const el = ref.current;
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    wrap.classList.toggle("fade-left", el.scrollLeft > 1);
    wrap.classList.toggle("fade-right", el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Switching tabs swaps the groups without resizing the panel itself.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true });
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Fades are overlays on a wrapper, not a mask on the scroller: a mask would
  // also clip the fixed-position dropdown menus rendered inside the panel.
  return (
    <div ref={wrapRef} className="rb-panel-wrap">
      <div ref={ref} className="rb-panel" role="tabpanel" aria-label={label} onScroll={measure}>
        {children}
      </div>
    </div>
  );
}

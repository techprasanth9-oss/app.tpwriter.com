import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, PencilRuler } from "lucide-react";
import type { NamedStyle, StyleId, StyleSheet } from "~/lib/editor/styles/namedStyles";

/** Order of the gallery, as in Word's Styles group. */
export const GALLERY_STYLES: StyleId[] = [
  "normal",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "title",
  "subtitle",
  "quote",
];

interface Props {
  styles: StyleSheet;
  value: StyleId;
  disabled?: boolean;
  onApply: (id: StyleId) => void;
  onModify: () => void;
}

/** A tile's preview text, styled like the paragraphs it produces (scaled
 *  down to fit the tile). */
function previewStyle(s: NamedStyle): CSSProperties {
  const size = s.fontSize ?? 16;
  return {
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight ?? 400,
    fontStyle: s.italic ? "italic" : undefined,
    color: s.color,
    // Big styles still read as big, without spilling out of the tile.
    fontSize: Math.round(Math.min(Math.max(size * 0.55, 12), 17)),
  };
}

/**
 * Word-style styles gallery: live previews of each named style. Arrow
 * keys move between tiles (roving tabindex); the expand button shows all
 * styles in a popover with "Modify styles…".
 */
export function StyleGallery({ styles, value, disabled, onApply, onModify }: Props) {
  const [expanded, setExpanded] = useState(false);
  /** Strip scroll edges, for the previous / next buttons. */
  const [edges, setEdges] = useState({ start: true, end: false });
  const stripRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Keep the current style's tile in view.
  useEffect(() => {
    const strip = stripRef.current;
    const tile = strip?.querySelector<HTMLElement>(`[data-style="${value}"]`);
    if (strip && tile && (tile.offsetLeft < strip.scrollLeft || tile.offsetLeft + tile.offsetWidth > strip.scrollLeft + strip.clientWidth)) {
      strip.scrollTo({ left: tile.offsetLeft - 4 });
    }
  }, [value]);

  useEffect(() => {
    if (!expanded) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPopPos({ top: r.top, left: r.left, width: Math.max(r.width, 360) });
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !wrapRef.current?.contains(e.target as Node)) setExpanded(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  const page = (dir: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({ left: dir * strip.clientWidth, behavior: "smooth" });
  };
  const measureEdges = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const next = { start: strip.scrollLeft <= 1, end: strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  };
  useEffect(() => {
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tiles = Array.from(stripRef.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []);
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const go = (i: number) => {
      const t = tiles[(i + tiles.length) % tiles.length];
      t?.focus();
      t?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    if (e.key === "ArrowRight") { e.preventDefault(); go(at + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(tiles.length - 1); }
  };

  const tile = (id: StyleId, inPopover = false) => {
    const s = styles[id];
    const selected = value === id;
    return (
      <button
        key={id}
        type="button"
        role="option"
        aria-selected={selected}
        data-style={id}
        className={`sg-tile${selected ? " is-selected" : ""}`}
        tabIndex={inPopover ? 0 : selected ? 0 : -1}
        disabled={disabled}
        title={`${s.label} style`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          onApply(id);
          if (inPopover) setExpanded(false);
        }}
      >
        <span className="sg-sample" style={previewStyle(s)} aria-hidden>
          AaBbCc
        </span>
        <span className="sg-label">{s.label}</span>
      </button>
    );
  };

  return (
    <div className="sg" ref={wrapRef}>
      <div
        className="sg-strip"
        ref={stripRef}
        role="listbox"
        aria-label="Paragraph style"
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        onScroll={measureEdges}
      >
        {GALLERY_STYLES.map((id) => tile(id))}
      </div>
      <div className="sg-nav">
        <button type="button" className="sg-nav-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => page(-1)} disabled={disabled || edges.start} aria-label="Previous styles" title="Previous styles">
          <ChevronUp size={12} strokeWidth={2} aria-hidden />
        </button>
        <button type="button" className="sg-nav-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => page(1)} disabled={disabled || edges.end} aria-label="Next styles" title="Next styles">
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="sg-nav-btn sg-more"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setExpanded((x) => !x)}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={expanded}
          aria-label="All styles"
          title="All styles"
        >
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {expanded && popPos && (
        <div
          className="sg-pop"
          ref={popRef}
          style={{ top: popPos.top, left: popPos.left, width: popPos.width }}
        >
          <div className="sg-grid" role="listbox" aria-label="All paragraph styles">
            {GALLERY_STYLES.map((id) => tile(id, true))}
          </div>
          <div className="sg-pop-foot">
            <button
              type="button"
              className="sg-pop-action"
              onClick={() => {
                setExpanded(false);
                onModify();
              }}
            >
              <PencilRuler size={14} strokeWidth={1.75} aria-hidden />
              Modify styles…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

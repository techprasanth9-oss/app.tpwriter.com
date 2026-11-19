import { useEffect, useState } from "react";
import { FONT_OPTIONS } from "~/lib/editor/format/inlineStyle";
import { DEFAULT_STYLES, type NamedStyle, type StyleId, type StyleSheet } from "~/lib/editor/styles/namedStyles";

interface Props {
  open: boolean;
  styles: StyleSheet;
  onSave: (styles: StyleSheet) => Promise<void>;
  onClose: () => void;
}

const ORDER: StyleId[] = ["normal", "title", "subtitle", "heading1", "heading2", "heading3", "heading4", "quote"];

/** Edit the document's named styles (Word's "Modify Style"). Every
 *  paragraph using a style updates when it changes. */
export function StylesDialog({ open, styles, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<StyleSheet>(styles);
  const [selected, setSelected] = useState<StyleId>("normal");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(styles);
      setError(null);
    }
  }, [open, styles]);

  if (!open) return null;
  const style = draft[selected];
  const patch = (p: Partial<NamedStyle>) => setDraft((d) => ({ ...d, [selected]: { ...d[selected], ...p } }));
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const fontLabel = FONT_OPTIONS.find((f) => f.css === style.fontFamily)?.label ?? "";

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="layout-backdrop" onMouseDown={onClose}>
      <div className="layout-dialog tp-styles-dialog" role="dialog" aria-modal="true" aria-label="Modify styles" onMouseDown={(e) => e.stopPropagation()}>
        <header className="layout-header">
          <h2 className="layout-title">Modify styles</h2>
          <button type="button" className="layout-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="layout-body tp-styles-body">
          <ul className="tp-styles-list" role="listbox" aria-label="Styles">
            {ORDER.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={id === selected}
                  className={`tp-styles-item${id === selected ? " is-active" : ""}`}
                  onClick={() => setSelected(id)}
                >
                  {draft[id].label}
                </button>
              </li>
            ))}
          </ul>
          <div className="tp-styles-form">
            <label className="tp-form-field">
              <span className="layout-label">Font</span>
              <select
                className="layout-select"
                value={fontLabel}
                onChange={(e) => patch({ fontFamily: FONT_OPTIONS.find((f) => f.label === e.target.value)?.css })}
              >
                {!fontLabel && <option value="">Document default</option>}
                {FONT_OPTIONS.map((f) => (
                  <option key={f.label} value={f.label}>{f.label}</option>
                ))}
              </select>
            </label>
            <div className="tp-form-row">
              <label className="tp-form-field">
                <span className="layout-label">Size (px)</span>
                <input className="layout-select" type="number" min={6} max={120} value={style.fontSize ?? ""} onChange={(e) => patch({ fontSize: num(e.target.value) })} />
              </label>
              <label className="tp-form-field">
                <span className="layout-label">Colour</span>
                <input className="tp-color-input" type="color" value={toHex(style.color)} onChange={(e) => patch({ color: e.target.value })} />
              </label>
            </div>
            <div className="tp-form-row">
              <label className="tp-check">
                <input type="checkbox" checked={(style.fontWeight ?? 400) >= 600} onChange={(e) => patch({ fontWeight: e.target.checked ? 700 : 400 })} />
                Bold
              </label>
              <label className="tp-check">
                <input type="checkbox" checked={!!style.italic} onChange={(e) => patch({ italic: e.target.checked })} />
                Italic
              </label>
            </div>
            <div className="tp-form-row">
              <label className="tp-form-field">
                <span className="layout-label">Line spacing</span>
                <input className="layout-select" type="number" step={0.05} min={0.8} max={3} value={style.lineHeight ?? ""} onChange={(e) => patch({ lineHeight: num(e.target.value) })} />
              </label>
              <label className="tp-form-field">
                <span className="layout-label">Space before (px)</span>
                <input className="layout-select" type="number" min={0} max={200} value={style.spaceBefore ?? ""} onChange={(e) => patch({ spaceBefore: num(e.target.value) })} />
              </label>
              <label className="tp-form-field">
                <span className="layout-label">Space after (px)</span>
                <input className="layout-select" type="number" min={0} max={200} value={style.spaceAfter ?? ""} onChange={(e) => patch({ spaceAfter: num(e.target.value) })} />
              </label>
            </div>
            <div
              className="tp-style-preview"
              style={{
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                fontStyle: style.italic ? "italic" : undefined,
                color: style.color,
                lineHeight: style.lineHeight,
              }}
            >
              {style.label} — The quick brown fox jumps over the lazy dog.
            </div>
            <button type="button" className="doc-btn" onClick={() => setDraft((d) => ({ ...d, [selected]: DEFAULT_STYLES[selected] }))}>
              Reset “{style.label}” to default
            </button>
          </div>
          {error && <div className="layout-error">{error}</div>}
        </div>
        <footer className="layout-footer">
          <button type="button" className="doc-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="doc-btn doc-btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save styles"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function toHex(color: string | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#0f172a";
}

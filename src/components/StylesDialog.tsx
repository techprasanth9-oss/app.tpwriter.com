import { useEffect, useState } from "react";
import { Bold, Italic, RotateCcw } from "lucide-react";
import { FONT_OPTIONS } from "~/lib/editor/format/inlineStyle";
import { DEFAULT_STYLES, type NamedStyle, type StyleId, type StyleSheet } from "~/lib/editor/styles/namedStyles";
import { Dialog, DialogButton, Field } from "./ui/Dialog";

interface Props {
  open: boolean;
  styles: StyleSheet;
  onSave: (styles: StyleSheet) => Promise<void>;
  onClose: () => void;
}

const ORDER: StyleId[] = ["normal", "title", "subtitle", "heading1", "heading2", "heading3", "heading4", "quote"];

const SWATCHES = ["#0f172a", "#334155", "#475569", "#c2410c", "#1d4ed8", "#047857", "#7c3aed", "#b91c1c"];

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
  const changed = (id: StyleId) => JSON.stringify(draft[id]) !== JSON.stringify(styles[id]);
  const dirty = ORDER.some(changed);
  const bold = (style.fontWeight ?? 400) >= 600;

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
    <Dialog
      open
      size="lg"
      title="Modify styles"
      description="Changes apply to every paragraph that uses the style."
      onClose={onClose}
      dismissible={!dirty}
      className="tp-styles-dialog"
      flush
      footerStart={
        <DialogButton
          variant="ghost"
          onClick={() => setDraft((d) => ({ ...d, [selected]: DEFAULT_STYLES[selected] }))}
          disabled={JSON.stringify(style) === JSON.stringify(DEFAULT_STYLES[selected])}
        >
          <RotateCcw size={14} strokeWidth={1.75} aria-hidden />
          Reset “{style.label}”
        </DialogButton>
      }
      footer={
        <>
          <DialogButton onClick={onClose} disabled={saving}>Cancel</DialogButton>
          <DialogButton variant="primary" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save styles"}
          </DialogButton>
        </>
      }
    >
      <div className="tp-styles">
        <ul className="tp-styles__list" role="listbox" aria-label="Styles">
          {ORDER.map((id) => {
            const s = draft[id];
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={id === selected}
                  className={`tp-styles__item${id === selected ? " is-active" : ""}`}
                  onClick={() => setSelected(id)}
                >
                  <span
                    className="tp-styles__sample"
                    style={{
                      fontFamily: s.fontFamily,
                      fontWeight: s.fontWeight,
                      fontStyle: s.italic ? "italic" : undefined,
                      color: s.color,
                      fontSize: Math.min(Math.max((s.fontSize ?? 16) * 0.6, 12), 18),
                    }}
                    aria-hidden
                  >
                    Aa
                  </span>
                  <span className="tp-styles__name">{s.label}</span>
                  {changed(id) && <span className="tp-styles__dot" title="Changed" aria-label="changed" />}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="tp-styles__editor">
          <section className="tp-dialog-section" aria-label="Font">
            <h3 className="tp-dialog-section__title">Font</h3>
            <div className="tp-styles__font-row">
              <Field label="Typeface">
                <select
                  className="tp-input"
                  data-autofocus
                  value={fontLabel}
                  onChange={(e) => patch({ fontFamily: FONT_OPTIONS.find((f) => f.label === e.target.value)?.css })}
                >
                  {!fontLabel && <option value="">Document default</option>}
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.label} value={f.label}>{f.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Size (px)">
                <input className="tp-input" type="number" min={6} max={120} value={style.fontSize ?? ""} onChange={(e) => patch({ fontSize: num(e.target.value) })} />
              </Field>
            </div>
            <div className="tp-styles__font-row2">
              <div className="tp-field-row">
                <span className="tp-field-label" id="tp-style-emphasis">Emphasis</span>
                <div className="tp-segmented" role="group" aria-labelledby="tp-style-emphasis">
                  <button type="button" aria-pressed={bold} aria-label="Bold" title="Bold" onClick={() => patch({ fontWeight: bold ? 400 : 700 })}>
                    <Bold size={15} strokeWidth={2} aria-hidden />
                  </button>
                  <button type="button" aria-pressed={!!style.italic} aria-label="Italic" title="Italic" onClick={() => patch({ italic: !style.italic })}>
                    <Italic size={15} strokeWidth={2} aria-hidden />
                  </button>
                </div>
              </div>
              <div className="tp-field-row">
                <span className="tp-field-label" id="tp-style-colour">Colour</span>
                <div className="tp-swatches" role="group" aria-labelledby="tp-style-colour">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="tp-swatch"
                      style={{ background: c }}
                      aria-pressed={toHex(style.color).toLowerCase() === c}
                      aria-label={`Colour ${c}`}
                      title={c}
                      onClick={() => patch({ color: c })}
                    />
                  ))}
                  <label className="tp-swatch tp-swatch--custom" title="Custom colour">
                    <input type="color" value={toHex(style.color)} onChange={(e) => patch({ color: e.target.value })} aria-label="Custom colour" />
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section className="tp-dialog-section" aria-label="Spacing">
            <h3 className="tp-dialog-section__title">Spacing</h3>
            <div className="tp-grid-3">
              <Field label="Line spacing">
                <input className="tp-input" type="number" step={0.05} min={0.8} max={3} value={style.lineHeight ?? ""} onChange={(e) => patch({ lineHeight: num(e.target.value) })} />
              </Field>
              <Field label="Space before (px)">
                <input className="tp-input" type="number" min={0} max={200} value={style.spaceBefore ?? ""} onChange={(e) => patch({ spaceBefore: num(e.target.value) })} />
              </Field>
              <Field label="Space after (px)">
                <input className="tp-input" type="number" min={0} max={200} value={style.spaceAfter ?? ""} onChange={(e) => patch({ spaceAfter: num(e.target.value) })} />
              </Field>
            </div>
          </section>

          <section className="tp-dialog-section" aria-label="Preview">
            <h3 className="tp-dialog-section__title">Preview</h3>
            <div className="tp-styles__preview">
              <p className="tp-styles__context">The paragraph before, in the body style of the document.</p>
              <p
                style={{
                  fontFamily: style.fontFamily,
                  fontSize: style.fontSize,
                  fontWeight: style.fontWeight,
                  fontStyle: style.italic ? "italic" : undefined,
                  color: style.color,
                  lineHeight: style.lineHeight,
                  marginTop: style.spaceBefore ?? 0,
                  marginBottom: style.spaceAfter ?? 0,
                }}
              >
                {style.label}: the quick brown fox jumps over the lazy dog.
              </p>
              <p className="tp-styles__context">The paragraph after, showing the space between them.</p>
            </div>
          </section>

          {error && <div className="tp-alert" role="alert">{error}</div>}
        </div>
      </div>
    </Dialog>
  );
}

function toHex(color: string | undefined): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#0f172a";
}

import { useEffect, useState } from "react";
import type { Orientation, PageLayout, PaperSize } from "~/lib/api/documents";
import { pageSize } from "~/lib/editor/pagination/paper";
import { Dialog, DialogButton, Field } from "./ui/Dialog";

/**
 * Page setup — paper size, orientation, margins (Word's Page Setup), with
 * a live preview of the page. Margins are shown in inches; stored in px
 * at 96 DPI.
 */

const PAPER_SIZES: PaperSize[] = ["A4", "LETTER", "LEGAL", "A3", "A5"];

const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  A4: "A4 · 210 × 297 mm",
  LETTER: "US Letter · 8.5 × 11 in",
  LEGAL: "US Legal · 8.5 × 14 in",
  A3: "A3 · 297 × 420 mm",
  A5: "A5 · 148 × 210 mm",
};

const PRESETS = [
  { label: "Normal", detail: "1 in all round", value: { t: 96, r: 96, b: 96, l: 96 } },
  { label: "Narrow", detail: "0.5 in", value: { t: 48, r: 48, b: 48, l: 48 } },
  { label: "Moderate", detail: "1 in · 0.75 in", value: { t: 96, r: 72, b: 96, l: 72 } },
  { label: "Wide", detail: "1 in · 2 in", value: { t: 96, r: 192, b: 96, l: 192 } },
] as const;

const DPI = 96;
const toIn = (px: number) => Math.round((px / DPI) * 100) / 100;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Document-level layout. */
  defaultLayout: PageLayout;
  onApply: (layout: PageLayout) => Promise<void> | void;
}

export function LayoutDialog({ open, onClose, defaultLayout, onApply }: Props) {
  const [draft, setDraft] = useState<PageLayout>(defaultLayout);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the draft every time the dialog opens so re-opening doesn't
  // show stale edits from a prior cancel.
  useEffect(() => {
    if (open) {
      setDraft(defaultLayout);
      setError(null);
    }
  }, [open, defaultLayout]);

  if (!open) return null;

  const setMarginIn = (key: "marginTop" | "marginRight" | "marginBottom" | "marginLeft", raw: string) => {
    const inches = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(inches) || inches < 0 || inches > 4) return;
    setDraft((d) => ({ ...d, [key]: Math.round(inches * DPI) }));
  };

  const activePreset = PRESETS.find(
    (p) => draft.marginTop === p.value.t && draft.marginRight === p.value.r && draft.marginBottom === p.value.b && draft.marginLeft === p.value.l,
  );

  const handleApply = async () => {
    setSaving(true);
    setError(null);
    try {
      await onApply(draft);
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
      title="Page setup"
      description="Paper, orientation and margins for the whole document."
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose} disabled={saving}>Cancel</DialogButton>
          <DialogButton variant="primary" onClick={() => void handleApply()} disabled={saving}>
            {saving ? "Applying…" : "Apply"}
          </DialogButton>
        </>
      }
    >
      <div className="tp-pagesetup">
        <div className="tp-pagesetup__form">
          <section className="tp-dialog-section">
            <h3 className="tp-dialog-section__title">Paper</h3>
            <Field label="Paper size">
              <select
                className="tp-input"
                value={draft.paperSize}
                onChange={(e) => setDraft({ ...draft, paperSize: e.target.value as PaperSize })}
              >
                {PAPER_SIZES.map((size) => (
                  <option key={size} value={size}>{PAPER_SIZE_LABELS[size]}</option>
                ))}
              </select>
            </Field>
            <div className="tp-field-row tp-pagesetup__orient">
              <span className="tp-field-label" id="tp-orient-label">Orientation</span>
              <div className="tp-segmented" role="group" aria-labelledby="tp-orient-label">
                {(["portrait", "landscape"] as Orientation[]).map((o) => (
                  <button key={o} type="button" aria-pressed={draft.orientation === o} onClick={() => setDraft({ ...draft, orientation: o })}>
                    <span className={`tp-orient-glyph tp-orient-glyph--${o}`} aria-hidden />
                    {o === "portrait" ? "Portrait" : "Landscape"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="tp-dialog-section">
            <h3 className="tp-dialog-section__title">Margins</h3>
            <div className="tp-presets" role="group" aria-label="Margin presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="tp-preset"
                  aria-pressed={activePreset === p}
                  onClick={() => setDraft((d) => ({ ...d, marginTop: p.value.t, marginRight: p.value.r, marginBottom: p.value.b, marginLeft: p.value.l }))}
                >
                  <span className="tp-preset__name">{p.label}</span>
                  <span className="tp-preset__detail">{p.detail}</span>
                </button>
              ))}
            </div>
            <div className="tp-grid-2 tp-pagesetup__margins">
              {([
                ["Top", "marginTop"],
                ["Bottom", "marginBottom"],
                ["Left", "marginLeft"],
                ["Right", "marginRight"],
              ] as const).map(([label, key]) => (
                <MarginField key={key} label={label} px={draft[key]} onChange={(v) => setMarginIn(key, v)} />
              ))}
            </div>
          </section>
          {error && <div className="tp-alert" role="alert">{error}</div>}
        </div>

        <PagePreview layout={draft} />
      </div>
    </Dialog>
  );
}

/** Inches input that keeps what's typed ("0.", "1.2") while focused and
 *  follows the value when it changes from outside (presets). */
function MarginField({ label, px, onChange }: { label: string; px: number; onChange: (raw: string) => void }) {
  const [text, setText] = useState(String(toIn(px)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(toIn(px)));
  }, [px, focused]);
  return (
    <Field label={label}>
      <span className="tp-input-group">
        <input
          className="tp-input"
          type="number"
          min={0}
          max={4}
          step={0.1}
          value={text}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value);
          }}
        />
        <span className="tp-input-suffix">in</span>
      </span>
    </Field>
  );
}

/** The page to scale, with its margins as a dashed text area. */
function PagePreview({ layout }: { layout: PageLayout }) {
  const { width, height } = pageSize(layout);
  const scale = Math.min(170 / width, 220 / height);
  const pct = (px: number, of: number) => `${(px / of) * 100}%`;
  return (
    <figure className="tp-pagesetup__preview" aria-label="Preview">
      <div className="tp-preview-page" style={{ width: width * scale, height: height * scale }}>
        <div
          className="tp-preview-text"
          style={{
            top: pct(layout.marginTop, height),
            bottom: pct(layout.marginBottom, height),
            left: pct(layout.marginLeft, width),
            right: pct(layout.marginRight, width),
          }}
        >
          {Array.from({ length: 60 }, (_, i) => (
            <span key={i} style={{ width: i % 5 === 4 ? "60%" : "100%" }} />
          ))}
        </div>
      </div>
      <figcaption>
        {PAPER_SIZE_LABELS[layout.paperSize].split(" · ")[0]} · {layout.orientation === "portrait" ? "Portrait" : "Landscape"}
      </figcaption>
    </figure>
  );
}

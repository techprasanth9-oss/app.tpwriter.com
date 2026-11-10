import { useEffect, useState } from "react";
import type { Orientation, PageLayout, PaperSize } from "~/lib/api/documents";

/**
 * Page layout picker — paper size, orientation, margins. Applies to the
 * whole document; per-section layouts arrive with section breaks.
 */

const PAPER_SIZES: PaperSize[] = ["A4", "LETTER", "LEGAL", "A3", "A5"];

const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  A4: "A4 (210 × 297 mm)",
  LETTER: "US Letter (8.5 × 11 in)",
  LEGAL: "US Legal (8.5 × 14 in)",
  A3: "A3 (297 × 420 mm)",
  A5: "A5 (148 × 210 mm)",
};

const PRESET_MARGINS = [
  { label: "Normal (1 in)", value: 96 },
  { label: "Narrow (0.5 in)", value: 48 },
  { label: "Wide (1.5 in)", value: 144 },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Document-level layout. */
  defaultLayout: PageLayout;
  onApply: (layout: PageLayout) => Promise<void> | void;
}

export function LayoutDialog({
  open,
  onClose,
  defaultLayout,
  onApply,
}: Props) {
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

  const applyMarginPreset = (px: number) =>
    setDraft((d) => ({
      ...d,
      marginTop: px,
      marginRight: px,
      marginBottom: px,
      marginLeft: px,
    }));

  const setMargin = (key: keyof PageLayout, raw: string) => {
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0 || num > 400) return;
    setDraft((d) => ({ ...d, [key]: num }));
  };

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
    <div className="layout-backdrop" onClick={onClose}>
      <div
        className="layout-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Page layout"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="layout-header">
          <h2 className="layout-title">Page setup</h2>
          <button
            type="button"
            className="layout-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="layout-body">
          <section className="layout-section">
            <label className="layout-label" htmlFor="paper-size">
              Paper size
            </label>
            <select
              id="paper-size"
              className="layout-select"
              value={draft.paperSize}
              onChange={(e) =>
                setDraft({ ...draft, paperSize: e.target.value as PaperSize })
              }
            >
              {PAPER_SIZES.map((size) => (
                <option key={size} value={size}>
                  {PAPER_SIZE_LABELS[size]}
                </option>
              ))}
            </select>
          </section>

          <section className="layout-section">
            <span className="layout-label">Orientation</span>
            <div className="layout-orient">
              <OrientationButton
                active={draft.orientation === "portrait"}
                onClick={() =>
                  setDraft({ ...draft, orientation: "portrait" as Orientation })
                }
                label="Portrait"
                aspect="3/4"
              />
              <OrientationButton
                active={draft.orientation === "landscape"}
                onClick={() =>
                  setDraft({ ...draft, orientation: "landscape" as Orientation })
                }
                label="Landscape"
                aspect="4/3"
              />
            </div>
          </section>

          <section className="layout-section">
            <span className="layout-label">Margins (px at 96 DPI = 1 in)</span>
            <div className="layout-margins">
              <MarginInput
                label="Top"
                value={draft.marginTop}
                onChange={(v) => setMargin("marginTop", v)}
              />
              <MarginInput
                label="Right"
                value={draft.marginRight}
                onChange={(v) => setMargin("marginRight", v)}
              />
              <MarginInput
                label="Bottom"
                value={draft.marginBottom}
                onChange={(v) => setMargin("marginBottom", v)}
              />
              <MarginInput
                label="Left"
                value={draft.marginLeft}
                onChange={(v) => setMargin("marginLeft", v)}
              />
            </div>
            <div className="layout-presets">
              {PRESET_MARGINS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="layout-preset-btn"
                  onClick={() => applyMarginPreset(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          {error && <div className="layout-error">{error}</div>}
        </div>

        <footer className="layout-footer">
          <button
            type="button"
            className="doc-btn"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="doc-btn doc-btn-primary"
            onClick={handleApply}
            disabled={saving}
          >
            {saving ? "Applying…" : "Apply"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function OrientationButton({
  active,
  onClick,
  label,
  aspect,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  aspect: string;
}) {
  return (
    <button
      type="button"
      className={`layout-orient-btn${active ? " layout-orient-btn-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <div className="layout-orient-icon" style={{ aspectRatio: aspect }} />
      <span>{label}</span>
    </button>
  );
}

function MarginInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: string) => void;
}) {
  return (
    <label className="layout-margin">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={400}
        step={8}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * Data shapes + cleaners for the equation and text-box blocks. Kept free of
 * DOM / CSS imports so the DOCX exporter can share them.
 */

// ── Equation ────────────────────────────────────────────────────────────

export interface EquationData {
  latex: string;
  display: boolean;
}

export const MAX_LATEX_LENGTH = 4000;

/**
 * LaTeX is stored as plain text. The load-time sanitizer runs any string
 * containing "<" through DOMPurify, which would turn `x<y` into `x` (a
 * tag) or `x &lt; y`; KaTeX's `\lt` / `\gt` are the same symbols and
 * survive untouched. Entities left by an earlier HTML pass are decoded.
 */
export function cleanLatex(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/</g, "\\lt ")
    .replace(/>/g, "\\gt ")
    .slice(0, MAX_LATEX_LENGTH);
}

export function cleanEquationData(raw: unknown): EquationData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    latex: cleanLatex(d.latex),
    display: typeof d.display === "boolean" ? d.display : true,
  };
}

// ── Text box ────────────────────────────────────────────────────────────

export type TextBoxPreset = "note" | "info" | "warning" | "plain";
export type TextBoxAlign = "left" | "center" | "right";

export interface TextBoxData {
  text: string;
  preset: TextBoxPreset;
  width: number;
  align: TextBoxAlign;
}

export const TEXT_BOX_PRESETS: readonly TextBoxPreset[] = ["note", "info", "warning", "plain"];
export const TEXT_BOX_ALIGNS: readonly TextBoxAlign[] = ["left", "center", "right"];
export const TEXT_BOX_WIDTHS = [50, 75, 100] as const;

/** Fixed preset colours (hex, no '#'), shared by the editor CSS and export. */
export const TEXT_BOX_COLORS: Record<TextBoxPreset, { fill: string; border: string; label: string }> = {
  note: { fill: "FFF8C5", border: "D4A72C", label: "Note" },
  info: { fill: "DDF4FF", border: "54AEFF", label: "Info" },
  warning: { fill: "FFEBE9", border: "CF222E", label: "Warning" },
  plain: { fill: "FFFFFF", border: "8C959F", label: "Plain" },
};

export function cleanTextBoxData(raw: unknown): TextBoxData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const width = typeof d.width === "number" && Number.isFinite(d.width) ? Math.round(d.width) : 100;
  return {
    text: typeof d.text === "string" ? d.text : "",
    preset: TEXT_BOX_PRESETS.includes(d.preset as TextBoxPreset) ? (d.preset as TextBoxPreset) : "note",
    width: Math.min(100, Math.max(50, width)),
    align: TEXT_BOX_ALIGNS.includes(d.align as TextBoxAlign) ? (d.align as TextBoxAlign) : "center",
  };
}

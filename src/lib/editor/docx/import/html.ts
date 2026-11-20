/** HTML escaping + unit conversions shared by the import modules. */

/** Escape text for an HTML text node. Runs of spaces keep their width
 *  (all but the last space of a run become no-break spaces). */
export function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;")
    .replace(/ (?= )/g, "&nbsp;");
}

/** Escape a value for a double-quoted HTML attribute. */
export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;");
}

/** twips (1/20 pt) → CSS px at 96 dpi. */
export const twipsToPx = (t: number) => t / 15;
/** EMU → CSS px. */
export const emuToPx = (e: number) => e / 9525;
/** pt → px. */
export const ptToPx = (pt: number) => (pt * 4) / 3;

export const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** "FF0000" / "ff0000" → "#ff0000"; "auto" / junk → null. */
export function hexColor(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : null;
}

/** Word highlight names → hex. */
export const HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};

/** Uint8Array → base64 (chunked so large images don't blow the stack). */
export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

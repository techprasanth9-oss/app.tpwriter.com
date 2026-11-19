import type { Alignment } from "./format/paragraphFormat";
import type { StyleId } from "./styles/namedStyles";

/**
 * Word-compatible keyboard shortcuts. Ctrl on Windows/Linux, ⌘ on macOS
 * (either is accepted). Bold / italic / underline (Mod+B/I/U) are left to
 * the browser's contenteditable handling, which already does them.
 */
export type ShortcutAction =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "pageBreak" }
  | { type: "link" }
  | { type: "find" }
  | { type: "replace" }
  | { type: "align"; alignment: Alignment }
  | { type: "style"; styleId: StyleId }
  | { type: "fontSize"; direction: 1 | -1 }
  | { type: "clearFormatting" }
  | { type: "superscript" }
  | { type: "subscript" }
  | { type: "strike" }
  | { type: "list"; style: "ordered" | "unordered" }
  | { type: "copyFormat" }
  | { type: "pasteFormat" };

interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  const { shiftKey: shift, altKey: alt } = e;

  if (alt && !shift) {
    // Ctrl+Alt+1..4 → Heading 1..4 (Word).
    const digit = /^Digit([1-4])$/.exec(e.code);
    if (digit) return { type: "style", styleId: `heading${digit[1]}` as StyleId };
    return null;
  }

  if (key === "z") return shift ? { type: "redo" } : { type: "undo" };
  if (key === "y" && !shift) return { type: "redo" };
  if (e.key === "Enter" && !shift) return { type: "pageBreak" };
  if (key === "k" && !shift) return { type: "link" };
  if (key === "f" && !shift) return { type: "find" };
  if (key === "h" && !shift) return { type: "replace" };

  if (!shift) {
    if (key === "l") return { type: "align", alignment: "left" };
    if (key === "e") return { type: "align", alignment: "center" };
    if (key === "r") return { type: "align", alignment: "right" };
    if (key === "j") return { type: "align", alignment: "justify" };
    if (e.code === "Space") return { type: "clearFormatting" };
    if (e.code === "Equal") return { type: "subscript" };
  } else {
    if (e.code === "Period") return { type: "fontSize", direction: 1 };
    if (e.code === "Comma") return { type: "fontSize", direction: -1 };
    if (e.code === "Equal") return { type: "superscript" };
    if (key === "x") return { type: "strike" };
    if (key === "n") return { type: "style", styleId: "normal" };
    if (key === "l") return { type: "list", style: "unordered" };
    if (key === "c") return { type: "copyFormat" };
    if (key === "v") return { type: "pasteFormat" };
  }
  return null;
}

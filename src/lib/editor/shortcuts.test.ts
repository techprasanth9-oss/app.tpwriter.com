import { describe, expect, it } from "vitest";
import { matchShortcut } from "./shortcuts";

const key = (k: string, code: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key: k,
  code,
  ctrlKey: mods.ctrl ?? false,
  metaKey: mods.meta ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("matchShortcut", () => {
  it("maps Word shortcuts with Ctrl or Cmd", () => {
    expect(matchShortcut(key("z", "KeyZ", { ctrl: true }))).toEqual({ type: "undo" });
    expect(matchShortcut(key("Z", "KeyZ", { meta: true, shift: true }))).toEqual({ type: "redo" });
    expect(matchShortcut(key("k", "KeyK", { meta: true }))).toEqual({ type: "link" });
    expect(matchShortcut(key("e", "KeyE", { ctrl: true }))).toEqual({ type: "align", alignment: "center" });
    expect(matchShortcut(key(">", "Period", { ctrl: true, shift: true }))).toEqual({ type: "fontSize", direction: 1 });
    expect(matchShortcut(key("@", "Digit2", { ctrl: true, alt: true }))).toEqual({ type: "style", styleId: "heading2" });
    expect(matchShortcut(key("Enter", "Enter", { ctrl: true }))).toEqual({ type: "pageBreak" });
    expect(matchShortcut(key("C", "KeyC", { ctrl: true, shift: true }))).toEqual({ type: "copyFormat" });
  });

  it("leaves plain typing and browser-handled shortcuts alone", () => {
    expect(matchShortcut(key("z", "KeyZ"))).toBeNull();
    expect(matchShortcut(key("b", "KeyB", { ctrl: true }))).toBeNull();
    expect(matchShortcut(key("c", "KeyC", { ctrl: true }))).toBeNull();
    expect(matchShortcut(key("v", "KeyV", { meta: true }))).toBeNull();
  });
});

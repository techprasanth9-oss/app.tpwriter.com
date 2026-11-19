import type { BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import type { MenuConfig } from "@editorjs/editorjs/types/tools";
import { BLOCK_INLINE_TAGS } from "../sanitizers";
import {
  cleanTextBoxData,
  TEXT_BOX_ALIGNS,
  TEXT_BOX_COLORS,
  TEXT_BOX_PRESETS,
  TEXT_BOX_WIDTHS,
  type TextBoxAlign,
  type TextBoxData,
} from "./objectData";
import "./TextBoxTool.css";

const ALIGN_ICONS: Record<TextBoxAlign, string> = {
  left: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M2 3h8v6H2zm0 8h13v1.5H2zm0 3h13v1.5H2z"/></svg>',
  center:
    '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M4.5 3h8v6h-8zM2 11h13v1.5H2zm0 3h13v1.5H2z"/></svg>',
  right:
    '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M7 3h8v6H7zm-5 8h13v1.5H2zm0 3h13v1.5H2z"/></svg>',
};

const swatch = (hex: string, border: string) =>
  `<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:#${hex};border:1px solid #${border}"></span>`;

/**
 * Text box / callout: a shaded, bordered box holding one rich-text area.
 * Presets map to fixed colours (no arbitrary CSS is stored); width is a
 * percentage of the text column; Enter inserts a line break.
 */
export class TextBoxTool implements BlockTool {
  static get toolbox() {
    return {
      title: "Text box",
      icon: '<svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="13" height="11" rx="1.5"/><path d="M5 7h7M5 10h5"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  /** Enter stays inside the box (a `<br>`), it doesn't split the block. */
  static get enableLineBreaks(): boolean {
    return true;
  }

  static get sanitize() {
    return { text: BLOCK_INLINE_TAGS, preset: false, width: false, align: false };
  }

  static get conversionConfig() {
    return { export: "text", import: "text" };
  }

  private data: TextBoxData;
  private readonly block?: BlockAPI;
  private readonly readOnly: boolean;
  private wrapper: HTMLElement | null = null;
  private content: HTMLElement | null = null;

  constructor({ data, block, readOnly }: BlockToolConstructorOptions<TextBoxData>) {
    this.data = cleanTextBoxData(data);
    this.block = block;
    this.readOnly = readOnly;
  }

  render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("role", "note");
    const content = document.createElement("div");
    content.className = "tp-textbox__content";
    content.innerHTML = this.data.text;
    if (!this.readOnly) {
      content.contentEditable = "true";
      content.dataset.placeholder = "Type in the text box…";
      content.addEventListener("keydown", (e) => this.onKeyDown(e));
    }
    wrapper.appendChild(content);
    this.wrapper = wrapper;
    this.content = content;
    this.applyLook();
    return wrapper;
  }

  renderSettings(): MenuConfig {
    const presets = TEXT_BOX_PRESETS.map((preset) => ({
      title: TEXT_BOX_COLORS[preset].label,
      icon: swatch(TEXT_BOX_COLORS[preset].fill, TEXT_BOX_COLORS[preset].border),
      toggle: "tp-textbox-preset",
      isActive: this.data.preset === preset,
      closeOnActivate: true,
      onActivate: () => this.update({ preset }),
    }));
    const widths = TEXT_BOX_WIDTHS.map((width) => ({
      title: `Width ${width}%`,
      icon: `<span style="font-size:10px;font-weight:600">${width}</span>`,
      toggle: "tp-textbox-width",
      isActive: this.data.width === width,
      closeOnActivate: true,
      onActivate: () => this.update({ width }),
    }));
    const aligns = TEXT_BOX_ALIGNS.map((align) => ({
      title: `Align ${align}`,
      icon: ALIGN_ICONS[align],
      toggle: "tp-textbox-align",
      isActive: this.data.align === align,
      closeOnActivate: true,
      onActivate: () => this.update({ align }),
    }));
    return [...presets, ...widths, ...aligns];
  }

  save(): TextBoxData {
    const html = this.content ? this.content.innerHTML : this.data.text;
    // A lone <br> is what browsers leave behind in an emptied box.
    const text = html.replace(/^(\s|<br\s*\/?>)+$/i, "");
    return { ...this.data, text };
  }

  /** Conversion / merge support: append inline HTML. */
  merge(data: Partial<TextBoxData>): void {
    if (!this.content || typeof data.text !== "string") return;
    this.content.insertAdjacentHTML("beforeend", data.text);
  }

  private update(patch: Partial<TextBoxData>): void {
    this.data = cleanTextBoxData({ ...this.save(), ...patch });
    this.applyLook();
    this.block?.dispatchChange();
  }

  private applyLook(): void {
    const w = this.wrapper;
    if (!w) return;
    const { preset, width, align } = this.data;
    w.className = `tp-textbox tp-textbox--${preset} tp-textbox--align-${align}`;
    w.style.width = `${width}%`;
    w.setAttribute("aria-label", `${TEXT_BOX_COLORS[preset].label} text box`);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    insertLineBreak(this.content!);
  }
}

/** Insert a `<br>` at the caret (and a trailing one when at the very end,
 *  so the new empty line is visible and the caret can sit on it). */
export function insertLineBreak(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const br = document.createElement("br");
  range.insertNode(br);
  // Is anything visible after the new <br>?
  let after: Node | null = br;
  let hasContent = false;
  while (after && after !== root) {
    let sib = after.nextSibling;
    while (sib) {
      if (sib.nodeType !== Node.TEXT_NODE || (sib.textContent ?? "") !== "") {
        hasContent = true;
        break;
      }
      sib = sib.nextSibling;
    }
    if (hasContent) break;
    after = after.parentNode;
  }
  if (!hasContent) br.after(document.createElement("br"));
  const caret = document.createRange();
  caret.setStartAfter(br);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  root.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertLineBreak" }));
}

export default TextBoxTool;

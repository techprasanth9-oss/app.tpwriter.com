import type EditorJS from "@editorjs/editorjs";
import type { PageLayout } from "~/lib/api/documents";
import type { BlockAPI } from "@editorjs/editorjs";
import { FORMAT_TUNE, MAX_INDENT, type Alignment, type ParagraphFormat } from "./format/paragraphFormat";
import { FORMAT_EVENT, type FormatPatch } from "./tools/ParagraphFormatTune";
import type { EditorHistory } from "./history";
import { headingStyleId, PARAGRAPH_STYLE_IDS, type StyleId } from "./styles/namedStyles";
import {
  applyInlineStyle,
  changeCase as changeCaseIn,
  clearFormatting as clearFormattingIn,
  editableRoot,
  expandToWord,
  FONT_OPTIONS,
  fontLabelFor,
  selectionRanges,
  stepFontSize,
  type CaseMode,
  type StyleProp,
} from "./format/inlineStyle";
import { isSafeLinkUrl } from "./safeUrl";

/**
 * The one place UI (ribbon, shortcuts, menus) changes the document.
 * Everything goes through block data or tunes so it persists — the old
 * ribbon used `execCommand("justifyLeft")`, which only touched the DOM and
 * was lost on save.
 *
 * Character formatting edits the block's HTML, which *is* what gets saved:
 * bold/italic/underline/strike/super/subscript use execCommand (it toggles
 * them well); fonts, sizes, colours, clearing and case use the range-based
 * engine in format/inlineStyle.ts.
 */

export interface InlineState {
  /** Matching FONT_OPTIONS label, or null for a font not in the list. */
  font: string | null;
  /** Font size in pt (rounded to 0.5). */
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  /** href of the link at the caret, if any. */
  link: string | null;
}

/** Character formatting captured by the format painter. */
export interface CopiedFormat {
  fontFamily: string | null;
  fontSize: string | null;
  color: string | null;
  background: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

type PendingStyle = { prop: StyleProp; value: string | null };

export type ListStyle = "ordered" | "unordered" | "checklist";
export type ListCounter = "numeric" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

export interface BlockState {
  type: string | null;
  styleId: StyleId;
  alignment: Alignment;
  indent: number;
}

export class EditorCommands {
  /** Last block the caret was in. EditorJS forgets its current block when
   *  you click outside the editor — which clicking the ribbon is. */
  private lastBlockId: string | null = null;
  /** Last selection inside the document — restored before formatting,
   *  because ribbon selects / colour inputs take focus away from it. */
  private lastRange: Range | null = null;
  /** Styles to apply to the next typed text (caret between words). */
  private pending: { at: Range; styles: PendingStyle[] } | null = null;

  private readonly onSelectionChange = () => {
    const id = this.selectionBlockId();
    if (id) this.lastBlockId = id;
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0 && editableRoot(sel.anchorNode) && this.root.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      this.lastRange = range.cloneRange();
      if (
        this.pending &&
        (range.startContainer !== this.pending.at.startContainer ||
          range.startOffset !== this.pending.at.startOffset)
      ) {
        this.pending = null;
      }
    }
  };

  /** Typing right after a font change between words uses the new style. */
  private readonly onBeforeInput = (e: InputEvent) => {
    const pending = this.pending;
    if (!pending || e.inputType !== "insertText" || !e.data) return;
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.getRangeAt(0).collapsed) return;
    e.preventDefault();
    const span = document.createElement("span");
    for (const { prop, value } of pending.styles) {
      if (value !== null) span.style.setProperty(prop, value);
    }
    const text = document.createTextNode(e.data);
    span.appendChild(text);
    const range = sel.getRangeAt(0);
    range.insertNode(span);
    range.setStart(text, text.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    this.pending = null;
  };

  /** Block containing the live selection, if it's inside the document. */
  private selectionBlockId(): string | null {
    const node = document.getSelection()?.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el || !this.root.contains(el)) return null;
    return el.closest<HTMLElement>(".ce-block")?.dataset.id ?? null;
  }

  constructor(
    private readonly editor: EditorJS,
    private readonly history: EditorHistory,
    /** Element containing the editor, for selection tracking. */
    private readonly root: HTMLElement,
  ) {
    document.addEventListener("selectionchange", this.onSelectionChange);
    root.addEventListener("beforeinput", this.onBeforeInput);
  }

  dispose(): void {
    document.removeEventListener("selectionchange", this.onSelectionChange);
    this.root.removeEventListener("beforeinput", this.onBeforeInput);
  }

  // ── Queries ────────────────────────────────────────────────────────────

  currentBlock(): BlockAPI | undefined {
    // Read the live selection first: `selectionchange` is async, so a
    // shortcut pressed right after a click can arrive before it. The
    // tracked id covers focus having moved to the ribbon.
    for (const id of [this.selectionBlockId(), this.lastBlockId]) {
      const block = id ? this.editor.blocks.getById(id) : null;
      if (block) return block;
    }
    const index = this.editor.blocks.getCurrentBlockIndex();
    return index >= 0 ? this.editor.blocks.getBlockByIndex(index) : undefined;
  }

  private currentIndex(): number {
    const block = this.currentBlock();
    return block ? this.editor.blocks.getBlockIndex(block.id) : -1;
  }

  /** What the ribbon should show as active for the caret's block. */
  blockState(): BlockState {
    const block = this.currentBlock();
    const wrapper = block ? formatWrapper(block) : null;
    const level = Number(block?.holder.querySelector<HTMLElement>(".ce-header")?.dataset.level);
    const styleClass = Array.from(wrapper?.classList ?? []).find((c) => c.startsWith("tp-style-"));
    const styleId: StyleId =
      block?.name === "header"
        ? headingStyleId(level || 2)
        : ((styleClass?.slice("tp-style-".length) as StyleId | undefined) ?? "normal");
    return {
      type: block?.name ?? null,
      styleId,
      alignment: (wrapper?.dataset.alignment as Alignment | undefined) ?? "left",
      indent: Math.round(parseFloat(wrapper?.style.paddingLeft || "0") / 40) || 0,
    };
  }

  // ── Paragraph format ───────────────────────────────────────────────────

  setAlignment(alignment: Alignment): Promise<void> {
    return this.patchFormat({ alignment: alignment === "left" ? undefined : alignment });
  }

  changeIndent(delta: 1 | -1): Promise<void> {
    const next = Math.min(Math.max(this.blockState().indent + delta, 0), MAX_INDENT);
    return this.patchFormat({ indent: next || undefined });
  }

  setLineHeight(lineHeight: number | undefined): Promise<void> {
    return this.patchFormat({ lineHeight });
  }

  /** Apply a named style: headings become header blocks, the rest are
   *  paragraphs carrying a styleId. */
  async applyStyle(styleId: StyleId): Promise<void> {
    const block = this.currentBlock();
    if (!block) return;
    await this.history.record();

    const heading = /^heading([1-4])$/.exec(styleId);
    if (heading) {
      const level = Number(heading[1]);
      if (block.name === "header") {
        await this.editor.blocks.update(block.id, { level });
      } else {
        await this.convert(block, "header", { level });
      }
      await this.patchFormat({ styleId: undefined }, false);
      return;
    }

    if (block.name !== "paragraph") await this.convert(block, "paragraph");
    const paragraphStyle = (PARAGRAPH_STYLE_IDS as readonly string[]).includes(styleId)
      ? styleId
      : undefined;
    await this.patchFormat({ styleId: paragraphStyle }, false);
  }

  // ── Blocks ─────────────────────────────────────────────────────────────

  /** Space above / below the paragraph in px (null = style default). */
  setParagraphSpacing(spacing: { spaceBefore?: number | null; spaceAfter?: number | null }): Promise<void> {
    const patch: FormatPatch = {};
    if ("spaceBefore" in spacing) patch.spaceBefore = spacing.spaceBefore ?? undefined;
    if ("spaceAfter" in spacing) patch.spaceAfter = spacing.spaceAfter ?? undefined;
    return this.patchFormat(patch);
  }

  async listState(): Promise<{ style: ListStyle; counterType: string; start: number } | null> {
    const block = this.currentBlock();
    if (!block || block.name !== "list") return null;
    const data = ((await block.save())?.data ?? {}) as { style?: ListStyle; meta?: { counterType?: string; start?: number } };
    return {
      style: data.style ?? "unordered",
      counterType: data.meta?.counterType ?? "numeric",
      start: data.meta?.start ?? 1,
    };
  }

  /** Numbering format for the list at the caret (level 0; deeper levels
   *  cycle from it). Turns a bulleted list into a numbered one. */
  setListNumbering(counterType: ListCounter): Promise<void> {
    return this.patchList({ style: "ordered" }, { counterType });
  }

  /** First number of the list at the caret (1 = restart numbering). */
  setListStart(start: number): Promise<void> {
    return this.patchList({}, { start: Math.max(1, Math.round(start)) });
  }

  private async patchList(
    data: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const block = this.currentBlock();
    if (!block || block.name !== "list") return;
    await this.history.record();
    const saved = ((await block.save())?.data ?? {}) as Record<string, unknown>;
    await this.editor.blocks.update(block.id, {
      ...saved,
      ...data,
      meta: { ...((saved.meta as object) ?? {}), ...meta },
    });
  }

  async toggleList(style: ListStyle): Promise<void> {
    const block = this.currentBlock();
    if (!block) return;
    await this.history.record();
    if (block.name === "list") {
      const saved = await block.save();
      const current = (saved?.data as { style?: string } | undefined)?.style;
      if (current === style) await this.convert(block, "paragraph");
      else await this.editor.blocks.update(block.id, { style });
      return;
    }
    await this.convert(block, "list", { style });
  }

  async insertBlock(type: string, data: Record<string, unknown> = {}): Promise<void> {
    await this.history.record();
    const index = this.currentIndex();
    this.editor.blocks.insert(type, data, undefined, index >= 0 ? index + 1 : undefined, true);
  }

  /** Section break (next page); the following section uses `layout`. */
  async insertSectionBreak(layout: Partial<PageLayout>): Promise<void> {
    await this.history.record();
    const index = this.currentIndex();
    const at = index >= 0 ? index + 1 : this.editor.blocks.getBlocksCount();
    this.editor.blocks.insert("sectionBreak", { layout }, undefined, at, false);
    this.editor.blocks.insert("paragraph", { text: "" }, undefined, at + 1, true);
  }

  /**
   * The section-break block that starts the caret's section, or null when
   * the caret is in the first section (whose layout is the document's).
   */
  async currentSection(): Promise<{ breakId: string; layout: Partial<PageLayout> } | null> {
    const index = this.currentIndex();
    for (let i = index; i >= 0; i--) {
      const block = this.editor.blocks.getBlockByIndex(i);
      if (block?.name !== "sectionBreak" || i === index) continue;
      const data = ((await block.save())?.data ?? {}) as { layout?: Partial<PageLayout> };
      return { breakId: block.id, layout: data.layout ?? {} };
    }
    return null;
  }

  async setSectionLayout(breakId: string, layout: Partial<PageLayout>): Promise<void> {
    await this.history.record();
    await this.editor.blocks.update(breakId, { layout });
  }

  async insertTableOfContents(maxLevel = 3): Promise<void> {
    await this.history.record();
    const index = this.currentIndex();
    this.editor.blocks.insert("toc", { maxLevel, title: "Contents" }, undefined, index >= 0 ? index : 0, false);
  }

  /** Insert a footnote reference at the caret; returns its id (the caller
   *  creates the note text). */
  async insertFootnote(): Promise<string | null> {
    const range = this.restoreSelection();
    if (!range || !editableRoot(range.startContainer)) return null;
    await this.history.record();
    const id = `fn${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ref = document.createElement("sup");
    ref.className = "tp-fn-ref";
    ref.dataset.fnId = id;
    ref.contentEditable = "false";
    ref.dataset.mutationFree = "true";
    ref.textContent = "*";
    range.collapse(false);
    range.insertNode(ref);
    range.setStartAfter(ref);
    range.collapse(true);
    setSelection(range);
    // The ref's own mutations are ignored by EditorJS; nudge a change.
    editableRoot(ref)?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return id;
  }

  async insertPageBreak(): Promise<void> {
    await this.history.record();
    const index = this.currentIndex();
    const at = index >= 0 ? index + 1 : this.editor.blocks.getBlocksCount();
    this.editor.blocks.insert("pageBreak", {}, undefined, at, false);
    // Give the user somewhere to type on the new page.
    this.editor.blocks.insert("paragraph", { text: "" }, undefined, at + 1, true);
  }

  // ── Inline ─────────────────────────────────────────────────────────────

  inline(command: "bold" | "italic" | "underline" | "strikeThrough" | "superscript" | "subscript"): void {
    this.restoreSelection();
    document.execCommand(command, false);
  }

  setFontFamily(css: string | null): Promise<void> {
    return this.styleSelection("font-family", css);
  }

  setFontSize(pt: number | null): Promise<void> {
    return this.styleSelection("font-size", pt === null ? null : `${pt}pt`);
  }

  /** Word's Grow / Shrink Font (Ctrl+Shift+> / <). */
  stepFontSize(direction: 1 | -1): Promise<void> {
    return this.setFontSize(stepFontSize(this.inlineState().sizePt, direction));
  }

  /** null = automatic (inherit the paragraph style's colour). */
  setTextColor(color: string | null): Promise<void> {
    return this.styleSelection("color", color);
  }

  /** null = no highlight. */
  setHighlight(color: string | null): Promise<void> {
    return this.styleSelection("background-color", color);
  }

  async clearFormatting(): Promise<void> {
    await this.history.record();
    this.eachRange((r) => clearFormattingIn(r));
  }

  async changeCase(mode: CaseMode): Promise<void> {
    await this.history.record();
    this.eachRange((r) => changeCaseIn(r, mode), true);
  }

  /** Character formatting at the caret, for the ribbon. */
  inlineState(): InlineState {
    const range = this.activeRange();
    const node = range?.startContainer ?? null;
    const el = (node instanceof Element ? node : node?.parentElement) ?? null;
    const cs = el ? getComputedStyle(el) : null;
    const px = cs ? parseFloat(cs.fontSize) : 16;
    const query = (cmd: string) => {
      try {
        return document.queryCommandState(cmd);
      } catch {
        return false;
      }
    };
    return {
      // No caret in the document yet: show the default font, not "(mixed)".
      font: cs ? fontLabelFor(cs.fontFamily) : FONT_OPTIONS[0]!.label,
      sizePt: Math.round(((px || 16) * 0.75) * 2) / 2,
      bold: query("bold"),
      italic: query("italic"),
      underline: query("underline"),
      strike: query("strikeThrough"),
      superscript: query("superscript"),
      subscript: query("subscript"),
      link: el?.closest("a")?.getAttribute("href") ?? null,
    };
  }

  // ── Links ──────────────────────────────────────────────────────────────

  /** Text of the selection (to prefill the link dialog). */
  selectedText(): string {
    return this.activeRange()?.toString() ?? "";
  }

  /**
   * Link the selection to `url`, edit the link at the caret, or — with a
   * collapsed caret outside a link — insert `text` as a new link. Returns
   * false if the URL isn't allowed.
   */
  async setLink(rawUrl: string, text?: string): Promise<boolean> {
    const url = normalizeUrl(rawUrl);
    if (!url || !isSafeLinkUrl(url)) return false;
    await this.history.record();
    const range = this.restoreSelection();
    if (!range) return false;

    const existing = closestLink(range.startContainer);
    if (existing && range.collapsed) {
      existing.setAttribute("href", url);
      if (text && text !== existing.textContent) existing.textContent = text;
      markExternal(existing);
      return true;
    }
    if (range.collapsed) {
      const a = document.createElement("a");
      a.href = url;
      a.textContent = text || url;
      markExternal(a);
      range.insertNode(a);
      range.setStartAfter(a);
      range.collapse(true);
      setSelection(range);
      return true;
    }
    document.execCommand("createLink", false, url);
    editableRoot(range.startContainer)
      ?.querySelectorAll<HTMLAnchorElement>("a[href]")
      .forEach((a) => {
        if (a.getAttribute("href") === url) markExternal(a);
      });
    return true;
  }

  async removeLink(): Promise<void> {
    const range = this.restoreSelection();
    const link = range && closestLink(range.startContainer);
    if (!link) return;
    await this.history.record();
    const r = document.createRange();
    r.selectNodeContents(link);
    setSelection(r);
    document.execCommand("unlink", false);
  }

  // ── Format painter ─────────────────────────────────────────────────────

  copyFormat(): CopiedFormat | null {
    const range = this.activeRange();
    const node = range?.startContainer ?? null;
    const el = (node instanceof Element ? node : node?.parentElement) ?? null;
    if (!el || !editableRoot(el)) return null;
    const editable = editableRoot(el)!;
    // Only what's set inline counts — inherited paragraph-style values
    // shouldn't be stamped onto the target as overrides.
    const inlineValue = (prop: string) => {
      for (let n = el as HTMLElement | null; n && n !== editable; n = n.parentElement) {
        const v = n.style?.getPropertyValue(prop);
        if (v) return v;
      }
      return null;
    };
    const state = this.inlineState();
    return {
      fontFamily: inlineValue("font-family"),
      fontSize: inlineValue("font-size"),
      color: inlineValue("color"),
      background: inlineValue("background-color"),
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
      strike: state.strike,
    };
  }

  async pasteFormat(format: CopiedFormat): Promise<void> {
    await this.history.record();
    this.eachRange((r) => clearFormattingIn(r));
    for (const [prop, value] of [
      ["font-family", format.fontFamily],
      ["font-size", format.fontSize],
      ["color", format.color],
      ["background-color", format.background],
    ] as const) {
      if (value) this.eachRange((r) => applyInlineStyle(r, prop, value));
    }
    for (const [cmd, on] of [
      ["bold", format.bold],
      ["italic", format.italic],
      ["underline", format.underline],
      ["strikeThrough", format.strike],
    ] as const) {
      if (on) document.execCommand(cmd, false);
    }
  }

  // ── Inline internals ───────────────────────────────────────────────────

  private async styleSelection(prop: StyleProp, value: string | null): Promise<void> {
    await this.history.record();
    const range = this.restoreSelection();
    if (range?.collapsed && selectionRanges(this.root).length <= 1) {
      // Inside a word: Word formats the whole word.
      if (!expandToWord(range)) {
        // Between words: remember it for the next typed text.
        const styles = this.pending?.styles.filter((p) => p.prop !== prop) ?? [];
        this.pending = { at: range.cloneRange(), styles: [...styles, { prop, value }] };
        return;
      }
      setSelection(range);
    }
    this.eachRange((r) => applyInlineStyle(r, prop, value));
  }

  /** Run a range operation on every editable the selection touches and
   *  select the result. */
  private eachRange(fn: (r: Range) => Range | null, wordIfCollapsed = false): void {
    this.restoreSelection();
    let ranges = selectionRanges(this.root);
    if (wordIfCollapsed && ranges.length === 1 && ranges[0]!.collapsed) {
      if (!expandToWord(ranges[0]!)) return;
    }
    ranges = ranges.filter((r) => !r.collapsed);
    const results = ranges.map(fn).filter((r): r is Range => r !== null);
    if (results.length > 0) {
      const combined = document.createRange();
      combined.setStart(results[0]!.startContainer, results[0]!.startOffset);
      const last = results[results.length - 1]!;
      combined.setEnd(last.endContainer, last.endOffset);
      setSelection(combined);
    }
  }

  private activeRange(): Range | null {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0 && this.root.contains(sel.anchorNode)) return sel.getRangeAt(0);
    return this.lastRange;
  }

  /** Put the document selection back (focus may be in the ribbon). */
  private restoreSelection(): Range | null {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0 && this.root.contains(sel.anchorNode)) return sel.getRangeAt(0);
    const range = this.lastRange;
    if (!range || !range.startContainer.isConnected) return null;
    editableRoot(range.startContainer)?.focus({ preventScroll: true });
    setSelection(range);
    return document.getSelection()!.getRangeAt(0);
  }

  // ── History ────────────────────────────────────────────────────────────

  undo(): Promise<void> {
    return this.history.undo();
  }

  redo(): Promise<void> {
    return this.history.redo();
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Change the current block's format tune in place (caret preserved).
   *  Falls back to a block update for blocks without the tune. */
  private async patchFormat(patch: FormatPatch, recordFirst = true): Promise<void> {
    const block = this.currentBlock();
    if (!block) return;
    if (recordFirst) await this.history.record();

    const wrapper = formatWrapper(block);
    if (wrapper) {
      wrapper.dispatchEvent(new CustomEvent(FORMAT_EVENT, { detail: patch }));
      return;
    }
    const saved = await block.save();
    if (!saved) return;
    const tunes = (saved as { tunes?: Record<string, ParagraphFormat> }).tunes ?? {};
    const format: Record<string, unknown> = { ...(tunes[FORMAT_TUNE] ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete format[k];
      else format[k] = v;
    }
    await this.editor.blocks.update(block.id, undefined, { ...tunes, [FORMAT_TUNE]: format });
  }

  private async convert(
    block: BlockAPI,
    type: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const index = this.editor.blocks.getBlockIndex(block.id);
      await this.editor.blocks.convert(block.id, type, data);
      this.editor.caret.setToBlock(index, "end");
    } catch (err) {
      console.debug("[commands] convert failed:", err);
    }
  }
}

function formatWrapper(block: BlockAPI): HTMLElement | null {
  return block.holder.querySelector<HTMLElement>(":scope .tp-format");
}

function setSelection(range: Range): void {
  const sel = document.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function closestLink(node: Node): HTMLAnchorElement | null {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest("a") ?? null;
}

/** Links open in a new tab without giving it a handle on this window. */
function markExternal(a: HTMLAnchorElement): void {
  a.target = "_blank";
  a.rel = "noopener noreferrer";
}

/** "example.com" → "https://example.com", "a@b.co" → "mailto:a@b.co". */
export function normalizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return url;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
  if (/^[^\s]+\.[^\s]{2,}/.test(url)) return `https://${url}`;
  return null;
}

export { FONT_OPTIONS };

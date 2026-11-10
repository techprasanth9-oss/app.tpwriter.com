import type EditorJS from "@editorjs/editorjs";
import type { BlockAPI } from "@editorjs/editorjs";
import { FORMAT_TUNE, MAX_INDENT, type Alignment, type ParagraphFormat } from "./format/paragraphFormat";
import { FORMAT_EVENT, type FormatPatch } from "./tools/ParagraphFormatTune";
import type { EditorHistory } from "./history";
import { headingStyleId, PARAGRAPH_STYLE_IDS, type StyleId } from "./styles/namedStyles";

/**
 * The one place UI (ribbon, shortcuts, menus) changes the document.
 * Everything goes through block data or tunes so it persists — the old
 * ribbon used `execCommand("justifyLeft")`, which only touched the DOM and
 * was lost on save.
 *
 * Inline character formatting (bold, colour…) still uses execCommand for
 * now: it rewrites the block's HTML, which *is* what gets saved.
 */

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
  private readonly onSelectionChange = () => {
    const id = this.selectionBlockId();
    if (id) this.lastBlockId = id;
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
  }

  dispose(): void {
    document.removeEventListener("selectionchange", this.onSelectionChange);
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

  async toggleList(style: "ordered" | "unordered"): Promise<void> {
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

  async insertPageBreak(): Promise<void> {
    await this.history.record();
    const index = this.currentIndex();
    const at = index >= 0 ? index + 1 : this.editor.blocks.getBlocksCount();
    this.editor.blocks.insert("pageBreak", {}, undefined, at, false);
    // Give the user somewhere to type on the new page.
    this.editor.blocks.insert("paragraph", { text: "" }, undefined, at + 1, true);
  }

  // ── Inline ─────────────────────────────────────────────────────────────

  inline(command: "bold" | "italic" | "underline" | "strikeThrough" | "superscript" | "subscript" | "removeFormat"): void {
    document.execCommand(command, false);
  }

  textColor(color: string): void {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("foreColor", false, color);
  }

  highlight(color: string): void {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("hiliteColor", false, color);
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

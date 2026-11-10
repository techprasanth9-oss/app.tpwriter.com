import type { API, BlockAPI, BlockTune } from "@editorjs/editorjs";
import type { MenuConfig } from "@editorjs/editorjs/types/tools";
import {
  applyFormat,
  cleanFormat,
  MAX_INDENT,
  type Alignment,
  type ParagraphFormat,
} from "../format/paragraphFormat";

/** Event the command layer dispatches on a block's format wrapper to change
 *  its format in place (keeps caret + selection, unlike blocks.update()). */
export const FORMAT_EVENT = "tp:format";

export type FormatPatch = Partial<Record<keyof ParagraphFormat, unknown>>;

interface ConstructorParams {
  api: API;
  data: unknown;
  block: BlockAPI;
}

const ALIGN_ITEMS: Array<{ value: Alignment; title: string; icon: string }> = [
  {
    value: "left",
    title: "Align left",
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1.5H2zm0 3.5h8V8H2zM2 10h12v1.5H2zm0 3.5h8V15H2z"/></svg>',
  },
  {
    value: "center",
    title: "Align center",
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1.5H2zm2 3.5h8V8H4zM2 10h12v1.5H2zm2 3.5h8V15H4z"/></svg>',
  },
  {
    value: "right",
    title: "Align right",
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1.5H2zm4 3.5h8V8H6zM2 10h12v1.5H2zm4 3.5h8V15H6z"/></svg>',
  },
  {
    value: "justify",
    title: "Justify",
    icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1.5H2zm0 3.5h12V8H2zM2 10h12v1.5H2zm0 3.5h12V15H2z"/></svg>',
  },
];

/**
 * Block tune holding a text block's paragraph format (alignment, indent,
 * spacing, named style). Saved as `tunes.format`.
 *
 * It wraps the tool's content in a `.tp-format` element and applies the
 * format there, so text tools stay format-agnostic. The ribbon changes it
 * through EditorCommands, which dispatches FORMAT_EVENT on the wrapper.
 */
export class ParagraphFormatTune implements BlockTune {
  static get isTune(): boolean {
    return true;
  }

  private block: BlockAPI;
  private data: ParagraphFormat;
  private wrapper: HTMLElement | null = null;

  constructor({ data, block }: ConstructorParams) {
    this.block = block;
    this.data = cleanFormat(data);
  }

  wrap(blockContent: HTMLElement): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tp-format";
    wrapper.appendChild(blockContent);
    wrapper.addEventListener(FORMAT_EVENT, (e) => {
      e.stopPropagation();
      this.update((e as CustomEvent<FormatPatch>).detail);
    });
    applyFormat(wrapper, this.data);
    this.wrapper = wrapper;
    return wrapper;
  }

  render(): MenuConfig {
    return [
      ...ALIGN_ITEMS.map((item) => ({
        icon: item.icon,
        title: item.title,
        toggle: "tp-align",
        isActive: (this.data.alignment ?? "left") === item.value,
        closeOnActivate: true,
        onActivate: () => this.update({ alignment: item.value }),
      })),
      {
        icon: "→",
        title: "Increase indent",
        isDisabled: (this.data.indent ?? 0) >= MAX_INDENT,
        closeOnActivate: true,
        onActivate: () => this.update({ indent: (this.data.indent ?? 0) + 1 }),
      },
      {
        icon: "←",
        title: "Decrease indent",
        isDisabled: !this.data.indent,
        closeOnActivate: true,
        onActivate: () => this.update({ indent: (this.data.indent ?? 0) - 1 }),
      },
    ];
  }

  save(): ParagraphFormat {
    return { ...this.data };
  }

  /** Merge a patch (undefined/null clears a key), re-validate, re-apply. */
  private update(patch: FormatPatch): void {
    const next: Record<string, unknown> = { ...this.data };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null) delete next[key];
      else next[key] = value;
    }
    this.data = cleanFormat(next);
    if (this.wrapper) applyFormat(this.wrapper, this.data);
    this.block.dispatchChange();
  }
}

import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  PasteEvent,
} from "@editorjs/editorjs";
import { BLOCK_INLINE_TAGS } from "../sanitizers";

interface ParagraphToolConfig {
  /** Keep empty paragraphs on save — blank lines are layout in a word
   *  processor, not noise. */
  preserveBlank?: boolean;
}

interface ParagraphToolData {
  text: string;
}

/**
 * Replacement for @editorjs/paragraph that keeps the inline-tag sanitize
 * whitelist in sync with the rest of the ported tools (so a `<mark>` chip or
 * styled `<span>` survives save+reload inside a paragraph). Alignment,
 * indent and spacing are not the tool's concern: they live in the shared
 * `format` tune (ParagraphFormatTune).
 *
 * Kept standalone — does NOT extend @editorjs/paragraph — because that package
 * has shipped two incompatible saved-data shapes across versions and extending
 * it couples us to whichever one is on disk. Owning the class means a
 * paragraph block's saved JSON is stable regardless of the dependency.
 */
export class ParagraphTool implements BlockTool {
  private _data: ParagraphToolData;
  private _element: HTMLDivElement;
  private api: API;
  private readOnly: boolean;
  private config: ParagraphToolConfig;
  private _preserveBlank: boolean;

  static get isInline(): boolean {
    return false;
  }

  static get sanitize() {
    // Pull the shared inline-tag whitelist so paragraph text keeps every
    // <span> the DOCX parser emits — font-family, font-size, color, and every
    // mention/placeholder chip data-* attr. A local list that omits span (or
    // omits a single data-* attr) flattens parsed `<span style="font-family:…">`
    // runs to plain text on the first sanitize pass and the source document's
    // typography is lost. Header + list tools share this same whitelist.
    return {
      text: {
        ...BLOCK_INLINE_TAGS,
        markup: ["strong", "em", "del", "u", "b", "i", "a", "code"],
      },
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  static get toolbox() {
    return {
      icon: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 4.5H15V6H3V4.5ZM3 8.25H15V9.75H3V8.25ZM3 12H12V13.5H3V12Z" fill="currentColor"/></svg>',
      title: "Paragraph",
    };
  }

  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions) {
    this.api = api;
    this.readOnly = readOnly;
    const typedConfig: ParagraphToolConfig = (config as ParagraphToolConfig) ?? {};
    this.config = { preserveBlank: false, ...typedConfig };

    const typedData = (data ?? {}) as ParagraphToolData;
    this._data = { text: typedData.text || "" };

    this._element = this._createParagraphElement();
    this._preserveBlank = this.config.preserveBlank ?? false;
  }

  private _createParagraphElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.classList.add("ce-paragraph");
    return element;
  }

  render(): HTMLElement {
    this._element.innerHTML = this._data.text || "";
    this._element.contentEditable = (!this.readOnly).toString();
    return this._element;
  }

  save(): ParagraphToolData | null {
    const text = this._element.innerHTML.trim();
    return this._preserveBlank || text ? { text } : null;
  }

  static get conversionConfig() {
    return {
      export: "text",
      import: "text",
    };
  }

  static get pasteConfig() {
    return {
      tags: ["P", "DIV"],
    };
  }

  // TODO: PasteEvent in @editorjs/editorjs <= v2.29 doesn't type `detail.data`
  // precisely enough to avoid an `any` here. Narrow once we upgrade.
  onPaste(event: PasteEvent | any): void {
    const content = event.detail.data;

    if (content.innerHTML !== undefined) {
      this._element.innerHTML = content.innerHTML;
    } else if (content.text) {
      this._element.innerHTML = content.text;
    }

    this._preserveFormatting();
  }

  private _preserveFormatting(): void {
    const styleMap: Record<string, string> = {
      "font-weight: bold": "strong",
      "font-style: italic": "em",
      "text-decoration: underline": "u",
      "text-decoration: line-through": "del",
    };

    const walker = document.createTreeWalker(
      this._element,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null,
    );

    const nodesToProcess: Node[] = [];
    while (walker.nextNode()) {
      nodesToProcess.push(walker.currentNode);
    }

    nodesToProcess.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        const style = element.getAttribute("style");

        if (style) {
          Object.entries(styleMap).forEach(([styleAttr, tag]) => {
            if (style.includes(styleAttr)) {
              const wrapper = document.createElement(tag);
              element.replaceWith(wrapper);
              wrapper.appendChild(element);
              element.removeAttribute("style");
            }
          });
        }
      }
    });
  }
}

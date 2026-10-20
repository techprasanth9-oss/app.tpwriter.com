import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  PasteEvent,
} from "@editorjs/editorjs";
import { BLOCK_INLINE_TAGS } from "../sanitizers";

type Alignment = "left" | "center" | "right" | "justify";

interface ParagraphToolConfig {
  preserveBlank?: boolean;
  defaultAlignment?: Alignment;
}

interface ParagraphToolData {
  text: string;
  alignment?: Alignment;
  indentLevel?: number;
  // EditorJS passes the serialized tunes payload back on load. The alignment
  // and indent tunes write under `tunes.alignment` / `tunes.indentTune`, and
  // the ribbon re-reads them from there — treating them as optional nested
  // objects keeps the ctor from blowing up on blocks that have never been
  // tuned.
  tunes?: {
    alignment?: { alignment?: Alignment };
    indentTune?: { indentLevel?: number };
  };
}

/**
 * Replacement for @editorjs/paragraph that keeps the inline-tag sanitize
 * whitelist in sync with the rest of the ported tools (so a `<mark>` chip or
 * styled `<span>` survives save+reload inside a paragraph), and ships its own
 * alignment + indent settings panel so the ribbon can hand control off to
 * paragraph tunes without a second tool class.
 *
 * Kept standalone — does NOT extend @editorjs/paragraph — because that package
 * has shipped two incompatible saved-data shapes across versions and extending
 * it couples us to whichever one is on disk. Owning the class means a
 * paragraph block's saved JSON is stable regardless of the dependency.
 */
export class ParagraphTool implements BlockTool {
  private _data: ParagraphToolData;
  private _element: HTMLDivElement;
  private _settings: HTMLElement | null;
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
    this.config = {
      preserveBlank: false,
      defaultAlignment: "left",
      ...typedConfig,
    };

    const typedData = (data ?? {}) as ParagraphToolData;
    this._data = {
      text: typedData.text || "",
      alignment:
        typedData.tunes?.alignment?.alignment || this.config.defaultAlignment,
      indentLevel: typedData.tunes?.indentTune?.indentLevel || 0,
    };

    this._element = this._createParagraphElement();
    this._preserveBlank = typedConfig.preserveBlank ?? false;
    this._settings = null;
  }

  private _createParagraphElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.classList.add("ce-paragraph");
    return element;
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("ce-paragraph-settings");

    const alignments: Alignment[] = ["left", "center", "right", "justify"];
    const alignmentIcons: Record<Alignment, string> = {
      left: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14V5.5H2V4ZM2 7H10V8.5H2V7ZM2 10H14V11.5H2V10ZM2 13H10V14.5H2V13Z" fill="currentColor"/></svg>',
      center:
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 4H13V5.5H3V4ZM5 7H11V8.5H5V7ZM3 10H13V11.5H3V10ZM5 13H11V14.5H5V13Z" fill="currentColor"/></svg>',
      right:
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14V5.5H2V4ZM6 7H14V8.5H6V7ZM2 10H14V11.5H2V10ZM6 13H14V14.5H6V13Z" fill="currentColor"/></svg>',
      justify:
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14V5.5H2V4ZM2 7H14V8.5H2V7ZM2 10H14V11.5H2V10ZM2 13H14V14.5H2V13Z" fill="currentColor"/></svg>',
    };
    const alignmentLabels: Record<Alignment, string> = {
      left: "Align left",
      center: "Align center",
      right: "Align right",
      justify: "Justify",
    };

    alignments.forEach((alignment) => {
      const button = document.createElement("button");
      button.classList.add("ce-paragraph-settings__button");
      button.type = "button";
      button.innerHTML = alignmentIcons[alignment];
      button.title = alignmentLabels[alignment];
      button.classList.toggle("active", this._data.alignment === alignment);

      button.addEventListener("click", () => {
        this.setAlignment(alignment);
      });

      wrapper.appendChild(button);
    });

    const indentControls = document.createElement("div");
    indentControls.classList.add("ce-paragraph-settings__indent-controls");

    const decreaseIndentButton = document.createElement("button");
    decreaseIndentButton.classList.add("ce-paragraph-settings__button");
    decreaseIndentButton.type = "button";
    decreaseIndentButton.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14V5.5H2V4ZM6 7H14V8.5H6V7ZM6 10H14V11.5H6V10ZM2 7.75L5 9.5L2 11.25V7.75ZM6 13H14V14.5H6V13Z" fill="currentColor"/></svg>';
    decreaseIndentButton.title = "Decrease indent";
    decreaseIndentButton.disabled = (this._data.indentLevel || 0) <= 0;

    decreaseIndentButton.addEventListener("click", () => {
      this.setIndentLevel(Math.max((this._data.indentLevel || 0) - 1, 0));
    });

    const increaseIndentButton = document.createElement("button");
    increaseIndentButton.classList.add("ce-paragraph-settings__button");
    increaseIndentButton.type = "button";
    increaseIndentButton.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4H14V5.5H2V4ZM2 7H10V8.5H2V7ZM2 10H10V11.5H2V10ZM11 7.75L14 9.5L11 11.25V7.75ZM2 13H10V14.5H2V13Z" fill="currentColor"/></svg>';
    increaseIndentButton.title = "Increase indent";
    increaseIndentButton.disabled = (this._data.indentLevel || 0) >= 5;

    increaseIndentButton.addEventListener("click", () => {
      this.setIndentLevel(Math.min((this._data.indentLevel || 0) + 1, 5));
    });

    indentControls.appendChild(decreaseIndentButton);
    indentControls.appendChild(increaseIndentButton);
    wrapper.appendChild(indentControls);

    this._settings = wrapper;
    return wrapper;
  }

  setAlignment(alignment: Alignment): void {
    this._data.alignment = alignment;
    this._applyParagraphStyle();

    if (this._settings) {
      this._settings
        .querySelectorAll(".ce-paragraph-settings__button")
        .forEach((button) => {
          button.classList.remove("active");
          if ((button as HTMLButtonElement).title === `Align ${alignment}`) {
            button.classList.add("active");
          }
        });
    }
  }

  setIndentLevel(level: number): void {
    this._data.indentLevel = level;
    this._applyParagraphStyle();

    if (this._settings) {
      const decreaseButton = this._settings.querySelector(
        ".ce-paragraph-settings__indent-controls button:first-child",
      ) as HTMLButtonElement | null;
      const increaseButton = this._settings.querySelector(
        ".ce-paragraph-settings__indent-controls button:last-child",
      ) as HTMLButtonElement | null;

      if (decreaseButton) {
        decreaseButton.disabled = level <= 0;
      }

      if (increaseButton) {
        increaseButton.disabled = level >= 5;
      }
    }
  }

  private _applyParagraphStyle(): void {
    if (this._element) {
      this._element.style.textAlign = this._data.alignment || "left";
      this._element.style.paddingLeft = `${(this._data.indentLevel || 0) * 20}px`;
    }
  }

  render(): HTMLElement {
    this._element.innerHTML = this._data.text || "";
    this._element.contentEditable = (!this.readOnly).toString();
    this._applyParagraphStyle();
    return this._element;
  }

  save(): ParagraphToolData | null {
    const text = this._element.innerHTML.trim();
    return this._preserveBlank || text
      ? {
          text,
          alignment: this._data.alignment,
          indentLevel: this._data.indentLevel,
        }
      : null;
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

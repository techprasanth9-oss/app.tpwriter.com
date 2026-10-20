import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  PasteEvent,
} from "@editorjs/editorjs";
import { BLOCK_INLINE_TAGS } from "../sanitizers";

type Alignment = "left" | "center" | "right";

interface HeaderToolConfig {
  levels: number[];
  defaultLevel: number;
  preserveBlank?: boolean;
}

interface HeaderToolData {
  text: string;
  level: number;
  alignment?: Alignment;
  indentLevel?: number;
}

export class HeaderTool implements BlockTool {
  private _data: HeaderToolData;
  private _element: HTMLDivElement;
  private _settings: HTMLElement | null;
  private api: API;
  private readOnly: boolean;
  private config: HeaderToolConfig;
  private _preserveBlank: boolean;

  static get isInline() {
    return false;
  }

  static get sanitize() {
    // Keep the shared inline-tag whitelist so mentions / variable chips /
    // marks survive the save round-trip inside header text.
    return {
      level: false,
      text: {
        ...BLOCK_INLINE_TAGS,
        markup: ["strong", "em", "del", "u", "b", "i", "mark", "ins"],
      },
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get toolbox() {
    return {
      icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M6 12h12"/><path d="M6 20V4"/><path d="M18 20V4"/></svg>',
      title: "Heading",
    };
  }

  static get conversionConfig() {
    return { export: "text", import: "text" };
  }

  static get pasteConfig() {
    return {
      tags: ["H1", "H2", "H3", "H4", "H5", "H6"],
      patterns: {
        heading: /^(#{1,6})\s+(.+)$/,
      },
    };
  }

  constructor({ data, config, api, readOnly }: BlockToolConstructorOptions) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = {
      levels: [1, 2, 3, 4, 5, 6],
      defaultLevel: 2,
      ...(config ?? {}),
    } as HeaderToolConfig;

    this._data = {
      text: data?.text || "",
      level: this._normalizeLevel(data?.level),
      alignment: data?.tunes?.alignment?.alignment || "left",
      indentLevel: data?.tunes?.indentTune?.indentLevel || 0,
    };

    this._element = this._createHeaderElement();
    this._preserveBlank = (config as HeaderToolConfig | undefined)?.preserveBlank ?? false;
    this._settings = null;
  }

  private _normalizeLevel(level?: number): number {
    return Math.min(Math.max(level ?? this.config.defaultLevel, 1), 6);
  }

  private _createHeaderElement(): HTMLDivElement {
    const element = document.createElement("div");
    element.classList.add("ce-header");
    return element;
  }

  renderSettings(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("ce-header-settings");

    this.config.levels.forEach((level) => {
      const button = document.createElement("button");
      button.classList.add("ce-header-settings__button");
      button.type = "button";
      button.innerHTML = `H${level}`;
      button.classList.toggle("active", this._data.level === level);

      button.addEventListener("click", () => {
        this.setLevel(level);
      });

      wrapper.appendChild(button);
    });

    this._settings = wrapper;
    return wrapper;
  }

  setLevel(level: number): void {
    this._data.level = this._normalizeLevel(level);
    this._element.className = `ce-header ce-header-level-${this._data.level}`;
    this._element.dataset.level = this._data.level.toString();
    this._applyHeaderStyle();

    if (this._settings) {
      this._settings
        .querySelectorAll(".ce-header-settings__button")
        .forEach((button) => {
          button.classList.toggle(
            "active",
            button.innerHTML === `H${this._data.level}`,
          );
        });
    }
  }

  private _applyHeaderStyle(): void {
    const sizes: Record<number, { fontSize: string; fontWeight: string }> = {
      1: { fontSize: "2em", fontWeight: "bold" },
      2: { fontSize: "1.5em", fontWeight: "bold" },
      3: { fontSize: "1.17em", fontWeight: "bold" },
      4: { fontSize: "1em", fontWeight: "bold" },
      5: { fontSize: "0.83em", fontWeight: "bold" },
      6: { fontSize: "0.67em", fontWeight: "bold" },
    };
    const style = sizes[this._data.level];
    if (style) Object.assign(this._element.style, style);
  }

  render(): HTMLElement {
    this._element.innerHTML = this._data.text || "";
    this._element.contentEditable = (!this.readOnly).toString();
    this._element.dataset.level = this._data.level.toString();
    this._applyHeaderStyle();
    this._element.style.textAlign = this._data.alignment ?? "left";
    this._element.style.paddingLeft = `${(this._data.indentLevel ?? 0) * 20}px`;
    return this._element;
  }

  save(): HeaderToolData | null {
    const text = this._element.innerHTML.trim();
    return this._preserveBlank || text
      ? { text, level: this._data.level }
      : null;
  }

  onPaste(event: PasteEvent | { detail: { data: HTMLElement & { innerHTML?: string; text?: string } } }): void {
    const content = (event as { detail: { data: HTMLElement & { innerHTML?: string; text?: string } } }).detail.data;

    if (content.innerHTML !== undefined) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = content.innerHTML;

      const headingMatch = tempDiv.querySelector("h1, h2, h3, h4, h5, h6");
      if (headingMatch) {
        const level = Number.parseInt(headingMatch.tagName.charAt(1));
        this.setLevel(level);
        this._element.innerHTML = headingMatch.innerHTML;
        return;
      }
    }

    if (typeof content.text === "string") {
      const markdownMatch = content.text.match(/^(#{1,6})\s+(.+)$/);
      if (markdownMatch?.[1] && markdownMatch[2]) {
        this.setLevel(markdownMatch[1].length);
        this._element.innerHTML = markdownMatch[2];
        return;
      }
    }

    if (content.innerHTML) this._element.innerHTML = content.innerHTML;
    else if (content.text) this._element.innerHTML = content.text;
  }
}

/**
 * Bold / Italic / Underline / Strikethrough / Superscript / Subscript inline
 * tools. Delegate to `document.execCommand` (byte-identical to EditorJS's
 * built-ins). Ported from app.esigns.io's MentionAwareFormatTool with mention
 * stamping removed — TP Writer has no mention chips.
 */
import type {
  InlineTool,
  InlineToolConstructorOptions,
  SanitizerConfig,
} from "@editorjs/editorjs";

interface FormatSpec {
  command: string;
  title: string;
  shortcut: string;
  icon: string;
  sanitize: SanitizerConfig;
}

class FormatTool implements InlineTool {
  protected api: InlineToolConstructorOptions["api"];
  protected button: HTMLButtonElement | null = null;
  protected spec: FormatSpec;

  static get isInline(): boolean {
    return true;
  }

  constructor({ api }: InlineToolConstructorOptions, spec: FormatSpec) {
    this.api = api;
    this.spec = spec;
  }

  render(): HTMLButtonElement {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.classList.add("ce-inline-tool");
    this.button.innerHTML = this.spec.icon;
    this.button.title = this.spec.title;
    return this.button;
  }

  surround(_range: Range): void {
    try {
      document.execCommand(this.spec.command);
    } catch {
      /* execCommand unsupported in headless */
    }
  }

  checkState(): boolean {
    try {
      const state = document.queryCommandState(this.spec.command);
      this.button?.classList.toggle("ce-inline-tool--active", state);
      return state;
    } catch {
      return false;
    }
  }

  get shortcut(): string {
    return this.spec.shortcut;
  }

  static get sanitize(): SanitizerConfig {
    return {};
  }
}

const BOLD_SPEC: FormatSpec = {
  command: "bold",
  title: "Bold",
  shortcut: "CMD+B",
  icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>`,
  sanitize: { b: {}, strong: {} } as SanitizerConfig,
};
const ITALIC_SPEC: FormatSpec = {
  command: "italic",
  title: "Italic",
  shortcut: "CMD+I",
  icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>`,
  sanitize: { i: {}, em: {} } as SanitizerConfig,
};
const UNDERLINE_SPEC: FormatSpec = {
  command: "underline",
  title: "Underline",
  shortcut: "CMD+U",
  icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" y1="20" x2="20" y2="20"/></svg>`,
  sanitize: { u: {} } as SanitizerConfig,
};
const STRIKE_SPEC: FormatSpec = {
  command: "strikeThrough",
  title: "Strikethrough",
  shortcut: "CMD+SHIFT+X",
  icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><path d="M17.3 5.5A6.5 6.5 0 0 0 12 3a5 5 0 0 0-5 5c0 1.5.6 2.9 1.7 4"/><path d="M6.7 18.5A6.5 6.5 0 0 0 12 21a5 5 0 0 0 5-5c0-1.5-.6-2.9-1.7-4"/></svg>`,
  sanitize: { s: {}, strike: {} } as SanitizerConfig,
};
const SUP_SPEC: FormatSpec = {
  command: "superscript",
  title: "Superscript",
  shortcut: "CMD+.",
  icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5l7 8-7 8"/><path d="M13 5l7 8"/><circle cx="19" cy="4" r="1.5" fill="currentColor"/></svg>`,
  sanitize: { sup: {} } as SanitizerConfig,
};
const SUB_SPEC: FormatSpec = {
  command: "subscript",
  title: "Subscript",
  shortcut: "CMD+,",
  icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5l7 8-7 8"/><path d="M13 5l7 8"/><circle cx="19" cy="20" r="1.5" fill="currentColor"/></svg>`,
  sanitize: { sub: {} } as SanitizerConfig,
};

export class BoldTool extends FormatTool {
  constructor(opts: InlineToolConstructorOptions) {
    super(opts, BOLD_SPEC);
  }
  static override get sanitize(): SanitizerConfig {
    return BOLD_SPEC.sanitize;
  }
}
export class ItalicTool extends FormatTool {
  constructor(opts: InlineToolConstructorOptions) {
    super(opts, ITALIC_SPEC);
  }
  static override get sanitize(): SanitizerConfig {
    return ITALIC_SPEC.sanitize;
  }
}
export class UnderlineTool extends FormatTool {
  constructor(opts: InlineToolConstructorOptions) {
    super(opts, UNDERLINE_SPEC);
  }
  static override get sanitize(): SanitizerConfig {
    return UNDERLINE_SPEC.sanitize;
  }
}
export class StrikeTool extends FormatTool {
  constructor(opts: InlineToolConstructorOptions) {
    super(opts, STRIKE_SPEC);
  }
  static override get sanitize(): SanitizerConfig {
    return STRIKE_SPEC.sanitize;
  }
}
export class SuperscriptTool extends FormatTool {
  constructor(opts: InlineToolConstructorOptions) {
    super(opts, SUP_SPEC);
  }
  static override get sanitize(): SanitizerConfig {
    return SUP_SPEC.sanitize;
  }
}
export class SubscriptTool extends FormatTool {
  constructor(opts: InlineToolConstructorOptions) {
    super(opts, SUB_SPEC);
  }
  static override get sanitize(): SanitizerConfig {
    return SUB_SPEC.sanitize;
  }
}

import type { BlockAPI, BlockTool, BlockToolConstructorOptions, PasteEvent } from "@editorjs/editorjs";
import type { MenuConfig } from "@editorjs/editorjs/types/tools";
import { cleanEquationData, cleanLatex, type EquationData } from "./objectData";
import "./EquationTool.css";

/** The slice of KaTeX this tool uses (also what tests mock). */
export type Katex = Pick<typeof import("katex").default, "render">;

/** KaTeX options: untrusted input, bounded output. */
export const KATEX_OPTIONS = {
  throwOnError: false,
  trust: false,
  strict: "ignore" as const,
  maxSize: 40,
  maxExpand: 500,
  errorColor: "#cf222e",
  output: "htmlAndMathml" as const,
};

let katexModule: Katex | null = null;
let katexPromise: Promise<Katex> | null = null;

/** Lazy-load KaTeX + its stylesheet once. Resolved synchronously-available
 *  afterwards, so later equations render in their first paint. */
export function loadKatex(): Promise<Katex> {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css").catch(() => undefined),
    ])
      .then(([mod]) => {
        const k = ((mod as unknown as { default?: Katex }).default ?? mod) as Katex;
        katexModule = k;
        return k;
      })
      .catch((err) => {
        katexPromise = null;
        throw err;
      });
  }
  return katexPromise;
}

/** Test hook: swap the KaTeX implementation (jsdom can't lay it out). */
export function __setKatexForTests(k: Katex | null): void {
  katexModule = k;
  katexPromise = k ? Promise.resolve(k) : null;
}

/** Render LaTeX into `target`; errors become a red message, never a throw. */
export function renderLatex(k: Katex, target: HTMLElement, latex: string, display: boolean): boolean {
  target.replaceChildren();
  try {
    k.render(latex, target, { ...KATEX_OPTIONS, displayMode: display });
    return !target.querySelector(".katex-error");
  } catch (err) {
    const msg = document.createElement("span");
    msg.className = "tp-equation__error";
    msg.textContent = err instanceof Error ? err.message : "Invalid equation";
    target.replaceChildren(msg);
    return false;
  }
}

const DISPLAY_RE = /^\s*\$\$([\s\S]+?)\$\$\s*$/;
const BRACKET_RE = /^\s*\\\[([\s\S]+?)\\\]\s*$/;

/**
 * Equation block (KaTeX). The rendered preview is generated DOM, marked
 * `data-mutation-free`; clicking it (or Enter while focused) opens an
 * inline LaTeX editor with a live preview. Saved as plain-text LaTeX.
 */
export class EquationTool implements BlockTool {
  static get toolbox() {
    return {
      title: "Equation",
      icon: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M3 2h10v1.6H5.6l4 4.9-4 4.9H13V15H3v-1.3l4.6-5.2L3 3.3z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  /** Enter inside the LaTeX textarea is a newline, not a new block. */
  static get enableLineBreaks(): boolean {
    return true;
  }

  /** Plain-text fields: tell EditorJS not to HTML-clean them on save. */
  static get sanitize() {
    return { latex: true, display: true };
  }

  static get pasteConfig() {
    return { patterns: { equation: /^\s*(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])\s*$/ } };
  }

  private data: EquationData;
  private readonly block?: BlockAPI;
  private readonly readOnly: boolean;
  private wrapper: HTMLElement | null = null;
  private preview: HTMLElement | null = null;
  private editor: HTMLElement | null = null;
  private destroyed = false;

  constructor({ data, block, readOnly }: BlockToolConstructorOptions<EquationData>) {
    this.data = cleanEquationData(data);
    this.block = block;
    this.readOnly = readOnly;
  }

  render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tp-equation";
    wrapper.contentEditable = "false";
    const preview = document.createElement("div");
    preview.className = "tp-equation__preview";
    preview.dataset.mutationFree = "true";
    preview.setAttribute("role", "img");
    if (!this.readOnly) {
      preview.tabIndex = 0;
      preview.title = "Edit equation";
      preview.addEventListener("click", () => this.openEditor());
      preview.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          this.openEditor();
        }
      });
    }
    wrapper.appendChild(preview);
    this.wrapper = wrapper;
    this.preview = preview;
    this.paint();
    return wrapper;
  }

  renderSettings(): MenuConfig {
    return [
      { display: true, title: "Display (centred)" },
      { display: false, title: "Inline (left)" },
    ].map((opt) => ({
      title: opt.title,
      icon: opt.display
        ? '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M2 4h13v1.5H2zm3 4h7v1.5H5zm-3 4h13v1.5H2z"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M2 4h13v1.5H2zm0 4h7v1.5H2zm0 4h13v1.5H2z"/></svg>',
      toggle: "tp-equation-display",
      isActive: this.data.display === opt.display,
      closeOnActivate: true,
      onActivate: () => {
        if (this.data.display === opt.display) return;
        this.data.display = opt.display;
        this.paint();
        this.block?.dispatchChange();
      },
    }));
  }

  onPaste(event: PasteEvent): void {
    if (event.type !== "pattern") return;
    const text = String((event.detail as { data?: unknown }).data ?? "");
    const m = text.match(DISPLAY_RE) ?? text.match(BRACKET_RE);
    this.data = { latex: cleanLatex((m?.[1] ?? text).trim()), display: true };
    this.paint();
  }

  save(): EquationData {
    return { latex: cleanLatex(this.data.latex), display: this.data.display };
  }

  validate(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.editor = null;
  }

  /** Render the preview (sync when KaTeX is already loaded). */
  private paint(): void {
    const wrapper = this.wrapper;
    const preview = this.preview;
    if (!wrapper || !preview) return;
    wrapper.classList.toggle("tp-equation--display", this.data.display);
    wrapper.classList.toggle("tp-equation--inline", !this.data.display);
    const latex = this.data.latex;
    preview.setAttribute("aria-label", latex || "Empty equation");
    if (!latex.trim()) {
      const ph = document.createElement("span");
      ph.className = "tp-equation__placeholder";
      ph.textContent = this.readOnly ? "" : "Click to add an equation";
      preview.replaceChildren(ph);
      preview.classList.remove("tp-equation__preview--invalid");
      return;
    }
    if (katexModule) {
      this.fill(katexModule);
      return;
    }
    // First equation on the page: keep the reserved min-height (CSS) and
    // show the source until KaTeX arrives.
    const pending = document.createElement("code");
    pending.className = "tp-equation__pending";
    pending.textContent = latex;
    preview.replaceChildren(pending);
    loadKatex()
      .then((k) => {
        if (!this.destroyed && this.data.latex === latex) this.fill(k);
      })
      .catch(() => {
        /* offline: the LaTeX source stays visible */
      });
  }

  private fill(k: Katex): void {
    const preview = this.preview;
    if (!preview) return;
    const ok = renderLatex(k, preview, this.data.latex, this.data.display);
    preview.classList.toggle("tp-equation__preview--invalid", !ok);
  }

  private openEditor(): void {
    if (this.readOnly || this.editor || !this.wrapper) return;
    const startLatex = this.data.latex;
    const panel = document.createElement("div");
    panel.className = "tp-equation__editor";
    panel.dataset.mutationFree = "true";

    const label = document.createElement("label");
    label.className = "tp-equation__label";
    label.textContent = "LaTeX";
    const textarea = document.createElement("textarea");
    textarea.className = "tp-equation__input";
    textarea.value = this.data.latex;
    textarea.rows = Math.min(6, Math.max(2, this.data.latex.split("\n").length));
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "Equation LaTeX source");
    textarea.placeholder = "e.g. E = mc^2 or \\frac{a}{b}";
    label.appendChild(textarea);

    const live = document.createElement("div");
    live.className = "tp-equation__live";
    live.setAttribute("aria-live", "polite");

    const actions = document.createElement("div");
    actions.className = "tp-equation__actions";
    const hint = document.createElement("span");
    hint.className = "tp-equation__hint";
    hint.textContent = "Esc to close";
    const done = document.createElement("button");
    done.type = "button";
    done.className = "tp-equation__done";
    done.textContent = "Done";
    actions.append(hint, done);
    panel.append(label, live, actions);

    const renderLive = () => {
      const latex = textarea.value;
      if (!latex.trim()) {
        live.textContent = "";
        return;
      }
      if (katexModule) {
        renderLatex(katexModule, live, latex, this.data.display);
      } else {
        void loadKatex()
          .then((k) => this.editor === panel && renderLatex(k, live, textarea.value, this.data.display))
          .catch(() => undefined);
      }
    };

    const close = () => {
      if (this.editor !== panel) return;
      this.editor = null;
      panel.remove();
      this.data.latex = cleanLatex(textarea.value);
      this.paint();
      if (this.data.latex !== startLatex) this.block?.dispatchChange();
      this.preview?.focus({ preventScroll: true });
    };

    textarea.addEventListener("input", () => {
      this.data.latex = textarea.value;
      renderLive();
    });
    // Keys typed here belong to the textarea, not to EditorJS (Backspace
    // at offset 0 would otherwise merge blocks, Tab move focus, …).
    panel.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        close();
      }
    });
    panel.addEventListener("focusout", (e) => {
      const next = e.relatedTarget as Node | null;
      if (next && panel.contains(next)) return;
      // Defer: clicking Done fires focusout first.
      setTimeout(() => {
        if (!panel.contains(document.activeElement)) close();
      }, 0);
    });
    done.addEventListener("click", close);

    this.editor = panel;
    this.wrapper.appendChild(panel);
    renderLive();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  /** For tests / callers: whether the inline editor is open. */
  get isEditing(): boolean {
    return this.editor !== null;
  }
}

export default EquationTool;

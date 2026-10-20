import type { API, InlineTool, SanitizerConfig } from "@editorjs/editorjs";
import { MARK_SANITIZER } from "../sanitizers";

/**
 * Inline tool that lets a user drop a `{{variable}}` mail-merge chip into
 * paragraph / list / table text. The chip is rendered as `<mark>` so it
 * survives inside headings and inline-formatted text, and carries three
 * data-* attrs that identify it on save:
 *   data-placeholder-name  — the variable key (`first_name`, `invoice_total`, …)
 *   data-field-type        — the semantic type (`text`, `date`, `number`, …)
 *   data-unique-id         — a stable id so the same variable can appear
 *                            multiple times in the doc without them collapsing
 *                            into one on save
 *
 * The attrs are mirrored in `src/lib/editor/sanitizers.ts > MARK_SANITIZER`,
 * which is what EditorJS runs on save — any attr not whitelisted there is
 * silently stripped and the chip degrades to a plain `<mark>` on reload.
 *
 * UI model:
 *   - toolbar button opens a tiny inline input prompting for the variable name
 *   - submit inserts the chip at the selection
 *   - right-click a chip to edit the name, change width/colour, or delete
 *   - clicking a chip puts the caret inside it; pressing Backspace / Delete
 *     while the chip is focused removes it as a whole unit instead of
 *     deleting one character at a time
 */

interface VariableSuggestion {
  name: string;
  label: string;
}

interface VariableToolConfig {
  /** Optional pick-list surfaced in the trigger input as suggestions. */
  availableVariables?: VariableSuggestion[];
  defaultMinWidth?: string;
  defaultBorderColor?: string;
  fieldType?: string;
  availableWidths?: string[];
  availableColors?: string[];
}

export class VariableTool implements InlineTool {
  // TODO: narrow once @editorjs/editorjs API typing covers the methods we
  // actually use (notifier, selection).
  private api: API | any;
  private config: Required<Omit<VariableToolConfig, "availableVariables">> & {
    availableVariables: VariableSuggestion[];
  };
  private button: HTMLButtonElement | null = null;
  private _state: boolean = false;
  private contextMenu: HTMLDivElement | null = null;
  private selectedChip: HTMLElement | null = null;
  private isInitialized: boolean = false;
  private static activeContextMenus: HTMLDivElement[] = [];

  static get isInline(): boolean {
    return true;
  }

  /** Keep the whitelist in lockstep with `MARK_SANITIZER`. If you add a
   *  data-attr to the chip, add it there too — otherwise it gets stripped
   *  on save and the next load forgets the variable's identity. */
  static get sanitize(): SanitizerConfig {
    return {
      mark: MARK_SANITIZER,
    };
  }

  constructor({
    api,
    config = {},
  }: {
    api: API;
    config?: VariableToolConfig;
  }) {
    this.api = api;
    this.config = {
      defaultMinWidth: "120px",
      defaultBorderColor: "#0066cc",
      fieldType: "text",
      availableWidths: ["80px", "120px", "160px", "200px", "240px", "300px"],
      availableColors: [
        "#000000",
        "#0066cc",
        "#FF0000",
        "#00AA00",
        "#FFA500",
        "#800080",
      ],
      availableVariables: [],
      ...config,
    } as Required<Omit<VariableToolConfig, "availableVariables">> & {
      availableVariables: VariableSuggestion[];
    };
    // Defer so the DOM exists by the time we hunt for pre-existing chips.
    setTimeout(() => this.initialize(), 0);
  }

  private initialize(): void {
    if (this.isInitialized) return;
    this.createContextMenu();
    this.isInitialized = true;
    this.reinitializeExistingChips();
  }

  private reinitializeExistingChips(): void {
    const existing = document.querySelectorAll("mark[data-placeholder-name]");
    existing.forEach((chip) => {
      const el = chip as HTMLElement;
      const customWidth = el.getAttribute("data-custom-width");
      const customColor = el.getAttribute("data-custom-color");
      this.applyChipStyles(el, customWidth, customColor);
      this.setupChipBehavior(el);
    });
  }

  render(): HTMLButtonElement {
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.innerHTML = this.getIcon();
    this.button.classList.add("ce-inline-tool");
    this.button.classList.add("ce-inline-tool--variable");
    this.button.title = "Insert variable";

    if (!this.contextMenu) {
      this.createContextMenu();
    }

    return this.button;
  }

  private getIcon(): string {
    return `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3h2v2H4V3zm0 10h2v2H4v-2zm10-10h-2v2h2V3zm0 10h-2v2h2v-2zM6 7h6v4H6V7z" fill="currentColor"/>
      </svg>
    `;
  }

  /**
   * EditorJS calls `surround(range)` when the toolbar button is clicked. We
   * don't wrap the user's selection — a variable chip replaces the selection
   * because the chip's TEXT is the variable value, not the user's prose.
   * Instead we open a tiny prompt input, read a variable name from the user,
   * and insert the chip at the collapsed selection.
   */
  surround(range: Range): void {
    this.openNamePrompt(range);
  }

  private openNamePrompt(range: Range): void {
    const existingPrompt = document.getElementById("variable-tool-prompt");
    if (existingPrompt) {
      existingPrompt.remove();
    }

    const prompt = document.createElement("div");
    prompt.id = "variable-tool-prompt";
    prompt.className = "variable-tool-prompt";
    prompt.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 10px;
      z-index: 10000;
      min-width: 240px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    const label = document.createElement("div");
    label.textContent = "Variable name";
    label.style.cssText =
      "font-size: 12px; color: #666; margin-bottom: 6px; font-weight: 600;";
    prompt.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "e.g. first_name";
    input.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
    `;
    prompt.appendChild(input);

    const suggestions = this.config.availableVariables;
    let suggestionList: HTMLDivElement | null = null;
    if (suggestions.length > 0) {
      suggestionList = document.createElement("div");
      suggestionList.style.cssText =
        "margin-top: 6px; max-height: 160px; overflow-y: auto;";
      suggestions.forEach((v) => {
        const row = document.createElement("button");
        row.type = "button";
        row.textContent = `${v.label} (${v.name})`;
        row.style.cssText = `
          display: block;
          width: 100%;
          text-align: left;
          background: none;
          border: none;
          padding: 6px 8px;
          cursor: pointer;
          font-size: 13px;
          border-radius: 4px;
        `;
        row.addEventListener("mouseenter", () => {
          row.style.background = "#f3f4f6";
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = "none";
        });
        row.addEventListener("click", () => {
          input.value = v.name;
          commit();
        });
        suggestionList!.appendChild(row);
      });
      prompt.appendChild(suggestionList);
    }

    const commit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.insertChip(range, name);
      prompt.remove();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        prompt.remove();
      }
    });

    const rect = range.getBoundingClientRect();
    prompt.style.left = `${rect.left + window.scrollX}px`;
    prompt.style.top = `${rect.bottom + window.scrollY + 4}px`;

    document.body.appendChild(prompt);
    input.focus();

    const outsideHandler = (e: MouseEvent) => {
      if (!prompt.contains(e.target as Node)) {
        prompt.remove();
        document.removeEventListener("mousedown", outsideHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", outsideHandler);
    }, 0);
  }

  private insertChip(range: Range, name: string): void {
    const safeName = this.sanitizeFieldName(name);
    const chip = this.createChipElement(safeName);

    range.deleteContents();
    range.insertNode(chip);

    // Caret jumps to immediately after the chip so the user keeps typing in
    // the surrounding block, not inside the chip.
    const newRange = document.createRange();
    newRange.setStartAfter(chip);
    newRange.collapse(true);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    this._state = true;
  }

  private createChipElement(name: string): HTMLElement {
    const chip = document.createElement("mark");
    chip.setAttribute("data-placeholder-name", name);
    chip.setAttribute("data-unique-id", this.generateUniqueId());
    chip.setAttribute("data-field-type", this.config.fieldType);
    chip.setAttribute("data-custom-width", this.config.defaultMinWidth);
    chip.setAttribute("data-empty", "true");

    this.applyChipStyles(
      chip,
      this.config.defaultMinWidth,
      this.config.defaultBorderColor,
    );
    // Visible label — rendered as `{{name}}` so a filled chip visually matches
    // the source document's convention. The chip is NOT contentEditable; the
    // name only changes through the context menu edit flow.
    chip.textContent = `{{${name}}}`;

    this.setupChipBehavior(chip);
    return chip;
  }

  private applyChipStyles(
    chip: HTMLElement,
    width?: string | null,
    color?: string | null,
  ): void {
    const borderColor =
      color ||
      chip.getAttribute("data-custom-color") ||
      this.config.defaultBorderColor;
    const minWidth =
      width ||
      chip.getAttribute("data-custom-width") ||
      this.config.defaultMinWidth;

    Object.assign(chip.style, {
      display: "inline-block",
      whiteSpace: "nowrap",
      border: `1px solid ${borderColor}`,
      borderRadius: "3px",
      minWidth,
      padding: "0 6px",
      backgroundColor: "#eef5ff",
      color: borderColor,
      cursor: "context-menu",
      verticalAlign: "middle",
      textDecoration: "none",
    });
  }

  private setupChipBehavior(chip: HTMLElement): void {
    const currentId = chip.getAttribute("data-unique-id");
    if (!currentId || this.isDuplicateId(currentId)) {
      chip.setAttribute("data-unique-id", this.generateUniqueId());
    }

    // Chip-level keyboard model: Backspace / Delete removes the whole chip,
    // Arrow keys hop over it. Any other key is a no-op (the chip isn't text).
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        this.removeChip(chip);
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
      }
    });

    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      this.selectChip(chip);
    });

    chip.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.closeAllContextMenus();
      this.selectedChip = chip;
      this.showContextMenu(e, chip);
    });
  }

  private selectChip(chip: HTMLElement): void {
    const range = document.createRange();
    range.selectNode(chip);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  private removeChip(chip: HTMLElement): void {
    const parent = chip.parentNode;
    if (!parent) return;
    const after = document.createRange();
    after.setStartAfter(chip);
    after.collapse(true);
    parent.removeChild(chip);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(after);
    }
  }

  private isDuplicateId(id: string): boolean {
    if (!id) return false;
    const found = document.querySelectorAll(
      `mark[data-unique-id="${CSS.escape(id)}"]`,
    );
    return found.length > 1;
  }

  // ---------- context menu ----------

  private createContextMenu(): void {
    this.contextMenu = document.createElement("div");
    this.contextMenu.className = "variable-chip-context-menu";
    this.contextMenu.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #ddd;
      border-radius: 6px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 12px;
      z-index: 10000;
      display: none;
      min-width: 240px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    VariableTool.activeContextMenus.push(this.contextMenu);

    this.contextMenu.appendChild(this.createNameSection());
    this.contextMenu.appendChild(this.createSeparator());
    this.contextMenu.appendChild(this.createWidthSection());
    this.contextMenu.appendChild(this.createSeparator());
    this.contextMenu.appendChild(this.createColorSection());
    this.contextMenu.appendChild(this.createSeparator());
    this.contextMenu.appendChild(this.createDeleteSection());

    document.body.appendChild(this.contextMenu);

    document.addEventListener("mousedown", (e) => {
      if (
        this.contextMenu &&
        this.contextMenu.style.display === "block" &&
        !this.contextMenu.contains(e.target as Node)
      ) {
        this.hideContextMenu();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeAllContextMenus();
      }
    });
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement("div");
    sep.style.cssText = "border-top: 1px solid #e1e5e9; margin: 8px 0;";
    return sep;
  }

  private createNameSection(): HTMLDivElement {
    const section = document.createElement("div");
    section.style.marginBottom = "12px";

    const label = document.createElement("div");
    label.textContent = "Variable name";
    label.style.cssText =
      "font-size: 12px; color: #666; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;";
    section.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("data-variable-name-input", "true");
    input.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
    `;

    input.addEventListener("change", () => {
      if (!this.selectedChip) return;
      const name = this.sanitizeFieldName(input.value);
      if (!name) return;
      this.selectedChip.setAttribute("data-placeholder-name", name);
      this.selectedChip.textContent = `{{${name}}}`;
    });

    section.appendChild(input);
    return section;
  }

  private createWidthSection(): HTMLDivElement {
    const section = document.createElement("div");

    const label = document.createElement("div");
    label.textContent = "Width";
    label.style.cssText =
      "font-size: 12px; color: #666; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;";
    section.appendChild(label);

    const widthsContainer = document.createElement("div");
    widthsContainer.style.cssText =
      "display: grid; grid-template-columns: 1fr 1fr; gap: 6px;";

    this.config.availableWidths.forEach((width) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = width;
      btn.setAttribute("data-width", width);
      btn.style.cssText = `
        display: block;
        text-align: center;
        padding: 6px 4px;
        border: 1px solid #e1e5e9;
        background: white;
        cursor: pointer;
        font-size: 12px;
        border-radius: 4px;
      `;
      btn.addEventListener("click", () => {
        this.updateChipWidth(width);
        this.setActiveButton(btn, widthsContainer, "width");
      });
      widthsContainer.appendChild(btn);
    });

    section.appendChild(widthsContainer);
    return section;
  }

  private createColorSection(): HTMLDivElement {
    const section = document.createElement("div");

    const label = document.createElement("div");
    label.textContent = "Color";
    label.style.cssText =
      "font-size: 12px; color: #666; margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;";
    section.appendChild(label);

    const colorsContainer = document.createElement("div");
    colorsContainer.style.cssText =
      "display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px;";

    this.config.availableColors.forEach((color) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-color", color);
      btn.style.cssText = `
        width: 24px;
        height: 24px;
        border: 2px solid white;
        border-radius: 4px;
        cursor: pointer;
        background: ${color};
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      `;
      btn.addEventListener("click", () => {
        this.updateChipColor(color);
        this.setActiveButton(btn, colorsContainer, "color");
      });
      colorsContainer.appendChild(btn);
    });

    section.appendChild(colorsContainer);
    return section;
  }

  private createDeleteSection(): HTMLDivElement {
    const section = document.createElement("div");
    section.style.cssText = "padding-top: 4px;";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Delete variable";
    btn.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #dc3545;
      background: white;
      color: #dc3545;
      cursor: pointer;
      font-size: 12px;
      border-radius: 4px;
      font-weight: 500;
    `;
    btn.addEventListener("click", () => {
      if (this.selectedChip) {
        this.removeChip(this.selectedChip);
      }
      this.hideContextMenu();
    });

    section.appendChild(btn);
    return section;
  }

  private setActiveButton(
    activeButton: HTMLButtonElement,
    container: HTMLElement,
    type: "width" | "color",
  ): void {
    container.querySelectorAll("button").forEach((btn) => {
      btn.classList.remove("active");
      if (type === "width") {
        btn.style.backgroundColor = "white";
        btn.style.borderColor = "#e1e5e9";
        btn.style.color = "inherit";
      }
    });

    activeButton.classList.add("active");
    if (type === "width") {
      activeButton.style.backgroundColor = "#0066cc";
      activeButton.style.borderColor = "#0066cc";
      activeButton.style.color = "white";
    } else {
      activeButton.style.transform = "scale(1.1)";
      activeButton.style.boxShadow = "0 2px 8px rgba(0,0,0,0.4)";
    }
  }

  private closeAllContextMenus(): void {
    VariableTool.activeContextMenus.forEach((menu) => {
      if (menu && menu.parentNode) {
        menu.style.display = "none";
      }
    });
    VariableTool.activeContextMenus = VariableTool.activeContextMenus.filter(
      (menu) => menu && menu.parentNode,
    );
  }

  private showContextMenu(event: MouseEvent, chip: HTMLElement): void {
    if (!this.contextMenu) return;

    this.selectedChip = chip;
    this.contextMenu.style.display = "block";

    const nameInput = this.contextMenu.querySelector(
      "[data-variable-name-input]",
    ) as HTMLInputElement | null;
    if (nameInput) {
      nameInput.value = chip.getAttribute("data-placeholder-name") || "";
    }

    const rect = this.contextMenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = rect.width;
    const h = rect.height;
    const x = event.clientX;
    const y = event.clientY;

    const spaceRight = vw - x - 10;
    const spaceLeft = x - 10;
    const spaceBelow = vh - y - 10;
    const spaceAbove = y - 10;

    const left =
      spaceRight >= w
        ? x + window.scrollX + 5
        : spaceLeft >= w
          ? x + window.scrollX - w - 5
          : window.scrollX + 10;
    const top =
      spaceBelow >= h
        ? y + window.scrollY + 5
        : spaceAbove >= h
          ? y + window.scrollY - h - 5
          : window.scrollY + vh - h - 10;

    this.contextMenu.style.left = `${left}px`;
    this.contextMenu.style.top = `${top}px`;
    this.highlightActiveSettings(chip);
  }

  private highlightActiveSettings(chip: HTMLElement): void {
    const currentWidth =
      chip.getAttribute("data-custom-width") || this.config.defaultMinWidth;
    const widthButtons =
      this.contextMenu?.querySelectorAll("[data-width]") || [];
    widthButtons.forEach((btn) => {
      if (btn.getAttribute("data-width") === currentWidth) {
        const container = btn.parentElement;
        if (container) {
          this.setActiveButton(btn as HTMLButtonElement, container, "width");
        }
      }
    });

    const currentColor =
      chip.getAttribute("data-custom-color") || this.config.defaultBorderColor;
    const colorButtons =
      this.contextMenu?.querySelectorAll("[data-color]") || [];
    colorButtons.forEach((btn) => {
      if (btn.getAttribute("data-color") === currentColor) {
        const container = btn.parentElement;
        if (container) {
          this.setActiveButton(btn as HTMLButtonElement, container, "color");
        }
      }
    });
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.style.display = "none";
      this.selectedChip = null;
    }
  }

  private updateChipWidth(width: string): void {
    if (!this.selectedChip) return;
    this.selectedChip.setAttribute("data-custom-width", width);
    this.selectedChip.style.minWidth = width;
  }

  private updateChipColor(color: string): void {
    if (!this.selectedChip) return;
    this.selectedChip.setAttribute("data-custom-color", color);
    this.selectedChip.style.border = `1px solid ${color}`;
    this.selectedChip.style.color = color;
  }

  private sanitizeFieldName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .toLowerCase()
      .replace(/_{2,}/g, "_")
      .replace(/^_|_$/g, "");
  }

  private generateUniqueId(): string {
    return `var_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  checkState(selection: Selection): boolean {
    const selectedNode = selection.anchorNode;
    if (!selectedNode) {
      this._state = false;
      return false;
    }

    const parent =
      selectedNode.nodeType === Node.ELEMENT_NODE
        ? (selectedNode as HTMLElement)
        : selectedNode.parentElement;

    if (
      parent &&
      parent.tagName === "MARK" &&
      parent.hasAttribute("data-placeholder-name")
    ) {
      this._state = true;
      return true;
    }

    this._state = false;
    return false;
  }

  clear(): void {
    this._state = false;
  }

  destroy(): void {
    this.closeAllContextMenus();
    if (this.contextMenu && this.contextMenu.parentNode) {
      this.contextMenu.parentNode.removeChild(this.contextMenu);
    }
    VariableTool.activeContextMenus = VariableTool.activeContextMenus.filter(
      (menu) => menu !== this.contextMenu,
    );
  }
}

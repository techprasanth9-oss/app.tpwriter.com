import EditorJS from "@editorjs/editorjs";

interface ColumnData {
  cols: Array<{
    blocks: unknown[];
    width?: number;
  }>;
  numberOfColumns: number;
  layout: {
    gap: number;
    backgroundColor: string;
    columnBackgroundColor: string;
    borderColor: string;
    borderRadius: number;
    padding: number;
    customCSS: string;
    showBorders: boolean;
    widthMode: "equal" | "custom" | "auto";
  };
}

interface ColumnConfig {
  EditorJS: typeof EditorJS;
  // TODO: tighten this once we have a shared tool-map type.
  tools: Record<string, unknown>;
  defaultColumns?: number;
  maxColumns?: number;
  defaultGap?: number;
  defaultBackgroundColor?: string;
  defaultColumnBackgroundColor?: string;
  defaultBorderColor?: string;
  defaultBorderRadius?: number;
  defaultPadding?: number;
  showBorders?: boolean;
  defaultWidthMode?: "equal" | "custom" | "auto";
}

// TODO: expand once we add typed EditorJS block API wrappers.
interface ToolCtorArgs {
  data: Partial<ColumnData>;
  config: Partial<ColumnConfig>;
  api: unknown;
  readOnly: boolean;
}

class ColumnTool {
  private readOnly: boolean;
  private data: ColumnData;
  private config: Required<Omit<ColumnConfig, "EditorJS" | "tools">> & {
    EditorJS: typeof EditorJS;
    tools: Record<string, unknown>;
  };
  private wrapper: HTMLElement | null = null;
  private editors: EditorJS[] = [];
  private columnWrappers: HTMLElement[] = [];
  private settingsPanel: HTMLElement | null = null;
  private isInitialized: boolean = false;
  private resizeHandles: HTMLElement[] = [];
  private isResizing: boolean = false;
  private currentResizeIndex: number = -1;
  private observer: MutationObserver | null = null;

  static get toolbox() {
    return {
      title: "Columns",
      icon: `<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg">
              <path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/>
            </svg>`,
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  constructor({ data, config, readOnly }: ToolCtorArgs) {
    this.readOnly = readOnly;
    this.config = {
      EditorJS: config?.EditorJS || EditorJS,
      tools: config?.tools || {},
      defaultColumns: config?.defaultColumns || 2,
      maxColumns: config?.maxColumns || 4,
      defaultGap: config?.defaultGap || 20,
      defaultBackgroundColor: config?.defaultBackgroundColor || "transparent",
      defaultColumnBackgroundColor:
        config?.defaultColumnBackgroundColor || "transparent",
      defaultBorderColor: config?.defaultBorderColor || "#e8e8eb",
      defaultBorderRadius: config?.defaultBorderRadius || 8,
      defaultPadding: config?.defaultPadding || 16,
      showBorders:
        config?.showBorders !== undefined ? config.showBorders : false,
      defaultWidthMode: config?.defaultWidthMode || "auto",
    };

    this.data = {
      cols: data?.cols || this._createEmptyColumns(this.config.defaultColumns),
      numberOfColumns: data?.numberOfColumns || this.config.defaultColumns,
      layout: data?.layout || {
        gap: this.config.defaultGap,
        backgroundColor: this.config.defaultBackgroundColor,
        columnBackgroundColor: this.config.defaultColumnBackgroundColor,
        borderColor: this.config.defaultBorderColor,
        borderRadius: this.config.defaultBorderRadius,
        padding: this.config.defaultPadding,
        customCSS: data?.layout?.customCSS || "",
        showBorders: this.config.showBorders,
        widthMode: data?.layout?.widthMode || this.config.defaultWidthMode,
      },
    };

    this.data.cols.forEach((col) => {
      if (col.width === undefined) {
        col.width = 100 / this.data.numberOfColumns;
      }
    });
  }

  private _createEmptyColumns(
    count: number,
  ): Array<{ blocks: unknown[]; width: number }> {
    const defaultWidth = 100 / count;
    return Array.from({ length: count }, () => ({
      blocks: [],
      width: defaultWidth,
    }));
  }

  render(): HTMLElement {
    this.wrapper = document.createElement("div");
    this.wrapper.classList.add("custom-columns-tool");

    const columnsWrapper = document.createElement("div");
    columnsWrapper.classList.add("columns-layout-wrapper");
    this.wrapper.appendChild(columnsWrapper);

    this._applyStyles();
    this._renderColumns(columnsWrapper);

    return this.wrapper;
  }

  private _applyStyles(): void {
    if (!this.wrapper) return;

    this.wrapper.style.cssText = `
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      position: relative;
      background: ${this.data.layout.backgroundColor};
      border-radius: ${this.data.layout.borderRadius}px;
      ${this.data.layout.customCSS}
    `;

    const columnsWrapper = this.wrapper.querySelector(
      ".columns-layout-wrapper",
    );
    if (columnsWrapper) {
      (columnsWrapper as HTMLElement).style.cssText = `
        display: flex;
        gap: ${this.data.layout.gap}px;
        width: 100%;
        padding: 1px;
        box-sizing: border-box;
        position: relative;
        align-items: flex-start;
      `;
    }
  }

  private _renderColumns(container: HTMLElement): void {
    if (!container) return;

    this.columnWrappers.forEach((col) => {
      if (col && col.parentNode) {
        col.remove();
      }
    });
    this.columnWrappers = [];
    this.resizeHandles = [];

    this._destroyEditors();

    while (this.data.cols.length < this.data.numberOfColumns) {
      this.data.cols.push({
        blocks: [],
        width: 100 / this.data.numberOfColumns,
      });
    }

    for (let i = 0; i < this.data.numberOfColumns; i++) {
      const columnWrapper = this._createColumnWrapper(i);
      container.appendChild(columnWrapper);
      this.columnWrappers.push(columnWrapper);

      if (
        i < this.data.numberOfColumns - 1 &&
        this.data.layout.widthMode === "custom" &&
        !this.readOnly
      ) {
        const resizeHandle = this._createResizeHandle(i);
        container.appendChild(resizeHandle);
        this.resizeHandles.push(resizeHandle);
      }

      setTimeout(
        () => {
          this._initializeColumnEditor(i);
        },
        50 * (i + 1),
      );
    }

    this.isInitialized = true;
  }

  private _createColumnWrapper(index: number): HTMLElement {
    const columnWrapper = document.createElement("div");
    columnWrapper.classList.add("custom-column");
    columnWrapper.dataset.columnIndex = index.toString();

    const borderStyle = this.data.layout.showBorders
      ? `1px solid ${this.data.layout.borderColor}`
      : "none";

    let widthStyle = "";
    switch (this.data.layout.widthMode) {
      case "equal":
        widthStyle = "flex: 1 1 0;";
        break;
      case "custom": {
        const width =
          this.data.cols[index]?.width || 100 / this.data.numberOfColumns;
        widthStyle = `flex: 0 0 ${width}%;`;
        break;
      }
      case "auto":
        widthStyle = "flex: 1 1 auto; min-width: 200px;";
        break;
    }

    columnWrapper.style.cssText = `
      ${widthStyle}
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      border: ${borderStyle};
      border-radius: ${this.data.layout.borderRadius}px;
      padding: ${this.data.layout.padding}px;
      background: ${this.data.layout.columnBackgroundColor};
      transition: all 0.3s ease;
      position: relative;
      overflow: visible;
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: flex;
      flex-direction: column;
      align-self: flex-start;
    `;

    const editorHolder = document.createElement("div");
    editorHolder.id = `column-editor-${Date.now()}-${index}`;
    editorHolder.classList.add("column-editor-holder");

    editorHolder.style.cssText = `
      flex: 1;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      position: relative;
      overflow: visible;
      word-wrap: break-word;
      overflow-wrap: break-word;
      background: transparent;
      min-height: 50px;
    `;

    columnWrapper.appendChild(editorHolder);
    return columnWrapper;
  }

  private _createResizeHandle(columnIndex: number): HTMLElement {
    const handle = document.createElement("div");
    handle.classList.add("column-resize-handle");
    handle.dataset.handleIndex = columnIndex.toString();

    handle.style.cssText = `
      width: 8px;
      cursor: col-resize;
      position: relative;
      flex-shrink: 0;
      z-index: 10;
      transition: background-color 0.2s;
      align-self: stretch;
      display: flex;
      align-items: center;
    `;

    const visualIndicator = document.createElement("div");
    visualIndicator.style.cssText = `
      width: 2px;
      height: 60px;
      background: #cbd5e1;
      margin: 0 auto;
      border-radius: 2px;
      transition: all 0.2s;
    `;
    handle.appendChild(visualIndicator);

    handle.addEventListener("mouseenter", () => {
      visualIndicator.style.background = "#3b82f6";
      visualIndicator.style.width = "3px";
    });

    handle.addEventListener("mouseleave", () => {
      if (!this.isResizing) {
        visualIndicator.style.background = "#cbd5e1";
        visualIndicator.style.width = "2px";
      }
    });

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this._startResize(columnIndex, e);
    });

    return handle;
  }

  private _startResize(columnIndex: number, e: MouseEvent): void {
    this.isResizing = true;
    this.currentResizeIndex = columnIndex;

    const startX = e.clientX;
    const columnsWrapper = this.wrapper?.querySelector(
      ".columns-layout-wrapper",
    ) as HTMLElement | null;
    if (!columnsWrapper) return;

    const containerWidth = columnsWrapper.offsetWidth;
    const leftColumn = this.columnWrappers[columnIndex];
    const rightColumn = this.columnWrappers[columnIndex + 1];
    if (!leftColumn || !rightColumn) return;

    const startLeftWidth = this.data.cols[columnIndex]?.width || 0;
    const startRightWidth = this.data.cols[columnIndex + 1]?.width || 0;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;

      let newLeftWidth = startLeftWidth + deltaPercent;
      let newRightWidth = startRightWidth - deltaPercent;

      if (newLeftWidth < 10) {
        newLeftWidth = 10;
        newRightWidth = startLeftWidth + startRightWidth - 10;
      }
      if (newRightWidth < 10) {
        newRightWidth = 10;
        newLeftWidth = startLeftWidth + startRightWidth - 10;
      }

      const colL = this.data.cols[columnIndex];
      const colR = this.data.cols[columnIndex + 1];
      if (colL) colL.width = newLeftWidth;
      if (colR) colR.width = newRightWidth;

      leftColumn.style.flex = `0 0 ${newLeftWidth}%`;
      rightColumn.style.flex = `0 0 ${newRightWidth}%`;
    };

    const handleMouseUp = () => {
      this.isResizing = false;
      this.currentResizeIndex = -1;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  private _destroyEditors(): void {
    for (let i = 0; i < this.editors.length; i++) {
      const editor = this.editors[i];
      if (editor && editor.destroy) {
        try {
          const destroyPromise = editor.destroy() as unknown;
          if (
            destroyPromise &&
            typeof (destroyPromise as { then?: unknown }).then === "function"
          ) {
            (destroyPromise as Promise<unknown>)
              .then(() => {
                /* editor destroyed */
              })
              .catch((err: unknown) => {
                console.error(`Error destroying editor ${i}:`, err);
              });
          }
        } catch (err) {
          console.error(`Error in destroy for editor ${i}:`, err);
        }
      }
    }
    this.editors = [];

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  private async _initializeColumnEditor(columnIndex: number): Promise<void> {
    try {
      const columnWrapper = this.columnWrappers[columnIndex];
      if (!columnWrapper) return;

      const editorHolder = columnWrapper.querySelector(
        ".column-editor-holder",
      ) as HTMLElement | null;
      if (!editorHolder) return;

      const editorId = `column-editor-${Date.now()}-${columnIndex}`;
      editorHolder.id = editorId;

      if (!this.config.EditorJS) {
        console.error("EditorJS constructor not available");
        return;
      }

      // TODO: tighten once we have a typed EditorJS config.
      const editorConfig: Record<string, unknown> = {
        holder: editorId,
        tools: this.config.tools,
        data: {
          blocks: this.data.cols[columnIndex]?.blocks || [],
        },
        readOnly: this.readOnly,
        minHeight: 0,
        placeholder: "Type here…",
        inlineToolbar: true,
        defaultBlock: "paragraph",
        hideToolbar: false,
        autofocus: false,
        onReady: () => {
          this._fixToolbarPositioning(columnIndex);
        },
        onChange: async () => {
          if (!this.readOnly) {
            try {
              const editor = this.editors[columnIndex];
              if (!editor) return;
              const savedData = await editor.save();
              const col = this.data.cols[columnIndex];
              if (col) {
                col.blocks = savedData.blocks;
              }
            } catch (error) {
              console.error("Error saving column data:", error);
            }
          }
        },
      };

      const editor = new this.config.EditorJS(editorConfig as never);
      this.editors[columnIndex] = editor;

      setTimeout(() => {
        this._applyEditorStyles(editorId);
      }, 100);
    } catch (error) {
      console.error("Error initializing column editor:", error);
    }
  }

  private _applyEditorStyles(editorId: string): void {
    const editorElement = document.getElementById(editorId);
    if (!editorElement) return;

    editorElement.style.cssText = `
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    position: relative;
    overflow: visible;
  `;

    const codexEditor = editorElement.querySelector(".codex-editor");
    if (codexEditor) {
      (codexEditor as HTMLElement).style.cssText = `
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      position: relative;
      overflow: visible;
      background: transparent;
    `;
    }

    const editorContent = editorElement.querySelector(
      ".codex-editor__redactor",
    );
    if (editorContent) {
      (editorContent as HTMLElement).style.cssText = `
      padding-bottom: 0 !important;
      margin-bottom: 0 !important;
      position: relative;
      overflow: visible;
    `;
    }
  }

  private _fixToolbarPositioning(columnIndex: number): void {
    const columnWrapper = this.columnWrappers[columnIndex];
    if (!columnWrapper) return;

    const editorElement = columnWrapper.querySelector(".column-editor-holder");
    if (!editorElement) return;

    this._injectToolbarStyles();
    this._setupToolbarObserver(editorElement as HTMLElement);
  }

  private _injectToolbarStyles(): void {
    const styleId = "custom-columns-toolbar-styles";
    if (document.getElementById(styleId)) return;

    const styleSheet = document.createElement("style");
    styleSheet.id = styleId;
    styleSheet.textContent = `
      /* Fix inline toolbar positioning inside column blocks */
      .custom-columns-tool .ce-inline-toolbar {
        position: fixed !important;
        z-index: 10000 !important;
        transform: none !important;
        left: auto !important;
        right: auto !important;
      }

      .custom-columns-tool .ce-inline-toolbar--showed {
        opacity: 1 !important;
        visibility: visible !important;
        display: flex !important;
      }

      .custom-columns-tool .column-editor-holder,
      .custom-columns-tool .custom-column,
      .custom-columns-tool .codex-editor,
      .custom-columns-tool .codex-editor__redactor {
        overflow: visible !important;
      }

      .custom-columns-tool .ce-toolbar {
        position: absolute !important;
        z-index: 9999 !important;
      }

      .custom-columns-tool .ce-block {
        position: relative;
        z-index: 1;
      }

      .custom-columns-tool .ce-block--focused {
        z-index: 2;
      }
    `;
    document.head.appendChild(styleSheet);
  }

  private _setupToolbarObserver(editorElement: HTMLElement): void {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          const target = mutation.target as HTMLElement;
          if (
            target.classList.contains("ce-inline-toolbar") &&
            target.classList.contains("ce-inline-toolbar--showed")
          ) {
            this._repositionInlineToolbar(target, editorElement);
          }
        }

        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) {
              const inlineToolbar = node.classList.contains("ce-inline-toolbar")
                ? node
                : node.querySelector(".ce-inline-toolbar");
              if (
                inlineToolbar &&
                (inlineToolbar as HTMLElement).classList.contains(
                  "ce-inline-toolbar--showed",
                )
              ) {
                this._repositionInlineToolbar(
                  inlineToolbar as HTMLElement,
                  editorElement,
                );
              }
            }
          });
        }
      });
    });

    observer.observe(editorElement, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
      childList: true,
    });

    if (!this.observer) {
      this.observer = observer;
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editorElement.contains(range.commonAncestorContainer)) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              const inlineToolbar = editorElement.querySelector(
                ".ce-inline-toolbar--showed",
              ) as HTMLElement | null;
              if (inlineToolbar) {
                this._repositionInlineToolbar(inlineToolbar, editorElement);
              }
            }, 50);
          });
        }
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    editorElement.addEventListener("mouseup", () => {
      setTimeout(() => {
        const inlineToolbar = editorElement.querySelector(
          ".ce-inline-toolbar--showed",
        ) as HTMLElement | null;
        if (inlineToolbar) {
          this._repositionInlineToolbar(inlineToolbar, editorElement);
        }
      }, 100);
    });
  }

  private _repositionInlineToolbar(
    toolbar: HTMLElement,
    editorElement: HTMLElement,
  ): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    if (!editorElement.contains(range.commonAncestorContainer)) return;

    const selectionRect = range.getBoundingClientRect();

    if (selectionRect.width === 0 && selectionRect.height === 0) return;

    toolbar.style.visibility = "hidden";
    toolbar.style.display = "block";
    const toolbarRect = toolbar.getBoundingClientRect();
    const toolbarHeight = toolbarRect.height || 40;
    const toolbarWidth = toolbarRect.width || 300;
    toolbar.style.visibility = "";

    const pageContainer =
      this.wrapper?.closest('[class*="page"]') ||
      this.wrapper?.closest('[class*="editor-page"]') ||
      this.wrapper?.closest(".codex-editor") ||
      this.wrapper?.parentElement?.parentElement;

    let pageLeft = 230;
    let pageRight = window.innerWidth - 250;

    if (pageContainer) {
      const pageRect = pageContainer.getBoundingClientRect();
      pageLeft = pageRect.left + 10;
      pageRight = pageRect.right - 10;
    }

    let finalY = selectionRect.bottom + 8;

    let finalX = selectionRect.right - toolbarWidth;

    if (selectionRect.width < toolbarWidth) {
      const selectionCenterX = selectionRect.left + selectionRect.width / 2;
      finalX = selectionCenterX - toolbarWidth / 2;
    }

    if (finalX < pageLeft) {
      finalX = pageLeft;
    }

    if (finalX + toolbarWidth > pageRight) {
      finalX = pageRight - toolbarWidth;
    }

    if (finalX < pageLeft) {
      finalX = pageLeft;
    }

    if (finalY + toolbarHeight > window.innerHeight - 10) {
      finalY = selectionRect.top - toolbarHeight - 8;
    }

    toolbar.style.position = "fixed";
    toolbar.style.left = `${finalX}px`;
    toolbar.style.top = `${finalY}px`;
    toolbar.style.transform = "none";
    toolbar.style.zIndex = "10000";
  }

  private async _changeColumnCount(newCount: number): Promise<void> {
    for (let i = 0; i < this.editors.length; i++) {
      const editor = this.editors[i];
      if (editor && typeof editor.save === "function") {
        try {
          const data = await editor.save();
          const col = this.data.cols[i];
          if (col) {
            col.blocks = data.blocks;
          }
        } catch (error) {
          console.error(`Error saving column ${i}:`, error);
        }
      }
    }

    const defaultWidth = 100 / newCount;

    if (newCount > this.data.numberOfColumns) {
      const columnsToAdd = newCount - this.data.numberOfColumns;
      for (let i = 0; i < columnsToAdd; i++) {
        this.data.cols.push({ blocks: [], width: defaultWidth });
      }
    } else if (newCount < this.data.numberOfColumns) {
      this.data.cols = this.data.cols.slice(0, newCount);
    }

    this.data.cols.forEach((col) => {
      col.width = defaultWidth;
    });

    this.data.numberOfColumns = newCount;

    const columnsWrapper = this.wrapper?.querySelector(
      ".columns-layout-wrapper",
    );
    if (columnsWrapper) {
      this._renderColumns(columnsWrapper as HTMLElement);
    }
  }

  private _updateLayoutStyle(property: string, value: unknown): void {
    // TODO: tighten this bag once `layout` has a strong keyed accessor.
    (this.data.layout as unknown as Record<string, unknown>)[property] = value;

    if (property === "widthMode") {
      if (value === "equal" || value === "auto") {
        const defaultWidth = 100 / this.data.numberOfColumns;
        this.data.cols.forEach((col) => {
          col.width = defaultWidth;
        });
      }

      const columnsWrapper = this.wrapper?.querySelector(
        ".columns-layout-wrapper",
      );
      if (columnsWrapper) {
        this._renderColumns(columnsWrapper as HTMLElement);
      }
      return;
    }

    this._applyStyles();

    this.columnWrappers.forEach((column) => {
      if (property === "borderColor" || property === "showBorders") {
        const borderStyle = this.data.layout.showBorders
          ? `1px solid ${this.data.layout.borderColor}`
          : "none";
        column.style.border = borderStyle;
      } else if (property === "columnBackgroundColor") {
        column.style.background = String(value ?? "");
      } else if (property === "borderRadius") {
        column.style.borderRadius = `${value}px`;
      } else if (property === "padding") {
        column.style.padding = `${value}px`;
      } else if (property === "gap") {
        const columnsWrapper = this.wrapper?.querySelector(
          ".columns-layout-wrapper",
        );
        if (columnsWrapper) {
          (columnsWrapper as HTMLElement).style.gap = `${value}px`;
        }
      }
    });
  }

  async save(): Promise<ColumnData> {
    for (let i = 0; i < this.editors.length; i++) {
      const editor = this.editors[i];
      if (editor && typeof editor.save === "function") {
        try {
          const savedData = await editor.save();
          const col = this.data.cols[i];
          if (col) {
            col.blocks = savedData.blocks;
          }
        } catch (error) {
          console.error(`Error saving column ${i}:`, error);
        }
      }
    }

    while (this.data.cols.length < this.data.numberOfColumns) {
      this.data.cols.push({
        blocks: [],
        width: 100 / this.data.numberOfColumns,
      });
    }

    return {
      cols: this.data.cols.slice(0, this.data.numberOfColumns),
      numberOfColumns: this.data.numberOfColumns,
      layout: this.data.layout,
    };
  }

  validate(savedData: ColumnData): boolean {
    return !!(
      savedData &&
      savedData.cols &&
      Array.isArray(savedData.cols) &&
      savedData.cols.length > 0
    );
  }

  renderSettings(): HTMLElement {
    this.settingsPanel = document.createElement("div");
    this.settingsPanel.style.cssText = `
      padding: 16px;
      max-width: 320px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    `;

    this._renderColumnCountSettings();
    this._renderWidthModeSettings();
    if (this.data.layout.widthMode === "custom") {
      this._renderColumnWidthSettings();
    }
    this._renderLayoutSettings();
    this._renderBorderSettings();
    this._renderColorSettings();
    this._renderAdvancedSettings();

    return this.settingsPanel;
  }

  private _renderWidthModeSettings(): void {
    const section = this._createSettingsSection("Width distribution");

    const modes = [
      { value: "equal", label: "Equal width", icon: "⚖️" },
      { value: "custom", label: "Custom width", icon: "📏" },
      { value: "auto", label: "Auto (content-based)", icon: "🔄" },
    ];

    const modesWrapper = document.createElement("div");
    modesWrapper.style.cssText =
      "display: flex; flex-direction: column; gap: 8px;";

    modes.forEach((mode) => {
      const button = document.createElement("button");
      button.type = "button";
      const isActive = this.data.layout.widthMode === mode.value;

      button.style.cssText = `
        padding: 12px 16px;
        border: 2px solid ${isActive ? "#3b82f6" : "#e5e7eb"};
        border-radius: 8px;
        background: ${isActive ? "#eff6ff" : "white"};
        color: ${isActive ? "#1e40af" : "#374151"};
        cursor: pointer;
        font-size: 13px;
        font-weight: ${isActive ? "600" : "500"};
        transition: all 0.15s;
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
      `;

      button.innerHTML = `<span>${mode.icon}</span><span>${mode.label}</span>`;

      if (!isActive) {
        button.addEventListener("mouseenter", () => {
          button.style.background = "#f8fafc";
          button.style.borderColor = "#cbd5e1";
        });

        button.addEventListener("mouseleave", () => {
          button.style.background = "white";
          button.style.borderColor = "#e5e7eb";
        });
      }

      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._updateLayoutStyle("widthMode", mode.value);

        if (this.settingsPanel && this.settingsPanel.parentNode) {
          const newSettings = this.renderSettings();
          this.settingsPanel.parentNode.replaceChild(
            newSettings,
            this.settingsPanel,
          );
        }
      });

      modesWrapper.appendChild(button);
    });

    section.appendChild(modesWrapper);
    this.settingsPanel!.appendChild(section);
  }

  private _renderColumnWidthSettings(): void {
    const section = this._createSettingsSection("Column widths");

    for (let i = 0; i < this.data.numberOfColumns; i++) {
      const width = this.data.cols[i]?.width || 100 / this.data.numberOfColumns;

      const sliderWrapper = this._createSliderSetting(
        `Column ${i + 1}`,
        Math.round(width),
        10,
        90,
        (value) => {
          const col = this.data.cols[i];
          if (!col) return;
          col.width = value;

          const totalOthers = 100 - value;
          const othersCount = this.data.numberOfColumns - 1;

          if (othersCount > 0) {
            const perOther = totalOthers / othersCount;
            this.data.cols.forEach((c, idx) => {
              if (idx !== i) {
                c.width = perOther;
              }
            });
          }

          this.columnWrappers.forEach((wrapper, idx) => {
            const w = this.data.cols[idx]?.width;
            if (w !== undefined) wrapper.style.flex = `0 0 ${w}%`;
          });
        },
      );

      section.appendChild(sliderWrapper);
    }

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset to equal widths";
    resetButton.style.cssText = `
      width: 100%;
      padding: 8px 16px;
      margin-top: 8px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: white;
      color: #374151;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s;
    `;

    resetButton.addEventListener("mouseenter", () => {
      resetButton.style.background = "#f8fafc";
    });

    resetButton.addEventListener("mouseleave", () => {
      resetButton.style.background = "white";
    });

    resetButton.addEventListener("click", (e) => {
      e.preventDefault();
      const equalWidth = 100 / this.data.numberOfColumns;
      this.data.cols.forEach((col, idx) => {
        col.width = equalWidth;
        const w = this.columnWrappers[idx];
        if (w) w.style.flex = `0 0 ${equalWidth}%`;
      });

      if (this.settingsPanel && this.settingsPanel.parentNode) {
        const newSettings = this.renderSettings();
        this.settingsPanel.parentNode.replaceChild(
          newSettings,
          this.settingsPanel,
        );
      }
    });

    section.appendChild(resetButton);
    this.settingsPanel!.appendChild(section);
  }

  private _renderColumnCountSettings(): void {
    const section = this._createSettingsSection("Column layout");

    const buttonsWrapper = document.createElement("div");
    buttonsWrapper.style.cssText = "display: flex; gap: 8px; flex-wrap: wrap;";

    for (let i = 1; i <= this.config.maxColumns; i++) {
      const button = this._createColumnButton(i);
      buttonsWrapper.appendChild(button);
    }

    section.appendChild(buttonsWrapper);
    this.settingsPanel!.appendChild(section);
  }

  private _createColumnButton(count: number): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${count}`;

    const isActive = count === this.data.numberOfColumns;

    button.style.cssText = `
      width: 40px;
      height: 40px;
      border: 2px solid ${isActive ? "#3b82f6" : "#e5e7eb"};
      border-radius: 8px;
      background: ${isActive ? "#3b82f6" : "white"};
      color: ${isActive ? "white" : "#374151"};
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    if (!isActive) {
      button.addEventListener("mouseenter", () => {
        button.style.background = "#f8fafc";
        button.style.borderColor = "#cbd5e1";
      });

      button.addEventListener("mouseleave", () => {
        button.style.background = "white";
        button.style.borderColor = "#e5e7eb";
      });
    }

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._changeColumnCount(count);

      const buttonsWrapper = button.parentElement;
      if (buttonsWrapper) {
        buttonsWrapper.querySelectorAll("button").forEach((btn) => {
          const btnElement = btn as HTMLElement;
          const btnCount = parseInt(btnElement.textContent || "0");
          const isNowActive = btnCount === count;

          btnElement.style.background = isNowActive ? "#3b82f6" : "white";
          btnElement.style.color = isNowActive ? "white" : "#374151";
          btnElement.style.borderColor = isNowActive ? "#3b82f6" : "#e5e7eb";
        });
      }
    });

    return button;
  }

  private _renderLayoutSettings(): void {
    const section = this._createSettingsSection("Layout settings");

    const gapWrapper = this._createSliderSetting(
      "Gap between columns",
      this.data.layout.gap,
      0,
      50,
      (value) => this._updateLayoutStyle("gap", value),
    );
    section.appendChild(gapWrapper);

    const paddingWrapper = this._createSliderSetting(
      "Column padding",
      this.data.layout.padding,
      0,
      40,
      (value) => this._updateLayoutStyle("padding", value),
    );
    section.appendChild(paddingWrapper);

    const borderRadiusWrapper = this._createSliderSetting(
      "Border radius",
      this.data.layout.borderRadius,
      0,
      20,
      (value) => this._updateLayoutStyle("borderRadius", value),
    );
    section.appendChild(borderRadiusWrapper);

    this.settingsPanel!.appendChild(section);
  }

  private _renderBorderSettings(): void {
    const section = this._createSettingsSection("Border settings");

    const toggleWrapper = document.createElement("div");
    toggleWrapper.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;";

    const label = document.createElement("label");
    label.textContent = "Show borders";
    label.style.cssText = "font-size: 13px; color: #374151; cursor: pointer;";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = this.data.layout.showBorders;
    toggle.style.cssText = "cursor: pointer;";

    toggle.addEventListener("change", (e) => {
      const isChecked = (e.target as HTMLInputElement).checked;
      this._updateLayoutStyle("showBorders", isChecked);
    });

    toggleWrapper.appendChild(label);
    toggleWrapper.appendChild(toggle);
    section.appendChild(toggleWrapper);

    if (this.data.layout.showBorders) {
      const borderColorWrapper = this._createColorSetting(
        "Border color",
        this.data.layout.borderColor,
        (value) => this._updateLayoutStyle("borderColor", value),
      );
      section.appendChild(borderColorWrapper);
    }

    this.settingsPanel!.appendChild(section);
  }

  private _renderColorSettings(): void {
    const section = this._createSettingsSection("Color settings");

    const bgColorWrapper = this._createColorSetting(
      "Background color",
      this.data.layout.backgroundColor,
      (value) => this._updateLayoutStyle("backgroundColor", value),
    );
    section.appendChild(bgColorWrapper);

    const columnBgColorWrapper = this._createColorSetting(
      "Column background",
      this.data.layout.columnBackgroundColor,
      (value) => this._updateLayoutStyle("columnBackgroundColor", value),
    );
    section.appendChild(columnBgColorWrapper);

    this.settingsPanel!.appendChild(section);
  }

  private _renderAdvancedSettings(): void {
    const section = this._createSettingsSection("Advanced");

    const cssWrapper = document.createElement("div");
    cssWrapper.style.cssText = "margin-bottom: 16px;";

    const cssLabel = document.createElement("label");
    cssLabel.textContent = "Custom CSS";
    cssLabel.style.cssText =
      "display: block; font-size: 12px; color: #374151; margin-bottom: 6px; font-weight: 500;";

    const cssTextarea = document.createElement("textarea");
    cssTextarea.value = this.data.layout.customCSS;
    cssTextarea.placeholder = "/* custom CSS applied to this columns block */";
    cssTextarea.style.cssText = `
      width: 100%;
      height: 80px;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      resize: vertical;
      background: #f8fafc;
    `;

    cssTextarea.addEventListener("input", (e) => {
      const value = (e.target as HTMLTextAreaElement).value;
      this._updateLayoutStyle("customCSS", value);
    });

    cssWrapper.appendChild(cssLabel);
    cssWrapper.appendChild(cssTextarea);
    section.appendChild(cssWrapper);

    this.settingsPanel!.appendChild(section);
  }

  private _createSettingsSection(title: string): HTMLElement {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 24px;";

    const titleElement = document.createElement("div");
    titleElement.textContent = title;
    titleElement.style.cssText = `
      font-weight: 600;
      font-size: 14px;
      color: #1f2937;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #f1f5f9;
    `;

    section.appendChild(titleElement);
    return section;
  }

  private _createSliderSetting(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "margin-bottom: 16px;";

    const labelRow = document.createElement("div");
    labelRow.style.cssText =
      "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";

    const labelElement = document.createElement("label");
    labelElement.textContent = label;
    labelElement.style.cssText =
      "font-size: 13px; color: #374151; font-weight: 500;";

    const valueElement = document.createElement("span");
    valueElement.textContent = `${value}px`;
    valueElement.style.cssText =
      "font-size: 12px; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 10px;";

    labelRow.appendChild(labelElement);
    labelRow.appendChild(valueElement);
    wrapper.appendChild(labelRow);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min.toString();
    slider.max = max.toString();
    slider.value = value.toString();
    slider.style.cssText = `
      width: 100%;
      height: 6px;
      border-radius: 3px;
      background: #e2e8f0;
      outline: none;
      -webkit-appearance: none;
      cursor: pointer;
    `;

    slider.addEventListener("input", (e) => {
      const newValue = parseInt((e.target as HTMLInputElement).value);
      valueElement.textContent = `${newValue}px`;
      onChange(newValue);
    });

    wrapper.appendChild(slider);
    return wrapper;
  }

  private _createColorSetting(
    label: string,
    value: string,
    onChange: (value: string) => void,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "margin-bottom: 16px;";

    const labelRow = document.createElement("div");
    labelRow.style.cssText =
      "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";

    const labelElement = document.createElement("label");
    labelElement.textContent = label;
    labelElement.style.cssText =
      "font-size: 13px; color: #374151; font-weight: 500;";

    labelRow.appendChild(labelElement);
    wrapper.appendChild(labelRow);

    const colorInputWrapper = document.createElement("div");
    colorInputWrapper.style.cssText =
      "display: flex; align-items: center; gap: 8px;";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = value;
    colorInput.style.cssText = `
      width: 40px;
      height: 40px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      cursor: pointer;
      padding: 2px;
      background: white;
    `;

    const colorText = document.createElement("span");
    colorText.textContent = value;
    colorText.style.cssText =
      "font-size: 12px; color: #64748b; font-family: monospace;";

    colorInput.addEventListener("input", (e) => {
      const newValue = (e.target as HTMLInputElement).value;
      colorText.textContent = newValue;
      onChange(newValue);
    });

    colorInputWrapper.appendChild(colorInput);
    colorInputWrapper.appendChild(colorText);
    wrapper.appendChild(colorInputWrapper);

    return wrapper;
  }

  destroy(): void {
    this._destroyEditors();
    this.columnWrappers = [];
    this.resizeHandles = [];
    this.wrapper = null;
    this.settingsPanel = null;
    this.isInitialized = false;
    this.isResizing = false;
    this.currentResizeIndex = -1;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

export default ColumnTool;

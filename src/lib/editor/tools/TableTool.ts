/**
 * TableTool — EditorJS block tool for rich tables.
 *
 * Ported from eSigns with the CLM "linked field" wiring stripped:
 *   - `linkedField` / `linkedUsers` / `viewerEmail` / `viewerFinished`
 *     config and the owner-permission gates around `cellsEditable` were
 *     dropped. Every cell is editable unless the whole tool is in
 *     `readOnly` mode.
 *   - `emitLinkedChange` / `onLinkedChange` / `cacheLinkedValue` /
 *     `renderLinkedBadge` / `buildOwnerList` / the `clm:linked-table-changed`
 *     window-event bus and `applyTableValueToBlockData` were removed.
 *   - `failedPopper(msg)` replaced with `console.warn(msg)`.
 *   - `t(key, { defaultValue })` collapsed to inline English literals
 *     via a local `t()` shim (falls back to the key's last segment when
 *     no `defaultValue` is present).
 */

/** Inline shim for the eSigns i18n layer. */
function t(key: string, options?: { defaultValue?: string } & Record<string, unknown>): string {
  if (options && typeof options.defaultValue === "string") {
    return options.defaultValue;
  }
  const last = key.split(".").pop() || key;
  const spaced = last.replace(/([A-Z])/g, " $1").replace(/[._-]/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** eSigns toast replacement — surfaces input-validation failures as a
 *  console warning so callers still see them without the CLM UI shell. */
function failedPopper(message: string): void {
  console.warn(message);
}

interface TableData {
  content: string[][];
  withHeading: boolean;
  headerRows?: number[];
  hideBorders?: boolean;
  columnWidths?: number[];
  // Per-row heights in px. Written by the row drag-resize handle and the
  // Row Height popup. Undefined entries mean "let the row auto-size".
  rowHeights?: number[];
  // Tier-2 fields. All optional + default-off so legacy tables load
  // exactly as before.
  theme?: string;
  repeatHeaderOnPrint?: boolean;
  tableAlign?: "left" | "center" | "right";
  caption?: string;
  captionPosition?: "top" | "bottom";
  cellImages?: { [key: string]: string };
  cellImageSizes?: { [key: string]: { width: number; height: number } };
  styles: {
    table: {
      width: string;
      backgroundColor: string;
      borderColor: string;
      borderWidth: string;
      borderStyle: string;
      tableLayout?: string;
    };
    rows: { [key: string]: { backgroundColor: string } };
    cells: {
      [key: string]: {
        backgroundColor?: string;
        borderColor?: string;
        borderWidth?: string;
        borderStyle?: string;
        // Per-side border shorthands ("2px solid #000"). When set, take
        // precedence over the shorthand triplet above — lets the user
        // style sides independently (Word/Zoho behaviour). Legacy cells
        // without these fields keep the shorthand path intact.
        borderTop?: string;
        borderRight?: string;
        borderBottom?: string;
        borderLeft?: string;
        textAlign?: string;
        colSpan?: number;
        rowSpan?: number;
        color?: string;
        paddingTop?: string;
        paddingBottom?: string;
        paddingLeft?: string;
        paddingRight?: string;
        verticalAlign?: string;
        // Diagonal line across the cell. "down" = TL→BR, "up" = BL→TR,
        // undefined/"" = no diagonal. Rendered as a per-cell SVG overlay
        // in enhanceDiagonalBorders().
        diagonalBorder?: "down" | "up" | "";
      };
    };
  };
}

interface PasteConfig {
  tags: string[];
  files: {
    mimeTypes: string[];
  };
  patterns: {
    [key: string]: RegExp;
  };
}

class TableTool {
  static get toolbox() {
    return {
      title: "Table",
      // Lucide "Table" — currentColor + 2px stroke matches the palette's
      // text color so the icon reads correctly in light + dark modes.
      icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M3 3h18v18H3z"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>`,
    };
  }
  static get isReadOnlySupported() {
    return true;
  }

  private data: any;
  private wrapper: HTMLElement | any;
  private readOnly = false;
  private table: any;
  private contextMenu: any;
  private selectedCell: any;
  private selectedRow: any;
  private isSelecting = false;
  private selectionStart: any;
  private selectionEnd: any;
  private selectionStartRow: number;
  private selectionStartCol: number;
  private selectionStartEndCol: number;
  private selectionEndRow: number;
  private selectionEndCol: number;
  private selectionEndEndCol: number;
  private selectedMinRow: number | undefined;
  private selectedMaxRow: number | undefined;
  private selectedMinCol: number | undefined;
  private selectedMaxCol: number | undefined;
  private ownerGrid:
    | { cell: HTMLTableCellElement; startRow: number; startCol: number }[][]
    | undefined;
  private setOpenTableProperties?: any;
  private openTableProperties?: any;
  private completedPreview = false;

  private readonly CSS = {
    wrapper: "te-table-wrapper",
    table: "te-table",
    cell: "te-table-cell",
    row: "te-table-row",
    selected: "te-cell-selected",
    selecting: "te-cell-selecting",
    contextMenu: "te-context-menu",
    contextMenuItem: "te-context-menu-item",
    contextMenuIcon: "te-context-menu-icon",
    submenu: "te-submenu",
    header: "te-table-header",
    resizeHandle: "table-resize-handle",
  };

  private block?: any;

  constructor({
    data,
    readOnly = false,
    config,
    block,
  }: {
    data: any;
    readOnly?: boolean;
    config: any;
    block?: any;
  }) {
    this.readOnly = readOnly;
    this.block = block;
    this.data = {
      id: data.id || this.generateUniqueId(),
      content: data.content || [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ],
      withHeading: data.withHeading || false,
      headerRows: data.headerRows || [],
      hideBorders: data.hideBorders || false,
      columnWidths: data.columnWidths || [],
      rowHeights: data.rowHeights || [],
      theme: data.theme || "none",
      repeatHeaderOnPrint:
        typeof data.repeatHeaderOnPrint === "boolean"
          ? data.repeatHeaderOnPrint
          : true,
      tableAlign: data.tableAlign || "left",
      caption: data.caption || "",
      captionPosition: data.captionPosition || "top",
      cellImages: data.cellImages || {},
      cellImageSizes: data.cellImageSizes || {},
      styles: {
        table: {
          width: "100%",
          height: "auto",
          backgroundColor: "#ffffff",
          borderColor: "#d1d5db",
          borderWidth: "1px",
          borderStyle: "solid",
          position: "relative",
          tableLayout: "fixed",
          ...data.styles?.table,
        },
        rows: data.styles?.rows || {},
        cells: data.styles?.cells || {},
      },
    };

    this.wrapper = document.createElement("div");
    this.wrapper.classList.add(this.CSS.wrapper);
    this.setOpenTableProperties = config?.setOpenTableProperties;
    this.openTableProperties = config?.openTableProperties;
    this.completedPreview = config?.isEditable || false;
  }

  private getParentWidth(): number {
    const parent = this.wrapper.parentElement;
    if (!parent) return 729;
    return parent.offsetWidth || 729;
  }

  private createResizeHandle() {
    if (this.readOnly || this.completedPreview) return null;

    const resizeHandle = document.createElement("div");
    resizeHandle.classList.add(this.CSS.resizeHandle);

    resizeHandle.style.cssText = `
      position: absolute;
      width: 15px;
      height: 15px;
      cursor: se-resize;
      background-color: rgba(0,0,0,0.2);
      z-index: 20;
      pointer-events: auto;
      touch-action: none;
    `;

    let isResizing = false;
    let startX: number, startY: number;
    let startWidth: number, startHeight: number;

    const updateHandlePosition = () => {
      const tableRect = this.table.getBoundingClientRect();
      const wrapperRect = this.wrapper.getBoundingClientRect();
      resizeHandle.style.bottom = `${wrapperRect.bottom - tableRect.bottom}px`;
      resizeHandle.style.right = `${wrapperRect.right - tableRect.right}px`;
    };

    const startResize = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = this.table.offsetWidth;
      startHeight = this.table.offsetHeight;

      document.addEventListener("mousemove", resize);
      document.addEventListener("mouseup", stopResize);
      document.addEventListener("mouseleave", stopResize);
    };

    const resize = (e: MouseEvent) => {
      if (!isResizing) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const maxWidth = this.getParentWidth() - 2;
      const newWidth = Math.max(200, Math.min(startWidth + dx, maxWidth));
      const newHeight = Math.max(100, startHeight + dy);

      this.table.style.width = `${newWidth}px`;
      this.table.style.height = `${newHeight}px`;

      this.data.styles.table.width = `${newWidth}px`;
      this.data.styles.table.height = `${newHeight}px`;

      updateHandlePosition();
    };

    const stopResize = () => {
      isResizing = false;
      document.removeEventListener("mousemove", resize);
      document.removeEventListener("mouseup", stopResize);
      document.removeEventListener("mouseleave", stopResize);
      this.updateData();
    };

    resizeHandle.addEventListener("mousedown", startResize);

    updateHandlePosition();

    const resizeObserver = new ResizeObserver(() => {
      updateHandlePosition();
    });
    resizeObserver.observe(this.table);

    return resizeHandle;
  }

  render() {
    this.createTable();
    this.attachEventListeners();
    // Row/column drag-resize cursors on cell edges + Tab/Shift+Tab
    // navigation. Both are no-ops in read-only mode so the completed /
    // preview routes get the same inert table they always had.
    this.attachEdgeResizeHandlers();
    this.attachKeyboardNavigation();
    this.applyTableStyles();

    this.wrapper.style.position = "relative";
    this.wrapper.style.overflow = "visible";

    const existingHandle = this.wrapper.querySelector(
      `.${this.CSS.resizeHandle}`,
    );
    if (existingHandle) {
      existingHandle.remove();
    }

    const resizeHandle = this.createResizeHandle();
    if (resizeHandle) {
      this.wrapper.appendChild(resizeHandle);
    }
    return this.wrapper;
  }

  /** Cell editability. In the stripped port this is simply `!readOnly` —
   *  the CLM linked-field owner/author permission gates are gone. */
  private get cellsEditable(): boolean {
    return !this.readOnly;
  }

  destroy() {
    /* No-op. eSigns used this to detach the `clm:linked-table-changed`
     * window listener, which no longer exists in this port. */
  }

  // ──────────────────────────────────────────────────────────────────────────
  // The CLM linked-field surface (linkedField, linkedUsers, viewerEmail,
  // viewerFinished, cacheLinkedValue, emitLinkedChange, onLinkedChange,
  // renderLinkedBadge, buildOwnerList, isLinked, ownerName) was removed as
  // part of the port — see cellsEditable above. The remaining declarations
  // keep rebuildTable intact for use by resize / cell-edit paths.
  // ──────────────────────────────────────────────────────────────────────────

  // Stub declarations retained so the renamed-but-dead CLM method bodies
  // below still type-check without pulling the whole surface back in.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private linkedEmitTimer: any = null;
  private lastLinkedJson = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private linkedUsers: any[] = [];
  private viewerEmail = "";
  private viewerFinished = false;

  /** Field value ({ columns, rows } plain text) read from this table's content. */
  private _STRIPPED_linkedValueFromContent() {
    const toText = (html: string) => {
      const div = document.createElement("div");
      div.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
      return (div.textContent || "").replace(/ /g, " ");
    };
    const [head = [], ...rows] = (this.data.content || []) as string[][];
    return {
      columns: head.map(toText),
      rows: rows.map((r) => r.map(toText)),
    };
  }

  /** Latest value per field_key, so a newly inserted copy starts in sync. */
  private _STRIPPED_cacheLinkedValue() {
    const w = window as any;
    w.__clmLinkedTableValues = w.__clmLinkedTableValues || {};
    const value = this._STRIPPED_linkedValueFromContent();
    w.__clmLinkedTableValues[this.data.linkedField.field_key] = value;
    this.lastLinkedJson = JSON.stringify(value);
  }

  /** Builder / template routes — where the sender authors (assigns owner). */
  private get _STRIPPED_isAuthoringRoute(): boolean {
    const p = window.location.pathname;
    return (
      p.includes("contract-document-preview") ||
      p.includes("clm-template-editor") ||
      p.includes("document-preview") ||
      p.includes("template-preview")
    );
  }

  /**
   * A linked table is a FIELD: only its assigned owner edits it, and only on
   * the signing page (after send-to-signatures). Everyone else — including
   * the sender in the builder — sees it read-only.
   */
  private get _STRIPPED_ownerCanEdit(): boolean {
    const ownerId = this.data?.linkedField?.user_id;
    if (!this._STRIPPED_isLinked || !ownerId || this._STRIPPED_isAuthoringRoute) return false;
    if (this.viewerFinished) return false;
    const params = new URLSearchParams(window.location.search);
    const email = (params.get("email") || this.viewerEmail || "").toLowerCase();
    if (!email) return false;
    const viewer = this.linkedUsers.find(
      (u: any) => String(u?.email || "").toLowerCase() === email,
    );
    return !!viewer && String(viewer._id) === String(ownerId);
  }

  /** Builder / template editor while the document is still editable (before send). */
  private get _STRIPPED_authorCanEdit(): boolean {
    return this._STRIPPED_isLinked && this._STRIPPED_isAuthoringRoute && !this.readOnly;
  }

  /**
   * Cell editability. Normal tables as before. Linked tables: the sender
   * edits any of them in the builder while drafting (readOnly once sent);
   * after sending only the assigned recipient edits, on the signing page.
   */
  private get _STRIPPED_cellsEditable_CLM(): boolean {
    return !this.readOnly;
  }

  /**
   * Debounced broadcast of an edit.
   *  - builder (draft): every copy of the field + persisted as the contract's
   *    value (ContractDocumentPreview) / the template default (CLMTemplateEditor)
   *  - signing page (owner): only this owner's copies + signing-page state
   */
  private _STRIPPED_emitLinkedChange() {
    const authoring = this._STRIPPED_authorCanEdit;
    if (!authoring && !this._STRIPPED_ownerCanEdit) return;
    if (JSON.stringify(this._STRIPPED_linkedValueFromContent()) === this.lastLinkedJson) return;
    if (this.linkedEmitTimer) clearTimeout(this.linkedEmitTimer);
    // A hand-edited copy keeps its own data from now on — metadata /
    // template defaults no longer overwrite it (see `customized` readers).
    if (authoring && !this.data.linkedField.customized) {
      this.data.linkedField = { ...this.data.linkedField, customized: true };
    }
    this.linkedEmitTimer = setTimeout(() => {
      const field_key = this.data.linkedField.field_key;
      const value = this._STRIPPED_linkedValueFromContent();
      if (JSON.stringify(value) === this.lastLinkedJson) return;
      this._STRIPPED_cacheLinkedValue();
      window.dispatchEvent(
        new CustomEvent("clm:linked-table-changed", {
          detail: {
            field_key,
            value,
            sourceId: this.data.id,
            // Copies assigned to different recipients are independent.
            owner_id: this.data.linkedField.user_id || "",
            customized: authoring,
          },
        }),
      );
    }, 300);
  }

  /** Another copy of the same field changed — mirror its data. */
  private _STRIPPED_onLinkedChange = (e: Event) => {
    const { field_key, value, sourceId, owner_id, customized } =
      (e as CustomEvent).detail || {};
    if (!this._STRIPPED_isLinked || field_key !== this.data.linkedField.field_key) return;
    // Copies assigned to different recipients are independent tables.
    if (owner_id !== undefined && String(owner_id) !== String(this.data.linkedField.user_id || "")) {
      return;
    }
    // Field-level pushes (no owner: template defaults / metadata) never
    // overwrite a copy the sender edited by hand.
    if (owner_id === undefined && this.data.linkedField.customized) return;
    if (sourceId === this.data.id) return;
    if (!this.wrapper?.isConnected) return;
    // Never rebuild under the user's caret — an echo of an older value would
    // eat what they are typing. Their own debounced emit wins.
    if (this.table?.contains(document.activeElement)) return;
    // Original eSigns code called applyTableValueToBlockData(this.data, value) —
    // helper removed with the CLM port; this branch is unreachable now.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const next: any = this.data;
    if (JSON.stringify(next.content) === JSON.stringify(this.data.content)) return;
    this.data = customized
      ? { ...next, linkedField: { ...next.linkedField, customized: true } }
      : next;
    this._STRIPPED_cacheLinkedValue();
    this.rebuildTable();
  };

  private rebuildTable() {
    this.createTable();
    this.attachEventListeners();
    this.attachEdgeResizeHandlers();
    this.attachKeyboardNavigation();
    this.applyTableStyles();
  }

  // Original CLM removed()/destroy() methods were replaced by the
  // simpler no-op destroy() above.
  private _STRIPPED_removed() { /* no-op */ }
  private _STRIPPED_destroy_CLM() { /* no-op */ }

  private get _STRIPPED_isLinked(): boolean {
    return !!this.data?.linkedField?.field_key;
  }

  private _STRIPPED_ownerName(): string {
    const lf = this.data.linkedField || {};
    const u = this.linkedUsers.find((x: any) => String(x?._id) === String(lf.user_id));
    const fromUser = u
      ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email
      : "";
    return fromUser || lf.user_name || "";
  }

  /**
   * Linked table chrome. No badge — the owner is shown/changed from the
   * right-click menu ("Who fills" panel). Signing page (owner only): blue
   * outline + add/remove row controls.
   */
  private _STRIPPED_renderLinkedBadge() {
    this.wrapper.querySelector(".te-linked-owner-actions")?.remove();
    if (!this._STRIPPED_isLinked) return;
    this.wrapper.dataset.linkedFieldKey = this.data.linkedField.field_key;
    // Attribute change inside the block → EditorJS's mutation observer
    // marks the block changed, so a re-assigned owner is saved.
    this.wrapper.dataset.linkedOwner = String(this.data.linkedField.user_id || "");

    if (this._STRIPPED_ownerCanEdit) {
      this.wrapper.style.outline = "2px solid #60a5fa";
      this.wrapper.style.outlineOffset = "4px";
      this.wrapper.style.borderRadius = "4px";
      const actions = document.createElement("div");
      actions.className = "te-linked-owner-actions";
      actions.contentEditable = "false";
      Object.assign(actions.style, { display: "flex", gap: "6px", marginTop: "6px" });
      const mkBtn = (text: string, onClick: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        Object.assign(b.style, {
          fontSize: "12px",
          padding: "2px 10px",
          border: "1px dashed #93c5fd",
          borderRadius: "6px",
          color: "#1d4ed8",
          background: "#eff6ff",
          cursor: "pointer",
        });
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        });
        return b;
      };
      const cols = this.data.content?.[0]?.length || 1;
      actions.appendChild(
        mkBtn(t("ContactForm.tableField.addRow", { defaultValue: "Add row" }), () => {
          this.data.content.push(Array(cols).fill(""));
          this.rebuildTable();
          this._STRIPPED_emitLinkedChange();
        }),
      );
      if ((this.data.content?.length || 0) > 1) {
        actions.appendChild(
          mkBtn(
            t("editor.tools.table.removeLastRow", { defaultValue: "Remove last row" }),
            () => {
              this.data.content.pop();
              this.rebuildTable();
              this._STRIPPED_emitLinkedChange();
            },
          ),
        );
      }
      this.wrapper.appendChild(actions);
    }
  }

  /** Recipient list for "Who fills" — rendered inline in the right-click menu. */
  private _STRIPPED_buildOwnerList(onPicked: () => void): HTMLElement {
    const users = this.linkedUsers.filter((u: any) => !u?.is_cc && u?._id);
    const list = document.createElement("div");
    list.className = "te-linked-owner-list";
    Object.assign(list.style, {
      background: "#fff",
      border: "1px solid #bfdbfe",
      borderRadius: "6px",
      maxHeight: "220px",
      overflowY: "auto",
      padding: "4px",
      fontSize: "13px",
    });
    if (!users.length) {
      const empty = document.createElement("div");
      empty.textContent = t("editor.tools.table.noRecipients", {
        defaultValue: "Add recipients first",
      });
      Object.assign(empty.style, { padding: "8px 10px", color: "#9ca3af" });
      list.appendChild(empty);
    }
    users.forEach((u: any) => {
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email;
      const role = u.value || u.role || "";
      const selected = String(u._id) === String(this.data.linkedField?.user_id);
      const item = document.createElement("div");
      Object.assign(item.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 10px",
        borderRadius: "6px",
        cursor: "pointer",
        background: selected ? "#eff6ff" : "transparent",
        fontWeight: selected ? "600" : "400",
      });
      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        flexShrink: "0",
        background: u.color || "#93c5fd",
      });
      const text = document.createElement("span");
      text.textContent = role ? `${name} (${role})` : name;
      text.style.flex = "1";
      item.appendChild(dot);
      item.appendChild(text);
      if (selected) {
        const tick = document.createElement("span");
        tick.textContent = "✓";
        tick.style.color = "#2563eb";
        item.appendChild(tick);
      }
      item.addEventListener("mouseenter", () => (item.style.background = "#f3f4f6"));
      item.addEventListener(
        "mouseleave",
        () => (item.style.background = selected ? "#eff6ff" : "transparent"),
      );
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.data.linkedField = {
          ...this.data.linkedField,
          user_id: String(u._id),
          user_name: name,
        };
        this._STRIPPED_renderLinkedBadge();
        try {
          this.block?.dispatchChange?.();
        } catch {
          /* older EditorJS */
        }
        onPicked();
      });
      list.appendChild(item);
    });
    return list;
  }


  private generateUniqueId(): string {
    return (
      "table-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9)
    );
  }

  private createTable() {
    this.table = document.createElement("table");
    this.table.style.marginTop = "12px";
    this.table.classList.add(this.CSS.table);
    this.table.id = this.data.id;
    this.applyTableStyles();
    this.table.style.position = "relative";
    this.table.style.width = "100%";

    // Caption first — HTML spec requires <caption> to be table's first
    // child. captionPosition flips caption-side so it visually renders
    // above or below the rows.
    this.renderCaption();

    // When header rows exist and the user hasn't opted out of the
    // print-repeat behaviour, group rows into <thead> + <tbody> so
    // browsers (and Puppeteer in the print pipeline) repeat the
    // header on every page break — matching Word's "Repeat header
    // rows at the top of each page" setting.
    const useSections =
      this.data.repeatHeaderOnPrint !== false &&
      !!this.data.headerRows &&
      this.data.headerRows.length > 0;
    let thead: HTMLTableSectionElement | null = null;
    let tbody: HTMLTableSectionElement | null = null;
    if (useSections) {
      thead = document.createElement("thead");
      tbody = document.createElement("tbody");
      this.table.appendChild(thead);
      this.table.appendChild(tbody);
    }

    this.data.content.forEach((row: string[], rowIndex: number) => {
      const tr = document.createElement("tr");
      tr.classList.add(this.CSS.row);

      if (this.data.headerRows?.includes(rowIndex)) {
        tr.classList.add(this.CSS.header);
      }

      if (this.data.styles.rows[rowIndex]) {
        Object.assign(tr.style, this.data.styles.rows[rowIndex]);
      }

      // Apply stored row height if present. Written by the row drag-resize
      // handle and the Row Height popup. undefined entries fall through to
      // the browser's auto-sizing.
      const savedRowHeight = this.data.rowHeights?.[rowIndex];
      if (typeof savedRowHeight === "number" && savedRowHeight > 0) {
        tr.style.height = `${savedRowHeight}px`;
      }

      row.forEach((cellContent, colIndex) => {
        const tag = this.data.headerRows?.includes(rowIndex) ? "th" : "td";
        const cell = document.createElement(tag);
        cell.classList.add(this.CSS.cell);
        cell.contentEditable = this.cellsEditable ? "true" : "false";
        cell.innerHTML = cellContent;

        cell.style.wordBreak = "break-word";
        // `pre-wrap` preserves user-typed whitespace + newlines in
        // regular data cells (rate tables, comment cells). But for
        // hidden-border layout wrappers — the DOCX header/footer
        // bands the parser emits — it also preserves the `<w:tab/>`
        // whitespace Word inserts to fake centring inside a text
        // box, which shows up as a giant gap in the middle of
        // address lines. Layout tables never need pre-wrap; the
        // block content owns its own line breaks via <br> or
        // separate paragraphs.
        cell.style.whiteSpace = this.data.hideBorders ? "normal" : "pre-wrap";
        cell.style.overflowWrap = "break-word";

        if (
          this.data.styles.cells[rowIndex] &&
          this.data.styles.cells[rowIndex][colIndex]
        ) {
          const cellStyles = this.data.styles.cells[rowIndex][colIndex];
          const rawStyleStr =
            this.data.styles.cells[rowIndex] &&
            this.data.styles.cells[rowIndex][colIndex];
          if (rawStyleStr) {
            const styleObj = this.parseStyleString(rawStyleStr);
            Object.assign(cell.style, styleObj);
          }
          if (cellStyles.backgroundColor)
            cell.style.backgroundColor = cellStyles.backgroundColor;
          if (cellStyles.borderColor)
            cell.style.borderColor = cellStyles.borderColor;
          if (cellStyles.borderWidth)
            cell.style.borderWidth = cellStyles.borderWidth;
          if (cellStyles.borderStyle)
            cell.style.borderStyle = cellStyles.borderStyle;
          // Per-side borders applied AFTER the shorthand so they win when
          // both are set — the shorthand becomes a base layer legacy cells
          // keep using unchanged.
          if (cellStyles.borderTop) cell.style.borderTop = cellStyles.borderTop;
          if (cellStyles.borderRight)
            cell.style.borderRight = cellStyles.borderRight;
          if (cellStyles.borderBottom)
            cell.style.borderBottom = cellStyles.borderBottom;
          if (cellStyles.borderLeft)
            cell.style.borderLeft = cellStyles.borderLeft;
          if (cellStyles.textAlign) cell.style.textAlign = cellStyles.textAlign;
          if (cellStyles.colSpan) cell.colSpan = cellStyles.colSpan;
          if (cellStyles.rowSpan) cell.rowSpan = cellStyles.rowSpan;
          if (cellStyles.color) cell.style.color = cellStyles.color;
          if (cellStyles.paddingTop)
            cell.style.paddingTop = cellStyles.paddingTop;
          if (cellStyles.paddingBottom)
            cell.style.paddingBottom = cellStyles.paddingBottom;
          if (cellStyles.paddingLeft)
            cell.style.paddingLeft = cellStyles.paddingLeft;
          if (cellStyles.paddingRight)
            cell.style.paddingRight = cellStyles.paddingRight;
          if (cellStyles.verticalAlign)
            cell.style.verticalAlign = cellStyles.verticalAlign;
        } else {
          if (this.data.hideBorders) {
            cell.style.borderWidth = "0";
            cell.style.borderStyle = "none";
            cell.style.borderColor = "transparent";
          } else {
            cell.style.borderWidth = this.data.styles.table.borderWidth;
            cell.style.borderStyle = this.data.styles.table.borderStyle;
            cell.style.borderColor = this.data.styles.table.borderColor;
          }
        }

        // Inject stored image from cellImages (bypasses EditorJS sanitization)
        this.injectCellImage(cell, rowIndex, colIndex);

        // Also wrap any INLINE <img> tags that came in via the cell
        // content HTML (DOCX-imported logos, pasted images, etc.).
        // injectCellImage only handles images persisted in
        // data.cellImages; without this pass, DOCX-authored images
        // would show up in the cell but never gain resize handles.
        this.enhanceInlineCellImages(cell, rowIndex, colIndex);

        // Diagonal border overlay (Tier-3). Reads diagonalBorder from the
        // saved cell styles and attaches an SVG line across the cell.
        const diag = this.data.styles.cells[rowIndex]?.[colIndex]?.diagonalBorder;
        if (diag === "down" || diag === "up") {
          this.applyDiagonalToCell(cell, diag);
        }

        // Formula computed-value overlay (Tier-3). If the cell text is
        // =FUNC(A1:B2) we compute now and show the value; the raw
        // formula is kept on data-formula for re-evaluation and the
        // input handler restores it when the admin starts typing.
        this.evaluateCellFormula(cell, rowIndex, colIndex);

        tr.appendChild(cell);

        // Formula cells (Tier-3): show the raw =SUM(…) text on focus so the
        // admin can edit it, re-compute on blur. Non-formula cells pass
        // through unchanged.
        cell.addEventListener("focus", () => {
          const formula = cell.dataset.formula;
          if (formula && cell.dataset.formulaDisplayed === "value") {
            cell.textContent = formula;
            cell.dataset.formulaDisplayed = "raw";
          }
        });
        cell.addEventListener("blur", () => {
          const text = (cell.textContent || "").trim();
          if (text.startsWith("=")) {
            const result = this.evalFormulaExpression(text);
            if (result !== null) {
              cell.dataset.formula = text;
              cell.textContent = String(result);
              cell.dataset.formulaDisplayed = "value";
              cell.title = text;
              this.data.content[rowIndex][colIndex] = text;
              this.updateData();
              return;
            }
          }
          delete cell.dataset.formula;
          delete cell.dataset.formulaDisplayed;
          cell.removeAttribute("title");
        });

        cell.addEventListener("input", () => {
          // Exclude managed cell images from text content
          const clone = cell.cloneNode(true) as HTMLElement;
          clone
            .querySelectorAll("[data-cell-image]")
            .forEach((el) => el.remove());
          // Unwrap inline-image resize wrappers so we save clean
          // <img> HTML — the wrapper is a runtime UI concern only.
          clone
            .querySelectorAll("[data-inline-resize-wrapped]")
            .forEach((wrap) => {
              const img = wrap.querySelector("img");
              if (img && wrap.parentNode) {
                wrap.parentNode.replaceChild(img, wrap);
              } else {
                wrap.remove();
              }
            });
          // While the admin is editing a formula cell the DOM shows the
          // raw =FUNC(...) text — save that as the canonical content so
          // we don't lose the formula on partial edits.
          this.data.content[rowIndex][colIndex] = clone.innerHTML;
          this.updateData();
        });
      });
      if (
        useSections &&
        thead &&
        tbody &&
        this.data.headerRows?.includes(rowIndex)
      ) {
        thead.appendChild(tr);
      } else if (useSections && tbody) {
        tbody.appendChild(tr);
      } else {
        this.table.appendChild(tr);
      }
    });

    this.wrapper.innerHTML = "";
    this.wrapper.appendChild(this.table);
    this.applyTableAlignment();

    this.assignLogicalCols();
    this.applyColumnWidths();
  }

  private parseStyleString(styleStr: string) {
    const regex = /style="([^"]+)"/g;
    let match;
    const styleObj: any = {};
    while ((match = regex.exec(styleStr)) !== null) {
      const declarations = match[1].split(";");
      declarations.forEach((decl) => {
        const [property, value] = decl
          .split(":")
          .map((item) => item && item.trim());
        if (property && value) {
          styleObj[property] = value;
        }
      });
    }
    return styleObj;
  }

  private getNumCols(): number {
    let max = 0;
    Array.from(this.table.rows).forEach((row: HTMLTableRowElement) => {
      let sum = 0;
      Array.from(row.cells).forEach((cell: HTMLTableCellElement) => {
        sum += cell.colSpan || 1;
      });
      max = Math.max(max, sum);
    });
    return max;
  }

  private assignLogicalCols() {
    const numRows = this.table.rows.length;
    const numCols = this.getNumCols();
    const owner: {
      cell: HTMLTableCellElement;
      startRow: number;
      startCol: number;
    }[][] = Array.from({ length: numRows }, () => Array(numCols).fill(null));

    for (let i = 0; i < numRows; i++) {
      let c = 0;
      const row = this.table.rows[i];
      for (let k = 0; k < row.cells.length; k++) {
        const cell = row.cells[k];
        while (c < numCols && owner[i][c] !== null) c++;
        if (c >= numCols) return;
        const rs = cell.rowSpan || 1;
        const cs = cell.colSpan || 1;
        if (c + cs > numCols) return;
        for (let rr = i; rr < i + rs; rr++) {
          if (rr >= numRows) break;
          for (let cc = c; cc < c + cs; cc++) {
            if (owner[rr][cc] !== null) return;
            owner[rr][cc] = { cell, startRow: i, startCol: c };
          }
        }
        cell.dataset.logicalStartCol = c.toString();
        cell.dataset.logicalEndCol = (c + cs - 1).toString();
        c += cs;
      }
    }
    this.ownerGrid = owner;
  }

  private createContextMenu() {
    const menu = document.createElement("div");
    menu.classList.add(this.CSS.contextMenu);

    menu.style.position = "absolute";
    menu.style.zIndex = "1000";
    menu.style.display = "flex";
    menu.style.flexWrap = "wrap";
    menu.style.backgroundColor = "#f0f0f0";
    menu.style.border = "1px solid #d1d5db";
    menu.style.padding = "1px";
    menu.style.gap = "5px";
    menu.style.alignItems = "center";
    menu.style.justifyContent = "flex-start";
    menu.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
    menu.style.borderRadius = "4px";
    menu.style.maxWidth = "636px";

    // All icons use the Lucide design language — 18×18 viewBox, single
    // #475569 stroke (slate-600), 1.5 stroke-width, round joins, no fill
    // except for the small blue accent that marks the "target" sub-element
    // in disambiguating icons (e.g. the active row in alignment, the active
    // slice in border-sides). Keeping the whole menu monochrome prevents
    // the earlier rainbow of brand-colour icons which read as noisy chrome.
    const IC = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#475569" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">`;
    const A = `#2563eb`; // accent — the "selected / target" slice
    const D = `#dc2626`; // danger — destructive actions only

    const menuItems = [
      // ── Fills ────────────────────────────────────────────────────────────────
      {
        icon: `${IC}<path d="M11 3l-7 7a1.5 1.5 0 0 0 0 2l2 2a1.5 1.5 0 0 0 2 0l7-7-4-4z"/><path d="M3 15h12" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.cellBackground"),
        action: () => this.showColorPicker("background"),
      },
      {
        icon: `${IC}<rect x="2.5" y="3" width="13" height="3" rx="0.5" fill="${A}" stroke="none"/><rect x="2.5" y="7.5" width="13" height="3" rx="0.5"/><rect x="2.5" y="12" width="13" height="3" rx="0.5"/></svg>`,
        label: t("editor.tools.table.rowBackground"),
        action: () => this.showColorPicker("rowBackground"),
      },
      {
        icon: `${IC}<rect x="3" y="2.5" width="3" height="13" rx="0.5" fill="${A}" stroke="none"/><rect x="7.5" y="2.5" width="3" height="13" rx="0.5"/><rect x="12" y="2.5" width="3" height="13" rx="0.5"/></svg>`,
        label: t("editor.tools.table.columnBackground"),
        action: () => this.showColorPicker("columnBackground"),
      },
      {
        icon: `${IC}<path d="M4.5 13L9 3l4.5 10"/><path d="M6 10h6"/><path d="M3 15.5h12" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.textColor"),
        action: () => {
          const picker = this.createColorPicker("textColor");
          document.body.appendChild(picker);
          setTimeout(() => picker.click(), 100);
        },
      },
      { type: "separator" },
      // ── Text alignment ───────────────────────────────────────────────────────
      {
        icon: `${IC}<line x1="3" y1="5" x2="15" y2="5"/><line x1="3" y1="9" x2="11" y2="9"/><line x1="3" y1="13" x2="13" y2="13"/></svg>`,
        label: t("editor.tools.table.alignLeft"),
        action: () => this.setAlignment("left"),
      },
      {
        icon: `${IC}<line x1="3" y1="5" x2="15" y2="5"/><line x1="5" y1="9" x2="13" y2="9"/><line x1="4" y1="13" x2="14" y2="13"/></svg>`,
        label: t("editor.tools.table.alignCenter"),
        action: () => this.setAlignment("center"),
      },
      {
        icon: `${IC}<line x1="3" y1="5" x2="15" y2="5"/><line x1="7" y1="9" x2="15" y2="9"/><line x1="5" y1="13" x2="15" y2="13"/></svg>`,
        label: t("editor.tools.table.alignRight"),
        action: () => this.setAlignment("right"),
      },
      {
        icon: `${IC}<line x1="3" y1="3" x2="15" y2="3" stroke="${A}" stroke-width="2"/><line x1="4" y1="7.5" x2="11" y2="7.5"/><line x1="4" y1="11" x2="11" y2="11"/><line x1="4" y1="14.5" x2="11" y2="14.5"/></svg>`,
        label: t("editor.tools.table.verticalAlign"),
        submenu: true,
        "data-action": "verticalAlign",
        action: () => this.showVerticalAlignMenu(),
      },
      { type: "separator" },
      // ── Borders ──────────────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="13" rx="1" stroke="${A}" stroke-width="2"/><circle cx="14" cy="14" r="2" fill="${A}" stroke="none"/></svg>`,
        label: t("editor.tools.table.borderColor"),
        action: () => this.showColorPicker("border"),
      },
      {
        icon: `${IC}<line x1="2.5" y1="4" x2="15.5" y2="4"/><line x1="2.5" y1="9" x2="15.5" y2="9" stroke-dasharray="2 1.5"/><line x1="2.5" y1="14" x2="15.5" y2="14" stroke-dasharray="1 1.5"/></svg>`,
        label: t("editor.tools.table.borderStyle"),
        submenu: true,
        "data-action": "borderStyle",
        action: () => this.showBorderStylePicker(),
      },
      {
        icon: `${IC}<line x1="2.5" y1="3.5" x2="15.5" y2="3.5" stroke-width="0.6"/><line x1="2.5" y1="7" x2="15.5" y2="7" stroke-width="1.3"/><line x1="2.5" y1="10.75" x2="15.5" y2="10.75" stroke-width="2.2"/><line x1="2.5" y1="14.5" x2="15.5" y2="14.5" stroke-width="3"/></svg>`,
        label: t("editor.tools.table.borderWidth", { defaultValue: "Border width" }),
        submenu: true,
        "data-action": "borderWidth",
        action: () => this.showBorderWidthPicker(),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="13" rx="0.5" stroke-dasharray="1.5 1.5"/><line x1="2.5" y1="9" x2="15.5" y2="9" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.borderSides", { defaultValue: "Border sides" }),
        submenu: true,
        "data-action": "borderSides",
        action: () => this.showBorderSidesPicker(),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="13" rx="1"/><line x1="2.5" y1="7" x2="15.5" y2="7"/><line x1="2.5" y1="11" x2="15.5" y2="11"/><line x1="7" y1="2.5" x2="7" y2="15.5"/><line x1="11" y1="2.5" x2="11" y2="15.5"/></svg>`,
        label: () => (this.data.hideBorders ? t("editor.tools.table.showBorders") : t("editor.tools.table.hideBorders")),
        action: () => this.toggleBorders(),
      },
      { type: "separator" },
      // ── Rows / Columns ───────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="9" width="13" height="3" rx="0.5"/><rect x="2.5" y="12.5" width="13" height="3" rx="0.5"/><line x1="9" y1="2.5" x2="9" y2="7" stroke="${A}" stroke-width="2"/><line x1="6.5" y1="4.75" x2="11.5" y2="4.75" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.insertRowAbove"),
        action: () => this.insertRow("above"),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="3" rx="0.5"/><rect x="2.5" y="6" width="13" height="3" rx="0.5"/><line x1="9" y1="11" x2="9" y2="15.5" stroke="${A}" stroke-width="2"/><line x1="6.5" y1="13.25" x2="11.5" y2="13.25" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.insertRowBelow"),
        action: () => this.insertRow("below"),
      },
      {
        icon: `${IC}<rect x="9" y="2.5" width="3" height="13" rx="0.5"/><rect x="12.5" y="2.5" width="3" height="13" rx="0.5"/><line x1="2.5" y1="9" x2="7" y2="9" stroke="${A}" stroke-width="2"/><line x1="4.75" y1="6.5" x2="4.75" y2="11.5" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.insertColumnLeft"),
        action: () => this.insertColumn("left"),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="3" height="13" rx="0.5"/><rect x="6" y="2.5" width="3" height="13" rx="0.5"/><line x1="11" y1="9" x2="15.5" y2="9" stroke="${A}" stroke-width="2"/><line x1="13.25" y1="6.5" x2="13.25" y2="11.5" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.insertColumnRight"),
        action: () => this.insertColumn("right"),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="3" height="13" rx="0.5"/><rect x="7.5" y="2.5" width="3" height="13" rx="0.5"/><rect x="12.5" y="2.5" width="3" height="13" rx="0.5"/><path d="M6 9h1M11 9h1" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.columnFit", { defaultValue: "Column width" }),
        submenu: true,
        "data-action": "columnFit",
        action: () => this.showColumnFitPicker(),
      },
      { type: "separator" },
      // ── Merge / Split ────────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="5.5" height="5" rx="0.5"/><rect x="10" y="2.5" width="5.5" height="5" rx="0.5"/><rect x="2.5" y="10.5" width="13" height="5" rx="0.5" stroke="${A}" stroke-width="2"/><path d="M9 7.5L9 10" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.mergeCells"),
        action: () => this.mergeCells(),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="13" rx="0.5"/><line x1="9" y1="2.5" x2="9" y2="15.5" stroke="${A}" stroke-width="2" stroke-dasharray="2 1.5"/><line x1="2.5" y1="9" x2="15.5" y2="9" stroke="${A}" stroke-width="2" stroke-dasharray="2 1.5"/></svg>`,
        label: t("editor.tools.table.splitCell"),
        action: () => this.splitCell(),
      },
      { type: "separator" },
      // ── Header toggle ────────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="4" rx="0.5" fill="${A}" stroke="${A}"/><rect x="2.5" y="7" width="13" height="3.5" rx="0.5"/><rect x="2.5" y="11" width="13" height="3.5" rx="0.5"/></svg>`,
        label: t("editor.tools.table.toggleHeaderRow"),
        action: () => this.toggleHeader(),
      },
      { type: "separator" },
      // ── Delete ───────────────────────────────────────────────────────────────
      {
        icon: `${IC}<path d="M3 5h12M7 5V3h4v2M6 5v10a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V5" stroke="${D}"/><line x1="8" y1="8" x2="8" y2="13" stroke="${D}"/><line x1="10" y1="8" x2="10" y2="13" stroke="${D}"/></svg>`,
        label: t("editor.tools.table.deleteRow"),
        action: () => this.deleteRow(),
      },
      {
        icon: `${IC}<rect x="6" y="2.5" width="4" height="13" rx="0.5" stroke="${D}" stroke-width="2"/><line x1="3" y1="6" x2="5" y2="12" stroke="${D}"/><line x1="5" y1="6" x2="3" y2="12" stroke="${D}"/><line x1="13" y1="6" x2="15" y2="12" stroke="${D}"/><line x1="15" y1="6" x2="13" y2="12" stroke="${D}"/></svg>`,
        label: t("editor.tools.table.deleteColumn"),
        action: () => this.deleteColumn(),
      },
      { type: "separator" },
      // ── Image ────────────────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="3" width="13" height="12" rx="1.5"/><circle cx="6.5" cy="7" r="1.25"/><path d="M2.5 13l3-3 2.5 2.5L12 8.5l3.5 3.5"/></svg>`,
        label: t("editor.tools.table.insertImage"),
        action: () => this.insertImageInCell(),
      },
      { type: "separator" },
      // ── Spacing ──────────────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2" y="2" width="14" height="14" rx="1"/><rect x="5" y="5" width="8" height="8" rx="0.5" stroke="${A}"/><path d="M9 2v2M9 14v2M2 9h2M14 9h2" stroke="${A}"/></svg>`,
        label: t("editor.tools.table.cellPadding", { defaultValue: "Cell padding" }),
        "data-action": "cellPadding",
        action: () => this.showPaddingPicker(),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="4" rx="0.5"/><rect x="2.5" y="7.5" width="13" height="3" rx="0.5"/><rect x="2.5" y="11.5" width="13" height="4" rx="0.5"/><path d="M16.5 4L17 4M17 4v10M16.5 14h1M15 5l2-1 2 1M15 13l2 1 2-1" stroke="${A}"/></svg>`,
        label: t("editor.tools.table.rowHeight", { defaultValue: "Row height" }),
        "data-action": "rowHeight",
        action: () => this.showRowHeightPicker(),
      },
      { type: "separator" },
      // ── Table-level ──────────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="4" rx="0.5" fill="${A}" stroke="${A}"/><rect x="2.5" y="7" width="13" height="3.5" rx="0.5"/><rect x="2.5" y="11" width="13" height="3.5" rx="0.5"/></svg>`,
        label: t("editor.tools.table.tableStyle", { defaultValue: "Table style" }),
        submenu: true,
        "data-action": "tableStyle",
        action: () => this.showTableStylePicker(),
      },
      {
        icon: `${IC}<rect x="4" y="4" width="10" height="10" rx="0.5" stroke="${A}"/><line x1="2" y1="2" x2="16" y2="2"/><line x1="2" y1="16" x2="16" y2="16"/></svg>`,
        label: t("editor.tools.table.tableAlignment", { defaultValue: "Table alignment" }),
        submenu: true,
        "data-action": "tableAlignment",
        action: () => this.showTableAlignmentPicker(),
      },
      {
        icon: `${IC}<rect x="2.5" y="5" width="13" height="9" rx="0.5"/><line x1="4" y1="2.5" x2="14" y2="2.5" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.caption", { defaultValue: "Caption" }),
        "data-action": "caption",
        action: () => this.showCaptionEditor(),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="3.5" rx="0.5" fill="${A}" stroke="${A}"/><path d="M9 7.5v3M7 9.5l2 2 2-2" stroke="${A}"/><rect x="2.5" y="12" width="13" height="3.5" rx="0.5" stroke-dasharray="1.5 1.5"/></svg>`,
        label: () =>
          this.data.repeatHeaderOnPrint !== false
            ? t("editor.tools.table.repeatHeaderOff", { defaultValue: "Stop repeating header" })
            : t("editor.tools.table.repeatHeaderOn", { defaultValue: "Repeat header on each page" }),
        action: () => this.toggleRepeatHeader(),
      },
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="6" height="13" rx="0.5"/><line x1="4" y1="5.5" x2="7" y2="5.5"/><line x1="4" y1="9" x2="7" y2="9"/><line x1="4" y1="12.5" x2="7" y2="12.5"/><path d="M10 9h5M13 7l2 2-2 2" stroke="${A}"/></svg>`,
        label: t("editor.tools.table.convertToText", { defaultValue: "Convert to text" }),
        "data-action": "convertToText",
        action: () => this.showConvertToTextDialog(),
      },
      { type: "separator" },
      // ── Advanced (Tier-3) ────────────────────────────────────────────────────
      {
        icon: `${IC}<rect x="2.5" y="2.5" width="13" height="13" rx="0.5"/><line x1="2.5" y1="2.5" x2="15.5" y2="15.5" stroke="${A}" stroke-width="2"/></svg>`,
        label: t("editor.tools.table.diagonalBorder", { defaultValue: "Diagonal border" }),
        submenu: true,
        "data-action": "diagonalBorder",
        action: () => this.showDiagonalBorderPicker(),
      },
      {
        icon: `${IC}<path d="M4 3h10l-5 6 5 6H4l4-6-4-6z" stroke="${A}"/></svg>`,
        label: t("editor.tools.table.recalcFormulas", { defaultValue: "Recalculate formulas" }),
        "data-action": "recalcFormulas",
        action: () => this.recalculateAllFormulas(),
      },
      {
        icon: `${IC}<rect x="1.5" y="1.5" width="15" height="15" rx="0.5"/><line x1="1.5" y1="7" x2="16.5" y2="7"/><line x1="7" y1="1.5" x2="7" y2="16.5"/><rect x="9" y="9" width="6" height="6" rx="0.3" stroke="${A}"/><line x1="9" y1="12" x2="15" y2="12" stroke="${A}"/><line x1="12" y1="9" x2="12" y2="15" stroke="${A}"/></svg>`,
        label: t("editor.tools.table.insertNestedTable", { defaultValue: "Insert nested table" }),
        "data-action": "insertNestedTable",
        action: () => this.insertNestedTable(),
      },
      { type: "separator" },
      // ── Properties ───────────────────────────────────────────────────────────
      {
        icon: `${IC}<circle cx="9" cy="9" r="2.5"/><path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M4.3 4.3l1.4 1.4M12.3 12.3l1.4 1.4M12.3 5.7l1.4-1.4M4.3 13.7l1.4-1.4"/></svg>`,
        label: t("editor.tools.table.tableProperties"),
        action: () => this.openTablePropertiesPanel(),
      },
    ];

    menuItems.forEach((item: any) => {
      if (item.type === "separator") {
        const separator = document.createElement("hr");
        separator.style.width = "1px";
        separator.style.height = "20px";
        separator.style.backgroundColor = "#d1d5db";
        separator.style.margin = "0 2px";
        menu.appendChild(separator);
        return;
      }

      const menuItem = document.createElement("div");
      menuItem.classList.add(this.CSS.contextMenuItem);
      menuItem.style.display = "flex";
      menuItem.style.alignItems = "center";
      menuItem.style.gap = "5px";
      menuItem.style.cursor = "pointer";
      menuItem.style.padding = "3px 5px";
      menuItem.style.borderRadius = "4px";
      menuItem.style.transition = "background-color 0.2s";
      menuItem.style.fontSize = "12px";
      menuItem.style.whiteSpace = "nowrap";

      menuItem.addEventListener("mouseenter", () => {
        menuItem.style.backgroundColor = "#e5e7eb";
      });
      menuItem.addEventListener("mouseleave", () => {
        menuItem.style.backgroundColor = "transparent";
      });

      const icon = document.createElement("span");
      icon.classList.add(this.CSS.contextMenuIcon);
      icon.innerHTML = item.icon;
      icon.style.width = "18px";
      icon.style.height = "18px";
      icon.style.display = "flex";
      icon.style.alignItems = "center";
      icon.style.justifyContent = "center";
      icon.style.flexShrink = "0";

      const label = document.createElement("span");
      label.textContent =
        typeof item.label === "function" ? item.label() : item.label;
      label.style.overflow = "hidden";
      label.style.textOverflow = "ellipsis";
      label.style.whiteSpace = "nowrap";

      menuItem.appendChild(icon);
      menuItem.appendChild(label);

      if (item.submenu) {
        const arrow = document.createElement("span");
        arrow.textContent = "▶";
        arrow.style.marginLeft = "5px";
        arrow.style.fontSize = "10px";
        arrow.style.color = "#666";
        menuItem.appendChild(arrow);
      }

      if (item["data-action"]) {
        menuItem.dataset.action = item["data-action"];
      }

      menuItem.addEventListener("click", (e) => {
        e.stopPropagation();
        item.action();
        this.hideContextMenu();
      });

      menu.appendChild(menuItem);
    });

    // Linked table field: a distinct "Filled by" panel on top of the menu —
    // who fills this table, and the way to change it.
    /* "Filled by" owner chip removed with the CLM linked-field port. */

    return menu;
  }

  /* CLM linked-field owner helpers removed by the port — ownerUser() and
   * createOwnerChip() depended on linkedUsers / linkedField / ownerName
   * which no longer exist in this tool. */

  /**
   * Compact "who fills" pill at the END of the right-click menu (same height
   * as the other options, so the menu stays two rows). Click → recipient
   * popover right under it.
   */
  // Dead CLM-port stub left intentionally un-called.
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private _STRIPPED_createOwnerChip(): HTMLElement {
    const u = this._STRIPPED_ownerUser();
    const name = this._STRIPPED_ownerName();
    // "Assigned to: [pill ▾]" — pinned to the bottom-right of the menu
    // (last item + margin-left:auto on the wrapped row).
    const wrap = document.createElement("div");
    wrap.className = "te-linked-owner-chip";
    Object.assign(wrap.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      marginLeft: "auto",
      padding: "3px 6px 3px 10px",
      borderLeft: "1px solid #d1d5db",
    });
    const caption = document.createElement("span");
    Object.assign(caption.style, {
      fontSize: "12px",
      color: "#475569",
      whiteSpace: "nowrap",
    });
    caption.textContent = t("editor.tools.table.assignedTo", {
      defaultValue: "Assigned to:",
    });
    const chip = document.createElement("div");
    Object.assign(chip.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "5px",
      height: "24px",
      padding: "0 6px 0 3px",
      borderRadius: "12px",
      border: `1px solid ${name ? "#93c5fd" : "#fcd34d"}`,
      background: name ? "#eff6ff" : "#fffbeb",
      cursor: "pointer",
      fontSize: "12px",
      maxWidth: "170px",
      transition: "box-shadow 0.15s",
    });
    chip.addEventListener("mouseenter", () => (chip.style.boxShadow = "0 0 0 2px rgba(59,130,246,0.25)"));
    chip.addEventListener("mouseleave", () => (chip.style.boxShadow = "none"));
    const avatar = document.createElement("span");
    Object.assign(avatar.style, {
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      flexShrink: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "9px",
      fontWeight: "700",
      color: "#fff",
      background: name ? u?.color || "#2563eb" : "#f59e0b",
    });
    avatar.textContent = name
      ? name
          .split(/\s+/)
          .map((p) => p[0])
          .join("")
          .slice(0, 2)
          .toUpperCase()
      : "?";
    const label = document.createElement("span");
    Object.assign(label.style, {
      fontWeight: "600",
      color: name ? "#1e3a8a" : "#92400e",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    label.textContent =
      name || t("editor.tools.table.notAssigned", { defaultValue: "Not assigned" });
    const chevron = document.createElement("span");
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
    Object.assign(chevron.style, {
      display: "flex",
      flexShrink: "0",
      color: name ? "#2563eb" : "#b45309",
    });
    chip.appendChild(avatar);
    chip.appendChild(label);
    chip.appendChild(chevron);
    chip.setAttribute(
      "aria-label",
      `${t("editor.tools.table.whoFills", { defaultValue: "Who fills" })}: ${name || "—"}`,
    );
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      const existing = document.querySelector(".te-linked-owner-list");
      if (existing) {
        existing.remove();
        return;
      }
      const list = this._STRIPPED_buildOwnerList(() => {
        list.remove();
        this.hideContextMenu();
      });
      const r = chip.getBoundingClientRect();
      Object.assign(list.style, {
        position: "fixed",
        top: `${r.bottom + 4}px`,
        left: `${Math.max(8, Math.min(r.left, window.innerWidth - 240))}px`,
        width: "230px",
        zIndex: "100002",
        margin: "0",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
      });
      // Title row so the popover says what it is.
      const title = document.createElement("div");
      Object.assign(title.style, {
        padding: "4px 10px 6px",
        fontSize: "10px",
        fontWeight: "700",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: "#6b7280",
      });
      title.textContent = `${t("editor.tools.table.whoFills", { defaultValue: "Who fills" })} · ${
        this.data.linkedField.label || this.data.linkedField.field_key
      }`;
      list.insertBefore(title, list.firstChild);
      document.body.appendChild(list);
      const close = (ev: MouseEvent) => {
        if (list.contains(ev.target as Node) || chip.contains(ev.target as Node)) return;
        list.remove();
        document.removeEventListener("mousedown", close, true);
      };
      setTimeout(() => document.addEventListener("mousedown", close, true), 0);
    });
    wrap.appendChild(caption);
    wrap.appendChild(chip);
    return wrap;
  }

  private openTablePropertiesPanel() {
    if (this.setOpenTableProperties) {
      this.setOpenTableProperties({
        visible: true,
        selectedCell: this.data,
      });
    }
  }

  private createColorPicker(
    type:
      | "background"
      | "border"
      | "rowBackground"
      | "columnBackground"
      | "textColor",
  ) {
    const picker = document.createElement("input");
    picker.type = "color";

    if (this.selectedCell) {
      const cellRect = this.selectedCell.getBoundingClientRect();
      picker.style.position = "fixed";
      picker.style.left = `${cellRect.left}px`;
      picker.style.top = `${cellRect.bottom + 5}px`;
      picker.style.zIndex = "1000";
    }

    picker.addEventListener("change", (e) => {
      const color = (e.target as HTMLInputElement).value;
      switch (type) {
        case "background":
          this.setCellBackground(color);
          break;
        case "border":
          this.setCellBorder(color);
          break;
        case "rowBackground":
          this.setRowBackground(color);
          break;
        case "columnBackground":
          this.setColumnBackground(color);
          break;
        case "textColor":
          this.setCellTextColor(color);
          break;
      }
      picker.remove();
    });

    const closeHandler = (e: MouseEvent) => {
      if (e.target !== picker) {
        picker.remove();
        document.removeEventListener("click", closeHandler);
      }
    };
    document.addEventListener("click", closeHandler);

    return picker;
  }

  private showColorPicker(
    type:
      | "background"
      | "border"
      | "rowBackground"
      | "columnBackground"
      | "textColor",
  ) {
    const picker = this.createColorPicker(type);
    document.body.appendChild(picker);
    setTimeout(() => picker.click(), 100);
  }

  private showBorderStylePicker() {
    const styleOptions: { value: string; label: string; preview: string }[] = [
      { value: "solid", label: t("editor.tools.table.solid"), preview: "2px solid #374151" },
      { value: "dashed", label: t("editor.tools.table.dashed"), preview: "2px dashed #374151" },
      { value: "dotted", label: t("editor.tools.table.dotted"), preview: "2px dotted #374151" },
      { value: "double", label: t("editor.tools.table.double"), preview: "4px double #374151" },
      { value: "none", label: t("editor.tools.table.none"), preview: "none" },
    ];

    const menu = document.createElement("div");
    menu.style.cssText = `
      position: fixed;
      z-index: 100000;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.18);
      padding: 4px;
      display: flex;
      flex-direction: column;
      min-width: 160px;
      gap: 1px;
    `;

    // Determine current style on selected cell
    const currentStyle = this.selectedCell?.style?.borderStyle ?? "";

    styleOptions.forEach(({ value, label, preview }) => {
      const item = document.createElement("div");
      const isActive = currentStyle === value;
      item.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 10px;
        cursor: pointer;
        border-radius: 5px;
        background: ${isActive ? "#eff6ff" : "transparent"};
        transition: background 0.12s;
      `;

      // Visual preview swatch
      const swatch = document.createElement("div");
      swatch.style.cssText = `
        flex-shrink: 0;
        width: 52px;
        height: 0px;
        border-top: ${preview === "none" ? "2px dashed #d1d5db" : preview};
        opacity: ${preview === "none" ? "0.5" : "1"};
      `;

      // Label
      const text = document.createElement("span");
      text.textContent = label;
      text.style.cssText = `
        font-size: 12px;
        font-weight: ${isActive ? "600" : "400"};
        color: ${isActive ? "#1d4ed8" : "#374151"};
        flex: 1;
      `;

      // Active checkmark
      if (isActive) {
        const check = document.createElement("span");
        check.textContent = "✓";
        check.style.cssText = "font-size:11px;color:#1d4ed8;";
        item.appendChild(swatch);
        item.appendChild(text);
        item.appendChild(check);
      } else {
        item.appendChild(swatch);
        item.appendChild(text);
      }

      item.addEventListener("mouseenter", () => {
        if (!isActive) item.style.background = "#f3f4f6";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = isActive ? "#eff6ff" : "transparent";
      });

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setBorderStyle(value);
        menu.remove();
        this.hideContextMenu();
      });

      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    // Position using fixed coords — find the Border Style trigger item in context menu
    let anchorRect: DOMRect | null = null;
    if (this.contextMenu) {
      this.contextMenu
        .querySelectorAll(`.${this.CSS.contextMenuItem}`)
        .forEach((el: Element) => {
          if (
            (el as HTMLElement).dataset.action === "borderStyle" ||
            el.textContent?.includes(t("editor.tools.table.borderStyle"))
          ) {
            anchorRect = (el as HTMLElement).getBoundingClientRect();
          }
        });
    }

    const menuWidth = 164;
    const menuHeight = styleOptions.length * 36 + 8;

    if (anchorRect) {
      const rect = anchorRect as DOMRect;
      const spaceRight = window.innerWidth - rect.right;
      let left =
        spaceRight >= menuWidth ? rect.right + 4 : rect.left - menuWidth - 4;
      let top = rect.top;
      // Clamp vertically
      if (top + menuHeight > window.innerHeight)
        top = window.innerHeight - menuHeight - 8;
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    } else {
      // Fallback: center near viewport
      menu.style.left = `${(window.innerWidth - menuWidth) / 2}px`;
      menu.style.top = `${window.innerHeight / 2 - menuHeight / 2}px`;
    }

    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler), 10);
  }

  private attachEventListeners() {
    if (!this.table) return;

    this.table.addEventListener("contextmenu", (e: any) => {
      if (this.readOnly) return;
      e.preventDefault();
      const cell = (e.target as HTMLElement).closest("td, th");
      if (!cell) return;

      this.selectedCell = cell as HTMLTableCellElement;
      this.selectedRow = cell.parentElement as HTMLTableRowElement;

      this.hideContextMenu();
      this.contextMenu = this.createContextMenu();

      const tableRect = this.table.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      const wrapperRect = this.wrapper.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      const menuHeight = 180;
      const menuWidth = Math.min(636, wrapperRect.width - 10);

      const spaceBelow = viewportHeight - cellRect.bottom;
      const spaceAbove = cellRect.top;

      let topPosition: number;

      if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
        topPosition = cellRect.bottom - wrapperRect.top + 5;
        this.contextMenu.style.top = `${topPosition}px`;
        this.contextMenu.style.bottom = "auto";
      } else {
        const bottomPosition = wrapperRect.bottom - cellRect.top + 5;
        this.contextMenu.style.bottom = `${bottomPosition}px`;
        this.contextMenu.style.top = "auto";
      }

      this.contextMenu.style.left = "5px";
      this.contextMenu.style.right = "5px";
      this.contextMenu.style.width = `calc(100% - 10px)`;
      this.contextMenu.style.maxWidth = `${menuWidth}px`;

      this.wrapper.appendChild(this.contextMenu);
    });

    document.addEventListener("click", this.handleDocumentClick.bind(this));

    this.table.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0 || this.readOnly) return;

      const cell: any = (e.target as HTMLElement).closest("td, th");
      if (cell) {
        if (e.shiftKey && this.selectionStart) {
          this.selectionEnd = cell as HTMLTableCellElement;
          this.selectionEndRow = cell.parentElement!.rowIndex;
          this.selectionEndCol = parseInt(cell.dataset.logicalStartCol!);
          this.selectionEndEndCol = parseInt(cell.dataset.logicalEndCol!);
          this.highlightCells();
          this.finalizeSelection();
        } else {
          this.clearSelection();
          this.selectionStart = cell as HTMLTableCellElement;
          this.selectionStartRow = cell.parentElement!.rowIndex;
          this.selectionStartCol = parseInt(cell.dataset.logicalStartCol!);
          this.selectionStartEndCol = parseInt(cell.dataset.logicalEndCol!);
          this.isSelecting = true;
        }
      }
    });

    this.table.addEventListener("mousemove", (e: MouseEvent) => {
      if (this.isSelecting && this.selectionStart) {
        const cell: any = (e.target as HTMLElement).closest("td, th");
        if (cell) {
          this.selectionEnd = cell as HTMLTableCellElement;
          this.selectionEndRow = cell.parentElement!.rowIndex;
          this.selectionEndCol = parseInt(cell.dataset.logicalStartCol!);
          this.selectionEndEndCol = parseInt(cell.dataset.logicalEndCol!);
          this.highlightCells();
        }
      }
    });

    document.addEventListener("mouseup", () => {
      if (this.isSelecting) {
        this.isSelecting = false;
        if (!this.selectionEnd) {
          this.selectionEnd = this.selectionStart;
          this.selectionEndRow = this.selectionStartRow;
          this.selectionEndCol = this.selectionStartCol;
          this.selectionEndEndCol = this.selectionStartEndCol;
        }
        this.finalizeSelection();
      }
    });

    this.table.addEventListener("keydown", (e: KeyboardEvent) => {
      const cell = e.target as HTMLElement;
      if (cell.tagName !== "TD" && cell.tagName !== "TH") return;

      if (e.key === "Enter") {
        if (e.shiftKey) {
          e.preventDefault();
          document.execCommand("insertLineBreak");
        } else {
          const row: any = cell.parentElement;
          if (row && row.rowIndex === this.table!.rows.length - 1) {
            e.preventDefault();
            this.insertRow("below");
            const newRow = this.table!.rows[row.rowIndex + 1];
            if (newRow && newRow.cells[0]) {
              newRow.cells[0].focus();
            }
          }
        }
      }
    });
  }

  private highlightCells() {
    Array.from(this.table.querySelectorAll("td, th")).forEach((c: any) =>
      c.classList.remove(this.CSS.selecting),
    );
    if (!this.selectionStart || !this.selectionEnd) return;
    const minRow = Math.min(this.selectionStartRow, this.selectionEndRow);
    const maxRow = Math.max(this.selectionStartRow, this.selectionEndRow);
    const minCol = Math.min(this.selectionStartCol, this.selectionEndCol);
    const maxCol = Math.max(this.selectionStartEndCol, this.selectionEndEndCol);
    Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
      const row = cell.parentElement.rowIndex;
      const startCol = parseInt(cell.dataset.logicalStartCol!);
      const endCol = parseInt(cell.dataset.logicalEndCol!);
      if (
        row >= minRow &&
        row <= maxRow &&
        startCol <= maxCol &&
        endCol >= minCol
      ) {
        cell.classList.add(this.CSS.selecting);
      }
    });
  }

  private finalizeSelection() {
    const minRow = Math.min(this.selectionStartRow, this.selectionEndRow);
    const maxRow = Math.max(this.selectionStartRow, this.selectionEndRow);
    const minCol = Math.min(this.selectionStartCol, this.selectionEndCol);
    const maxCol = Math.max(this.selectionStartEndCol, this.selectionEndEndCol);
    this.selectedMinRow = minRow;
    this.selectedMaxRow = maxRow;
    this.selectedMinCol = minCol;
    this.selectedMaxCol = maxCol;
    Array.from(this.table.querySelectorAll(`.${this.CSS.selecting}`)).forEach(
      (c: any) => {
        c.classList.remove(this.CSS.selecting);
        c.classList.add(this.CSS.selected);
      },
    );
  }

  private clearSelection() {
    Array.from(this.table.querySelectorAll("td, th")).forEach((c: any) =>
      c.classList.remove(this.CSS.selected),
    );
    this.selectedMinRow = undefined;
    this.selectedMaxRow = undefined;
    this.selectedMinCol = undefined;
    this.selectedMaxCol = undefined;
  }

  private handleDocumentClick(e: MouseEvent) {
    if (!this.contextMenu?.contains(e.target as Node)) {
      this.hideContextMenu();
    }
  }

  private hideContextMenu() {
    document.querySelector(".te-linked-owner-list")?.remove();
    this.contextMenu?.remove();
    this.contextMenu = null;
  }

  private setCellBackground(color: string) {
    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) {
        this.selectedCell.style.backgroundColor = color;
        this.updateCellStyles();
      }
    } else {
      const minRow = this.selectedMinRow;
      const maxRow = this.selectedMaxRow!;
      const minCol = this.selectedMinCol!;
      const maxCol = this.selectedMaxCol!;
      Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
        const row = cell.parentElement.rowIndex;
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (
          row >= minRow &&
          row <= maxRow &&
          startCol <= maxCol &&
          endCol >= minCol
        ) {
          cell.style.backgroundColor = color;
          this.updateCellStyles(cell);
        }
      });
    }
  }

  private setRowBackground(color: string) {
    if (!this.selectedRow) return;
    this.selectedRow.style.backgroundColor = color;
    const rowIndex = this.selectedRow.rowIndex;
    this.data.styles.rows[rowIndex] = { backgroundColor: color };
    this.updateData();
  }

  private setColumnBackground(color: string) {
    if (this.selectedCell) {
      const columnIndex = parseInt(this.selectedCell.dataset.logicalStartCol!);
      Array.from(this.table.rows).forEach((row: HTMLTableRowElement) => {
        Array.from(row.cells).forEach((cell: HTMLTableCellElement) => {
          const startCol = parseInt(cell.dataset.logicalStartCol!);
          if (startCol === columnIndex) {
            cell.style.backgroundColor = color;
          }
        });
      });
      this.updateData();
    }
  }

  private setCellBorder(color: string) {
    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) {
        this.selectedCell.style.borderColor = color;
        this.selectedCell.style.borderWidth =
          this.data.styles.table.borderWidth;
        this.selectedCell.style.borderStyle =
          this.data.styles.table.borderStyle;
        this.updateCellStyles();
      }
    } else {
      const minRow = this.selectedMinRow;
      const maxRow = this.selectedMaxRow!;
      const minCol = this.selectedMinCol!;
      const maxCol = this.selectedMaxCol!;
      Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
        const row = cell.parentElement.rowIndex;
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (
          row >= minRow &&
          row <= maxRow &&
          startCol <= maxCol &&
          endCol >= minCol
        ) {
          cell.style.borderColor = color;
          cell.style.borderWidth = this.data.styles.table.borderWidth;
          cell.style.borderStyle = this.data.styles.table.borderStyle;
          this.updateCellStyles(cell);
        }
      });
    }
  }

  private setBorderStyle(style: string) {
    const isNone = style === "none";
    const applyWidth = isNone
      ? "0"
      : this.data.styles.table.borderWidth || "1px";

    const applyToCell = (cell: HTMLElement) => {
      cell.style.borderStyle = style;
      cell.style.borderWidth = applyWidth;
      if (isNone) cell.style.borderColor = "transparent";
    };

    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) {
        applyToCell(this.selectedCell);
        this.updateCellStyles();
      }
    } else {
      const minRow = this.selectedMinRow;
      const maxRow = this.selectedMaxRow!;
      const minCol = this.selectedMinCol!;
      const maxCol = this.selectedMaxCol!;
      Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
        const row = cell.parentElement.rowIndex;
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (
          row >= minRow &&
          row <= maxRow &&
          startCol <= maxCol &&
          endCol >= minCol
        ) {
          applyToCell(cell);
          this.updateCellStyles(cell);
        }
      });
    }
    this.updateData();
  }

  private toggleHeader() {
    if (!this.selectedRow) return;

    const rowIndex = this.selectedRow.rowIndex;
    const isHeader = !this.selectedRow.classList.contains(this.CSS.header);

    if (isHeader) {
      this.selectedRow.classList.add(this.CSS.header);
    } else {
      this.selectedRow.classList.remove(this.CSS.header);
    }

    Array.from(this.selectedRow.cells).forEach((cell: any) => {
      const cellContent = cell.innerHTML;
      const cellStyles = cell.style.cssText;
      const newCell = isHeader
        ? document.createElement("th")
        : document.createElement("td");

      newCell.innerHTML = cellContent;
      newCell.style.cssText = cellStyles;
      newCell.classList.add(this.CSS.cell);
      newCell.contentEditable = this.cellsEditable ? "true" : "false";
      newCell.dataset.logicalStartCol = cell.dataset.logicalStartCol;
      newCell.dataset.logicalEndCol = cell.dataset.logicalEndCol;
      if (cell.colSpan > 1) newCell.colSpan = cell.colSpan;
      if (cell.rowSpan > 1) newCell.rowSpan = cell.rowSpan;

      newCell.style.whiteSpace = "pre-wrap";
      newCell.style.wordBreak = "break-word";
      newCell.style.overflowWrap = "break-word";

      cell.replaceWith(newCell);
    });

    if (!this.data.headerRows) {
      this.data.headerRows = [];
    }

    if (isHeader) {
      if (!this.data.headerRows.includes(rowIndex)) {
        this.data.headerRows.push(rowIndex);
      }
    } else {
      this.data.headerRows = this.data.headerRows.filter(
        (idx: number) => idx !== rowIndex,
      );
    }

    this.data.withHeading = this.data.headerRows.length > 0;

    this.updateData();
  }

  private setAlignment(align: "left" | "center" | "right") {
    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) {
        this.selectedCell.style.textAlign = align;
        this.updateCellStyles();
      }
    } else {
      const minRow = this.selectedMinRow;
      const maxRow = this.selectedMaxRow!;
      const minCol = this.selectedMinCol!;
      const maxCol = this.selectedMaxCol!;
      Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
        const row = cell.parentElement.rowIndex;
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (
          row >= minRow &&
          row <= maxRow &&
          startCol <= maxCol &&
          endCol >= minCol
        ) {
          cell.style.textAlign = align;
          this.updateCellStyles(cell);
        }
      });
    }
  }

  private toggleBorders() {
    this.data.hideBorders = !this.data.hideBorders;
    const hide = this.data.hideBorders;
    const ts = this.data.styles.table;

    // Apply to the outer table element itself
    if (hide) {
      this.table.style.borderWidth = "0";
      this.table.style.borderStyle = "none";
      this.table.style.borderColor = "transparent";
    } else {
      this.table.style.borderWidth = ts.borderWidth || "1px";
      this.table.style.borderStyle = ts.borderStyle || "solid";
      this.table.style.borderColor = ts.borderColor || "#d1d5db";
    }

    // Always force-apply to every cell regardless of individual overrides
    Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
      if (hide) {
        cell.style.borderWidth = "0";
        cell.style.borderStyle = "none";
        cell.style.borderColor = "transparent";
      } else {
        cell.style.borderWidth = ts.borderWidth || "1px";
        cell.style.borderStyle = ts.borderStyle || "solid";
        cell.style.borderColor = ts.borderColor || "#d1d5db";
      }
    });

    // updateData() will now read the DOM and save the correct border state
    this.updateData();
  }

  private insertImageInCell() {
    const targetCell = this.selectedCell;
    if (!targetCell) return;

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) {
        fileInput.remove();
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const src = e.target?.result as string;
        if (!src) return;

        // Determine cell coordinates
        const rowIndex = targetCell.parentElement?.rowIndex ?? 0;
        const colIndex = targetCell.cellIndex;
        const imgKey = `${rowIndex}-${colIndex}`;

        // Store in data (separate from cell HTML so EditorJS can't strip it)
        if (!this.data.cellImages) this.data.cellImages = {};
        this.data.cellImages[imgKey] = src;
        // Clear stored size so the new image auto-fits initially
        if (this.data.cellImageSizes) delete this.data.cellImageSizes[imgKey];

        // Remove any existing image wrapper in this cell, then inject new one
        targetCell
          .querySelectorAll("[data-cell-image]")
          .forEach((el) => el.remove());
        this.injectCellImage(targetCell, rowIndex, colIndex);

        // Dispatch input event so EditorJS detects the change and fires onChange.
        // This is critical for header/footer editors where no autosave runs —
        // without this, cellImages is updated in this.data but the parent state
        // (pageHeaders/pageFooters) is never notified, causing images to be lost on reload.
        targetCell.dispatchEvent(new Event("input", { bubbles: true }));

        fileInput.remove();
      };
      reader.readAsDataURL(file);
    });

    fileInput.click();
  }

  private mergeCells() {
    // No drag-selection? Help the admin instead of silently doing
    // nothing — the #1 "merge is broken" bug report traces to users
    // not realising they have to drag across cells first.
    if (this.selectedMinRow === undefined) {
      failedPopper(
        t("editor.tools.table.mergeNeedsSelection", {
          defaultValue:
            "Drag across two or more cells first, then try Merge again.",
        }),
      );
      return;
    }

    const minRow = this.selectedMinRow;
    const maxRow = this.selectedMaxRow!;
    const minCol = this.selectedMinCol!;
    const maxCol = this.selectedMaxCol!;

    if (minRow === maxRow && minCol === maxCol) {
      failedPopper(
        t("editor.tools.table.mergeNeedsMultiple", {
          defaultValue: "Select at least two cells to merge.",
        }),
      );
      return;
    }

    // ownerGrid can go stale after insert/delete column|row — always
    // rebuild before a structural operation so the bounds check uses
    // the current table shape.
    this.assignLogicalCols();
    const owner = this.ownerGrid!;

    const numPositions = (maxRow - minRow + 1) * (maxCol - minCol + 1);
    const cellSet = new Set<HTMLTableCellElement>();
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const o = owner[r]?.[c];
        if (!o) {
          failedPopper(
            t("editor.tools.table.mergeHoleInRange", {
              defaultValue:
                "Selected area has a gap — pick a solid rectangle of cells.",
            }),
          );
          return;
        }
        cellSet.add(o.cell);
        if (
          o.startRow < minRow ||
          o.startRow > maxRow ||
          o.startCol < minCol ||
          o.startCol > maxCol
        ) {
          failedPopper(
            t("editor.tools.table.mergeCrossesExisting", {
              defaultValue:
                "Selection crosses an already-merged cell. Split it first, then merge again.",
            }),
          );
          return;
        }
      }
    }

    if (cellSet.size !== numPositions) {
      failedPopper(
        t("editor.tools.table.mergeCrossesExisting", {
          defaultValue:
            "Selection crosses an already-merged cell. Split it first, then merge again.",
        }),
      );
      return;
    }

    let topLeft: {
      cell: HTMLTableCellElement;
      row: number;
      col: number;
    } | null = null;
    cellSet.forEach((cell: any) => {
      const r = cell.parentElement!.rowIndex;
      const c = parseInt(cell.dataset.logicalStartCol!);
      if (
        !topLeft ||
        r < topLeft.row ||
        (r === topLeft.row && c < topLeft.col)
      ) {
        topLeft = { cell, row: r, col: c };
      }
    });

    if (!topLeft) return;

    const contents = Array.from(cellSet)
      .map((cell) => cell.innerHTML)
      .join(" ");
    topLeft.cell.innerHTML = contents;

    topLeft.cell.rowSpan = maxRow - minRow + 1;
    topLeft.cell.colSpan = maxCol - minCol + 1;

    cellSet.forEach((cell) => {
      if (cell !== topLeft!.cell) {
        cell.remove();
      }
    });

    this.assignLogicalCols();
    this.updateData();
    this.clearSelection();
  }

  private splitCell() {
    if (!this.selectedCell) {
      failedPopper(
        t("editor.tools.table.splitPickCell", {
          defaultValue: "Right-click a merged cell, then choose Split.",
        }),
      );
      return;
    }

    const cell: any = this.selectedCell as HTMLTableCellElement;
    const rowSpan = cell.rowSpan || 1;
    const colSpan = cell.colSpan || 1;
    if (rowSpan === 1 && colSpan === 1) {
      failedPopper(
        t("editor.tools.table.splitNotMerged", {
          defaultValue: "This cell isn't merged — nothing to split.",
        }),
      );
      return;
    }

    const startRow = cell.parentElement!.rowIndex;
    const startCol = parseInt(cell.dataset.logicalStartCol!);
    const endRow = startRow + rowSpan - 1;
    const endCol = startCol + colSpan - 1;

    cell.rowSpan = 1;
    cell.colSpan = 1;

    for (let r = startRow; r <= endRow; r++) {
      const row = this.table.rows[r];
      for (let c = startCol; c <= endCol; c++) {
        if (r === startRow && c === startCol) continue;

        const newCell = document.createElement(
          row.classList.contains(this.CSS.header) ? "th" : "td",
        );
        newCell.classList.add(this.CSS.cell);
        newCell.contentEditable = this.cellsEditable ? "true" : "false";
        newCell.innerHTML = "";
        if (this.data.hideBorders) {
          newCell.style.borderWidth = "0";
          newCell.style.borderStyle = "none";
          newCell.style.borderColor = "transparent";
        } else {
          newCell.style.borderWidth = this.data.styles.table.borderWidth;
          newCell.style.borderStyle = this.data.styles.table.borderStyle;
          newCell.style.borderColor = this.data.styles.table.borderColor;
        }
        newCell.style.wordBreak = "break-word";
        newCell.style.whiteSpace = "pre-wrap";
        newCell.style.overflowWrap = "break-word";

        let insertBefore: HTMLTableCellElement | null = null;
        Array.from(row.cells).forEach((existing: HTMLTableCellElement) => {
          const exC = parseInt(existing.dataset.logicalStartCol!);
          if (exC >= c && !insertBefore) {
            insertBefore = existing;
          }
        });
        row.insertBefore(newCell, insertBefore);
      }
    }

    this.assignLogicalCols();
    this.updateData();
  }

  private insertRow(position: "above" | "below"): void {
    if (!this.selectedRow || !this.table) return;

    const newRow = document.createElement("tr");
    newRow.classList.add(this.CSS.row);
    const cellCount = this.getNumCols();

    for (let i = 0; i < cellCount; i++) {
      const cell = document.createElement(
        this.selectedRow.classList.contains(this.CSS.header) ? "th" : "td",
      );
      cell.classList.add(this.CSS.cell);
      cell.contentEditable = "true";

      if (this.data.hideBorders) {
        cell.style.borderWidth = "0";
        cell.style.borderStyle = "none";
        cell.style.borderColor = "transparent";
      } else {
        cell.style.borderWidth = this.data.styles.table.borderWidth;
        cell.style.borderStyle = this.data.styles.table.borderStyle;
        cell.style.borderColor = this.data.styles.table.borderColor;
      }
      cell.style.wordBreak = "break-word";
      cell.style.whiteSpace = "pre-wrap";
      cell.style.overflowWrap = "break-word";

      newRow.appendChild(cell);
      cell.addEventListener("input", () => {
        const rowIndex = newRow.rowIndex;
        const colIndex = cell.cellIndex;
        this.data.content[rowIndex][colIndex] = cell.innerHTML;
        this.updateData();
      });
    }

    if (position === "above") {
      this.selectedRow.before(newRow);
    } else {
      this.selectedRow.after(newRow);
    }

    if (position === "above" && this.data.headerRows) {
      this.data.headerRows = this.data.headerRows.map((idx: number) =>
        idx >= this.selectedRow.rowIndex ? idx + 1 : idx,
      );
    }

    // Shift cell image keys for the new row
    const insertedRowIndex =
      position === "above"
        ? this.selectedRow.rowIndex
        : this.selectedRow.rowIndex + 1;
    this.shiftCellImageKeys("insertRow", insertedRowIndex);

    // Shift stored row heights so later rows keep their explicit height
    // after the insert. New row has no stored height → auto-sizes.
    if (this.data.rowHeights && this.data.rowHeights.length > 0) {
      this.data.rowHeights.splice(insertedRowIndex, 0, 0);
    }

    this.assignLogicalCols();
    this.updateData();
  }

  private insertColumn(position: "left" | "right"): void {
    if (!this.selectedCell || !this.table) return;

    const logicalCol = parseInt(this.selectedCell.dataset.logicalStartCol!);

    const rows = this.table.rows;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const newCell = document.createElement(
        row.classList.contains(this.CSS.header) ? "th" : "td",
      );
      newCell.classList.add(this.CSS.cell);
      newCell.contentEditable = "true";

      if (this.data.hideBorders) {
        newCell.style.borderWidth = "0";
        newCell.style.borderStyle = "none";
        newCell.style.borderColor = "transparent";
      } else {
        newCell.style.borderWidth = this.data.styles.table.borderWidth;
        newCell.style.borderStyle = this.data.styles.table.borderStyle;
        newCell.style.borderColor = this.data.styles.table.borderColor;
      }
      newCell.style.wordBreak = "break-word";
      newCell.style.whiteSpace = "pre-wrap";
      newCell.style.overflowWrap = "break-word";

      newCell.addEventListener("input", () => {
        const rowIndex = row.rowIndex;
        const colIndex = newCell.cellIndex;
        this.data.content[rowIndex][colIndex] = newCell.innerHTML;
        this.updateData();
      });

      let insertBefore: HTMLTableCellElement | null = null;
      Array.from(row.cells).forEach((cell: HTMLTableCellElement) => {
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        if (
          (position === "left" && startCol >= logicalCol) ||
          (position === "right" && startCol >= logicalCol + 1)
        ) {
          if (!insertBefore) insertBefore = cell;
        }
      });
      row.insertBefore(newCell, insertBefore);
    }

    // Update column widths array
    if (this.data.columnWidths && this.data.columnWidths.length > 0) {
      const insertIdx = position === "left" ? logicalCol : logicalCol + 1;
      const splitWidth =
        (this.data.columnWidths[logicalCol] ??
          100 / this.data.columnWidths.length) / 2;
      this.data.columnWidths[logicalCol] = splitWidth;
      this.data.columnWidths.splice(insertIdx, 0, splitWidth);
      const total = this.data.columnWidths.reduce((s, w) => s + w, 0);
      this.data.columnWidths = this.data.columnWidths.map(
        (w) => (w / total) * 100,
      );
    }

    // Shift cell image keys for the inserted column
    const insertedColIdx = position === "left" ? logicalCol : logicalCol + 1;
    this.shiftCellImageKeys("insertCol", insertedColIdx);

    this.assignLogicalCols();
    this.applyColumnWidths();
    this.updateData();
  }

  private deleteRow() {
    if (!this.selectedRow) return;
    const rowIndex = this.selectedRow.rowIndex;
    this.shiftCellImageKeys("deleteRow", rowIndex);
    this.selectedRow.remove();
    this.selectedCell = null;
    this.selectedRow = null;

    if (this.data.headerRows) {
      this.data.headerRows = this.data.headerRows
        .filter((idx: number) => idx !== rowIndex)
        .map((idx: number) => (idx > rowIndex ? idx - 1 : idx));
    }

    // Drop the deleted row's stored height so later rows still line up
    // with their saved sizes.
    if (this.data.rowHeights && this.data.rowHeights.length > rowIndex) {
      this.data.rowHeights.splice(rowIndex, 1);
    }

    this.assignLogicalCols();
    this.updateData();
  }

  private deleteColumn(): void {
    if (!this.selectedCell || !this.table) return;

    const logicalCol = parseInt(this.selectedCell.dataset.logicalStartCol!);

    const rows = this.table.rows;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      Array.from(row.cells).forEach((cell: HTMLTableCellElement) => {
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (startCol <= logicalCol && endCol >= logicalCol) {
          if (cell.colSpan > 1) {
            cell.colSpan -= 1;
          } else {
            cell.remove();
          }
        }
      });
    }

    this.selectedCell = null;
    this.shiftCellImageKeys("deleteCol", logicalCol);

    // Update column widths array
    if (this.data.columnWidths && this.data.columnWidths.length > logicalCol) {
      this.data.columnWidths.splice(logicalCol, 1);
      if (this.data.columnWidths.length > 0) {
        const total = this.data.columnWidths.reduce((s, w) => s + w, 0);
        this.data.columnWidths = this.data.columnWidths.map(
          (w) => (w / total) * 100,
        );
      }
    }

    this.assignLogicalCols();
    this.applyColumnWidths();
    this.updateData();
  }

  private updateCellStyles(cell?: HTMLTableCellElement) {
    const targetCell = cell || this.selectedCell;
    if (!targetCell) return;
    const rowIndex = targetCell.parentElement?.rowIndex || 0;
    const colIndex = targetCell.cellIndex;
    const key = `${rowIndex}-${colIndex}`;

    const existingStyles = this.data.styles.cells[key] || {};
    if (!this.data.styles.cells[rowIndex]) {
      this.data.styles.cells[rowIndex] = {};
    }

    this.data.styles.cells[rowIndex][colIndex] = {
      ...existingStyles,
      backgroundColor:
        targetCell.style.backgroundColor || existingStyles.backgroundColor,
      borderColor: targetCell.style.borderColor || existingStyles.borderColor,
      borderWidth: targetCell.style.borderWidth || existingStyles.borderWidth,
      borderStyle: targetCell.style.borderStyle || existingStyles.borderStyle,
      borderTop: targetCell.style.borderTop || existingStyles.borderTop,
      borderRight: targetCell.style.borderRight || existingStyles.borderRight,
      borderBottom:
        targetCell.style.borderBottom || existingStyles.borderBottom,
      borderLeft: targetCell.style.borderLeft || existingStyles.borderLeft,
      textAlign: targetCell.style.textAlign || existingStyles.textAlign,
      colSpan: targetCell.colSpan > 1 ? targetCell.colSpan : undefined,
      rowSpan: targetCell.rowSpan > 1 ? targetCell.rowSpan : undefined,
      color: targetCell.style.color || existingStyles.color,
      paddingTop: targetCell.style.paddingTop || existingStyles.paddingTop,
      paddingBottom:
        targetCell.style.paddingBottom || existingStyles.paddingBottom,
      paddingLeft: targetCell.style.paddingLeft || existingStyles.paddingLeft,
      paddingRight:
        targetCell.style.paddingRight || existingStyles.paddingRight,
      verticalAlign:
        targetCell.style.verticalAlign || existingStyles.verticalAlign,
      diagonalBorder:
        (targetCell.dataset.diagonalBorder as "down" | "up" | "") ||
        existingStyles.diagonalBorder,
    };

    this.updateData();
  }

  private shiftCellImageKeys(
    type: "insertRow" | "deleteRow" | "insertCol" | "deleteCol",
    index: number,
  ) {
    const shiftMap = (
      source: { [key: string]: any } | undefined,
    ): { [key: string]: any } => {
      const next: { [key: string]: any } = {};
      if (!source || Object.keys(source).length === 0) return next;
      for (const [key, val] of Object.entries(source)) {
        const [r, c] = key.split("-").map(Number);
        if (type === "insertRow") {
          if (r < index) next[key] = val;
          else next[`${r + 1}-${c}`] = val;
        } else if (type === "deleteRow") {
          if (r < index) next[key] = val;
          else if (r > index) next[`${r - 1}-${c}`] = val;
          // r === index → deleted
        } else if (type === "insertCol") {
          if (c < index) next[key] = val;
          else next[`${r}-${c + 1}`] = val;
        } else if (type === "deleteCol") {
          if (c < index) next[key] = val;
          else if (c > index) next[`${r}-${c - 1}`] = val;
          // c === index → deleted
        }
      }
      return next;
    };

    this.data.cellImages = shiftMap(this.data.cellImages);
    this.data.cellImageSizes = shiftMap(this.data.cellImageSizes);
  }

  private injectCellImage(
    cell: HTMLElement,
    rowIndex: number,
    colIndex: number,
  ) {
    const imgKey = `${rowIndex}-${colIndex}`;
    const src = this.data.cellImages?.[imgKey];
    if (!src) return;

    // Wrapper carries the data-cell-image attribute so updateData() can exclude it.
    // contentEditable="false" is important — without it the browser treats the
    // wrapper as part of the editable text flow, and clicking next to the
    // image lands the caret INSIDE the wrapper, making it impossible to
    // type text alongside the image. With it off, the wrapper reads as a
    // single non-editable atom and the caret freely sits before or after it.
    const wrapper = document.createElement("div");
    wrapper.dataset.cellImage = imgKey;
    wrapper.contentEditable = "false";
    wrapper.style.cssText =
      "display:inline-block;position:relative;max-width:100%;line-height:0;vertical-align:middle;margin:2px 4px 2px 0;";

    // Apply stored dimensions if available, otherwise auto-size
    const storedSize = this.data.cellImageSizes?.[imgKey];
    if (storedSize?.width && storedSize?.height) {
      wrapper.style.width = `${storedSize.width}px`;
      wrapper.style.height = `${storedSize.height}px`;
    }

    const img = document.createElement("img");
    img.src = src;
    img.style.cssText =
      "width:100%;height:100%;display:block;pointer-events:none;";
    if (!storedSize) {
      img.style.cssText =
        "max-width:100%;height:auto;display:block;pointer-events:none;";
    }
    wrapper.appendChild(img);

    // Resize + delete controls — only in editable mode
    if (!this.readOnly) {
      // Three resize handles: corner (both), right-edge (width only),
      // bottom-edge (height only). All hidden until the user hovers
      // the wrapper so they don't clutter the cell in the general
      // reading pass. Same style palette as the corner handle.
      //
      // axis:
      //   "both" — diagonal SE corner. width AND height follow drag.
      //   "x"    — right edge. only width follows drag.
      //   "y"    — bottom edge. only height follows drag.
      const makeHandle = (
        axis: "both" | "x" | "y",
      ): HTMLDivElement => {
        const h = document.createElement("div");
        const isCorner = axis === "both";
        const isX = axis === "x";
        const isY = axis === "y";
        h.dataset.resizeAxis = axis;
        h.title = isCorner
          ? t("editor.tools.table.dragResizeBoth")
          : isX
            ? t("editor.tools.table.dragResizeWidth")
            : t("editor.tools.table.dragResizeHeight");
        h.style.cssText = `
          position:absolute;
          background:rgba(37,99,235,0.85);
          border:2px solid #fff;
          display:none;
          pointer-events:auto;
          z-index:10;
          box-shadow:0 1px 3px rgba(0,0,0,0.3);
          ${
            isCorner
              ? "bottom:0;right:0;width:12px;height:12px;border-radius:2px;cursor:se-resize;"
              : isX
                ? "top:50%;right:-4px;transform:translateY(-50%);width:8px;height:24px;border-radius:2px;cursor:ew-resize;"
                : "bottom:-4px;left:50%;transform:translateX(-50%);width:24px;height:8px;border-radius:2px;cursor:ns-resize;"
          }
        `;
        return h;
      };

      const cornerHandle = makeHandle("both");
      const rightHandle = makeHandle("x");
      const bottomHandle = makeHandle("y");
      wrapper.appendChild(cornerHandle);
      wrapper.appendChild(rightHandle);
      wrapper.appendChild(bottomHandle);

      // Delete button — top-right corner
      const deleteBtn = document.createElement("div");
      deleteBtn.title = t("editor.tools.table.removeImage");
      deleteBtn.style.cssText = `
        position:absolute;
        top:0;
        right:0;
        width:18px;
        height:18px;
        background:rgba(220,38,38,0.9);
        border:2px solid #fff;
        border-radius:0 2px 0 4px;
        cursor:pointer;
        display:none;
        pointer-events:auto;
        z-index:11;
        align-items:center;
        justify-content:center;
        font-size:14px;
        line-height:1;
        color:#fff;
        font-weight:bold;
      `;
      deleteBtn.innerHTML = "×";
      wrapper.appendChild(deleteBtn);

      wrapper.addEventListener("mouseenter", () => {
        cornerHandle.style.display = "block";
        rightHandle.style.display = "block";
        bottomHandle.style.display = "block";
        deleteBtn.style.display = "flex";
      });
      wrapper.addEventListener("mouseleave", () => {
        cornerHandle.style.display = "none";
        rightHandle.style.display = "none";
        bottomHandle.style.display = "none";
        deleteBtn.style.display = "none";
      });

      deleteBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.data.cellImages) delete this.data.cellImages[imgKey];
        if (this.data.cellImageSizes) delete this.data.cellImageSizes[imgKey];
        wrapper.remove();
        cell.dispatchEvent(new Event("input", { bubbles: true }));
        this.updateData();
      });

      // Shared drag lifecycle for all three handles. The `axis`
      // dataset on the handle decides whether width, height, or
      // both track the drag. onMouseUp persists whatever ended up
      // on the wrapper into data.cellImageSizes and fires an input
      // event so EditorJS picks up the change.
      const attachResize = (h: HTMLDivElement) => {
        h.addEventListener("mousedown", (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();

          const axis = (h.dataset.resizeAxis || "both") as
            | "both"
            | "x"
            | "y";
          const startX = e.clientX;
          const startY = e.clientY;
          const startW =
            wrapper.offsetWidth ||
            (img as HTMLImageElement).naturalWidth ||
            200;
          const startH =
            wrapper.offsetHeight ||
            (img as HTMLImageElement).naturalHeight ||
            150;

          // Lock the image to fill the wrapper for the duration of
          // the drag so height changes actually cause a visible
          // stretch — the "no stored size" branch above uses
          // height:auto which would ignore explicit heights.
          img.style.cssText =
            "width:100%;height:100%;display:block;pointer-events:none;";
          wrapper.style.width = `${startW}px`;
          wrapper.style.height = `${startH}px`;

          const onMouseMove = (ev: MouseEvent) => {
            if (axis === "both" || axis === "x") {
              const newW = Math.max(20, startW + (ev.clientX - startX));
              wrapper.style.width = `${newW}px`;
            }
            if (axis === "both" || axis === "y") {
              const newH = Math.max(20, startH + (ev.clientY - startY));
              wrapper.style.height = `${newH}px`;
            }
          };

          const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);

            if (!this.data.cellImageSizes) this.data.cellImageSizes = {};
            this.data.cellImageSizes[imgKey] = {
              width: wrapper.offsetWidth,
              height: wrapper.offsetHeight,
            };

            this.updateData();
            cell.dispatchEvent(new Event("input", { bubbles: true }));
          };

          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        });
      };

      attachResize(cornerHandle);
      attachResize(rightHandle);
      attachResize(bottomHandle);
    }

    cell.appendChild(wrapper);

    // Guarantee a text node after the image so the caret has somewhere
    // to land when the admin clicks past the image. Without this, an
    // image-only cell traps the cursor inside the uneditable wrapper
    // and typing goes nowhere.
    if (!wrapper.nextSibling) {
      cell.appendChild(document.createTextNode("​"));
    }
  }

  // Give every inline <img> inside a cell the same resize UX that
  // injectCellImage provides for stored cell images. Runs after
  // cell.innerHTML is set, so DOCX-imported logos + pasted images
  // gain corner / right / bottom resize handles. The wrapper is a
  // runtime UI concern only — the cell's serialize path strips
  // [data-inline-resize-wrapped] back to a bare <img> before
  // writing to data.content, so the persisted HTML stays clean.
  // Dimensions are written to the img's own inline style so they
  // round-trip on save/reload.
  private enhanceInlineCellImages(
    cell: HTMLElement,
    rowIndex: number,
    colIndex: number,
  ) {
    if (this.readOnly) return;

    const imgs = Array.from(cell.querySelectorAll("img"));
    for (const rawImg of imgs) {
      const img = rawImg as HTMLImageElement;

      // Skip images already inside our managed wrapper (whether
      // that's the injectCellImage wrapper or a previous pass of
      // this method — this is idempotent).
      if (img.closest("[data-cell-image]")) continue;
      if (img.closest("[data-inline-resize-wrapped]")) continue;

      const wrapper = document.createElement("span");
      wrapper.dataset.inlineResizeWrapped = "true";
      wrapper.contentEditable = "false";
      wrapper.style.cssText =
        "display:inline-block;position:relative;line-height:0;max-width:100%;vertical-align:middle;";

      // Swap the img into the wrapper in-place so nearby text
      // layout doesn't jump.
      const parent = img.parentNode;
      if (!parent) continue;
      parent.insertBefore(wrapper, img);
      wrapper.appendChild(img);

      // Neutralise editor drag-selection so the resize gesture
      // isn't stolen. Image stays a purely visual child.
      img.style.pointerEvents = "none";
      img.style.display = "block";
      img.draggable = false;

      const makeHandle = (axis: "both" | "x" | "y"): HTMLDivElement => {
        const h = document.createElement("div");
        const isCorner = axis === "both";
        const isX = axis === "x";
        h.dataset.resizeAxis = axis;
        h.title = isCorner
          ? t("editor.tools.table.dragResizeBoth")
          : isX
            ? t("editor.tools.table.dragResizeWidth")
            : t("editor.tools.table.dragResizeHeight");
        h.style.cssText = `
          position:absolute;
          background:rgba(37,99,235,0.85);
          border:2px solid #fff;
          display:none;
          pointer-events:auto;
          z-index:10;
          box-shadow:0 1px 3px rgba(0,0,0,0.3);
          ${
            isCorner
              ? "bottom:0;right:0;width:12px;height:12px;border-radius:2px;cursor:se-resize;"
              : isX
                ? "top:50%;right:-4px;transform:translateY(-50%);width:8px;height:24px;border-radius:2px;cursor:ew-resize;"
                : "bottom:-4px;left:50%;transform:translateX(-50%);width:24px;height:8px;border-radius:2px;cursor:ns-resize;"
          }
        `;
        return h;
      };

      const cornerHandle = makeHandle("both");
      const rightHandle = makeHandle("x");
      const bottomHandle = makeHandle("y");
      wrapper.appendChild(cornerHandle);
      wrapper.appendChild(rightHandle);
      wrapper.appendChild(bottomHandle);

      const showHandles = () => {
        cornerHandle.style.display = "block";
        rightHandle.style.display = "block";
        bottomHandle.style.display = "block";
      };
      const hideHandles = () => {
        cornerHandle.style.display = "none";
        rightHandle.style.display = "none";
        bottomHandle.style.display = "none";
      };
      wrapper.addEventListener("mouseenter", showHandles);
      wrapper.addEventListener("mouseleave", hideHandles);

      const attachResize = (h: HTMLDivElement) => {
        h.addEventListener("mousedown", (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();

          const axis = (h.dataset.resizeAxis || "both") as
            | "both"
            | "x"
            | "y";
          const startX = e.clientX;
          const startY = e.clientY;
          // offsetWidth/Height on the img reflect the current
          // rendered box (respects any width/height already set).
          // Fall back to natural size for freshly loaded images.
          const startW =
            img.offsetWidth || img.naturalWidth || 200;
          const startH =
            img.offsetHeight || img.naturalHeight || 150;

          // Lock explicit width/height on the img itself so it
          // stops honouring max-width:100% during the drag. That
          // way vertical drags produce a visible stretch instead
          // of the browser keeping aspect ratio via height:auto.
          img.style.width = `${startW}px`;
          img.style.height = `${startH}px`;
          img.style.maxWidth = "100%";
          img.style.objectFit = "contain";

          const onMouseMove = (ev: MouseEvent) => {
            if (axis === "both" || axis === "x") {
              const newW = Math.max(20, startW + (ev.clientX - startX));
              img.style.width = `${newW}px`;
            }
            if (axis === "both" || axis === "y") {
              const newH = Math.max(20, startH + (ev.clientY - startY));
              img.style.height = `${newH}px`;
            }
          };

          const onMouseUp = () => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            // Fire input so EditorJS notices the DOM change and
            // triggers onChange → parent state.
            cell.dispatchEvent(new Event("input", { bubbles: true }));
          };

          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        });
      };

      attachResize(cornerHandle);
      attachResize(rightHandle);
      attachResize(bottomHandle);
    }
  }

  private setCellTextColor(color: string) {
    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) {
        this.selectedCell.style.color = color;
        this.updateCellStyles();
      }
    } else {
      const minRow = this.selectedMinRow;
      const maxRow = this.selectedMaxRow!;
      const minCol = this.selectedMinCol!;
      const maxCol = this.selectedMaxCol!;
      Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
        const row = cell.parentElement.rowIndex;
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (
          row >= minRow &&
          row <= maxRow &&
          startCol <= maxCol &&
          endCol >= minCol
        ) {
          cell.style.color = color;
          this.updateCellStyles(cell);
        }
      });
    }
  }

  private setVerticalAlignment(align: "top" | "middle" | "bottom") {
    const applyToCell = (cell: HTMLTableCellElement) => {
      cell.style.verticalAlign = align;
      this.updateCellStyles(cell);
    };

    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) applyToCell(this.selectedCell);
    } else {
      const minRow = this.selectedMinRow;
      const maxRow = this.selectedMaxRow!;
      const minCol = this.selectedMinCol!;
      const maxCol = this.selectedMaxCol!;
      Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
        const row = cell.parentElement.rowIndex;
        const startCol = parseInt(cell.dataset.logicalStartCol!);
        const endCol = parseInt(cell.dataset.logicalEndCol!);
        if (
          row >= minRow &&
          row <= maxRow &&
          startCol <= maxCol &&
          endCol >= minCol
        ) {
          applyToCell(cell as HTMLTableCellElement);
        }
      });
    }
  }

  private showVerticalAlignMenu() {
    const aligns: Array<{
      label: string;
      value: "top" | "middle" | "bottom";
      icon: string;
    }> = [
      {
        label: t("editor.tools.table.alignTop"),
        value: "top",
        icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="14" height="1.5" rx="0.5" fill="#4a90e2"/><rect x="5" y="5" width="8" height="1.5" rx="0.5" fill="#666"/><rect x="5" y="8" width="8" height="1.5" rx="0.5" fill="#666"/></svg>`,
      },
      {
        label: t("editor.tools.table.alignMiddle"),
        value: "middle",
        icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="3" width="8" height="1.5" rx="0.5" fill="#666"/><rect x="2" y="8.25" width="14" height="1.5" rx="0.5" fill="#4a90e2"/><rect x="5" y="13.5" width="8" height="1.5" rx="0.5" fill="#666"/></svg>`,
      },
      {
        label: t("editor.tools.table.alignBottom"),
        value: "bottom",
        icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="8" height="1.5" rx="0.5" fill="#666"/><rect x="5" y="8.5" width="8" height="1.5" rx="0.5" fill="#666"/><rect x="2" y="14.5" width="14" height="1.5" rx="0.5" fill="#4a90e2"/></svg>`,
      },
    ];

    const menu = document.createElement("div");
    menu.style.cssText = `position:absolute;z-index:1001;background:#f0f0f0;border:1px solid #d1d5db;box-shadow:0 2px 5px rgba(0,0,0,0.2);border-radius:4px;padding:4px 0;display:flex;flex-direction:column;min-width:130px;`;

    if (this.contextMenu) {
      const menuItems = this.contextMenu.querySelectorAll(
        `.${this.CSS.contextMenuItem}`,
      );
      let vAlignItem: HTMLElement | null = null;
      menuItems.forEach((item: Element) => {
        if ((item as HTMLElement).dataset.action === "verticalAlign") {
          vAlignItem = item as HTMLElement;
        }
      });
      if (vAlignItem) {
        const itemRect = (vAlignItem as HTMLElement).getBoundingClientRect();
        const wrapperRect = this.wrapper.getBoundingClientRect();
        const spaceRight = window.innerWidth - itemRect.right;
        if (spaceRight >= 130) {
          menu.style.left = `${itemRect.right - wrapperRect.left + 4}px`;
          menu.style.top = `${itemRect.top - wrapperRect.top}px`;
        } else {
          menu.style.right = `${wrapperRect.right - itemRect.left + 4}px`;
          menu.style.top = `${itemRect.top - wrapperRect.top}px`;
        }
      }
    }

    aligns.forEach(({ label, value, icon }) => {
      const item = document.createElement("div");
      item.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 10px;cursor:pointer;font-size:12px;white-space:nowrap;`;
      item.innerHTML = `${icon}<span>${label}</span>`;
      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "#e5e7eb";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor = "transparent";
      });
      item.addEventListener("click", () => {
        this.setVerticalAlignment(value);
        menu.remove();
        this.hideContextMenu();
      });
      menu.appendChild(item);
    });

    this.wrapper.appendChild(menu);

    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("click", closeHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener("click", closeHandler);
    }, 10);
  }

  private applyTableStyles() {
    if (!this.table) return;
    Object.assign(this.table.style, this.data.styles.table);
    // When borders are hidden, also remove the outer table element border
    if (this.data.hideBorders) {
      this.table.style.borderWidth = "0";
      this.table.style.borderStyle = "none";
      this.table.style.borderColor = "transparent";
    }
  }

  private applyColumnWidths() {
    if (!this.table) return;
    const existing = this.table.querySelector("colgroup");
    if (existing) existing.remove();
    const widths = this.data.columnWidths;
    if (!widths || widths.length === 0) return;
    const colgroup = document.createElement("colgroup");
    widths.forEach((w) => {
      const col = document.createElement("col");
      col.style.width = `${w}%`;
      colgroup.appendChild(col);
    });
    this.table.insertBefore(colgroup, this.table.firstChild);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Border width picker — matches showBorderStylePicker's popup pattern. Only
  // changes borderWidth on sides that currently have a border (preserves "no
  // border on left" when user bumps width). Falls back to all four sides if
  // the cell has no borders yet so the first click still does something.
  // ──────────────────────────────────────────────────────────────────────────
  private showBorderWidthPicker() {
    const widths: { value: string; label: string }[] = [
      { value: "0.5px", label: "0.5 pt" },
      { value: "1px", label: "1 pt" },
      { value: "1.5px", label: "1.5 pt" },
      { value: "2px", label: "2 pt" },
      { value: "3px", label: "3 pt" },
      { value: "4px", label: "4 pt" },
      { value: "6px", label: "6 pt" },
    ];
    this.showAnchoredSubmenu({
      action: "borderWidth",
      minWidth: 150,
      items: widths.map(({ value, label }) => ({
        label,
        preview: `width:60px;height:0;border-top:${value} solid #374151;`,
        onPick: () => this.setBorderWidth(value),
      })),
    });
  }

  private setBorderWidth(width: string) {
    const applyToCell = (cell: HTMLTableCellElement) => {
      const sides: Array<"Top" | "Right" | "Bottom" | "Left"> = [
        "Top",
        "Right",
        "Bottom",
        "Left",
      ];
      const anySideBordered = sides.some((side) => {
        const style = (cell.style as any)[`border${side}Style`];
        return style && style !== "none";
      });
      if (anySideBordered) {
        sides.forEach((side) => {
          const style = (cell.style as any)[`border${side}Style`];
          if (style && style !== "none") {
            (cell.style as any)[`border${side}Width`] = width;
          }
        });
      } else {
        cell.style.borderWidth = width;
        if (!cell.style.borderStyle || cell.style.borderStyle === "none") {
          cell.style.borderStyle = this.data.styles.table.borderStyle || "solid";
        }
        if (!cell.style.borderColor) {
          cell.style.borderColor =
            this.data.styles.table.borderColor || "#d1d5db";
        }
      }
      this.updateCellStyles(cell);
    };
    this.forEachSelectedCell(applyToCell);
    this.updateData();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Border sides picker — maps Word's "Borders" button. Each option applies
  // the TABLE DEFAULT border (width + style + color) to the chosen sides and
  // clears the rest. For a selected block, "outside" draws on the perimeter
  // only; "inside" draws on interior cell boundaries only.
  // ──────────────────────────────────────────────────────────────────────────
  private showBorderSidesPicker() {
    type SidesKey =
      | "all"
      | "none"
      | "top"
      | "right"
      | "bottom"
      | "left"
      | "outside"
      | "inside"
      | "insideH"
      | "insideV";
    const options: { key: SidesKey; label: string; svg: string }[] = [
      {
        key: "all",
        label: t("editor.tools.table.sidesAll", { defaultValue: "All borders" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#2563eb" stroke-width="2"/><line x1="2" y1="9" x2="16" y2="9" stroke="#2563eb" stroke-width="1.4"/><line x1="9" y1="2" x2="9" y2="16" stroke="#2563eb" stroke-width="1.4"/>`,
      },
      {
        key: "outside",
        label: t("editor.tools.table.sidesOutside", { defaultValue: "Outside borders" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#2563eb" stroke-width="2"/><line x1="2" y1="9" x2="16" y2="9" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="9" y1="2" x2="9" y2="16" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/>`,
      },
      {
        key: "inside",
        label: t("editor.tools.table.sidesInside", { defaultValue: "Inside borders" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="2" y1="9" x2="16" y2="9" stroke="#2563eb" stroke-width="2"/><line x1="9" y1="2" x2="9" y2="16" stroke="#2563eb" stroke-width="2"/>`,
      },
      {
        key: "insideH",
        label: t("editor.tools.table.sidesInsideH", { defaultValue: "Inside horizontal" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="2" y1="9" x2="16" y2="9" stroke="#2563eb" stroke-width="2"/>`,
      },
      {
        key: "insideV",
        label: t("editor.tools.table.sidesInsideV", { defaultValue: "Inside vertical" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="9" y1="2" x2="9" y2="16" stroke="#2563eb" stroke-width="2"/>`,
      },
      {
        key: "top",
        label: t("editor.tools.table.sidesTop", { defaultValue: "Top border" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="2" y1="2" x2="16" y2="2" stroke="#2563eb" stroke-width="2.5"/>`,
      },
      {
        key: "right",
        label: t("editor.tools.table.sidesRight", { defaultValue: "Right border" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="16" y1="2" x2="16" y2="16" stroke="#2563eb" stroke-width="2.5"/>`,
      },
      {
        key: "bottom",
        label: t("editor.tools.table.sidesBottom", { defaultValue: "Bottom border" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="2" y1="16" x2="16" y2="16" stroke="#2563eb" stroke-width="2.5"/>`,
      },
      {
        key: "left",
        label: t("editor.tools.table.sidesLeft", { defaultValue: "Left border" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/><line x1="2" y1="2" x2="2" y2="16" stroke="#2563eb" stroke-width="2.5"/>`,
      },
      {
        key: "none",
        label: t("editor.tools.table.sidesNone", { defaultValue: "No border" }),
        svg: `<rect x="2" y="2" width="14" height="14" rx="0.5" fill="none" stroke="#d1d5db" stroke-width="1" stroke-dasharray="2 2"/>`,
      },
    ];
    this.showAnchoredSubmenu({
      action: "borderSides",
      minWidth: 170,
      items: options.map(({ key, label, svg }) => ({
        label,
        iconSvg: `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
        onPick: () => this.applyBorderToSides(key),
      })),
    });
  }

  private applyBorderToSides(
    key:
      | "all"
      | "none"
      | "top"
      | "right"
      | "bottom"
      | "left"
      | "outside"
      | "inside"
      | "insideH"
      | "insideV",
  ) {
    const t = this.data.styles.table;
    const borderShorthand = `${t.borderWidth || "1px"} ${t.borderStyle || "solid"} ${t.borderColor || "#d1d5db"}`;
    const cleared = "none";

    const selRow = (this.selectedCell?.parentElement as HTMLTableRowElement | null)?.rowIndex ?? 0;
    const minRow = this.selectedMinRow ?? selRow;
    const maxRow = this.selectedMaxRow ?? minRow;
    const minCol = this.selectedMinCol ?? (this.selectedCell ? parseInt(this.selectedCell.dataset.logicalStartCol || "0") : 0);
    const maxCol = this.selectedMaxCol ?? minCol;

    const assign = (
      cell: HTMLTableCellElement,
      top: boolean,
      right: boolean,
      bottom: boolean,
      left: boolean,
    ) => {
      cell.style.borderTop = top ? borderShorthand : cleared;
      cell.style.borderRight = right ? borderShorthand : cleared;
      cell.style.borderBottom = bottom ? borderShorthand : cleared;
      cell.style.borderLeft = left ? borderShorthand : cleared;
      this.updateCellStyles(cell);
    };

    this.forEachSelectedCell((cell: HTMLTableCellElement) => {
      const row =
        (cell.parentElement as HTMLTableRowElement | null)?.rowIndex ?? 0;
      const sCol = parseInt(cell.dataset.logicalStartCol || "0");
      const eCol = parseInt(cell.dataset.logicalEndCol || "0");

      switch (key) {
        case "all":
          assign(cell, true, true, true, true);
          break;
        case "none":
          assign(cell, false, false, false, false);
          break;
        case "top":
          assign(cell, true, false, false, false);
          break;
        case "right":
          assign(cell, false, true, false, false);
          break;
        case "bottom":
          assign(cell, false, false, true, false);
          break;
        case "left":
          assign(cell, false, false, false, true);
          break;
        case "outside":
          assign(
            cell,
            row === minRow,
            eCol === maxCol,
            row === maxRow,
            sCol === minCol,
          );
          break;
        case "inside":
          assign(
            cell,
            row !== minRow,
            eCol !== maxCol,
            row !== maxRow,
            sCol !== minCol,
          );
          break;
        case "insideH":
          assign(cell, row !== minRow, false, row !== maxRow, false);
          break;
        case "insideV":
          assign(cell, false, eCol !== maxCol, false, sCol !== minCol);
          break;
      }
    });

    this.updateData();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cell padding popup — four numeric inputs (top/right/bottom/left) with a
  // link toggle to drive all four from one value. Writes paddingTop etc.
  // which the existing render + save paths already support.
  // ──────────────────────────────────────────────────────────────────────────
  private showPaddingPicker() {
    // Resolve current padding from the first selected cell (fall back to 4px).
    const cell = this.selectedCell as HTMLTableCellElement | null;
    const read = (prop: string): number => {
      if (!cell) return 4;
      const raw = (cell.style as any)[prop];
      const n = parseInt(raw || "", 10);
      return isNaN(n) ? 4 : n;
    };
    let top = read("paddingTop");
    let right = read("paddingRight");
    let bottom = read("paddingBottom");
    let left = read("paddingLeft");

    const popup = document.createElement("div");
    popup.style.cssText = `
      position:fixed;z-index:100000;background:#ffffff;border:1px solid #d1d5db;
      border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);
      padding:12px;min-width:220px;font-size:12px;color:#374151;
    `;

    const title = document.createElement("div");
    title.textContent = t("editor.tools.table.cellPadding", { defaultValue: "Cell padding" });
    title.style.cssText = "font-weight:600;margin-bottom:10px;";
    popup.appendChild(title);

    const linkRow = document.createElement("label");
    linkRow.style.cssText =
      "display:flex;align-items:center;gap:6px;margin-bottom:10px;cursor:pointer;user-select:none;";
    const linkCheckbox = document.createElement("input");
    linkCheckbox.type = "checkbox";
    linkCheckbox.checked = top === right && right === bottom && bottom === left;
    const linkText = document.createElement("span");
    linkText.textContent = t("editor.tools.table.paddingLink", {
      defaultValue: "Link all sides",
    });
    linkRow.appendChild(linkCheckbox);
    linkRow.appendChild(linkText);
    popup.appendChild(linkRow);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;";
    popup.appendChild(grid);

    const inputs: Record<string, HTMLInputElement> = {};
    const makeField = (
      key: "top" | "right" | "bottom" | "left",
      label: string,
      initial: number,
    ) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;gap:2px;";
      const lbl = document.createElement("span");
      lbl.textContent = label;
      lbl.style.cssText = "font-size:11px;color:#6b7280;";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "60";
      input.value = String(initial);
      input.style.cssText =
        "padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;width:100%;";
      input.addEventListener("input", () => {
        if (linkCheckbox.checked) {
          const v = input.value;
          Object.values(inputs).forEach((other) => {
            if (other !== input) other.value = v;
          });
        }
      });
      wrap.appendChild(lbl);
      wrap.appendChild(input);
      inputs[key] = input;
      grid.appendChild(wrap);
    };
    makeField("top", t("editor.tools.table.paddingTop", { defaultValue: "Top (px)" }), top);
    makeField("right", t("editor.tools.table.paddingRight", { defaultValue: "Right (px)" }), right);
    makeField("bottom", t("editor.tools.table.paddingBottom", { defaultValue: "Bottom (px)" }), bottom);
    makeField("left", t("editor.tools.table.paddingLeft", { defaultValue: "Left (px)" }), left);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = t("common.cancel", { defaultValue: "Cancel" });
    cancelBtn.style.cssText =
      "padding:6px 12px;border:1px solid #d1d5db;background:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = t("common.apply", { defaultValue: "Apply" });
    applyBtn.style.cssText =
      "padding:6px 14px;border:1px solid #2563eb;background:#2563eb;color:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;";
    actions.appendChild(cancelBtn);
    actions.appendChild(applyBtn);
    popup.appendChild(actions);

    const closePopup = () => {
      popup.remove();
      document.removeEventListener("mousedown", onDocClick);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) closePopup();
    };

    cancelBtn.addEventListener("click", closePopup);
    applyBtn.addEventListener("click", () => {
      const t = `${inputs.top.value || 0}px`;
      const r = `${inputs.right.value || 0}px`;
      const b = `${inputs.bottom.value || 0}px`;
      const l = `${inputs.left.value || 0}px`;
      this.setCellPadding(t, r, b, l);
      closePopup();
    });

    document.body.appendChild(popup);

    // Position relative to the Cell Padding menu entry
    let anchorRect: DOMRect | null = null;
    if (this.contextMenu) {
      this.contextMenu
        .querySelectorAll(`.${this.CSS.contextMenuItem}`)
        .forEach((el: Element) => {
          if ((el as HTMLElement).dataset.action === "cellPadding") {
            anchorRect = (el as HTMLElement).getBoundingClientRect();
          }
        });
    }
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    if (anchorRect) {
      const rect = anchorRect as DOMRect;
      let left = rect.right + 6;
      if (left + w > window.innerWidth) left = Math.max(8, rect.left - w - 6);
      let top = rect.top;
      if (top + h > window.innerHeight) top = window.innerHeight - h - 8;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    } else {
      popup.style.left = `${(window.innerWidth - w) / 2}px`;
      popup.style.top = `${(window.innerHeight - h) / 2}px`;
    }

    setTimeout(() => document.addEventListener("mousedown", onDocClick), 10);
    inputs.top.focus();
    inputs.top.select();
  }

  private setCellPadding(top: string, right: string, bottom: string, left: string) {
    this.forEachSelectedCell((cell: HTMLTableCellElement) => {
      cell.style.paddingTop = top;
      cell.style.paddingRight = right;
      cell.style.paddingBottom = bottom;
      cell.style.paddingLeft = left;
      this.updateCellStyles(cell);
    });
    this.updateData();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Column width distribution. "Distribute evenly" writes equal percentages
  // to columnWidths; "Autofit content" clears widths and switches to
  // table-layout:auto; "Autofit window" keeps fixed layout but equalises so
  // the table fills the parent width.
  // ──────────────────────────────────────────────────────────────────────────
  private showColumnFitPicker() {
    const options = [
      {
        key: "distribute",
        label: t("editor.tools.table.distributeEvenly", {
          defaultValue: "Distribute evenly",
        }),
      },
      {
        key: "autoContent",
        label: t("editor.tools.table.autofitContent", {
          defaultValue: "Autofit to content",
        }),
      },
      {
        key: "autoWindow",
        label: t("editor.tools.table.autofitWindow", {
          defaultValue: "Autofit to window",
        }),
      },
    ];
    this.showAnchoredSubmenu({
      action: "columnFit",
      minWidth: 180,
      items: options.map(({ key, label }) => ({
        label,
        onPick: () => this.setColumnFitMode(key as any),
      })),
    });
  }

  private setColumnFitMode(mode: "distribute" | "autoContent" | "autoWindow") {
    const numCols = this.getNumCols();
    if (numCols === 0) return;

    switch (mode) {
      case "distribute": {
        const share = +(100 / numCols).toFixed(4);
        this.data.columnWidths = Array(numCols).fill(share);
        this.data.styles.table.tableLayout = "fixed";
        this.table.style.tableLayout = "fixed";
        this.table.style.width = "100%";
        this.data.styles.table.width = "100%";
        break;
      }
      case "autoContent": {
        this.data.columnWidths = [];
        this.data.styles.table.tableLayout = "auto";
        this.table.style.tableLayout = "auto";
        this.table.style.width = "auto";
        this.data.styles.table.width = "auto";
        break;
      }
      case "autoWindow": {
        const share = +(100 / numCols).toFixed(4);
        this.data.columnWidths = Array(numCols).fill(share);
        this.data.styles.table.tableLayout = "fixed";
        this.table.style.tableLayout = "fixed";
        this.table.style.width = "100%";
        this.data.styles.table.width = "100%";
        break;
      }
    }
    this.applyColumnWidths();
    this.updateData();
  }

  // Shared helper for the small submenu popups above (border width,
  // border sides, column fit). Anchors to whichever context-menu entry
  // has data-action matching `opts.action`.
  private showAnchoredSubmenu(opts: {
    action: string;
    minWidth: number;
    items: {
      label: string;
      iconSvg?: string;
      preview?: string;
      onPick: () => void;
    }[];
  }) {
    const menu = document.createElement("div");
    menu.style.cssText = `
      position:fixed;z-index:100000;background:#ffffff;border:1px solid #d1d5db;
      border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);padding:4px;
      display:flex;flex-direction:column;min-width:${opts.minWidth}px;gap:1px;
    `;

    opts.items.forEach(({ label, iconSvg, preview, onPick }) => {
      const item = document.createElement("div");
      item.style.cssText = `
        display:flex;align-items:center;gap:10px;padding:7px 10px;cursor:pointer;
        border-radius:5px;transition:background 0.12s;
      `;
      if (iconSvg) {
        const iconWrap = document.createElement("span");
        iconWrap.style.cssText =
          "flex-shrink:0;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;";
        iconWrap.innerHTML = iconSvg;
        item.appendChild(iconWrap);
      }
      if (preview) {
        const swatch = document.createElement("div");
        swatch.style.cssText = `flex-shrink:0;${preview}`;
        item.appendChild(swatch);
      }
      const text = document.createElement("span");
      text.textContent = label;
      text.style.cssText = "font-size:12px;color:#374151;flex:1;";
      item.appendChild(text);

      item.addEventListener("mouseenter", () => {
        item.style.background = "#f3f4f6";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick();
        menu.remove();
        this.hideContextMenu();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    let anchorRect: DOMRect | null = null;
    if (this.contextMenu) {
      this.contextMenu
        .querySelectorAll(`.${this.CSS.contextMenuItem}`)
        .forEach((el: Element) => {
          if ((el as HTMLElement).dataset.action === opts.action) {
            anchorRect = (el as HTMLElement).getBoundingClientRect();
          }
        });
    }
    const w = opts.minWidth + 16;
    const h = opts.items.length * 34 + 8;
    if (anchorRect) {
      const rect = anchorRect as DOMRect;
      const spaceRight = window.innerWidth - rect.right;
      let left = spaceRight >= w ? rect.right + 4 : rect.left - w - 4;
      let top = rect.top;
      if (top + h > window.innerHeight) top = window.innerHeight - h - 8;
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    } else {
      menu.style.left = `${(window.innerWidth - w) / 2}px`;
      menu.style.top = `${window.innerHeight / 2 - h / 2}px`;
    }

    const closeHandler = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", closeHandler);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", closeHandler), 10);
  }

  // Fan out an operation to every selected cell. Replaces the ~20-line
  // selection-range loop that was duplicated across setCellBackground,
  // setCellBorder, setBorderStyle, setAlignment, setVerticalAlignment,
  // setCellTextColor. New feature code now funnels through here.
  private forEachSelectedCell(fn: (cell: HTMLTableCellElement) => void) {
    if (this.selectedMinRow === undefined) {
      if (this.selectedCell) fn(this.selectedCell as HTMLTableCellElement);
      return;
    }
    const minRow = this.selectedMinRow;
    const maxRow = this.selectedMaxRow!;
    const minCol = this.selectedMinCol!;
    const maxCol = this.selectedMaxCol!;
    Array.from(this.table.querySelectorAll("td, th")).forEach((cell: any) => {
      const row = cell.parentElement.rowIndex;
      const startCol = parseInt(cell.dataset.logicalStartCol!);
      const endCol = parseInt(cell.dataset.logicalEndCol!);
      if (
        row >= minRow &&
        row <= maxRow &&
        startCol <= maxCol &&
        endCol >= minCol
      ) {
        fn(cell as HTMLTableCellElement);
      }
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Row/column drag-resize. Instead of absolute handle elements (which get
  // fiddly with merged cells and header rows), the whole table listens for
  // mousemove and swaps the cursor + starts a drag when the pointer is
  // within EDGE_PX of a cell's right or bottom border. Matches the Word /
  // Google Docs behaviour where you can grab ANY border and drag.
  // ──────────────────────────────────────────────────────────────────────────
  private attachEdgeResizeHandlers() {
    if (this.readOnly || this.completedPreview) return;
    // Narrow 3-px band — anything wider steals clicks from drag-select
    // when the user starts dragging near a border, and tanks merge/split
    // UX by never letting them establish a multi-cell selection.
    const EDGE_PX = 3;

    const detectEdge = (
      cell: HTMLTableCellElement,
      e: MouseEvent,
    ): "right" | "bottom" | "corner" | null => {
      const rect = cell.getBoundingClientRect();
      // Only count a hit when the pointer is INSIDE the cell, within
      // EDGE_PX of the right/bottom edge. The old "±EDGE_PX" test fired
      // on the neighbour cell too, which doubled the dead zone.
      const dxFromRight = rect.right - e.clientX;
      const dyFromBottom = rect.bottom - e.clientY;
      const nearRight = dxFromRight >= 0 && dxFromRight <= EDGE_PX;
      const nearBottom = dyFromBottom >= 0 && dyFromBottom <= EDGE_PX;
      if (nearRight && nearBottom) return "corner";
      if (nearRight) return "right";
      if (nearBottom) return "bottom";
      return null;
    };

    Array.from(this.table.querySelectorAll("td, th")).forEach(
      (raw: Element) => {
        const cell = raw as HTMLTableCellElement;

        cell.addEventListener("mousemove", (e: MouseEvent) => {
          if (cell.dataset.resizing === "1") return;
          // While the user is drag-selecting we must NOT swap to a
          // resize cursor — the mousemove handler was eating the hover
          // feedback for selection.
          if (this.isSelecting) {
            cell.style.cursor = "";
            return;
          }
          const edge = detectEdge(cell, e);
          if (edge === "corner") cell.style.cursor = "se-resize";
          else if (edge === "right") cell.style.cursor = "col-resize";
          else if (edge === "bottom") cell.style.cursor = "row-resize";
          else cell.style.cursor = "";
        });

        cell.addEventListener("mouseleave", () => {
          if (cell.dataset.resizing !== "1") cell.style.cursor = "";
        });

        cell.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          const edge = detectEdge(cell, e);
          if (!edge) return;
          // Only here do we claim the event — safely out of the way
          // of drag-select mousedowns which land in the cell interior.
          e.preventDefault();
          e.stopPropagation();

          const colIdx = parseInt(cell.dataset.logicalStartCol || "0");
          const colSpan = cell.colSpan || 1;
          // The right edge of a colspan-N cell resizes the LAST column it
          // spans — matches Word's behaviour of "the border you grabbed".
          const resizeColIdx = colIdx + colSpan - 1;
          const row = cell.parentElement as HTMLTableRowElement | null;
          const rowIdx = row?.rowIndex ?? 0;

          if (edge === "right" || edge === "corner") {
            this.startColumnResize(resizeColIdx, e);
          }
          if (edge === "bottom" || edge === "corner") {
            this.startRowResize(rowIdx, e);
          }
        });
      },
    );
  }

  // Column drag: shrink the dragged column, grow the next one so the
  // total adds back to 100%. If the dragged column is the last one we
  // just grow/shrink the table instead.
  private startColumnResize(colIdx: number, startEvent: MouseEvent) {
    const startX = startEvent.clientX;
    const numCols = this.getNumCols();
    if (numCols === 0) return;

    // Make sure the data has concrete widths before we start mutating,
    // so legacy tables without columnWidths get a sensible baseline.
    if (
      !this.data.columnWidths ||
      this.data.columnWidths.length !== numCols
    ) {
      this.data.columnWidths = this.measureColumnWidthsPct();
    }
    const startWidths: number[] = [...this.data.columnWidths];
    const tableRect = this.table.getBoundingClientRect();
    const tableWidth = tableRect.width || 1;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const dxPct = ((ev.clientX - startX) / tableWidth) * 100;
      const widths = [...startWidths];
      const MIN_PCT = 3;

      const neighbor = colIdx < numCols - 1 ? colIdx + 1 : -1;
      if (neighbor >= 0) {
        const newThis = Math.max(MIN_PCT, widths[colIdx] + dxPct);
        const delta = newThis - widths[colIdx];
        const newNext = widths[neighbor] - delta;
        if (newNext >= MIN_PCT) {
          widths[colIdx] = newThis;
          widths[neighbor] = newNext;
        }
      } else {
        widths[colIdx] = Math.max(MIN_PCT, widths[colIdx] + dxPct);
      }

      this.data.columnWidths = widths;
      this.applyColumnWidths();
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      this.updateData();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  private startRowResize(rowIdx: number, startEvent: MouseEvent) {
    const startY = startEvent.clientY;
    const tr = this.table.rows[rowIdx] as HTMLTableRowElement | undefined;
    if (!tr) return;
    const startHeight = tr.getBoundingClientRect().height;
    if (!this.data.rowHeights) this.data.rowHeights = [];

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const next = Math.max(20, startHeight + dy);
      tr.style.height = `${next}px`;
      this.data.rowHeights![rowIdx] = next;
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      this.updateData();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Legacy tables don't have columnWidths; derive from current rendered
  // widths so the first drag has something to adjust rather than
  // snapping every column to equal shares.
  private measureColumnWidthsPct(): number[] {
    const firstRow = this.table.rows[0] as HTMLTableRowElement | undefined;
    if (!firstRow) return [];
    const tableWidth = this.table.getBoundingClientRect().width || 1;
    return Array.from(firstRow.cells).map(
      (c: HTMLTableCellElement) =>
        (c.getBoundingClientRect().width / tableWidth) * 100,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Keyboard navigation — Tab / Shift+Tab between cells, with "Tab in last
  // cell appends a new row" matching Word. Enter is intentionally left to
  // the browser so it still inserts a newline within the cell.
  // ──────────────────────────────────────────────────────────────────────────
  private attachKeyboardNavigation() {
    if (this.readOnly) return;
    Array.from(this.table.querySelectorAll("td, th")).forEach(
      (raw: Element) => {
        const cell = raw as HTMLTableCellElement;
        cell.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key !== "Tab") return;
          e.preventDefault();
          this.focusAdjacentCell(cell, e.shiftKey ? -1 : 1);
        });
      },
    );
  }

  private focusAdjacentCell(
    current: HTMLTableCellElement,
    direction: 1 | -1,
  ) {
    const row = current.parentElement as HTMLTableRowElement | null;
    if (!row) return;
    const rowIdx = row.rowIndex;
    const colIdx = Array.from(row.cells).indexOf(current);
    const focus = (c: HTMLTableCellElement | undefined) => {
      if (!c) return;
      c.focus();
      // Place caret at end for familiar Tab-into-cell behaviour.
      const range = document.createRange();
      range.selectNodeContents(c);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    };

    if (direction === 1) {
      if (colIdx < row.cells.length - 1) {
        focus(row.cells[colIdx + 1] as HTMLTableCellElement);
        return;
      }
      const nextRow = this.table.rows[rowIdx + 1] as
        | HTMLTableRowElement
        | undefined;
      if (nextRow) {
        focus(nextRow.cells[0] as HTMLTableCellElement);
        return;
      }
      // At the bottom-right — grow the table with a fresh row and
      // land in the first cell, same as Word.
      this.selectedRow = row;
      this.selectedCell = current;
      this.insertRow("below");
      const appended = this.table.rows[rowIdx + 1] as
        | HTMLTableRowElement
        | undefined;
      if (appended) focus(appended.cells[0] as HTMLTableCellElement);
      return;
    }

    if (colIdx > 0) {
      focus(row.cells[colIdx - 1] as HTMLTableCellElement);
      return;
    }
    const prevRow = this.table.rows[rowIdx - 1] as
      | HTMLTableRowElement
      | undefined;
    if (prevRow) {
      focus(prevRow.cells[prevRow.cells.length - 1] as HTMLTableCellElement);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Row height popup — mirrors the Cell Padding popup. "Auto" clears the
  // stored height so the row goes back to content-driven sizing.
  // ──────────────────────────────────────────────────────────────────────────
  private showRowHeightPicker() {
    const tr = (this.selectedRow ||
      this.selectedCell?.parentElement) as HTMLTableRowElement | null;
    if (!tr) return;
    const rowIdx = tr.rowIndex;
    const current =
      this.data.rowHeights?.[rowIdx] ||
      Math.round(tr.getBoundingClientRect().height);

    const popup = document.createElement("div");
    popup.style.cssText = `
      position:fixed;z-index:100000;background:#ffffff;border:1px solid #d1d5db;
      border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);
      padding:12px;min-width:200px;font-size:12px;color:#374151;
    `;

    const title = document.createElement("div");
    title.textContent = t("editor.tools.table.rowHeight", {
      defaultValue: "Row height",
    });
    title.style.cssText = "font-weight:600;margin-bottom:10px;";
    popup.appendChild(title);

    const label = document.createElement("span");
    label.textContent = t("editor.tools.table.rowHeightPx", {
      defaultValue: "Height (px)",
    });
    label.style.cssText = "display:block;font-size:11px;color:#6b7280;margin-bottom:4px;";
    popup.appendChild(label);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "800";
    input.value = String(current);
    input.style.cssText =
      "padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;width:100%;";
    popup.appendChild(input);

    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;gap:8px;justify-content:space-between;margin-top:12px;";
    const autoBtn = document.createElement("button");
    autoBtn.type = "button";
    autoBtn.textContent = t("editor.tools.table.rowHeightAuto", {
      defaultValue: "Auto",
    });
    autoBtn.style.cssText =
      "padding:6px 12px;border:1px solid #d1d5db;background:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;";

    const rightGroup = document.createElement("div");
    rightGroup.style.cssText = "display:flex;gap:8px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = t("common.cancel", { defaultValue: "Cancel" });
    cancelBtn.style.cssText =
      "padding:6px 12px;border:1px solid #d1d5db;background:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = t("common.apply", { defaultValue: "Apply" });
    applyBtn.style.cssText =
      "padding:6px 14px;border:1px solid #2563eb;background:#2563eb;color:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;";

    rightGroup.appendChild(cancelBtn);
    rightGroup.appendChild(applyBtn);
    actions.appendChild(autoBtn);
    actions.appendChild(rightGroup);
    popup.appendChild(actions);

    const closePopup = () => {
      popup.remove();
      document.removeEventListener("mousedown", onDocClick);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) closePopup();
    };

    autoBtn.addEventListener("click", () => {
      this.setRowHeight(rowIdx, 0);
      closePopup();
    });
    cancelBtn.addEventListener("click", closePopup);
    applyBtn.addEventListener("click", () => {
      const val = Math.max(0, parseInt(input.value || "0", 10) || 0);
      this.setRowHeight(rowIdx, val);
      closePopup();
    });

    document.body.appendChild(popup);

    let anchorRect: DOMRect | null = null;
    if (this.contextMenu) {
      this.contextMenu
        .querySelectorAll(`.${this.CSS.contextMenuItem}`)
        .forEach((el: Element) => {
          if ((el as HTMLElement).dataset.action === "rowHeight") {
            anchorRect = (el as HTMLElement).getBoundingClientRect();
          }
        });
    }
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    if (anchorRect) {
      const rect = anchorRect as DOMRect;
      let left = rect.right + 6;
      if (left + w > window.innerWidth) left = Math.max(8, rect.left - w - 6);
      let top = rect.top;
      if (top + h > window.innerHeight) top = window.innerHeight - h - 8;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    } else {
      popup.style.left = `${(window.innerWidth - w) / 2}px`;
      popup.style.top = `${(window.innerHeight - h) / 2}px`;
    }

    setTimeout(() => document.addEventListener("mousedown", onDocClick), 10);
    input.focus();
    input.select();
  }

  private setRowHeight(rowIdx: number, px: number) {
    const tr = this.table.rows[rowIdx] as HTMLTableRowElement | undefined;
    if (!tr) return;
    if (!this.data.rowHeights) this.data.rowHeights = [];
    if (px <= 0) {
      tr.style.height = "";
      this.data.rowHeights[rowIdx] = 0;
    } else {
      tr.style.height = `${px}px`;
      this.data.rowHeights[rowIdx] = px;
    }
    this.updateData();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Table style presets. Each preset is a batch of styles applied across
  // every cell + row + table. Users can go back to custom styling by
  // picking "None" or by overriding individual cells afterwards.
  // ──────────────────────────────────────────────────────────────────────────
  private showTableStylePicker() {
    const presets: { key: string; label: string; swatch: string }[] = [
      {
        key: "none",
        label: t("editor.tools.table.themeNone", { defaultValue: "None" }),
        swatch: `<rect x="1" y="1" width="22" height="12" fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="1.5 1.5"/>`,
      },
      {
        key: "grid",
        label: t("editor.tools.table.themeGrid", { defaultValue: "Simple grid" }),
        swatch: `<rect x="1" y="1" width="22" height="12" fill="none" stroke="#374151" stroke-width="1"/><line x1="1" y1="5" x2="23" y2="5" stroke="#374151" stroke-width="0.8"/><line x1="1" y1="9" x2="23" y2="9" stroke="#374151" stroke-width="0.8"/><line x1="8" y1="1" x2="8" y2="13" stroke="#374151" stroke-width="0.8"/><line x1="15" y1="1" x2="15" y2="13" stroke="#374151" stroke-width="0.8"/>`,
      },
      {
        key: "banded",
        label: t("editor.tools.table.themeBanded", { defaultValue: "Banded rows" }),
        swatch: `<rect x="1" y="1" width="22" height="4" fill="#2563eb"/><rect x="1" y="5" width="22" height="4" fill="#ffffff"/><rect x="1" y="9" width="22" height="4" fill="#eff6ff"/><rect x="1" y="1" width="22" height="12" fill="none" stroke="#2563eb" stroke-width="0.6"/>`,
      },
      {
        key: "header",
        label: t("editor.tools.table.themeHeader", { defaultValue: "Header styled" }),
        swatch: `<rect x="1" y="1" width="22" height="4" fill="#111827"/><rect x="1" y="5" width="22" height="4" fill="#ffffff" stroke="#d1d5db" stroke-width="0.6"/><rect x="1" y="9" width="22" height="4" fill="#ffffff" stroke="#d1d5db" stroke-width="0.6"/>`,
      },
      {
        key: "minimal",
        label: t("editor.tools.table.themeMinimal", { defaultValue: "Minimal" }),
        swatch: `<line x1="1" y1="1" x2="23" y2="1" stroke="#111827" stroke-width="1.2"/><line x1="1" y1="5" x2="23" y2="5" stroke="#9ca3af" stroke-width="0.6"/><line x1="1" y1="9" x2="23" y2="9" stroke="#9ca3af" stroke-width="0.6"/><line x1="1" y1="13" x2="23" y2="13" stroke="#111827" stroke-width="1.2"/>`,
      },
      {
        key: "borderless",
        label: t("editor.tools.table.themeBorderless", { defaultValue: "No border" }),
        swatch: `<rect x="1" y="1" width="22" height="12" fill="#ffffff"/><text x="12" y="9" font-size="4" fill="#9ca3af" text-anchor="middle" font-family="Arial">—</text>`,
      },
    ];
    this.showAnchoredSubmenu({
      action: "tableStyle",
      minWidth: 180,
      items: presets.map(({ key, label, swatch }) => ({
        label,
        iconSvg: `<svg width="24" height="14" viewBox="0 0 24 14" xmlns="http://www.w3.org/2000/svg">${swatch}</svg>`,
        onPick: () => this.applyTableTheme(key),
      })),
    });
  }

  private applyTableTheme(theme: string) {
    this.data.theme = theme;
    // Themes own the table-level style trio + per-cell styles below. The
    // user can still override individual cells after applying a preset.
    const presets: Record<
      string,
      {
        tableBorder?: { color: string; width: string; style: string };
        cell?: { bg?: string; border?: string };
        headerCell?: { bg?: string; color?: string; bold?: boolean };
        bandedBg?: string;
        hideBorders?: boolean;
      }
    > = {
      none: {
        tableBorder: { color: "#d1d5db", width: "1px", style: "solid" },
        cell: { bg: "transparent", border: "1px solid #d1d5db" },
      },
      grid: {
        tableBorder: { color: "#374151", width: "1px", style: "solid" },
        cell: { bg: "transparent", border: "1px solid #374151" },
      },
      banded: {
        tableBorder: { color: "#2563eb", width: "1px", style: "solid" },
        cell: { bg: "#ffffff", border: "1px solid #bfdbfe" },
        headerCell: { bg: "#2563eb", color: "#ffffff", bold: true },
        bandedBg: "#eff6ff",
      },
      header: {
        tableBorder: { color: "#d1d5db", width: "1px", style: "solid" },
        cell: { bg: "#ffffff", border: "1px solid #d1d5db" },
        headerCell: { bg: "#111827", color: "#ffffff", bold: true },
      },
      minimal: {
        tableBorder: { color: "#111827", width: "1px", style: "solid" },
        cell: { bg: "transparent", border: "none" },
        headerCell: { bg: "transparent", color: "#111827", bold: true },
      },
      borderless: {
        hideBorders: true,
        cell: { bg: "transparent" },
      },
    };

    const preset = presets[theme] || presets.none;

    if (preset.tableBorder) {
      this.data.styles.table.borderColor = preset.tableBorder.color;
      this.data.styles.table.borderWidth = preset.tableBorder.width;
      this.data.styles.table.borderStyle = preset.tableBorder.style;
      this.data.hideBorders = false;
    }
    if (preset.hideBorders) {
      this.data.hideBorders = true;
    }

    // Clear per-cell overrides so the preset actually shows through.
    this.data.styles.cells = {};
    this.data.styles.rows = {};

    const headerSet = new Set(this.data.headerRows || []);

    Array.from(this.table.querySelectorAll("tr")).forEach(
      (raw: Element, rowIdx: number) => {
        const tr = raw as HTMLTableRowElement;
        const isHeader = headerSet.has(tr.rowIndex);
        const bandBg =
          preset.bandedBg && !isHeader && rowIdx % 2 === 1
            ? preset.bandedBg
            : undefined;
        if (bandBg) tr.style.backgroundColor = bandBg;
        else tr.style.backgroundColor = "";

        Array.from(tr.cells).forEach((raw2: Element) => {
          const cell = raw2 as HTMLTableCellElement;
          // Clear per-side overrides so the preset border wins.
          cell.style.borderTop = "";
          cell.style.borderRight = "";
          cell.style.borderBottom = "";
          cell.style.borderLeft = "";
          cell.style.fontWeight = "";
          cell.style.color = "";

          if (isHeader && preset.headerCell) {
            if (preset.headerCell.bg)
              cell.style.backgroundColor = preset.headerCell.bg;
            if (preset.headerCell.color)
              cell.style.color = preset.headerCell.color;
            if (preset.headerCell.bold) cell.style.fontWeight = "600";
          } else if (preset.cell) {
            if (bandBg) cell.style.backgroundColor = bandBg;
            else if (preset.cell.bg)
              cell.style.backgroundColor =
                preset.cell.bg === "transparent" ? "" : preset.cell.bg;
          }

          if (preset.cell?.border && !preset.hideBorders) {
            if (preset.cell.border === "none") {
              cell.style.borderStyle = "none";
              cell.style.borderWidth = "0";
            } else {
              const parts = preset.cell.border.split(" ");
              cell.style.borderWidth = parts[0] || "1px";
              cell.style.borderStyle = parts[1] || "solid";
              cell.style.borderColor = parts.slice(2).join(" ") || "#d1d5db";
            }
          }
          if (preset.hideBorders) {
            cell.style.borderWidth = "0";
            cell.style.borderStyle = "none";
            cell.style.borderColor = "transparent";
          }
          this.updateCellStyles(cell);
        });
      },
    );

    this.applyTableStyles();
    this.updateData();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Table alignment on page — margins only. Takes effect when the table
  // width is less than its container (i.e. after Autofit to content or a
  // manual width change). At 100% width "center" and "right" look the
  // same as "left", which is expected.
  // ──────────────────────────────────────────────────────────────────────────
  private showTableAlignmentPicker() {
    const options: { key: "left" | "center" | "right"; label: string; svg: string }[] = [
      {
        key: "left",
        label: t("editor.tools.table.alignLeft"),
        svg: `<rect x="1" y="3" width="10" height="12" fill="#dbeafe" stroke="#2563eb" stroke-width="1"/><line x1="12" y1="4" x2="22" y2="4" stroke="#9ca3af" stroke-width="0.7"/><line x1="12" y1="7" x2="22" y2="7" stroke="#9ca3af" stroke-width="0.7"/>`,
      },
      {
        key: "center",
        label: t("editor.tools.table.alignCenter"),
        svg: `<rect x="7" y="3" width="10" height="12" fill="#dbeafe" stroke="#2563eb" stroke-width="1"/><line x1="1" y1="4" x2="6" y2="4" stroke="#9ca3af" stroke-width="0.7"/><line x1="18" y1="4" x2="23" y2="4" stroke="#9ca3af" stroke-width="0.7"/>`,
      },
      {
        key: "right",
        label: t("editor.tools.table.alignRight"),
        svg: `<rect x="13" y="3" width="10" height="12" fill="#dbeafe" stroke="#2563eb" stroke-width="1"/><line x1="2" y1="4" x2="12" y2="4" stroke="#9ca3af" stroke-width="0.7"/><line x1="2" y1="7" x2="12" y2="7" stroke="#9ca3af" stroke-width="0.7"/>`,
      },
    ];
    this.showAnchoredSubmenu({
      action: "tableAlignment",
      minWidth: 170,
      items: options.map(({ key, label, svg }) => ({
        label,
        iconSvg: `<svg width="24" height="18" viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
        onPick: () => this.setTableAlignment(key),
      })),
    });
  }

  private setTableAlignment(align: "left" | "center" | "right") {
    this.data.tableAlign = align;
    this.applyTableAlignment();
    this.updateData();
  }

  private applyTableAlignment() {
    if (!this.table) return;
    const align = this.data.tableAlign || "left";
    switch (align) {
      case "center":
        this.table.style.marginLeft = "auto";
        this.table.style.marginRight = "auto";
        break;
      case "right":
        this.table.style.marginLeft = "auto";
        this.table.style.marginRight = "0";
        break;
      case "left":
      default:
        this.table.style.marginLeft = "0";
        this.table.style.marginRight = "auto";
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Caption. The <caption> element is HTML-native and goes INSIDE the
  // <table> as its first child. captionPosition flips caption-side to
  // move it visually above/below the rows.
  // ──────────────────────────────────────────────────────────────────────────
  private renderCaption() {
    if (!this.table) return;
    const existing = this.table.querySelector("caption");
    if (existing) existing.remove();
    const text = (this.data.caption || "").trim();
    if (!text) return;

    const caption = document.createElement("caption");
    caption.textContent = text;
    caption.contentEditable = this.readOnly ? "false" : "true";
    caption.style.cssText = `
      caption-side:${this.data.captionPosition === "bottom" ? "bottom" : "top"};
      padding:4px 2px;
      font-size:12px;
      font-style:italic;
      color:#4b5563;
      text-align:center;
    `;
    caption.addEventListener("input", () => {
      this.data.caption = caption.textContent || "";
      this.updateData();
    });
    this.table.insertBefore(caption, this.table.firstChild);
  }

  private showCaptionEditor() {
    const popup = document.createElement("div");
    popup.style.cssText = `
      position:fixed;z-index:100000;background:#ffffff;border:1px solid #d1d5db;
      border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);
      padding:12px;min-width:260px;font-size:12px;color:#374151;
    `;

    const title = document.createElement("div");
    title.textContent = t("editor.tools.table.caption", {
      defaultValue: "Caption",
    });
    title.style.cssText = "font-weight:600;margin-bottom:10px;";
    popup.appendChild(title);

    const input = document.createElement("input");
    input.type = "text";
    input.value = this.data.caption || "";
    input.placeholder = t("editor.tools.table.captionPlaceholder", {
      defaultValue: "e.g. Table 1 — Revenue by region",
    });
    input.style.cssText =
      "padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;width:100%;";
    popup.appendChild(input);

    const posLabel = document.createElement("div");
    posLabel.textContent = t("editor.tools.table.captionPosition", {
      defaultValue: "Position",
    });
    posLabel.style.cssText = "font-size:11px;color:#6b7280;margin:10px 0 4px;";
    popup.appendChild(posLabel);

    const radios = document.createElement("div");
    radios.style.cssText = "display:flex;gap:12px;";
    const makeRadio = (val: "top" | "bottom", label: string) => {
      const wrap = document.createElement("label");
      wrap.style.cssText =
        "display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;";
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "capPos";
      r.value = val;
      r.checked = (this.data.captionPosition || "top") === val;
      const t = document.createElement("span");
      t.textContent = label;
      wrap.appendChild(r);
      wrap.appendChild(t);
      radios.appendChild(wrap);
      return r;
    };
    const topRadio = makeRadio(
      "top",
      t("editor.tools.table.captionTop", { defaultValue: "Above" }),
    );
    const bottomRadio = makeRadio(
      "bottom",
      t("editor.tools.table.captionBottom", { defaultValue: "Below" }),
    );
    popup.appendChild(radios);

    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;gap:8px;justify-content:space-between;margin-top:12px;";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = t("editor.tools.table.captionRemove", {
      defaultValue: "Remove",
    });
    removeBtn.style.cssText =
      "padding:6px 12px;border:1px solid #fecaca;background:#ffffff;color:#dc2626;border-radius:4px;cursor:pointer;font-size:12px;";
    const rightGroup = document.createElement("div");
    rightGroup.style.cssText = "display:flex;gap:8px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = t("common.cancel", { defaultValue: "Cancel" });
    cancelBtn.style.cssText =
      "padding:6px 12px;border:1px solid #d1d5db;background:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = t("common.apply", { defaultValue: "Apply" });
    applyBtn.style.cssText =
      "padding:6px 14px;border:1px solid #2563eb;background:#2563eb;color:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;";
    rightGroup.appendChild(cancelBtn);
    rightGroup.appendChild(applyBtn);
    actions.appendChild(removeBtn);
    actions.appendChild(rightGroup);
    popup.appendChild(actions);

    const closePopup = () => {
      popup.remove();
      document.removeEventListener("mousedown", onDocClick);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) closePopup();
    };

    removeBtn.addEventListener("click", () => {
      this.data.caption = "";
      this.renderCaption();
      this.updateData();
      closePopup();
    });
    cancelBtn.addEventListener("click", closePopup);
    applyBtn.addEventListener("click", () => {
      this.data.caption = input.value;
      this.data.captionPosition = topRadio.checked ? "top" : "bottom";
      this.renderCaption();
      this.updateData();
      closePopup();
    });

    document.body.appendChild(popup);

    let anchorRect: DOMRect | null = null;
    if (this.contextMenu) {
      this.contextMenu
        .querySelectorAll(`.${this.CSS.contextMenuItem}`)
        .forEach((el: Element) => {
          if ((el as HTMLElement).dataset.action === "caption") {
            anchorRect = (el as HTMLElement).getBoundingClientRect();
          }
        });
    }
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    if (anchorRect) {
      const rect = anchorRect as DOMRect;
      let left = rect.right + 6;
      if (left + w > window.innerWidth) left = Math.max(8, rect.left - w - 6);
      let top = rect.top;
      if (top + h > window.innerHeight) top = window.innerHeight - h - 8;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    } else {
      popup.style.left = `${(window.innerWidth - w) / 2}px`;
      popup.style.top = `${(window.innerHeight - h) / 2}px`;
    }

    setTimeout(() => document.addEventListener("mousedown", onDocClick), 10);
    input.focus();
    input.select();
    bottomRadio;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Repeat header on page break — toggle wraps header rows in <thead>
  // (default when a header exists) or flattens them back to <tbody> only.
  // The browser's print renderer handles the actual repeat.
  // ──────────────────────────────────────────────────────────────────────────
  private toggleRepeatHeader() {
    this.data.repeatHeaderOnPrint = this.data.repeatHeaderOnPrint === false;
    // Rebuild the table body so thead/tbody structure matches the flag.
    // Preserves current content + styles via the data layer.
    this.updateData();
    this.createTable();
    this.attachEventListeners();
    this.attachEdgeResizeHandlers();
    this.attachKeyboardNavigation();
    this.applyTableStyles();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Convert table → text. Writes delimited plain text to the clipboard so
  // the admin can paste it anywhere. The reverse (paste text → table) is
  // already handled by the existing onPaste / pasteText pipeline, so this
  // dialog is write-only.
  // ──────────────────────────────────────────────────────────────────────────
  private showConvertToTextDialog() {
    const popup = document.createElement("div");
    popup.style.cssText = `
      position:fixed;z-index:100000;background:#ffffff;border:1px solid #d1d5db;
      border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.18);
      padding:12px;min-width:280px;font-size:12px;color:#374151;
    `;

    const title = document.createElement("div");
    title.textContent = t("editor.tools.table.convertToText", {
      defaultValue: "Convert to text",
    });
    title.style.cssText = "font-weight:600;margin-bottom:10px;";
    popup.appendChild(title);

    const sepLabel = document.createElement("div");
    sepLabel.textContent = t("editor.tools.table.convertSeparator", {
      defaultValue: "Separate cells with",
    });
    sepLabel.style.cssText = "font-size:11px;color:#6b7280;margin-bottom:6px;";
    popup.appendChild(sepLabel);

    const seps: { key: string; label: string; sep: string }[] = [
      { key: "tab", label: "Tab", sep: "\t" },
      { key: "comma", label: "Comma", sep: "," },
      { key: "pipe", label: "Pipe |", sep: " | " },
      { key: "semicolon", label: "Semicolon", sep: "; " },
    ];
    const radios = document.createElement("div");
    radios.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;";
    let selectedSep = seps[0].sep;
    seps.forEach(({ key, label, sep }, idx) => {
      const wrap = document.createElement("label");
      wrap.style.cssText =
        "display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;";
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "sepPick";
      r.checked = idx === 0;
      r.addEventListener("change", () => {
        if (r.checked) selectedSep = sep;
      });
      const t = document.createElement("span");
      t.textContent = label;
      wrap.appendChild(r);
      wrap.appendChild(t);
      radios.appendChild(wrap);
      void key;
    });
    popup.appendChild(radios);

    const preview = document.createElement("pre");
    preview.style.cssText = `
      margin-top:10px;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;
      border-radius:4px;font-size:11px;max-height:120px;overflow:auto;white-space:pre;
    `;
    popup.appendChild(preview);

    const buildPreview = () => {
      const lines: string[] = [];
      this.data.content.forEach((row: string[]) => {
        const cells = row.map((cell: string) =>
          (cell || "").replace(/<[^>]+>/g, "").trim(),
        );
        lines.push(cells.join(selectedSep));
      });
      preview.textContent = lines.slice(0, 10).join("\n");
    };
    buildPreview();
    radios.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("change", buildPreview),
    );

    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;gap:8px;justify-content:flex-end;margin-top:12px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = t("common.cancel", { defaultValue: "Cancel" });
    cancelBtn.style.cssText =
      "padding:6px 12px;border:1px solid #d1d5db;background:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = t("editor.tools.table.convertCopy", {
      defaultValue: "Copy to clipboard",
    });
    copyBtn.style.cssText =
      "padding:6px 14px;border:1px solid #2563eb;background:#2563eb;color:#ffffff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;";
    actions.appendChild(cancelBtn);
    actions.appendChild(copyBtn);
    popup.appendChild(actions);

    const closePopup = () => {
      popup.remove();
      document.removeEventListener("mousedown", onDocClick);
    };
    const onDocClick = (e: MouseEvent) => {
      if (!popup.contains(e.target as Node)) closePopup();
    };

    cancelBtn.addEventListener("click", closePopup);
    copyBtn.addEventListener("click", async () => {
      const lines = this.data.content.map((row: string[]) =>
        row
          .map((cell: string) => (cell || "").replace(/<[^>]+>/g, "").trim())
          .join(selectedSep),
      );
      const text = lines.join("\n");
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = t("editor.tools.table.convertCopied", {
          defaultValue: "Copied ✓",
        });
        setTimeout(closePopup, 800);
      } catch {
        // Fallback — select the preview text so the user can Ctrl+C manually
        const range = document.createRange();
        range.selectNodeContents(preview);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    });

    document.body.appendChild(popup);

    let anchorRect: DOMRect | null = null;
    if (this.contextMenu) {
      this.contextMenu
        .querySelectorAll(`.${this.CSS.contextMenuItem}`)
        .forEach((el: Element) => {
          if ((el as HTMLElement).dataset.action === "convertToText") {
            anchorRect = (el as HTMLElement).getBoundingClientRect();
          }
        });
    }
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    if (anchorRect) {
      const rect = anchorRect as DOMRect;
      let left = rect.right + 6;
      if (left + w > window.innerWidth) left = Math.max(8, rect.left - w - 6);
      let top = rect.top;
      if (top + h > window.innerHeight) top = window.innerHeight - h - 8;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    } else {
      popup.style.left = `${(window.innerWidth - w) / 2}px`;
      popup.style.top = `${(window.innerHeight - h) / 2}px`;
    }

    setTimeout(() => document.addEventListener("mousedown", onDocClick), 10);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Diagonal borders (Tier-3). Render as a per-cell SVG overlay so the line
  // scales with the cell at any width/height without affecting layout. The
  // chosen direction is stored on cell.dataset.diagonalBorder + round-trips
  // through styles.cells[r][c].diagonalBorder.
  // ──────────────────────────────────────────────────────────────────────────
  private showDiagonalBorderPicker() {
    const options: { key: "down" | "up" | "none"; label: string; svg: string }[] = [
      {
        key: "down",
        label: t("editor.tools.table.diagDown", { defaultValue: "Top-left ↘ bottom-right" }),
        svg: `<rect x="1" y="1" width="16" height="16" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1"/><line x1="1" y1="1" x2="17" y2="17" stroke="#2563eb" stroke-width="1.6"/>`,
      },
      {
        key: "up",
        label: t("editor.tools.table.diagUp", { defaultValue: "Bottom-left ↗ top-right" }),
        svg: `<rect x="1" y="1" width="16" height="16" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1"/><line x1="1" y1="17" x2="17" y2="1" stroke="#2563eb" stroke-width="1.6"/>`,
      },
      {
        key: "none",
        label: t("editor.tools.table.diagNone", { defaultValue: "No diagonal" }),
        svg: `<rect x="1" y="1" width="16" height="16" rx="0.5" fill="none" stroke="#9ca3af" stroke-width="1"/>`,
      },
    ];
    this.showAnchoredSubmenu({
      action: "diagonalBorder",
      minWidth: 220,
      items: options.map(({ key, label, svg }) => ({
        label,
        iconSvg: `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`,
        onPick: () => this.setDiagonalBorder(key),
      })),
    });
  }

  private setDiagonalBorder(dir: "down" | "up" | "none") {
    this.forEachSelectedCell((cell: HTMLTableCellElement) => {
      // Remove any existing overlay first — switching direction swaps
      // instead of layering.
      cell
        .querySelectorAll("[data-diagonal-overlay]")
        .forEach((el) => el.remove());
      if (dir === "none") {
        delete cell.dataset.diagonalBorder;
      } else {
        cell.dataset.diagonalBorder = dir;
        this.applyDiagonalToCell(cell, dir);
      }
      this.updateCellStyles(cell);
    });
    this.updateData();
  }

  private applyDiagonalToCell(
    cell: HTMLTableCellElement,
    dir: "down" | "up",
  ) {
    // The overlay is pointer-events:none so the cell is still editable
    // underneath. position:absolute pins it to the padding box of the
    // cell, which gets position:relative via inline style.
    const prior = cell.style.position;
    if (prior !== "relative" && prior !== "absolute") {
      cell.style.position = "relative";
    }
    cell.dataset.diagonalBorder = dir;

    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    svg.setAttribute("data-diagonal-overlay", dir);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:visible;";

    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line",
    );
    const borderColor =
      cell.style.borderColor ||
      this.data.styles.table.borderColor ||
      "#374151";
    const borderWidth =
      cell.style.borderWidth || this.data.styles.table.borderWidth || "1px";
    if (dir === "down") {
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      line.setAttribute("x2", "100");
      line.setAttribute("y2", "100");
    } else {
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "100");
      line.setAttribute("x2", "100");
      line.setAttribute("y2", "0");
    }
    line.setAttribute("stroke", borderColor);
    line.setAttribute("stroke-width", borderWidth);
    line.setAttribute("vector-effect", "non-scaling-stroke");

    svg.appendChild(line);
    cell.appendChild(svg);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Formulas (Tier-3). Supported: SUM, AVG/AVERAGE, COUNT, MIN, MAX over an
  // A1-notation range inside the current table. Scope is intentionally
  // narrow — enough for contract value tables (rate × qty totals) without
  // becoming a full spreadsheet engine.
  // ──────────────────────────────────────────────────────────────────────────
  private evalFormulaExpression(expr: string): number | string | null {
    const match = expr
      .trim()
      .match(
        /^=\s*(SUM|AVG|AVERAGE|COUNT|MIN|MAX)\s*\(\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*\)\s*$/i,
      );
    if (!match) return null;
    const [, fn, startRef, endRef] = match;
    const start = this.parseA1(startRef);
    const end = this.parseA1(endRef);
    if (!start || !end) return null;

    const minR = Math.min(start.row, end.row);
    const maxR = Math.max(start.row, end.row);
    const minC = Math.min(start.col, end.col);
    const maxC = Math.max(start.col, end.col);

    const values: number[] = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const raw = this.data.content[r]?.[c] || "";
        // Resolve nested formulas to their numeric value before using
        // them in another formula (basic single-level dependency).
        let cellText: string;
        if (raw.trim().startsWith("=")) {
          const inner = this.evalFormulaExpression(raw);
          cellText = inner === null ? "" : String(inner);
        } else {
          cellText = raw.replace(/<[^>]+>/g, "");
        }
        const parsed = parseFloat(cellText.replace(/[^0-9eE+\-.]/g, ""));
        if (!isNaN(parsed)) values.push(parsed);
      }
    }

    if (values.length === 0 && fn.toUpperCase() !== "COUNT") return 0;
    switch (fn.toUpperCase()) {
      case "SUM":
        return +values.reduce((a, b) => a + b, 0).toFixed(6);
      case "AVG":
      case "AVERAGE":
        return +(
          values.reduce((a, b) => a + b, 0) / values.length
        ).toFixed(6);
      case "COUNT":
        return values.length;
      case "MIN":
        return Math.min(...values);
      case "MAX":
        return Math.max(...values);
    }
    return null;
  }

  // "A1" → {row:0,col:0}; "B3" → {row:2,col:1}; "AA10" → {row:9, col:26}
  private parseA1(ref: string): { row: number; col: number } | null {
    const m = ref.match(/^([A-Z]+)(\d+)$/i);
    if (!m) return null;
    let col = 0;
    const letters = m[1].toUpperCase();
    for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = parseInt(m[2], 10) - 1;
    if (col <= 0 || row < 0) return null;
    return { row, col: col - 1 };
  }

  // Called from createTable for each cell. If data.content[r][c] is a
  // formula, swap the display to the computed value and remember the
  // raw formula on data-formula.
  private evaluateCellFormula(
    cell: HTMLTableCellElement,
    r: number,
    c: number,
  ) {
    const raw = (this.data.content[r]?.[c] || "").trim();
    if (!raw.startsWith("=")) return;
    const result = this.evalFormulaExpression(raw);
    if (result === null) {
      // Keep the raw text visible so the admin can see + fix the
      // broken formula — don't silently hide it.
      cell.title = t("editor.tools.table.formulaInvalid", {
        defaultValue: "Formula could not be parsed",
      });
      return;
    }
    cell.dataset.formula = raw;
    cell.dataset.formulaDisplayed = "value";
    cell.title = raw;
    cell.textContent = String(result);
  }

  // Re-evaluates every formula cell in the table. Called from the context
  // menu "Recalculate formulas" entry. Useful after a bulk data edit —
  // formulas only auto-recompute on individual cell blur, not on changes
  // in cells they depend on.
  private recalculateAllFormulas() {
    const cells = Array.from(this.table.querySelectorAll("td, th")) as HTMLTableCellElement[];
    let changed = 0;
    cells.forEach((cell) => {
      const row = (cell.parentElement as HTMLTableRowElement | null)?.rowIndex ?? -1;
      const col = cell.cellIndex;
      if (row < 0) return;
      const raw = (this.data.content[row]?.[col] || "").trim();
      if (!raw.startsWith("=")) return;
      const result = this.evalFormulaExpression(raw);
      if (result === null) return;
      cell.dataset.formula = raw;
      cell.dataset.formulaDisplayed = "value";
      cell.textContent = String(result);
      cell.title = raw;
      changed++;
    });
    void changed; // suppress unused — used for optional toast later
    this.updateData();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Nested tables (Tier-3, simplified). Drops a minimal HTML <table> into
  // the current cell. The sub-table is plain contentEditable HTML — not
  // instrumented with the full context menu / drag-resize that the outer
  // table has. For full Word-level nested editing we'd need a bigger
  // refactor; this covers the "I just need a sub-grid in one cell" case.
  // ──────────────────────────────────────────────────────────────────────────
  private insertNestedTable() {
    const target = this.selectedCell as HTMLTableCellElement | null;
    if (!target) return;
    const rowIndex = (target.parentElement as HTMLTableRowElement | null)?.rowIndex ?? 0;
    const colIndex = target.cellIndex;

    const nested = `<table class="te-nested-table" style="width:100%;border-collapse:collapse;margin:4px 0;border:1px solid #d1d5db;">` +
      `<tr>` +
      `<td style="border:1px solid #d1d5db;padding:4px;min-width:40px;">&nbsp;</td>` +
      `<td style="border:1px solid #d1d5db;padding:4px;min-width:40px;">&nbsp;</td>` +
      `</tr>` +
      `<tr>` +
      `<td style="border:1px solid #d1d5db;padding:4px;min-width:40px;">&nbsp;</td>` +
      `<td style="border:1px solid #d1d5db;padding:4px;min-width:40px;">&nbsp;</td>` +
      `</tr>` +
      `</table>`;

    // Append rather than overwrite — the admin might already have text
    // in the cell they'd like to keep above the nested grid.
    const existing = target.innerHTML.trim();
    target.innerHTML = existing ? `${existing}<br>${nested}` : nested;

    this.data.content[rowIndex][colIndex] = target.innerHTML;
    this.updateData();
    // Place caret inside the first nested cell so typing lands there.
    const firstTd = target.querySelector(".te-nested-table td") as HTMLElement | null;
    if (firstTd) {
      const range = document.createRange();
      range.selectNodeContents(firstTd);
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }

  private updateData() {
    if (!this.table) return;

    const content: string[][] = [];
    const rows = this.table.rows;

    const cellStyles: any = {};
    const rowStyles: any = {};
    const headerRows: number[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowData: string[] = [];
      const cells = rows[i].cells;

      if (rows[i].classList.contains(this.CSS.header)) {
        headerRows.push(i);
      }

      if (rows[i].style.backgroundColor) {
        rowStyles[i] = { backgroundColor: rows[i].style.backgroundColor };
      }

      if (!cellStyles[i]) {
        cellStyles[i] = {};
      }

      for (let j = 0; j < cells.length; j++) {
        const cell = cells[j];
        // Exclude managed cell images so they don't pollute the HTML content
        const clone = cell.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll("[data-cell-image]")
          .forEach((el) => el.remove());
        // Unwrap inline-image resize wrappers so we save clean
        // <img> HTML — the wrapper is a runtime UI concern only.
        clone
          .querySelectorAll("[data-inline-resize-wrapped]")
          .forEach((wrap) => {
            const img = wrap.querySelector("img");
            if (img && wrap.parentNode) {
              wrap.parentNode.replaceChild(img, wrap);
            } else {
              wrap.remove();
            }
          });
        rowData.push(clone.innerHTML);

        const cellStyle: any = {};
        if (cell.style.backgroundColor)
          cellStyle.backgroundColor = cell.style.backgroundColor;
        if (cell.style.borderColor)
          cellStyle.borderColor = cell.style.borderColor;
        if (cell.style.borderWidth)
          cellStyle.borderWidth = cell.style.borderWidth;
        if (cell.style.borderStyle)
          cellStyle.borderStyle = cell.style.borderStyle;
        if (cell.style.borderTop) cellStyle.borderTop = cell.style.borderTop;
        if (cell.style.borderRight)
          cellStyle.borderRight = cell.style.borderRight;
        if (cell.style.borderBottom)
          cellStyle.borderBottom = cell.style.borderBottom;
        if (cell.style.borderLeft) cellStyle.borderLeft = cell.style.borderLeft;
        if (cell.style.textAlign) cellStyle.textAlign = cell.style.textAlign;
        if (cell.colSpan > 1) cellStyle.colSpan = cell.colSpan;
        if (cell.rowSpan > 1) cellStyle.rowSpan = cell.rowSpan;
        if (cell.style.color) cellStyle.color = cell.style.color;
        if (cell.style.paddingTop) cellStyle.paddingTop = cell.style.paddingTop;
        if (cell.style.paddingBottom)
          cellStyle.paddingBottom = cell.style.paddingBottom;
        if (cell.style.paddingLeft)
          cellStyle.paddingLeft = cell.style.paddingLeft;
        if (cell.style.paddingRight)
          cellStyle.paddingRight = cell.style.paddingRight;
        if (cell.style.verticalAlign)
          cellStyle.verticalAlign = cell.style.verticalAlign;
        if (
          cell.dataset.diagonalBorder === "down" ||
          cell.dataset.diagonalBorder === "up"
        ) {
          cellStyle.diagonalBorder = cell.dataset.diagonalBorder;
        }

        if (Object.keys(cellStyle).length > 0) {
          cellStyles[i][j] = cellStyle;
        }
      }

      content.push(rowData);
    }

    this.data.content = content;
    this.data.styles.cells = cellStyles;
    this.data.styles.rows = rowStyles;
    this.data.headerRows = headerRows;
    this.data.withHeading = headerRows.length > 0;
  }

  save() {
    this.updateData();
    return {
      ...this.data,
      withHeading: this.data.withHeading,
      headerRows: this.data.headerRows,
      cellImages: this.data.cellImages || {},
      cellImageSizes: this.data.cellImageSizes || {},
    };
  }

  static get sanitize() {
    return {
      content: true,
      withHeading: false,
      headerRows: false,
      hideBorders: false,
      columnWidths: false,
      rowHeights: false,
      theme: false,
      repeatHeaderOnPrint: false,
      tableAlign: false,
      caption: false,
      captionPosition: false,
      cellImages: true,
      cellImageSizes: false,
      id: false,
      linkedField: false,
      styles: false,
    };
  }

  static get pasteConfig(): PasteConfig {
    return {
      tags: ["TABLE", "TR", "TD", "TBODY", "THEAD", "TH"],
      files: {
        mimeTypes: ["text/csv"],
      },
      patterns: {
        table: /^([^|\n]+\|)+([^|\n]+)$/m,
        csv: /^[^,\n]+(?:,[^,\n]+)*$/m,
      },
    };
  }

  onPaste(event: CustomEvent) {
    const { data } = event.detail;

    if (data.tagName === "TABLE") {
      return this.pasteHtmlTable(data);
    }

    if (data.file && data.file.type === "text/csv") {
      return this.pasteCsvFile(data.file);
    }

    if (typeof data.textContent === "string") {
      return this.pasteText(data.textContent);
    }

    return false;
  }

  private async pasteHtmlTable(tableElement: HTMLElement) {
    try {
      const rows = Array.from(tableElement.querySelectorAll("tr"));
      const content: string[][] = [];
      const headerRows: number[] = [];

      rows.forEach((row, index) => {
        const isHeader = row.closest("thead") || row.querySelector("th");
        if (isHeader) {
          headerRows.push(index);
        }
        const cells = Array.from(row.querySelectorAll("td, th")).map(
          (cell) => cell.textContent || "",
        );
        content.push(cells);
      });

      this.data.content = content;
      this.data.headerRows = headerRows;
      this.data.withHeading = headerRows.length > 0;
      this.render();

      return true;
    } catch (error) {
      console.error("Error pasting HTML table:", error);
      return false;
    }
  }

  private async pasteCsvFile(file: File) {
    try {
      const text = await file.text();
      return this.pasteText(text);
    } catch (error) {
      console.error("Error pasting CSV file:", error);
      return false;
    }
  }

  private pasteText(text: string) {
    try {
      let content: string[][] = [];

      if (this.constructor.pasteConfig.patterns.table.test(text)) {
        content = text
          .split("\n")
          .filter((line) => line.trim() && !line.includes("|-"))
          .map((row) =>
            row
              .split("|")
              .map((cell) => cell.trim())
              .filter((cell) => cell),
          );
      } else if (this.constructor.pasteConfig.patterns.csv.test(text)) {
        content = text
          .split("\n")
          .filter((line) => line.trim())
          .map((row) => row.split(",").map((cell) => cell.trim()));
      } else {
        content = text
          .split("\n")
          .filter((line) => line.trim())
          .map((row) =>
            row
              .split(/\t|\s{2,}/)
              .map((cell) => cell.trim())
              .filter((cell) => cell),
          );
      }

      if (content.length > 0 && content[0].length > 0) {
        this.data.content = content;
        this.render();
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error pasting text:", error);
      return false;
    }
  }
}

export default TableTool;

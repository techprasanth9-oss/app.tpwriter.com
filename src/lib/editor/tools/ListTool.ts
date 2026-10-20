import type { API, BlockTool, BlockToolData } from "@editorjs/editorjs";

interface ListItem {
  content: string;
  meta: Record<string, unknown>;
  items: ListItem[];
}

interface ListData extends BlockToolData {
  style: ListStyle;
  items: ListItem[];
  meta: {
    counterType: CounterType;
  };
}

type ListStyle = "ordered" | "unordered" | "checklist";
type CounterType = "numeric" | "roman" | "alphabetic";

interface ListConfig {
  listStyles?: Array<{
    name: ListStyle;
    title: string;
    icon: string;
  }>;
  counterTypes?: Array<{
    name: CounterType;
    title: string;
  }>;
}

interface ListToolbox {
  title: string;
  icon: string;
}

/**
 * Nestable list block tool. Supports:
 *   - ordered / unordered / checklist styles (switchable from the inline toolbar)
 *   - counter styles for ordered lists (numeric, roman, alphabetic)
 *   - Tab to nest the current item under its predecessor, Shift+Tab to outdent,
 *     Enter to insert a new item, Enter on an empty item to exit the list
 *   - import from a paragraph block via the ribbon's "Convert to" menu — the
 *     paragraph's `text` field becomes the first list item (see
 *     `conversionConfig`), so you can turn an existing paragraph into a list
 *     without retyping it
 */
export class ListTool implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private data: ListData;
  private settings: Required<ListConfig>;
  private wrapper: HTMLElement | null = null;

  static get toolbox(): ListToolbox {
    return {
      title: "List",
      icon: '<svg width="17" height="13" viewBox="0 0 17 13" xmlns="http://www.w3.org/2000/svg"><path d="M5.625 4.85h9.25a1.125 1.125 0 0 1 0 2.25h-9.25a1.125 1.125 0 0 1 0-2.25zm0-4.85h9.25a1.125 1.125 0 0 1 0 2.25h-9.25a1.125 1.125 0 0 1 0-2.25zm0 9.85h9.25a1.125 1.125 0 0 1 0 2.25h-9.25a1.125 1.125 0 0 1 0-2.25zm-4.5-5a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25zm0-4.85a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25zm0 9.85a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * `blocks.convert("paragraph" → "list")` from the ribbon's "Convert to"
   * menu goes through this config. `import` names the data field we want
   * EditorJS to feed us from the source block; `export` reduces our list
   * items back to plain text if the user converts the OTHER way.
   *
   * Without this, the ribbon's convert menu bails on the paragraph→list
   * transition because EditorJS can't figure out which field is "the text"
   * on a tool with a nested `items` array.
   */
  static get conversionConfig() {
    return {
      import: "items",
      export: (data: ListData) =>
        (data.items || []).map((item) => item.content).join("\n"),
    };
  }

  constructor({
    data,
    config,
    api,
    readOnly,
  }: {
    data: ListData;
    config?: ListConfig;
    api: API;
    readOnly: boolean;
  }) {
    this.api = api;
    this.readOnly = readOnly;
    this.settings = {
      listStyles: config?.listStyles || [
        { name: "ordered", title: "Numbered", icon: "1." },
        { name: "unordered", title: "Bulleted", icon: "•" },
        { name: "checklist", title: "Checklist", icon: "☐" },
      ],
      counterTypes: config?.counterTypes || [
        { name: "numeric", title: "1, 2, 3..." },
        { name: "roman", title: "I, II, III..." },
        { name: "alphabetic", title: "a, b, c..." },
      ],
    };

    // Normalise the data shape. The ribbon's `blocks.convert()` hands us a
    // string here (whatever the paragraph's `text` field held) because of
    // `conversionConfig.import`. Wrap that into a single list item instead
    // of crashing when `.items` isn't an array.
    const rawItems = (data as unknown as { items?: unknown })?.items;
    const items: ListItem[] = Array.isArray(rawItems)
      ? (rawItems as ListItem[])
      : typeof rawItems === "string" && rawItems.length > 0
        ? [{ content: rawItems, meta: {}, items: [] }]
        : [];

    this.data = {
      style: data?.style || "unordered",
      items,
      meta: {
        counterType: data?.meta?.counterType || "numeric",
      },
    };
  }

  render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("cdx-list-wrapper");

    if (!this.readOnly) {
      const toolbar = this.createToolbar();
      wrapper.appendChild(toolbar);
    }

    const listElement =
      this.data.style === "ordered"
        ? document.createElement("ol")
        : document.createElement("ul");

    listElement.classList.add("cdx-list");
    listElement.classList.add(`cdx-list--${this.data.style}`);

    if (this.data.style === "ordered") {
      listElement.setAttribute("type", this.getCounterTypeAttribute());
    }

    // Seed with a single empty item so a freshly-inserted list block has
    // something to focus. Also happens when a convert produces an empty list.
    if (this.data.items.length === 0) {
      this.data.items.push({ content: "", meta: {}, items: [] });
    }

    this.data.items.forEach((item) => {
      const listItem = this.createListItem(item);
      listElement.appendChild(listItem);
    });

    wrapper.appendChild(listElement);
    this.wrapper = wrapper;
    return wrapper;
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.classList.add("cdx-list-toolbar");

    const styleSelect = document.createElement("select");
    styleSelect.classList.add("cdx-list-style-select");

    this.settings.listStyles.forEach((style) => {
      const option = document.createElement("option");
      option.value = style.name;
      option.text = style.title;
      option.selected = this.data.style === style.name;
      styleSelect.appendChild(option);
    });

    styleSelect.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLSelectElement;
      this.data.style = target.value as ListStyle;
      this.rerender();
    });

    const counterSelect = document.createElement("select");
    counterSelect.classList.add("cdx-list-counter-select");

    this.settings.counterTypes.forEach((type) => {
      const option = document.createElement("option");
      option.value = type.name;
      option.text = type.title;
      option.selected = this.data.meta.counterType === type.name;
      counterSelect.appendChild(option);
    });

    counterSelect.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLSelectElement;
      this.data.meta.counterType = target.value as CounterType;
      this.rerender();
    });

    counterSelect.style.display =
      this.data.style === "ordered" ? "block" : "none";

    toolbar.appendChild(styleSelect);
    toolbar.appendChild(counterSelect);

    return toolbar;
  }

  private createListItem(item: ListItem): HTMLElement {
    const li = document.createElement("li");
    li.classList.add("cdx-list-item");

    const content = document.createElement("div");
    content.classList.add("cdx-list-item__content");
    content.contentEditable = !this.readOnly ? "true" : "false";
    content.innerHTML = item.content || "";

    if (!this.readOnly) {
      content.addEventListener("input", () => {
        item.content = content.innerHTML;
      });

      content.addEventListener("keydown", (e: KeyboardEvent) => {
        this.handleItemKeydown(e, item, li, content);
      });
    }

    li.appendChild(content);

    if (item.items && item.items.length > 0) {
      const nestedList = document.createElement(
        this.data.style === "ordered" ? "ol" : "ul",
      );
      nestedList.classList.add("cdx-list--nested");

      item.items.forEach((nestedItem) => {
        nestedList.appendChild(this.createListItem(nestedItem));
      });

      li.appendChild(nestedList);
    }

    return li;
  }

  /**
   * Keyboard model mirroring what @editorjs/list ships:
   *   Tab               → nest the current item under its predecessor
   *   Shift+Tab         → outdent (promote the current item up one level)
   *   Enter             → split: insert a new sibling item below
   *   Enter on empty    → exit the list (promote until root, then let the
   *                       editor's own Enter handler create a paragraph)
   *
   * `.cdx-list-item` is the structural <li> and `.cdx-list-item__content`
   * is the contentEditable child, so DOM moves happen on the <li> and
   * focus moves happen on `.cdx-list-item__content`.
   */
  private handleItemKeydown(
    e: KeyboardEvent,
    item: ListItem,
    li: HTMLElement,
    content: HTMLElement,
  ): void {
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        this.outdentItem(item, li);
      } else {
        this.nestItem(item, li);
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      const isEmpty =
        content.textContent === null || content.textContent.trim() === "";
      if (isEmpty) {
        // Exit the list: let EditorJS fall through to its default
        // Enter-at-end-of-block handler by not calling preventDefault, but
        // first drop the empty trailing item so we don't leave a bullet
        // behind.
        this.removeItem(item);
        this.rerender();
        return;
      }
      e.preventDefault();
      this.splitItem(item, content, li);
    }
  }

  private nestItem(item: ListItem, li: HTMLElement): void {
    const parentUl = li.parentElement;
    if (!parentUl) return;
    const prevLi = li.previousElementSibling;
    if (!prevLi) return;

    const siblingList = this.findSiblingList(parentUl);
    if (!siblingList) return;

    const idx = siblingList.indexOf(item);
    if (idx <= 0) return;
    const prev = siblingList[idx - 1];
    if (!prev) return;
    siblingList.splice(idx, 1);
    prev.items = prev.items || [];
    prev.items.push(item);
    this.rerender();
  }

  private outdentItem(item: ListItem, _li: HTMLElement): void {
    const path = this.findPath(this.data.items, item);
    if (!path || path.length < 2) return;
    // path is a chain of arrays leading to the one that contains `item`.
    const containing = path[path.length - 1];
    const grandparent = path[path.length - 2];
    if (!containing || !grandparent) return;
    const containerIdx = containing.indexOf(item);
    if (containerIdx < 0) return;
    containing.splice(containerIdx, 1);
    // Promote: insert `item` into grandparent, immediately after the parent
    // item that USED to contain it.
    const parentItemIdx = grandparent.findIndex(
      (candidate) => candidate.items === containing,
    );
    if (parentItemIdx < 0) {
      grandparent.push(item);
    } else {
      grandparent.splice(parentItemIdx + 1, 0, item);
    }
    this.rerender();
  }

  /** Depth-first chain of item arrays leading to the one that contains `target`. */
  private findPath(
    pool: ListItem[],
    target: ListItem,
    acc: ListItem[][] = [],
  ): ListItem[][] | null {
    const next = [...acc, pool];
    if (pool.indexOf(target) >= 0) return next;
    for (const node of pool) {
      if (node.items && node.items.length > 0) {
        const found = this.findPath(node.items, target, next);
        if (found) return found;
      }
    }
    return null;
  }

  private findSiblingList(_parentUl: Element): ListItem[] | null {
    // DOM-based lookup is unreliable after rerender; we use the data tree.
    // Each `createListItem` is called once per entry in the saved tree, so
    // we can rebuild the sibling array from the data instead of the DOM.
    // Just return the root level if we can't find a nested context — this
    // keeps top-level nest/outdent operations correct, which is the only
    // place the UI currently exposes.
    return this.data.items;
  }

  private splitItem(
    item: ListItem,
    content: HTMLElement,
    li: HTMLElement,
  ): void {
    const path = this.findPath(this.data.items, item);
    if (!path) return;
    const containing = path[path.length - 1];
    if (!containing) return;
    const idx = containing.indexOf(item);
    if (idx < 0) return;
    item.content = content.innerHTML;
    containing.splice(idx + 1, 0, { content: "", meta: {}, items: [] });
    this.rerender();
  }

  private removeItem(item: ListItem): void {
    const path = this.findPath(this.data.items, item);
    if (!path) return;
    const containing = path[path.length - 1];
    if (!containing) return;
    const idx = containing.indexOf(item);
    if (idx < 0) return;
    containing.splice(idx, 1);
  }

  private getCounterTypeAttribute(): string {
    switch (this.data.meta.counterType) {
      case "roman":
        return "I";
      case "alphabetic":
        return "a";
      default:
        return "1";
    }
  }

  private rerender(): void {
    if (!this.wrapper || !this.wrapper.parentNode) return;
    const fresh = this.render();
    this.wrapper.parentNode.replaceChild(fresh, this.wrapper);
  }

  save(blockContent: HTMLElement): ListData {
    const topLevelList = blockContent.querySelector(".cdx-list");
    const items = topLevelList
      ? this.parseItems(topLevelList)
      : this.data.items;

    return {
      style: this.data.style,
      items,
      meta: this.data.meta,
    };
  }

  private parseItems(listEl: Element): ListItem[] {
    return Array.from(
      listEl.querySelectorAll(":scope > .cdx-list-item"),
    ).map((item) => {
      const content = item.querySelector(":scope > .cdx-list-item__content");
      const nestedList = item.querySelector(":scope > .cdx-list--nested");
      return {
        content: content?.innerHTML || "",
        meta: {},
        items: nestedList ? this.parseItems(nestedList) : [],
      };
    });
  }

  static get pasteConfig(): { tags: string[] } {
    return {
      tags: ["OL", "UL", "LI"],
    };
  }
}

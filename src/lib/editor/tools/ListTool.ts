import type { API, BlockAPI, BlockTool, BlockToolData } from "@editorjs/editorjs";
import { BLOCK_INLINE_TAGS } from "../sanitizers";
import "./ListTool.css";

/**
 * Saved shape (compatible with @editorjs/list v2 and every document written
 * by earlier versions of this tool):
 *
 *   {
 *     style: "ordered" | "unordered" | "checklist",
 *     items: [{ content: string(HTML), meta: { checked?: boolean }, items: [...] }],
 *     meta: { counterType: CounterType, start?: number }
 *   }
 */
interface ItemMeta {
  checked?: boolean;
}

interface ListItem {
  content: string;
  meta: ItemMeta;
  items: ListItem[];
}

interface ListMeta {
  counterType: CounterType;
  start?: number;
}

interface ListData extends BlockToolData {
  style: ListStyle;
  items: ListItem[];
  meta: ListMeta;
}

type ListStyle = "ordered" | "unordered" | "checklist";
type CounterType =
  | "numeric"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman"
  // Written by earlier versions of this tool; still accepted and saved
  // back unchanged.
  | "roman"
  | "alphabetic";

interface ListConfig {
  defaultStyle?: ListStyle;
  listStyles?: Array<{ name: ListStyle; title: string; icon: string }>;
  counterTypes?: Array<{ name: CounterType; title: string; icon?: string }>;
}

type MenuConfig = Exclude<ReturnType<NonNullable<BlockTool["renderSettings"]>>, HTMLElement>;

/** Number of nesting levels (top level included). Matches Word's 9-level
 *  limit closely enough while keeping deep levels readable on a page. */
export const MAX_LIST_DEPTH = 8;

const STYLES: readonly ListStyle[] = ["ordered", "unordered", "checklist"];

/** counterType → CSS list-style-type. Only values from this table ever
 *  reach the DOM. */
const COUNTER_CSS: Record<CounterType, string> = {
  numeric: "decimal",
  "lower-alpha": "lower-alpha",
  "upper-alpha": "upper-alpha",
  "lower-roman": "lower-roman",
  "upper-roman": "upper-roman",
  roman: "upper-roman",
  alphabetic: "lower-alpha",
};

/** Word's default multi-level cycle: 1. → a. → i. → 1. … */
const ORDERED_CYCLE = ["decimal", "lower-alpha", "lower-roman"] as const;
const BULLET_CYCLE = ["disc", "circle", "square"] as const;

const isStyle = (v: unknown): v is ListStyle =>
  typeof v === "string" && (STYLES as readonly string[]).includes(v);

const isCounterType = (v: unknown): v is CounterType =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(COUNTER_CSS, v);

const isStart = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1_000_000;

function normalizeItems(raw: unknown): ListItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => {
      const meta: ItemMeta = {};
      const rawMeta = r.meta as Record<string, unknown> | undefined;
      if (rawMeta && typeof rawMeta.checked === "boolean") meta.checked = rawMeta.checked;
      return {
        content: typeof r.content === "string" ? r.content : "",
        meta,
        items: normalizeItems(r.items),
      };
    });
}

function normalizeMeta(raw: unknown): ListMeta {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const meta: ListMeta = {
    counterType: isCounterType(m.counterType) ? m.counterType : "numeric",
  };
  if (isStart(m.start)) meta.start = m.start;
  return meta;
}

/** List-style-type for a nesting level (0 = top). */
export function markerFor(style: ListStyle, counterType: CounterType, level: number): string {
  if (style === "checklist") return "none";
  if (style === "unordered") return BULLET_CYCLE[level % BULLET_CYCLE.length]!;
  const base = COUNTER_CSS[counterType] ?? "decimal";
  if (level === 0) return base;
  // Continue the cycle from the base's family (upper variants map onto
  // their lower-case slot).
  const family = base.endsWith("alpha") ? 1 : base.endsWith("roman") ? 2 : 0;
  return ORDERED_CYCLE[(family + level) % ORDERED_CYCLE.length]!;
}

interface FlatEntry {
  item: ListItem;
  level: number;
}

function flatten(items: ListItem[], level = 0, out: FlatEntry[] = []): FlatEntry[] {
  for (const item of items) {
    out.push({ item, level });
    flatten(item.items, level + 1, out);
  }
  return out;
}

/** Rebuild a tree from a flat (Google-Docs-style) list of levels. A level
 *  that jumps more than one deeper than its predecessor is attached one
 *  level below it — a tree can't hold gaps. */
function unflatten(entries: FlatEntry[]): ListItem[] {
  const root: ListItem[] = [];
  const stack: ListItem[] = [];
  for (const { item, level } of entries) {
    const lvl = Math.max(0, Math.min(level, stack.length));
    stack.length = lvl;
    const parent = lvl === 0 ? root : stack[lvl - 1]!.items;
    item.items = [];
    parent.push(item);
    stack.push(item);
  }
  return root;
}

/**
 * Nestable list block (Word / Google Docs behaviour):
 *   - ordered / unordered / checklist styles; ordered lists take a
 *     `counterType` (level 0) that cycles 1 → a → i on deeper levels, plus
 *     an optional `start`; bullets cycle disc → circle → square
 *   - Tab / Shift+Tab indent / outdent the current item (one item only —
 *     the levels of the items around it don't change, as in Google Docs)
 *   - Enter splits the item at the caret; Enter on an empty nested item
 *     outdents it, on an empty top-level item exits the list
 *   - Backspace at the start of a nested item outdents it; on an empty
 *     top-level item it removes the item
 *   - style / numbering are switched from the block settings menu or
 *     declaratively via `blocks.update(id, { style, meta })`
 *
 * Markers come from CSS `list-style-type`, never from text in the content.
 */
export class ListTool implements BlockTool {
  private api: API;
  private readOnly: boolean;
  private block: BlockAPI | undefined;
  private data: ListData;
  private settings: Required<Omit<ListConfig, "defaultStyle">>;
  private wrapper: HTMLElement | null = null;
  /** <li> → model item, for meta lookups when saving from the DOM. */
  private itemsByLi = new WeakMap<Element, ListItem>();
  /** model item → its contentEditable, for caret placement after rerender. */
  private contentByItem = new Map<ListItem, HTMLElement>();

  static get toolbox() {
    return {
      title: "List",
      icon: '<svg width="17" height="13" viewBox="0 0 17 13" xmlns="http://www.w3.org/2000/svg"><path d="M5.625 4.85h9.25a1.125 1.125 0 0 1 0 2.25h-9.25a1.125 1.125 0 0 1 0-2.25zm0-4.85h9.25a1.125 1.125 0 0 1 0 2.25h-9.25a1.125 1.125 0 0 1 0-2.25zm0 9.85h9.25a1.125 1.125 0 0 1 0 2.25h-9.25a1.125 1.125 0 0 1 0-2.25zm-4.5-5a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25zm0-4.85a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25zm0 9.85a1.125 1.125 0 1 1 0 2.25 1.125 1.125 0 0 1 0-2.25z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  /**
   * Without this, EditorJS falls back to the inline tools' merged config
   * (no `a`, no `br`), so links and line breaks inside items are stripped
   * on save. The rule applies to every nested item's `content`.
   */
  static get sanitize() {
    return { items: BLOCK_INLINE_TAGS };
  }

  /**
   * `blocks.convert("paragraph" → "list")` goes through this config:
   * `import` feeds the paragraph's text in as `items` (a string, wrapped
   * into one item by the constructor); `export` flattens items to text.
   */
  static get conversionConfig() {
    return {
      import: "items",
      export: (data: ListData) =>
        flatten(Array.isArray(data.items) ? data.items : [])
          .map((e) => e.item.content)
          .join("\n"),
    };
  }

  static get pasteConfig(): { tags: string[] } {
    return { tags: ["OL", "UL", "LI"] };
  }

  constructor({
    data,
    config,
    api,
    readOnly,
    block,
  }: {
    data: ListData;
    config?: ListConfig;
    api: API;
    readOnly: boolean;
    block?: BlockAPI;
  }) {
    this.api = api;
    this.readOnly = readOnly;
    this.block = block;
    this.settings = {
      listStyles: config?.listStyles || [
        { name: "ordered", title: "Numbered", icon: "1." },
        { name: "unordered", title: "Bulleted", icon: "•" },
        { name: "checklist", title: "Checklist", icon: "☑" },
      ],
      counterTypes: config?.counterTypes || [
        { name: "numeric", title: "1, 2, 3", icon: "1." },
        { name: "lower-alpha", title: "a, b, c", icon: "a." },
        { name: "upper-alpha", title: "A, B, C", icon: "A." },
        { name: "lower-roman", title: "i, ii, iii", icon: "i." },
        { name: "upper-roman", title: "I, II, III", icon: "I." },
      ],
    };

    const raw = (data ?? {}) as unknown as Record<string, unknown>;
    // `blocks.convert()` hands us the paragraph's text as a string here
    // (see `conversionConfig.import`).
    const items =
      typeof raw.items === "string"
        ? raw.items.length > 0
          ? [{ content: raw.items, meta: {}, items: [] }]
          : []
        : normalizeItems(raw.items);

    this.data = {
      style: isStyle(raw.style)
        ? raw.style
        : isStyle(config?.defaultStyle)
          ? config!.defaultStyle!
          : "unordered",
      items,
      meta: normalizeMeta(raw.meta),
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("cdx-list-wrapper");
    // Seed with an empty item so a fresh / emptied list has somewhere to type.
    if (this.data.items.length === 0) {
      this.data.items.push(this.newItem());
    }
    wrapper.appendChild(this.renderList());
    this.wrapper = wrapper;
    return wrapper;
  }

  private renderList(): HTMLElement {
    this.contentByItem.clear();
    const list = this.renderLevel(this.data.items, 0);
    list.classList.add("cdx-list", `cdx-list--${this.data.style}`);
    if (this.data.style === "ordered" && this.data.meta.start !== undefined) {
      (list as HTMLOListElement).start = this.data.meta.start;
    }
    return list;
  }

  private renderLevel(items: ListItem[], level: number): HTMLElement {
    const list = document.createElement(this.data.style === "ordered" ? "ol" : "ul");
    if (level > 0) list.classList.add("cdx-list--nested");
    list.dataset.level = String(level);
    list.style.listStyleType = markerFor(this.data.style, this.data.meta.counterType, level);
    for (const item of items) list.appendChild(this.renderItem(item, level));
    return list;
  }

  private renderItem(item: ListItem, level: number): HTMLElement {
    const li = document.createElement("li");
    // `cdx-list__item` is what styles.css targets; `cdx-list-item` is ours.
    li.classList.add("cdx-list-item", "cdx-list__item");
    this.itemsByLi.set(li, item);

    if (this.data.style === "checklist") {
      const checked = item.meta.checked === true;
      item.meta.checked = checked;
      li.classList.toggle("cdx-list-item--checked", checked);
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "cdx-list-item__checkbox";
      box.setAttribute("contenteditable", "false");
      box.checked = checked;
      box.disabled = this.readOnly;
      box.tabIndex = -1;
      box.addEventListener("change", () => {
        item.meta.checked = box.checked;
        li.classList.toggle("cdx-list-item--checked", box.checked);
        this.notifyChange();
      });
      li.appendChild(box);
    }

    const content = document.createElement("div");
    content.classList.add("cdx-list-item__content");
    content.setAttribute("contenteditable", this.readOnly ? "false" : "true");
    content.innerHTML = item.content;
    this.contentByItem.set(item, content);
    if (!this.readOnly) {
      content.addEventListener("input", () => {
        item.content = content.innerHTML;
      });
      content.addEventListener("keydown", (e) => this.onKeydown(e, item, content, level));
    }
    li.appendChild(content);

    if (item.items.length > 0) li.appendChild(this.renderLevel(item.items, level + 1));
    return li;
  }

  /** Re-render the list element in place (the wrapper stays, so EditorJS
   *  and the pagination layer keep their references). */
  private rerender(focus?: { item: ListItem; offset: number | "end" }): void {
    const wrapper = this.wrapper;
    if (!wrapper) return;
    const fresh = this.renderList();
    const old = wrapper.querySelector(":scope > .cdx-list");
    if (old) wrapper.replaceChild(fresh, old);
    else wrapper.appendChild(fresh);
    if (focus) {
      const el = this.contentByItem.get(focus.item);
      if (el) placeCaret(el, focus.offset);
    }
  }

  private notifyChange(): void {
    this.block?.dispatchChange?.();
  }

  private newItem(): ListItem {
    return this.data.style === "checklist"
      ? { content: "", meta: { checked: false }, items: [] }
      : { content: "", meta: {}, items: [] };
  }

  // ── Keyboard ───────────────────────────────────────────────────────────

  private onKeydown(e: KeyboardEvent, item: ListItem, content: HTMLElement, level: number): void {
    if (e.isComposing) return;

    if (e.key === "Tab" && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      // Stop EditorJS's own Tab handling (toolbox / block navigation).
      e.stopPropagation();
      const offset = caretOffset(content);
      if (e.shiftKey) this.outdent(item, offset);
      else this.indent(item, offset);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      const empty = isEmpty(content);
      if (empty && level > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.outdent(item, 0);
        return;
      }
      if (empty) {
        // Top level: drop the empty item and let EditorJS's Enter handler
        // continue with a new paragraph below the list.
        this.syncFromDom();
        const idx = this.data.items.indexOf(item);
        if (idx >= 0) this.data.items.splice(idx, 1);
        if (this.data.items.length === 0) this.data.items.push(this.newItem());
        this.rerender();
        this.notifyChange();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.split(item, content);
      return;
    }

    if (e.key === "Backspace" && isCaretAtStart(content)) {
      if (level > 0) {
        e.preventDefault();
        e.stopPropagation();
        this.outdent(item, 0);
        return;
      }
      if (isEmpty(content)) {
        this.syncFromDom();
        const flat = flatten(this.data.items);
        const idx = flat.findIndex((f) => f.item === item);
        if (idx > 0) {
          e.preventDefault();
          e.stopPropagation();
          const prev = flat[idx - 1]!.item;
          flat.splice(idx, 1);
          this.data.items = unflatten(flat);
          this.rerender({ item: prev, offset: "end" });
          this.notifyChange();
        }
      }
    }
  }

  // ── Structural operations (public for the command layer / tests) ───────

  /** Tab: make the item the last child of its previous sibling. The item's
   *  own children keep their level (they become its following siblings). */
  indent(item: ListItem, caret: number | "end" = 0): boolean {
    this.syncFromDom();
    const flat = flatten(this.data.items);
    const idx = flat.findIndex((f) => f.item === item);
    if (idx <= 0) return false;
    const entry = flat[idx]!;
    // First among its siblings → nothing to nest under.
    if (flat[idx - 1]!.level < entry.level) return false;
    if (entry.level + 1 >= MAX_LIST_DEPTH) return false;
    entry.level += 1;
    this.data.items = unflatten(flat);
    this.rerender({ item, offset: caret });
    this.notifyChange();
    return true;
  }

  /** Shift+Tab: move the item up one level, right after its parent. The
   *  siblings that followed it become its children (Google Docs). */
  outdent(item: ListItem, caret: number | "end" = 0): boolean {
    this.syncFromDom();
    const flat = flatten(this.data.items);
    const idx = flat.findIndex((f) => f.item === item);
    if (idx < 0) return false;
    const entry = flat[idx]!;
    if (entry.level === 0) return false;
    entry.level -= 1;
    this.data.items = unflatten(flat);
    this.rerender({ item, offset: caret });
    this.notifyChange();
    return true;
  }

  /** Enter: split the item at the caret; the tail becomes a new item at the
   *  same level directly below. */
  private split(item: ListItem, content: HTMLElement): void {
    this.syncFromDom();
    const tail = extractAfterCaret(content);
    item.content = content.innerHTML;
    const next = this.newItem();
    next.content = tail;
    const flat = flatten(this.data.items);
    const idx = flat.findIndex((f) => f.item === item);
    if (idx < 0) return;
    flat.splice(idx + 1, 0, { item: next, level: flat[idx]!.level });
    this.data.items = unflatten(flat);
    this.rerender({ item: next, offset: 0 });
    this.notifyChange();
  }

  /** Pull edits the browser made directly in the DOM into the model,
   *  keeping item identities (and their meta) intact. */
  private syncFromDom(): void {
    const list = this.wrapper?.querySelector(":scope > .cdx-list");
    if (list) this.data.items = this.readItems(list, true);
  }

  private readItems(listEl: Element, keepIdentity: boolean): ListItem[] {
    return Array.from(listEl.querySelectorAll(":scope > li.cdx-list-item")).map((li) => {
      const known = this.itemsByLi.get(li);
      const content = li.querySelector(":scope > .cdx-list-item__content");
      const nested = li.querySelector(":scope > .cdx-list--nested");
      const meta: ItemMeta = {};
      if (known && typeof known.meta.checked === "boolean") meta.checked = known.meta.checked;
      if (this.data.style === "checklist") meta.checked = meta.checked === true;
      const html = content?.innerHTML ?? "";
      const children = nested ? this.readItems(nested, keepIdentity) : [];
      if (keepIdentity && known) {
        known.content = html;
        known.items = children;
        return known;
      }
      return { content: html, meta, items: children };
    });
  }

  // ── Settings ───────────────────────────────────────────────────────────

  /** Switch style / numbering in place (same as `blocks.update`, but keeps
   *  the block instance and caret). Invalid values are ignored. */
  setStyle(style: ListStyle): void {
    if (!isStyle(style) || style === this.data.style) return;
    this.syncFromDom();
    this.data.style = style;
    if (style === "checklist") {
      for (const { item } of flatten(this.data.items)) item.meta.checked = item.meta.checked === true;
    }
    this.rerender();
    this.notifyChange();
  }

  setCounterType(counterType: CounterType): void {
    if (!isCounterType(counterType)) return;
    this.syncFromDom();
    this.data.meta.counterType = counterType;
    this.rerender();
    this.notifyChange();
  }

  renderSettings(): MenuConfig {
    const styles = this.settings.listStyles.filter((s) => isStyle(s.name));
    const items: Exclude<MenuConfig, unknown[]>[] = styles.map((s) => ({
      icon: s.icon,
      title: s.title,
      isActive: this.data.style === s.name,
      closeOnActivate: true,
      onActivate: () => this.setStyle(s.name),
    }));
    if (this.data.style === "ordered") {
      for (const c of this.settings.counterTypes.filter((t) => isCounterType(t.name))) {
        items.push({
          icon: c.icon ?? "#",
          title: c.title,
          isActive: COUNTER_CSS[this.data.meta.counterType] === COUNTER_CSS[c.name],
          closeOnActivate: true,
          onActivate: () => this.setCounterType(c.name),
        });
      }
    }
    return items;
  }

  // ── Save / paste ───────────────────────────────────────────────────────

  save(blockContent?: HTMLElement): ListData {
    const root = blockContent ?? this.wrapper;
    const list = root?.querySelector(".cdx-list");
    const items = list ? this.readItems(list, false) : normalizeItems(this.data.items);
    const meta: ListMeta = { counterType: this.data.meta.counterType };
    if (this.data.meta.start !== undefined) meta.start = this.data.meta.start;
    return { style: this.data.style, items, meta };
  }

  onPaste(event: CustomEvent): void {
    const el = (event.detail as { data?: unknown })?.data;
    if (!(el instanceof HTMLElement)) return;
    const tag = el.tagName;
    if (tag === "OL") this.data.style = "ordered";
    else if (tag === "UL") this.data.style = "unordered";
    const parse = (listEl: Element): ListItem[] =>
      Array.from(listEl.children)
        .filter((c) => c.tagName === "LI")
        .map((li) => {
          const clone = li.cloneNode(true) as HTMLElement;
          const nested = Array.from(clone.children).filter((c) => c.tagName === "OL" || c.tagName === "UL");
          nested.forEach((n) => n.remove());
          const sub = Array.from(li.children).find((c) => c.tagName === "OL" || c.tagName === "UL");
          return {
            content: clone.innerHTML.trim(),
            meta: {},
            items: sub ? parse(sub) : [],
          };
        });
    this.data.items =
      tag === "LI" ? [{ content: el.innerHTML.trim(), meta: {}, items: [] }] : parse(el);
    if (this.wrapper) this.rerender();
  }
}

// ── Caret helpers ────────────────────────────────────────────────────────

function isEmpty(el: HTMLElement): boolean {
  return (el.textContent ?? "").trim() === "" && !el.querySelector("img");
}

function caretRange(el: HTMLElement): Range | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  return range;
}

/** Character offset of the caret within `el` (0 when it isn't inside). */
function caretOffset(el: HTMLElement): number {
  const range = caretRange(el);
  if (!range) return 0;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function isCaretAtStart(el: HTMLElement): boolean {
  const range = caretRange(el);
  if (!range || !range.collapsed) return false;
  return caretOffset(el) === 0;
}

/** Remove everything after the caret from `el` and return it as HTML. */
function extractAfterCaret(el: HTMLElement): string {
  const range = caretRange(el);
  if (!range) return "";
  const tail = document.createRange();
  tail.selectNodeContents(el);
  tail.setStart(range.endContainer, range.endOffset);
  const holder = document.createElement("div");
  holder.appendChild(tail.extractContents());
  // A split at the end leaves empty inline wrappers behind — drop them.
  return holder.textContent === "" && !holder.querySelector("img,br") ? "" : holder.innerHTML;
}

function placeCaret(el: HTMLElement, offset: number | "end"): void {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset === "end" ? Infinity : offset;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    last = n;
    if (remaining <= n.length) {
      range.setStart(n, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= n.length;
  }
  if (last) range.setStart(last, last.length);
  else range.setStart(el, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import type { MenuConfig } from "@editorjs/editorjs/types/tools";
import { getOutline, requestScrollToBlock, subscribeOutline, type OutlineEntry } from "../pagination/outline";

interface TocData {
  maxLevel: number;
  title: string;
}

/**
 * Table of contents. Entries are generated live from the document's
 * headings and their computed page numbers (published by the paginator) —
 * only the options are saved. The generated list is marked
 * `data-mutation-free` so EditorJS doesn't treat refreshes as edits.
 */
export class TocTool implements BlockTool {
  static get toolbox() {
    return {
      title: "Table of contents",
      icon: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M2 3h9v1.5H2zm0 4h11v1.5H2zm2 4h9v1.5H4zM14 3h1.5v1.5H14zm0 8h1.5v1.5H14z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  private data: TocData;
  private block?: BlockAPI;
  private wrapper: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor({ data, block }: BlockToolConstructorOptions & { api: API }) {
    const d = (data ?? {}) as Partial<TocData>;
    const level = Number(d.maxLevel);
    this.data = {
      maxLevel: Number.isInteger(level) && level >= 1 && level <= 4 ? level : 3,
      title: typeof d.title === "string" ? d.title.slice(0, 120) : "Contents",
    };
    this.block = block;
  }

  render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "tp-toc";
    wrapper.contentEditable = "false";
    wrapper.dataset.tpGenerated = "toc";
    wrapper.dataset.mutationFree = "true";
    const title = document.createElement("div");
    title.className = "tp-toc__title";
    title.textContent = this.data.title;
    const list = document.createElement("div");
    list.className = "tp-toc__list";
    list.setAttribute("role", "list");
    wrapper.append(title, list);
    this.wrapper = wrapper;
    this.list = list;
    this.fill(getOutline());
    this.unsubscribe = subscribeOutline((entries) => this.fill(entries));
    return wrapper;
  }

  renderSettings(): MenuConfig {
    return [1, 2, 3, 4].map((level) => ({
      title: `Show ${level} level${level > 1 ? "s" : ""}`,
      icon: `<span style="font-weight:600">${level}</span>`,
      toggle: "tp-toc-level",
      isActive: this.data.maxLevel === level,
      closeOnActivate: true,
      onActivate: () => {
        this.data.maxLevel = level;
        this.fill(getOutline());
        this.block?.dispatchChange();
      },
    }));
  }

  save(): TocData {
    return { ...this.data };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private fill(entries: OutlineEntry[]): void {
    const list = this.list;
    if (!list) return;
    const shown = entries.filter((e) => e.level <= this.data.maxLevel);
    list.replaceChildren(
      ...shown.map((e) => {
        const row = document.createElement("a");
        row.className = `tp-toc__entry tp-toc__entry--l${e.level}`;
        row.setAttribute("role", "listitem");
        row.href = "#";
        const text = document.createElement("span");
        text.className = "tp-toc__text";
        text.textContent = e.text;
        const leader = document.createElement("span");
        leader.className = "tp-toc__leader";
        const page = document.createElement("span");
        page.className = "tp-toc__page";
        page.textContent = String(e.page);
        row.append(text, leader, page);
        row.addEventListener("click", (ev) => {
          ev.preventDefault();
          requestScrollToBlock(e.blockId);
        });
        return row;
      }),
    );
    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tp-toc__empty";
      empty.textContent = "Add headings (Heading 1–4) and they'll appear here.";
      list.appendChild(empty);
    }
    if (this.wrapper) this.wrapper.dataset.entries = String(shown.length);
  }
}

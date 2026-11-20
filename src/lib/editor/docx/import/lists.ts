/**
 * Consecutive list paragraphs with the same numId → ONE list block, nested
 * by ilvl. Numbering follows Word's counters (numbering.next), so a list
 * continued after an interruption, or restarted by a startOverride, gets
 * the right `meta.start`.
 */

import type { EditorBlock } from "~/lib/api/documents";
import { block, type ImportContext } from "./context";

interface ListItem {
  content: string;
  meta: Record<string, unknown>;
  items: ListItem[];
}

interface OpenList {
  numId: string;
  style: "ordered" | "unordered";
  meta: { counterType: string; start?: number };
  items: ListItem[];
  /** levels[d] = the items array new depth-d items go into. */
  levels: ListItem[][];
}

export class ListBuilder {
  private open: OpenList | null = null;

  constructor(private ctx: ImportContext) {}

  add(numId: string, ilvl: number, html: string): EditorBlock | null {
    const number = this.ctx.numbering.next(numId, ilvl);
    let flushed: EditorBlock | null = null;
    if (this.open && this.open.numId !== numId) flushed = this.flush();
    if (!this.open) {
      const kind = this.ctx.numbering.kind(numId, 0);
      if (kind.approximated) {
        this.ctx.warnings.add(`List numbering "${kind.approximated}" was imported as 1, 2, 3.`);
      }
      const meta: OpenList["meta"] = { counterType: kind.counterType };
      if (kind.style === "ordered" && ilvl === 0 && number !== 1 && number >= 1) meta.start = number;
      const items: ListItem[] = [];
      this.open = { numId, style: kind.style, meta, items, levels: [items] };
    }
    const list = this.open;
    const depth = Math.min(ilvl, list.levels.length - 1);
    const item: ListItem = { content: html, meta: {}, items: [] };
    list.levels[depth]!.push(item);
    list.levels.length = depth + 1;
    list.levels.push(item.items);
    return flushed;
  }

  flush(): EditorBlock | null {
    const list = this.open;
    this.open = null;
    if (!list || list.items.length === 0) return null;
    return block(this.ctx, "list", { style: list.style, meta: list.meta, items: list.items });
  }
}

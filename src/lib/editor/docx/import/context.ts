/** State shared by the import modules for one import run. */

import type { EditorBlock } from "~/lib/api/documents";
import type { Watermark } from "../../pageSetup";
import type { Numbering } from "./numbering";
import type { DocxPackage, Rels } from "./package";
import type { ThemeFonts } from "./props";
import type { StyleTable } from "./styles";

/** The part being converted (relationships are per part). */
export interface PartScope {
  path: string;
  rels: Rels;
  kind: "body" | "header" | "footer" | "note" | "textbox";
}

export interface FieldFrame {
  instr: string;
  /** "instr" until w:fldChar separate, then "result". */
  phase: "instr" | "result";
  /** Decided at separate (or end): what to do with the result runs. */
  mode?: "atom" | "toc" | "link" | "keep" | "drop";
  link?: string | null;
}

export class Warnings {
  private seen = new Map<string, number>();
  add(msg: string): void {
    this.seen.set(msg, (this.seen.get(msg) ?? 0) + 1);
  }
  list(): string[] {
    return [...this.seen.entries()].map(([m, n]) => (n > 1 ? `${m} (${n}×)` : m));
  }
  has(msg: string): boolean {
    return this.seen.has(msg);
  }
}

export interface NoteRef {
  /** Editor footnote id ("fn3" / "en2"). */
  id: string;
  number: number;
  source: "footnote" | "endnote";
  wordId: string;
}

export interface ImportContext {
  pkg: DocxPackage;
  styles: StyleTable;
  numbering: Numbering;
  theme: ThemeFonts;
  warnings: Warnings;
  /** New block id. */
  newId(): string;
  /** Referenced notes in order of first reference. */
  notes: Map<string, NoteRef>;
  fields: FieldFrame[];
  /** Watermark found in a header. */
  watermark: Watermark | null;
  /** Image blocks waiting for their media part (filled in at the end, so
   *  the walkers stay synchronous and each part is read once). */
  imageJobs: Array<{ part: string; block: EditorBlock }>;
  /** Paragraphs converted (for yielding to the event loop). */
  paragraphCount: number;
  /** Content width of the current section in px (positions floats). */
  contentWidth: number;
  /** Resolves when the UI thread should get a turn. */
  maybeYield(): Promise<void>;
}

export function block(ctx: ImportContext, type: string, data: Record<string, unknown>, tunes?: Record<string, unknown>): EditorBlock {
  const b: EditorBlock = { id: ctx.newId(), type, data };
  if (tunes && Object.keys(tunes).length > 0) b.tunes = tunes;
  return b;
}

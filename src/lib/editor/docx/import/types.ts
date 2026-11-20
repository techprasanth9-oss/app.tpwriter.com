import type { EditorBlock, PageLayout } from "~/lib/api/documents";
import type { PageSetup } from "../../pageSetup";
import type { NamedStyle, StyleId } from "../../styles/namedStyles";

/**
 * Result of importing a .docx into this editor's model (Phase 5 importer).
 *
 * - `blocks` use the editor's block shapes exactly as the tools save them
 *   (paragraph/header/list/table/image/pageBreak/sectionBreak/toc/
 *   equation/textBox…), with paragraph formatting in `tunes.format`,
 *   inline formatting as sanitizer-safe HTML (<b>, <i>, <u>, <s>, <sup>,
 *   <sub>, <a href>, <span style="font-family|font-size|color|
 *   background-color">), footnote references as
 *   <sup class="tp-fn-ref" data-fn-id contenteditable="false">n</sup>
 *   and fields as <span class="tp-field" data-field contenteditable="false">.
 * - Section breaks follow the editor's convention: a `sectionBreak` block
 *   carries the layout of the section AFTER it; `defaultLayout` is the
 *   first section's. (Word's sectPr describes the section it ENDS.)
 * - `pageSetup` holds headers/footers (default/first/even), the
 *   differentFirstPage / differentOddEven flags, header/footer distances,
 *   page colour/border and footnote texts.
 * - `styles` are named-style overrides derived from styles.xml (only
 *   values the document actually sets).
 */
export interface ImportedDocument {
  blocks: EditorBlock[];
  defaultLayout: PageLayout;
  pageSetup: PageSetup;
  styles: Partial<Record<StyleId, Partial<NamedStyle>>>;
  /** docProps/core.xml dc:title, if present. */
  title?: string;
  /** Things that couldn't be imported faithfully (shown to the user). */
  warnings: string[];
}

export interface ImportLimits {
  /** Max compressed file size. */
  maxBytes: number;
  /** Max total uncompressed size declared by the zip. */
  maxUncompressedBytes: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxBytes: 25 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
};

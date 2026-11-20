/**
 * Declarative fidelity checks (see fixtures/docx/expectations.ts).
 *
 * Every check is "hard" (fails the fidelity test) unless `soft: true`
 * (reported only — use it for representation choices the importer may
 * legitimately make differently, e.g. warning wording). FIDELITY_STRICT=1
 * makes soft checks fail too.
 */
import type { PageLayout } from "~/lib/api/documents";
import type { FieldKind, HeaderFooterKind, PageBorder } from "../../pageSetup";
import type { StyleId } from "../../styles/namedStyles";

/** Exact number (±0.5) or an inclusive [min, max] range. */
export type Num = number | [number, number];

/** Where text / formatting is looked for. */
export type Scope = "body" | "headers" | "footers" | "footnotes" | "all";

export type TextPattern = string | RegExp;

interface Base {
  /** Report-only unless FIDELITY_STRICT=1. */
  soft?: boolean;
  /** Shown in the report next to the check. */
  note?: string;
}

export type Check = Base &
  (
    | {
        /** Number of top-level body blocks of a type. */
        kind: "blockCount";
        type: string;
        count: Num;
      }
    | {
        /** Blocks matching each step appear in this order (contiguous when `adjacent`). */
        kind: "sequence";
        steps: Array<{ type: string; text?: TextPattern }>;
        adjacent?: boolean;
      }
    | {
        /** Text occurs (in `count` blocks/stories when given, default ≥ 1). */
        kind: "text";
        text: TextPattern;
        scope?: Scope;
        count?: Num;
      }
    | {
        /** Text / raw HTML pattern must not occur anywhere in scope. */
        kind: "absent";
        pattern: TextPattern;
        scope?: Scope;
        /** Search the raw HTML / JSON instead of visible text. */
        raw?: boolean;
      }
    | ({
        /** Inline formatting of a text span (every character must match). */
        kind: "format";
        text: string;
        /** Text that immediately precedes `text` (disambiguates e.g. "2"). */
        prefix?: string;
        scope?: Scope;
      } & FormatExpect)
    | {
        kind: "heading";
        text: TextPattern;
        level: Num;
      }
    | {
        /** `tunes.format` of the block containing the text. */
        kind: "paragraph";
        text: TextPattern;
        type?: string;
        alignment?: "left" | "center" | "right" | "justify";
        indent?: Num;
        lineHeight?: Num;
        spaceBefore?: Num;
        spaceAfter?: Num;
        styleId?: string;
      }
    | {
        /** The block before the one containing `text` is of `type`. */
        kind: "blockBefore";
        text: TextPattern;
        type: string;
        /** Skip empty paragraphs when looking back. */
        skipEmpty?: boolean;
      }
    | {
        kind: "emptyParagraphs";
        count: Num;
      }
    | {
        /** A list block whose first item contains `firstItem`. */
        kind: "list";
        firstItem: TextPattern;
        style?: "ordered" | "unordered" | "checklist";
        counterType?: string;
        start?: number;
        /** Nesting depth (1 = flat). */
        depth?: Num;
        /** Total items, all levels. */
        items?: Num;
      }
    | {
        /** A table with a cell containing `contains`. */
        kind: "table";
        contains: TextPattern;
        rows?: Num;
        /** Logical grid columns (spans counted). */
        cols?: Num;
        /** Some cell spans this many columns / rows. */
        colSpan?: number;
        rowSpan?: number;
        headerRows?: number[];
        repeatHeader?: boolean;
        /** Relative column widths (normalised; ±0.03 each). */
        columnWidthRatios?: number[];
        /** Some cell / row has this background. */
        cellBackground?: string;
        /** Some cell has this vertical alignment (CSS: top|middle|bottom). */
        verticalAlign?: string;
        /** Text found anywhere inside the table (incl. nested content). */
        containsText?: string[];
      }
    | {
        /** An image block with this alt text. */
        kind: "image";
        alt: TextPattern;
        scope?: Scope;
        wrap?: Array<"inline" | "top-bottom" | "float-left" | "float-right">;
        widthPx?: Num;
        heightPx?: Num;
        /** Crop percentages. */
        crop?: Partial<Record<"top" | "right" | "bottom" | "left", Num>>;
      }
    | {
        kind: "sectionCount";
        count: Num;
      }
    | {
        /** Layout of section `section` (0 = defaultLayout). Margins px ±2. */
        kind: "layout";
        section: number;
        paperSize?: PageLayout["paperSize"];
        orientation?: PageLayout["orientation"];
        margins?: Partial<Record<"top" | "right" | "bottom" | "left", Num>>;
      }
    | {
        kind: "headerFooter";
        part: "headers" | "footers";
        variant: HeaderFooterKind;
        contains?: TextPattern;
        fields?: FieldKind[];
        hasImage?: boolean;
      }
    | {
        kind: "pageSetup";
        differentFirstPage?: boolean;
        differentOddEven?: boolean;
        headerDistance?: Num;
        footerDistance?: Num;
        pageColor?: string;
        pageBorder?: { style?: PageBorder["style"]; color?: string; width?: Num };
        watermarkText?: TextPattern;
      }
    | {
        kind: "footnotes";
        count?: Num;
        /** Footnote reference atoms in the body. */
        refs?: Num;
        contains?: TextPattern[];
      }
    | {
        kind: "toc";
        count?: Num;
        maxLevel?: number;
      }
    | {
        /** An equation block with all these LaTeX fragments. */
        kind: "equation";
        latexContains: string[];
        display?: boolean;
      }
    | {
        kind: "textBox";
        contains: TextPattern;
      }
    | {
        /** Named-style override derived from styles.xml. */
        kind: "style";
        id: StyleId;
        fontFamily?: TextPattern;
        fontSizePx?: Num;
        color?: string;
        italic?: boolean;
        bold?: boolean;
      }
    | {
        kind: "title";
        text: TextPattern;
      }
    | {
        kind: "warning";
        pattern: RegExp;
      }
  );

export interface FormatExpect {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  /** Text colour, hex. */
  color?: string;
  /** Background / highlight colour, hex. */
  background?: string;
  fontFamily?: TextPattern;
  fontSizePx?: Num;
  /** Link target (null = must not be a link). */
  href?: TextPattern | null;
}

export interface FixtureExpectation {
  /** What the fixture covers (shown in the report). */
  covers: string;
  checks: Check[];
}

export type Expectations = Record<string, FixtureExpectation>;

export interface CheckResult {
  check: Check;
  label: string;
  ok: boolean;
  soft: boolean;
  detail?: string;
}

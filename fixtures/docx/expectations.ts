/**
 * Structural expectations for the DOCX fidelity corpus.
 *
 * Written from what scripts/fixtures/build_docx_fixtures.py PUTS INTO each
 * fixture — never from importer output. Units follow the editor model:
 * px at 96 dpi (1in = 96px, 1pt = 4/3px), indent in 40px steps, colours
 * as #rrggbb. `soft: true` = representation choices the importer may make
 * differently (reported, not failed, unless FIDELITY_STRICT=1).
 */
import type { Check, Expectations } from "../../src/lib/editor/docx/fidelity/types";

const A4_1IN = { top: 96, right: 96, bottom: 96, left: 96 };
const firstSectionA4: Check = { kind: "layout", section: 0, paperSize: "A4", orientation: "portrait", margins: A4_1IN };

export const EXPECTATIONS: Expectations = {
  "01-basic-formatting": {
    covers: "bold/italic/underline/strike, colours, highlight + shading, fonts, sizes, sub/superscript, line breaks, hyperlinks (unsafe javascript: link dropped)",
    checks: [
      firstSectionA4,
      { kind: "title", text: "Basic formatting" },
      { kind: "blockCount", type: "paragraph", count: 7 },
      { kind: "format", text: "Bold text", bold: true, italic: false },
      { kind: "format", text: "italic text", italic: true, bold: false },
      { kind: "format", text: "underlined text", underline: true },
      { kind: "format", text: "struck text", strike: true },
      { kind: "format", text: ", ", prefix: "Bold text", bold: false, italic: false },
      { kind: "format", text: "Red words", color: "#ff0000" },
      { kind: "format", text: "blue words", color: "#1f4e79" },
      { kind: "format", text: "highlighted words", background: "#ffff00" },
      { kind: "format", text: "shaded words", background: "#d9e2f3" },
      { kind: "format", text: "Georgia font", fontFamily: /Georgia/ },
      { kind: "format", text: "Courier New font", fontFamily: /Courier New/ },
      { kind: "format", text: "eighteen point", fontSizePx: 24 },
      { kind: "format", text: "eight point", fontSizePx: [10.4, 10.9] },
      { kind: "format", text: "2", prefix: "Water is H", sub: true, sup: false },
      { kind: "format", text: "2", prefix: "E=mc", sup: true, sub: false },
      { kind: "format", text: "Bold italic red", bold: true, italic: true, color: "#c00000" },
      { kind: "text", text: "Line one\nLine two\nLine three", count: 1 },
      { kind: "format", text: "Example docs", href: "https://example.com/docs" },
      { kind: "format", text: "Email the team", href: /^mailto:team@example\.com$/ },
      { kind: "text", text: "Unsafe link", count: 1, note: "link text kept" },
      { kind: "format", text: "Unsafe link", href: null },
      { kind: "absent", pattern: /javascript:/i, raw: true },
    ],
  },

  "02-styles": {
    covers: "custom Normal font/size, Heading 1 colour/size, Title, Subtitle, Heading 1–5, Quote",
    checks: [
      { kind: "style", id: "normal", fontFamily: /Cambria/, fontSizePx: [14.5, 14.8] },
      { kind: "style", id: "heading1", color: "#2e74b5", fontSizePx: [26.5, 26.8] },
      { kind: "paragraph", text: "Document Title", styleId: "title" },
      { kind: "paragraph", text: "A subtitle for the document", styleId: "subtitle" },
      { kind: "heading", text: "Heading One Text", level: 1 },
      { kind: "heading", text: "Heading Two Text", level: 2 },
      { kind: "heading", text: "Heading Three Text", level: 3 },
      { kind: "heading", text: "Heading Four Text", level: 4 },
      { kind: "heading", text: "Heading Five Text", level: [4, 6], note: "editor styles stop at heading 4" },
      { kind: "warning", pattern: /heading\s*5|level\s*5|heading level/i, soft: true },
      { kind: "paragraph", text: "To be or not to be", styleId: "quote" },
      { kind: "blockCount", type: "header", count: 5 },
      { kind: "text", text: "Plain normal paragraph at the end.", count: 1 },
    ],
  },

  "02b-styles-localized": {
    covers: "localized style IDs (styleId \"berschrift1\" with name \"heading 1\", \"Titel\", \"Zitat\")",
    checks: [
      { kind: "heading", text: "Erste Ebene", level: 1 },
      { kind: "heading", text: "Zweite Ebene", level: 2 },
      { kind: "heading", text: "Dritte Ebene", level: 3 },
      { kind: "paragraph", text: "Lokaler Titel", styleId: "title" },
      { kind: "paragraph", text: "Ein Zitat steht hier.", styleId: "quote" },
      { kind: "blockCount", type: "header", count: 3 },
    ],
  },

  "03-paragraphs": {
    covers: "alignment incl. justify, left indents, first-line indent, spacing before/after, line spacing 1.5/2, empty paragraphs, pageBreakBefore",
    checks: [
      firstSectionA4,
      { kind: "paragraph", text: "Centered paragraph.", alignment: "center" },
      { kind: "paragraph", text: "Right aligned paragraph.", alignment: "right" },
      { kind: "paragraph", text: "Justified paragraph.", alignment: "justify" },
      { kind: "paragraph", text: "Left aligned paragraph.", alignment: "left" },
      { kind: "paragraph", text: "Indented half an inch.", indent: [1, 2] },
      { kind: "paragraph", text: "Indented one inch.", indent: [2, 3] },
      { kind: "paragraph", text: "Spaced paragraph", spaceBefore: 16, spaceAfter: 24 },
      { kind: "paragraph", text: "One and a half line spacing.", lineHeight: [1.4, 1.6] },
      { kind: "paragraph", text: "Double line spacing.", lineHeight: [1.9, 2.1] },
      { kind: "text", text: "First line indent.", count: 1 },
      { kind: "emptyParagraphs", count: [1, 2], soft: true, note: "Word keeps empty paragraphs as vertical space" },
      { kind: "blockBefore", text: "Starts on a new page via pageBreakBefore.", type: "pageBreak", skipEmpty: true },
    ],
  },

  "04-lists": {
    covers: "bullets with 3 nesting levels, decimal with nested level, lower/upper letter, lower/upper roman, startOverride restart at 5, two separate numbered lists",
    checks: [
      { kind: "blockCount", type: "list", count: 9 },
      { kind: "list", firstItem: "Apple", style: "unordered", depth: 3, items: 5 },
      { kind: "list", firstItem: "First step", style: "ordered", counterType: "numeric", start: 1, depth: 2, items: 4 },
      { kind: "list", firstItem: "alpha item", style: "ordered", counterType: "lower-alpha", items: 2 },
      { kind: "list", firstItem: "Upper A item", style: "ordered", counterType: "upper-alpha", items: 2 },
      { kind: "list", firstItem: "roman i item", style: "ordered", counterType: "lower-roman", items: 2 },
      { kind: "list", firstItem: "Roman I item", style: "ordered", counterType: "upper-roman", items: 2 },
      { kind: "list", firstItem: "Starts at five", style: "ordered", start: 5, items: 2 },
      { kind: "list", firstItem: "List A one", style: "ordered", start: 1, items: 2 },
      { kind: "list", firstItem: "List B one", style: "ordered", start: 1, items: 2 },
      { kind: "text", text: "Interlude paragraph between lists.", count: 1 },
      { kind: "absent", pattern: /^\s*(•|o|▪|\d+\.|[a-z]\)|[ivx]+\.)\s/m, scope: "body", note: "no literal bullet/number glyphs in item text" },
    ],
  },

  "05-tables": {
    covers: "header row repeat, horizontal + vertical merges, shading, borders, vertical alignment, column widths, nested table, 61-row table spanning pages",
    checks: [
      { kind: "blockCount", type: "table", count: [3, 4], note: "the nested table may be lifted out" },
      {
        kind: "table",
        contains: "Region",
        rows: 5,
        cols: 4,
        colSpan: 2,
        rowSpan: 2,
        headerRows: [0],
        repeatHeader: true,
        columnWidthRatios: [2, 3, 2, 2],
        cellBackground: "#1f4e79",
        containsText: ["South merged", "Spans two columns", "Centered", "Bottom", "Shaded cell"],
      },
      { kind: "table", contains: "Region", cellBackground: "#fff2cc" },
      { kind: "table", contains: "Centered", verticalAlign: "middle", soft: true },
      { kind: "table", contains: "Bottom", verticalAlign: "bottom", soft: true },
      { kind: "format", text: "Region", bold: true, color: "#ffffff" },
      { kind: "text", text: "South merged", count: 1 },
      { kind: "text", text: "Spans two columns", count: 1 },
      { kind: "table", contains: "Outer A", containsText: ["Outer B", "Outer C", "Outer D"] },
      { kind: "text", text: "Inner 1" },
      { kind: "text", text: "Inner 4" },
      { kind: "warning", pattern: /nested/i, soft: true },
      { kind: "table", contains: "Item 60", rows: 61, cols: 3, headerRows: [0], repeatHeader: true, columnWidthRatios: [1, 3, 1] },
    ],
  },

  "06-images": {
    covers: "inline image, square-wrapped floats left/right, cropped image (srcRect 25% each side), alt text",
    checks: [
      { kind: "blockCount", type: "image", count: 4 },
      { kind: "image", alt: "Inline blue banner", wrap: ["inline", "top-bottom"], widthPx: 192, heightPx: 96 },
      { kind: "image", alt: "Left floating square", wrap: ["float-left"], widthPx: 96, heightPx: 96 },
      { kind: "image", alt: "Right floating rectangle", wrap: ["float-right"], widthPx: 96, heightPx: 144 },
      { kind: "image", alt: "Cropped stripes", crop: { left: 25, right: 25 } },
      { kind: "text", text: "Text wraps to the right of the left-floating square.", count: 1 },
      { kind: "text", text: "Text wraps to the left of the right-floating rectangle.", count: 1 },
      { kind: "sequence", steps: [{ type: "image" }, { type: "paragraph", text: "Text wraps to the right" }], adjacent: true, note: "float precedes the text it wraps" },
    ],
  },

  "07-sections": {
    covers: "A4 portrait → A4 landscape (0.5in) → A4 portrait (1.25in) → US Letter (0.75in)",
    checks: [
      { kind: "sectionCount", count: 4 },
      { kind: "blockCount", type: "sectionBreak", count: 3 },
      firstSectionA4,
      { kind: "layout", section: 1, paperSize: "A4", orientation: "landscape", margins: { top: 48, right: 48, bottom: 48, left: 48 } },
      { kind: "layout", section: 2, paperSize: "A4", orientation: "portrait", margins: { top: 120, right: 120, bottom: 120, left: 120 } },
      { kind: "layout", section: 3, paperSize: "LETTER", orientation: "portrait", margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      {
        kind: "sequence",
        steps: [
          { type: "paragraph", text: "Section one" },
          { type: "sectionBreak" },
          { type: "paragraph", text: "Section two" },
          { type: "sectionBreak" },
          { type: "paragraph", text: "Section three" },
          { type: "sectionBreak" },
          { type: "paragraph", text: "Section four" },
        ],
      },
    ],
  },

  "08-headers-footers": {
    covers: "PAGE (complex field) of NUMPAGES (fldSimple), different first page, different odd/even, header image, DRAFT watermark",
    checks: [
      { kind: "pageSetup", differentFirstPage: true, differentOddEven: true },
      { kind: "pageSetup", headerDistance: 48, footerDistance: 48, soft: true },
      { kind: "headerFooter", part: "headers", variant: "default", contains: "Fidelity Corp — Confidential", hasImage: true },
      { kind: "image", alt: "Header logo", scope: "headers", widthPx: 24 },
      { kind: "headerFooter", part: "headers", variant: "first", contains: "First Page Header" },
      { kind: "headerFooter", part: "headers", variant: "even", contains: "Even Page Header" },
      { kind: "headerFooter", part: "footers", variant: "default", contains: /Page\s.*of/, fields: ["page", "pages"] },
      { kind: "headerFooter", part: "footers", variant: "first", contains: "First page footer" },
      { kind: "headerFooter", part: "footers", variant: "even", contains: "Even footer page", fields: ["page"] },
      { kind: "pageSetup", watermarkText: "DRAFT", soft: true },
      { kind: "absent", pattern: "DRAFT", scope: "body" },
      { kind: "absent", pattern: /Confidential|Page Header|footer/, scope: "body", note: "header/footer text stays out of the body" },
      { kind: "blockCount", type: "pageBreak", count: 3 },
    ],
  },

  "09-footnotes": {
    covers: "three footnotes, one with bold + italic runs; separator footnotes ignored",
    checks: [
      { kind: "footnotes", count: 3, refs: 3, contains: ["Source: annual survey 2025.", "Important: see appendix B.", "Third note in plain text."] },
      { kind: "format", text: "Important:", scope: "footnotes", bold: true },
      { kind: "format", text: "see appendix B", scope: "footnotes", italic: true, bold: false },
      { kind: "text", text: "Revenue grew twelve percent while margins widened.", scope: "body", count: 1 },
      { kind: "absent", pattern: "Source: annual survey", scope: "body" },
    ],
  },

  "10-toc": {
    covers: "TOC field (\\o \"1-3\") in a docPartGallery SDT with cached entries, headings 1–4",
    checks: [
      { kind: "toc", count: 1, maxLevel: 3 },
      { kind: "heading", text: "Introduction", level: 1 },
      { kind: "heading", text: "Background", level: 2 },
      { kind: "heading", text: "Details", level: 3 },
      { kind: "heading", text: "Deep detail not in TOC", level: 4 },
      { kind: "heading", text: "Conclusion", level: 1 },
      { kind: "text", text: "Introduction", scope: "body", count: 1, note: "cached TOC entries are not imported as text" },
      { kind: "text", text: "Background", scope: "body", count: 1 },
      { kind: "sequence", steps: [{ type: "toc" }, { type: "header", text: "Introduction" }] },
      { kind: "blockCount", type: "pageBreak", count: [2, 3] },
    ],
  },

  "11-breaks": {
    covers: "page break mid-paragraph, standalone page break, lastRenderedPageBreak (ignored), continuous section break",
    checks: [
      { kind: "blockCount", type: "pageBreak", count: 2 },
      {
        kind: "sequence",
        adjacent: true,
        steps: [
          { type: "paragraph", text: "Alpha before the break." },
          { type: "pageBreak" },
          { type: "paragraph", text: "Omega after the break." },
        ],
      },
      {
        kind: "sequence",
        steps: [{ type: "paragraph", text: "A standalone page break follows." }, { type: "pageBreak" }, { type: "paragraph", text: "After the standalone break." }],
      },
      { kind: "text", text: "Rendered break markers are ignored.", count: 1 },
      { kind: "text", text: "Continuous section content.", count: 1 },
      { kind: "warning", pattern: /continuous/i, soft: true },
    ],
  },

  "12-textbox-math": {
    covers: "DrawingML text box (with VML fallback), OMML display equation (fraction + n-ary sum + radical), inline OMML",
    checks: [
      { kind: "blockCount", type: "textBox", count: 1 },
      { kind: "textBox", contains: "text box content stays together" },
      { kind: "text", text: "text box content stays together", count: 1, note: "the VML fallback is not imported twice" },
      { kind: "format", text: "Important:", bold: true, soft: true },
      { kind: "equation", display: true, latexContains: ["\\frac", "\\sum", "\\sqrt"] },
      { kind: "equation", display: true, latexContains: ["i=1", "n"] },
      { kind: "text", text: /The area is[\s\S]*for a circle\./ },
      { kind: "equation", display: false, latexContains: ["^"], soft: true, note: "inline math as an inline equation" },
    ],
  },

  "13-page-design": {
    covers: "page colour (w:background) and a single dark-blue page border",
    checks: [
      { kind: "pageSetup", pageColor: "#fff2cc" },
      { kind: "pageSetup", pageBorder: { style: "solid", color: "#1f4e79", width: [1, 3] } },
      firstSectionA4,
    ],
  },

  "14-report": {
    covers: "realistic ~10-page report: title/subtitle, TOC field, headings, justified text, footnotes, lists, merged + long tables, floating image, equation, landscape section, quote, header + Page X of Y footer",
    checks: [
      { kind: "title", text: "Annual Fidelity Report 2026" },
      { kind: "paragraph", text: "Annual Fidelity Report 2026", styleId: "title" },
      { kind: "paragraph", text: "Prepared for the board of directors", styleId: "subtitle" },
      { kind: "toc", count: 1, maxLevel: 2 },
      ...(["Executive Summary", "Market Overview", "Financial Results", "Appendix A: Wide Data", "Outlook", "Conclusion"].map(
        (text): Check => ({ kind: "heading", text, level: 1 }),
      )),
      ...(["Regional Performance", "Competitive Landscape", "Detailed Figures", "Risks", "Opportunities"].map(
        (text): Check => ({ kind: "heading", text, level: 2 }),
      )),
      { kind: "blockCount", type: "header", count: 11 },
      { kind: "blockCount", type: "table", count: 3 },
      { kind: "table", contains: "Region", rows: 4, cols: 4, rowSpan: 2, headerRows: [0], repeatHeader: true, cellBackground: "#1f4e79" },
      { kind: "table", contains: "Account 25", rows: 26, cols: 3, headerRows: [0] },
      { kind: "table", contains: "Col 8", rows: 8, cols: 8 },
      { kind: "blockCount", type: "list", count: 3 },
      { kind: "list", firstItem: "Revenue up twelve percent", style: "unordered", items: 3 },
      { kind: "list", firstItem: "Reconcile accounts", style: "ordered", counterType: "numeric", depth: 2, items: 4 },
      { kind: "list", firstItem: "Supply chain delays", style: "unordered", items: 3 },
      { kind: "footnotes", count: 3, refs: 3, contains: ["Figures are unaudited.", "Growth measured year over year.", "Margin excludes one-off items."] },
      { kind: "image", alt: "Market share chart placeholder", wrap: ["float-right"], widthPx: 120 },
      { kind: "equation", display: true, latexContains: ["\\frac", "profit", "revenue"] },
      { kind: "sectionCount", count: 3 },
      firstSectionA4,
      { kind: "layout", section: 1, paperSize: "A4", orientation: "landscape", margins: { top: 72, right: 72, bottom: 72, left: 72 } },
      { kind: "layout", section: 2, paperSize: "A4", orientation: "portrait", margins: A4_1IN },
      { kind: "headerFooter", part: "headers", variant: "default", contains: "Annual Fidelity Report 2026" },
      { kind: "headerFooter", part: "footers", variant: "default", fields: ["page", "pages"] },
      { kind: "paragraph", text: "Success is not final", styleId: "quote" },
      { kind: "format", text: "key results", bold: true },
      { kind: "format", text: "risks and opportunities", italic: true },
      { kind: "absent", pattern: "Update the table of contents.", scope: "body", note: "cached TOC field result is not body text" },
    ],
  },
};

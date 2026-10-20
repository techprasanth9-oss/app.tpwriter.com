// @ts-nocheck
/**
 * DOCX → EditorJS blocks via a direct JSZip-based OOXML walker. Ported
 * from the eSigns parser; CLM / AI-mention / signature-field features
 * stripped. This parser understands:
 *   - paragraphs, headings (w:pStyle), lists (w:numPr → list block),
 *     tables (w:tbl), hyperlinks (via document.xml.rels), inline run
 *     formatting (fonts, colors, highlight, sz, b/i/u/strike), alignment,
 *     and indent (precise + coarse levels).
 *   - images from word/media/** and word/images/** inlined as base64
 *     data URLs; both inline (w:drawing/wp:inline) and anchored (wp:anchor)
 *     positioning.
 *   - headers (word/header*.xml) and footers (word/footer*.xml), including
 *     the sectPr-resolved "default" variant so overlapping even/odd/first
 *     page content isn't rendered multiple times.
 *   - page properties: paperSize + orientation + margins from w:sectPr →
 *     w:pgSz / w:pgMar on the section at the end of the body.
 *   - page breaks (w:br type="page", sectPr nextPage, pageBreakBefore)
 *     splitting the output into separate ParsedDocxPage entries.
 *   - underscore-run placeholders (___) → inline <mark> variable chips in
 *     the TP Writer attribute shape the sanitizers whitelist.
 *   - floating-anchor layout documents (title-page style) via the
 *     processFloatingDocumentLayout grouping pass.
 */

import JSZip from "jszip";

export interface EditorBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

export interface EditorOutput {
  time?: number;
  blocks: EditorBlock[];
  version?: string;
}

export interface ParsedDocxPage {
  blocks: EditorBlock[];
  layout?: {
    paperSize?: "A4" | "LETTER" | "LEGAL" | "A3" | "A5";
    orientation?: "portrait" | "landscape";
    marginTop?: number;
    marginRight?: number;
    marginBottom?: number;
    marginLeft?: number;
  };
}

export interface ParsedDocx {
  pages: ParsedDocxPage[];
  headerBlocks: EditorBlock[];
  footerBlocks: EditorBlock[];
  defaultLayout?: ParsedDocxPage["layout"];
}

interface EditorJSListItem {
  content: string;
  items?: EditorJSListItem[];
}

interface EditorJSList {
  type: "list";
  data: {
    style: "ordered" | "unordered";
    items: EditorJSListItem[];
  };
}

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DRAWING_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const MAIN_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PICTURE_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WPS_NS =
  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const EMU_PER_INCH = 914400;

// Inlined from the source project's formBuilderConstants.TABLE_STYLES.
// Keyed by Word's built-in tblStyle names. Looked up by processTable via
// TABLE_STYLES[tblStyleVal] || TABLE_STYLES["TableNormal"].
const TABLE_STYLES: any = {
  TableNormal: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #000000" },
    firstRow: { fontWeight: "normal", backgroundColor: "transparent", color: "inherit" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
  },
  PlainTable1: {
    table: { borderCollapse: "collapse", width: "100%", border: "none" },
    firstRow: { fontWeight: "bold", borderBottom: "1px solid #000000" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
  },
  PlainTable2: {
    table: { borderCollapse: "collapse", width: "100%", border: "none" },
    firstRow: { fontWeight: "bold", borderBottom: "2px solid #000000" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
  },
  PlainTable3: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #BFBFBF" },
    firstRow: { fontWeight: "bold", backgroundColor: "#F2F2F2", borderBottom: "1px solid #BFBFBF" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
  },
  GridTable1Light: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #BFBFBF" },
    firstRow: { fontWeight: "bold", backgroundColor: "#F2F2F2", borderBottom: "1px solid #BFBFBF" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
    cell: { border: "1px solid #BFBFBF" },
  },
  GridTable2: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #000000" },
    firstRow: { fontWeight: "bold", backgroundColor: "#D9D9D9", borderBottom: "1px solid #000000" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
    cell: { border: "1px solid #000000" },
  },
  GridTable3: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #000000" },
    firstRow: { fontWeight: "bold", backgroundColor: "#000000", color: "#FFFFFF", borderBottom: "1px solid #000000" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
    cell: { border: "1px solid #000000" },
  },
  LightShading: {
    table: { borderCollapse: "collapse", width: "100%", border: "none" },
    firstRow: { fontWeight: "bold", backgroundColor: "#F2F2F2", borderBottom: "1px solid #BFBFBF" },
    evenRow: { backgroundColor: "#F2F2F2" },
    oddRow: { backgroundColor: "transparent" },
  },
  LightList: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #BFBFBF" },
    firstRow: { fontWeight: "bold", backgroundColor: "#F2F2F2", borderBottom: "1px solid #BFBFBF" },
    evenRow: { backgroundColor: "#F2F2F2" },
    oddRow: { backgroundColor: "transparent" },
    cell: { border: "1px solid #BFBFBF" },
  },
  LightGrid: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #BFBFBF" },
    firstRow: { fontWeight: "bold", backgroundColor: "#F2F2F2", borderBottom: "1px solid #BFBFBF" },
    evenRow: { backgroundColor: "transparent" },
    oddRow: { backgroundColor: "transparent" },
    cell: { border: "1px solid #BFBFBF" },
  },
  "LightList-Accent1": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #4472C4", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#4472C4", color: "#FFFFFF", border: "1px solid #4472C4" },
    evenRow: { backgroundColor: "#D9E1F2" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #4472C4" },
  },
  "LightList-Accent2": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #ED7D31", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#ED7D31", color: "#FFFFFF", border: "1px solid #ED7D31" },
    evenRow: { backgroundColor: "#FBE5D6" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #ED7D31" },
  },
  "LightList-Accent3": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #A5A5A5", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#9BBB59", color: "#FFFFFF", border: "1px solid #A5A5A5" },
    evenRow: { backgroundColor: "#E8E8E8" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #A5A5A5" },
  },
  "LightList-Accent4": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #FFC000", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#FFC000", color: "#FFFFFF", border: "1px solid #FFC000" },
    evenRow: { backgroundColor: "#FFF2CC" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #FFC000" },
  },
  "LightList-Accent5": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #5B9BD5", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#5B9BD5", color: "#FFFFFF", border: "1px solid #5B9BD5" },
    evenRow: { backgroundColor: "#DDEBF7" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #5B9BD5" },
  },
  "LightList-Accent6": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #70AD47", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#70AD47", color: "#FFFFFF", border: "1px solid #70AD47" },
    evenRow: { backgroundColor: "#E2EFD9" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #70AD47" },
  },
  "MediumShading1-Accent1": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #4472C4", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#4472C4", color: "#FFFFFF", border: "1px solid #4472C4" },
    evenRow: { backgroundColor: "#B4C6E7" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #4472C4" },
  },
  "MediumShading2-Accent1": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #4472C4", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#4472C4", color: "#FFFFFF", border: "1px solid #FFFFFF" },
    evenRow: { backgroundColor: "#B4C6E7" },
    oddRow: { backgroundColor: "#D9E1F2" },
    cell: { border: "1px solid #4472C4" },
  },
  "DarkList-Accent1": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #2F528F", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#2F528F", color: "#FFFFFF", border: "1px solid #2F528F" },
    evenRow: { backgroundColor: "#8EA9DB" },
    oddRow: { backgroundColor: "#B4C6E7" },
    cell: { border: "1px solid #2F528F" },
  },
  Calendar1: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #BFBFBF", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#F2F2F2", borderBottom: "1px solid #BFBFBF" },
    evenRow: { backgroundColor: "#FFFFFF" },
    oddRow: { backgroundColor: "#F2F2F2" },
    cell: { border: "1px solid #BFBFBF", padding: "8px", textAlign: "center" },
  },
  Calendar2: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #4472C4", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#4472C4", color: "#FFFFFF", borderBottom: "1px solid #4472C4" },
    evenRow: { backgroundColor: "#FFFFFF" },
    oddRow: { backgroundColor: "#D9E1F2" },
    cell: { border: "1px solid #9BC2E6", padding: "8px", textAlign: "center" },
  },
  Calendar3: {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #70AD47", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#70AD47", color: "#FFFFFF", borderBottom: "1px solid #70AD47" },
    evenRow: { backgroundColor: "#FFFFFF" },
    oddRow: { backgroundColor: "#E2EFD9" },
    cell: { border: "1px solid #A9D08E", padding: "8px", textAlign: "center" },
  },
  "MediumShading2-Accent5": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #5B9BD5", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#5B9BD5", color: "#FFFFFF", border: "1px solid #FFFFFF" },
    evenRow: { backgroundColor: "#BDD7EE" },
    oddRow: { backgroundColor: "#DDEBF7" },
    cell: { border: "1px solid #5B9BD5" },
  },
  "MediumList1-Accent1": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #4472C4", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#4472C4", color: "#FFFFFF", border: "1px solid #4472C4" },
    evenRow: { backgroundColor: "#D9E1F2" },
    oddRow: { backgroundColor: "#FFFFFF" },
    cell: { border: "1px solid #9BC2E6" },
  },
  "MediumList2-Accent1": {
    table: { borderCollapse: "collapse", width: "100%", border: "1px solid #4472C4", fontFamily: "Arial, sans-serif" },
    firstRow: { fontWeight: "bold", backgroundColor: "#4472C4", color: "#FFFFFF", border: "1px solid #4472C4" },
    evenRow: { backgroundColor: "#B4C6E7" },
    oddRow: { backgroundColor: "#D9E1F2" },
    cell: { border: "1px solid #9BC2E6" },
  },
};

/**
 * Map from common Office / proprietary font names → cross-platform
 * fallback stack. Keeps the visual close to the original when the
 * exact font isn't installed on the reader's OS. Hand-picked for
 * pixel-level similarity (Palatino Linotype ≈ Book Antiqua, etc.).
 */
const OFFICE_FONT_FALLBACKS: Record<string, string[]> = {
  "book antiqua": ["Book Antiqua", "Palatino Linotype", "Palatino", "Georgia"],
  palatino: ["Palatino", "Palatino Linotype", "Book Antiqua", "Georgia"],
  "palatino linotype": ["Palatino Linotype", "Palatino", "Book Antiqua", "Georgia"],
  cambria: ["Cambria", "Georgia", "Times New Roman"],
  constantia: ["Constantia", "Georgia", "Times New Roman"],
  garamond: ["Garamond", "EB Garamond", "Georgia", "Times New Roman"],
  goudy: ["Goudy Old Style", "Georgia", "Times New Roman"],
  "goudy old style": ["Goudy Old Style", "Georgia", "Times New Roman"],
  baskerville: ["Baskerville", "Libre Baskerville", "Georgia", "Times New Roman"],
  didot: ["Didot", "Georgia", "Times New Roman"],
  calibri: ["Calibri", "Carlito", "Helvetica Neue", "Arial"],
  "calibri light": ["Calibri Light", "Calibri", "Carlito", "Helvetica Neue", "Arial"],
  "segoe ui": ["Segoe UI", "Helvetica Neue", "Arial"],
  candara: ["Candara", "Corbel", "Helvetica Neue", "Arial"],
  corbel: ["Corbel", "Candara", "Helvetica Neue", "Arial"],
  aptos: ["Aptos", "Calibri", "Helvetica Neue", "Arial"],
  tahoma: ["Tahoma", "Geneva", "Helvetica Neue", "Arial"],
  verdana: ["Verdana", "Geneva", "Helvetica Neue", "Arial"],
  helvetica: ["Helvetica", "Helvetica Neue", "Arial"],
  arial: ["Arial", "Helvetica Neue", "Helvetica"],
  consolas: ["Consolas", "Menlo", "Monaco", "Courier New"],
  "courier new": ["Courier New", "Courier", "Menlo", "Monaco"],
};

const quoteFontName = (name: string): string => {
  return /\s|[^\w-]/.test(name) ? `'${name}'` : name;
};

const expandOfficeFontStack = (fontName: string, generic: string): string => {
  const lookup = OFFICE_FONT_FALLBACKS[fontName.trim().toLowerCase()];
  const stack = lookup && lookup.length > 0 ? lookup : [fontName];
  const quoted = stack.map(quoteFontName);
  return `${quoted.join(", ")}, ${generic}`;
};

const processRelationships = async (
  relsXml: string | undefined,
): Promise<{ [key: string]: string }> => {
  const relationships: { [key: string]: string } = {};

  if (relsXml) {
    const relsDoc = new DOMParser().parseFromString(relsXml, "text/xml");
    const rels = relsDoc.getElementsByTagName("Relationship");
    for (const rel of Array.from(rels)) {
      const id = rel.getAttribute("Id");
      const target = rel.getAttribute("Target");
      if (id && target) {
        relationships[id] = target;
      }
    }
  }

  return relationships;
};

const hasColumnLayout = (paragraph: Element): boolean => {
  const hasImage =
    paragraph.getElementsByTagNameNS(WORD_NS, "drawing").length > 0;
  const hasTextBox =
    paragraph.getElementsByTagNameNS(WORD_NS, "txbxContent").length > 0;

  const alternateContents = paragraph.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "AlternateContent",
  );
  for (const altContent of Array.from(alternateContents)) {
    const choice = altContent.getElementsByTagNameNS(
      "http://schemas.openxmlformats.org/markup-compatibility/2006",
      "Choice",
    )[0];
    if (choice) {
      const drawings = choice.getElementsByTagNameNS(WORD_NS, "drawing");
      for (const drawing of Array.from(drawings)) {
        const anchor = drawing.getElementsByTagNameNS(DRAWING_NS, "anchor")[0];
        if (anchor) {
          const graphic = anchor.getElementsByTagNameNS(MAIN_NS, "graphic")[0];
          if (graphic) {
            const graphicData = graphic.getElementsByTagNameNS(
              MAIN_NS,
              "graphicData",
            )[0];
            if (
              graphicData &&
              graphicData.getAttribute("uri") ===
                "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            ) {
              const wps = graphicData.getElementsByTagNameNS(
                "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                "wsp",
              )[0];
              if (wps) {
                const txbx = wps.getElementsByTagNameNS(
                  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                  "txbx",
                )[0];
                if (txbx) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
  }

  // Direct-run text case: an inline picture immediately followed by
  // plain <w:t> text runs in the same paragraph (Word's default when
  // you drop a logo next to text without a text box). Without this,
  // the parser fell into the generic paragraph-by-paragraph branch
  // which emits the image and the text as SEPARATE blocks — the
  // editor then renders them stacked / side-by-side, breaking the
  // "logo on the left, title on the right" layout the author wrote.
  // Recursive descent is fine here: if there's a txbxContent branch
  // it already returned true above.
  const hasDirectText = (() => {
    const ts = paragraph.getElementsByTagNameNS(WORD_NS, "t");
    for (const t of Array.from(ts)) {
      if ((t.textContent || "").trim().length > 0) return true;
    }
    return false;
  })();
  return hasImage && (hasTextBox || hasDirectText);
};

const processContainerChildrenInOrder = async (
  container: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
): Promise<any[]> => {
  const MC_NS_LOCAL =
    "http://schemas.openxmlformats.org/markup-compatibility/2006";

  const expand = (el: Element): Element[] => {
    if (
      el.namespaceURI === MC_NS_LOCAL &&
      el.localName === "AlternateContent"
    ) {
      const choice = el.getElementsByTagNameNS(MC_NS_LOCAL, "Choice")[0];
      const fallback = el.getElementsByTagNameNS(MC_NS_LOCAL, "Fallback")[0];
      const source = choice || fallback;
      if (!source) return [];
      const out: Element[] = [];
      for (const c of Array.from(source.children)) out.push(...expand(c));
      return out;
    }
    if (
      el.namespaceURI === WORD_NS &&
      el.localName === "sdt" &&
      !isTOCSdt(el)
    ) {
      const content = getElementByTagNameNS(el, "sdtContent");
      if (!content) return [];
      const out: Element[] = [];
      for (const c of Array.from(content.children)) out.push(...expand(c));
      return out;
    }
    return [el];
  };

  const workList: Element[] = [];
  for (const child of Array.from(container.children)) {
    workList.push(...expand(child));
  }

  const blocks: any[] = [];
  for (const el of workList) {
    if (el.namespaceURI !== WORD_NS) continue;
    if (el.localName === "p") {
      const block = await processParagraph(el, relationships, images);
      if (block) {
        if (Array.isArray(block)) {
          for (const b of block) if (b) blocks.push(b);
        } else {
          blocks.push(block);
        }
      }
    } else if (el.localName === "tbl") {
      const block = await processTable(el, relationships, images);
      if (Array.isArray(block)) {
        for (const b of block) if (b) blocks.push(b);
      } else if (block) {
        blocks.push(block);
      }
    } else if (el.localName === "sdt") {
      // Only TOC sdts reach here (expand handled the rest). We render
      // TOCs as flat paragraphs in headers/footers — a TOC in a header
      // is rare but not impossible (e.g. a floating table-of-contents
      // sidebar on a title page).
      const tocBlocks = await processTOC(el, relationships, images);
      for (const b of tocBlocks) blocks.push(b);
    }
  }
  return blocks;
};

const parseHeadersAndFooters = async (
  zip: JSZip,
  images: { [key: string]: string },
) => {
  const headerBlocks: any[] = [];
  const footerBlocks: any[] = [];
  // Element-level properties (backgroundColor, etc.) for the header
  // and footer. Populated from the wsp shape solidFill in the DOCX
  // so the HeaderFooterProperties side-panel picks them up.
  const headerProperties: { [k: string]: any } = {};
  const footerProperties: { [k: string]: any } = {};

  const allRelationships: { [headerPath: string]: { [key: string]: string } } =
    {};

  // Word emits up to three headers (and three footers) per section
  // — for first / even / default page types. When the sender's
  // template has, say, header1=even + header2=default + header3=first
  // all with variations of the same content, concatenating them all
  // shows the header text 2-3 times. Read the document's sectPr +
  // document.xml.rels to figure out which physical header/footer
  // files back the "default" type (Word's fallback for every regular
  // page) and only process THOSE. Fall back to processing everything
  // if we can't resolve — safer to over-render than to lose content.
  const allowedHeaderPaths = new Set<string>();
  const allowedFooterPaths = new Set<string>();
  try {
    const docRelsXml = await zip
      .file("word/_rels/document.xml.rels")
      ?.async("text");
    const docXml = await zip.file("word/document.xml")?.async("text");
    if (docRelsXml && docXml) {
      const relDoc = new DOMParser().parseFromString(docRelsXml, "text/xml");
      const relIdToTarget: { [rid: string]: string } = {};
      for (const rel of Array.from(
        relDoc.getElementsByTagName("Relationship"),
      )) {
        const rid = rel.getAttribute("Id");
        const tgt = rel.getAttribute("Target");
        if (rid && tgt) relIdToTarget[rid] = tgt;
      }
      const bodyDoc = new DOMParser().parseFromString(docXml, "text/xml");
      const pickDefault = (tag: "headerReference" | "footerReference") => {
        // Some DOMParser implementations return null for
        // getAttributeNS on prefixed attrs even when the attr
        // exists — fall back to the raw prefixed name so we
        // don't silently drop to the "process first file"
        // fallback (which for the Prateek DOCX picks header1 =
        // faded watermark compass instead of header2 = sharp
        // colored logo).
        const attr = (el: Element, ns: string, local: string) =>
          el.getAttributeNS(ns, local) ||
          el.getAttribute(`w:${local}`) ||
          el.getAttribute(`r:${local}`) ||
          el.getAttribute(local) ||
          "";

        const refs = Array.from(bodyDoc.getElementsByTagNameNS(WORD_NS, tag));
        // Prefer the "default" type; if none, take the first ref.
        const defRef =
          refs.find((r) => attr(r, WORD_NS, "type") === "default") || refs[0];
        if (!defRef) return null;
        const rid = attr(defRef, RELATIONSHIP_NS, "id");
        return rid && relIdToTarget[rid]
          ? `word/${relIdToTarget[rid].replace(/^\/+/, "")}`
          : null;
      };
      const hp = pickDefault("headerReference");
      const fp = pickDefault("footerReference");
      if (hp) allowedHeaderPaths.add(hp);
      if (fp) allowedFooterPaths.add(fp);
    }
  } catch {
    /* fall through — parse every header/footer file if lookup fails */
  }

  for (const path in zip.files) {
    if (
      path.includes(".xml.rels") &&
      (path.includes("header") || path.includes("footer"))
    ) {
      try {
        const relsXml = await zip.file(path)?.async("text");
        if (!relsXml) continue;

        // Rel files live at `word/_rels/headerN.xml.rels` but the
        // header/footer they describe lives at `word/headerN.xml`.
        // Old code only stripped the `.rels` suffix, leaving
        // `word/_rels/headerN.xml` as the key. Every downstream
        // relationships lookup used the real header path and hit an
        // empty map — processDrawing then fell to substring
        // pattern-matching in the images map and picked the WRONG
        // image (e.g. rId1 pattern-matched `media/image1.png` even
        // when header2's rId1 points at image2). Now we strip
        // `_rels/` too so the key matches the header/footer path.
        const basePath = path
          .replace("/_rels/", "/")
          .replace(".xml.rels", ".xml");
        allRelationships[basePath] = {};

        const relsDoc = new DOMParser().parseFromString(relsXml, "text/xml");
        const rels = relsDoc.getElementsByTagName("Relationship");
        for (const rel of Array.from(rels)) {
          const id = rel.getAttribute("Id");
          const target = rel.getAttribute("Target");
          if (id && target) {
            allRelationships[basePath][id] = target;
            allRelationships[basePath][target] = id;
          }
        }
      } catch (error) {
        console.error(`Error processing relationships ${path}:`, error);
      }
    }
  }

  // Safety net for when sectPr parsing fell through (allowedHeaderPaths
  // is empty): don't process every header/footer, only ONE. Word emits
  // header1/2/3 for even/default/first page types with overlapping
  // content — processing all three duplicates every text run visible
  // on the page (e.g. "Information Classification - Internal" from
  // header1 + header3).
  //
  // Pick the LARGEST file as the fallback. Alphabetical order picked
  // header1.xml which for the Hallmark offer letter has only the
  // faded watermark image, while header2.xml (the "default" ref
  // sectPr points at) has the sharp logo + title. Size is a good
  // proxy for "most content" because meaningful header variants
  // carry more markup (drawings, text runs, styles) than a bare
  // odd/even-page mirror.
  const pickLargest = (paths: string[]): string | undefined => {
    let best: string | undefined;
    let bestSize = -1;
    for (const p of paths) {
      const f = zip.files[p] as any;
      const size = f?._data?.uncompressedSize ?? f?._data?.compressedSize ?? 0;
      if (size > bestSize) {
        bestSize = size;
        best = p;
      }
    }
    return best;
  };
  const headerFileNames = Object.keys(zip.files)
    .filter((p) => p.startsWith("word/header") && p.endsWith(".xml"))
    .sort();
  const footerFileNames = Object.keys(zip.files)
    .filter((p) => p.startsWith("word/footer") && p.endsWith(".xml"))
    .sort();
  const fallbackHeaderPath = pickLargest(headerFileNames) || headerFileNames[0];
  const fallbackFooterPath = pickLargest(footerFileNames) || footerFileNames[0];
  console.log("[DocxParser] header/footer picks", {
    sectPrHeader: [...allowedHeaderPaths],
    sectPrFooter: [...allowedFooterPaths],
    fallbackHeaderPath,
    fallbackFooterPath,
  });

  for (const path in zip.files) {
    if (path.startsWith("word/header") && path.endsWith(".xml")) {
      // Prefer the sectPr-resolved default header. If we couldn't
      // resolve it, fall back to processing ONE header file only
      // (not all of them) so we don't concatenate every page-type
      // variant.
      if (allowedHeaderPaths.size > 0) {
        if (!allowedHeaderPaths.has(path)) continue;
      } else if (path !== fallbackHeaderPath) {
        continue;
      }
      try {
        const headerXml = await zip.file(path)?.async("text");
        if (!headerXml) continue;

        const relationships = allRelationships[path] || {};

        for (const [relId, target] of Object.entries(relationships)) {
          if (
            relId.startsWith("rId") &&
            (target.includes("/media/") || target.includes("/images/"))
          ) {
            const imagePath = target.startsWith("/")
              ? `word${target}`
              : `word/${target}`;

            // Guard on the imagePath ONLY, not the relId. rIds are
            // file-scoped in DOCX — header1's rId1 and header2's
            // rId1 can point to completely different media files.
            // Guarding on the relId key would skip loading the
            // second file because the first file already claimed
            // the relId slot, leaving processDrawing to resolve
            // the wrong image. imagePath is the media/imageN.png
            // path from the rel target and is globally unique.
            if (!images[imagePath]) {
              try {
                const imageFile = zip.file(imagePath);
                if (imageFile) {
                  const imageData = await imageFile.async("base64");
                  const imageType =
                    imagePath.split(".").pop()?.toLowerCase() || "";
                  const mimeType = getMimeType(imageType);
                  if (mimeType) {
                    // Only stamp the relId slot when it's not
                    // already taken. Path key is authoritative
                    // for processDrawing's fixed relationship
                    // resolution.
                    if (!images[relId]) {
                      images[relId] = `data:${mimeType};base64,${imageData}`;
                    }
                    images[imagePath] = `data:${mimeType};base64,${imageData}`;
                  }
                }
              } catch (error) {
                console.error(
                  `Error loading header image ${imagePath}:`,
                  error,
                );
              }
            }
          }
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(headerXml, "text/xml");
        // Only iterate TOP-LEVEL <w:p> children of <w:hdr>. Using
        // getElementsByTagNameNS(...,"p") is recursive and would pull
        // in the nested paragraphs living inside every AlternateContent's
        // Choice (wps:txbx > txbxContent > w:p) AND Fallback
        // (v:textbox > txbxContent > w:p) — so a header with one
        // text box would emit the SAME text twice (once per branch).
        // Word emits both branches for every drawing on modern Office,
        // so this affects essentially every Word-authored template.
        const paragraphArray = Array.from(
          xmlDoc.documentElement.children,
        ).filter((el) => el.namespaceURI === WORD_NS && el.localName === "p");

        // Header's element-level backgroundColor lives on a wsp
        // shape's a:solidFill; lift it so the header renders with
        // the DOCX-authored fill AND the properties panel shows it.
        const hdrBg = extractShapeSolidFillColor(xmlDoc.documentElement);
        if (hdrBg && !headerProperties.backgroundColor) {
          headerProperties.backgroundColor = hdrBg;
        }

        let hasColumnInHeader = false;

        for (const paragraph of paragraphArray) {
          if (hasColumnLayout(paragraph)) {
            hasColumnInHeader = true;
            break;
          }
        }

        // The flex direct-extract branch only walks <w:p> children —
        // it drops any nested <w:tbl> entirely. Some header
        // templates (e.g. the Hallmark offer letter) put the whole
        // header inside a table: logo cell + title-and-address cell.
        // If we detect a table at the top level of the header, skip
        // the flex branch and fall through to processContainerChildren
        // InOrder which handles tables + paragraphs interleaved.
        const hasTableInHeader = Array.from(
          xmlDoc.documentElement.children,
        ).some((c) => c.namespaceURI === WORD_NS && c.localName === "tbl");
        if (hasTableInHeader) hasColumnInHeader = false;

        // Secondary column detection: anchored floating image in ONE
        // paragraph + text in a DIFFERENT paragraph (both siblings
        // inside <w:hdr>). Word renders these side-by-side because the
        // wp:anchor image floats independently of the text-paragraph
        // flow. Our sequential-render fallback used to stack them,
        // producing the "logo top-left, huge blank gap, text way
        // below" layout the operator flagged on the Q1 Tech header.
        //
        // Detect: at least one paragraph with a wp:anchor, at least
        // one paragraph with non-empty <w:t> text. Only used when the
        // primary hasColumnLayout(paragraph) check missed (image + text
        // are in separate paragraphs, not the same one).
        const hasAnchoredImage = paragraphArray.some(
          (p) => p.getElementsByTagNameNS(DRAWING_NS, "anchor").length > 0,
        );
        const hasSiblingText = paragraphArray.some((p) => {
          const ts = p.getElementsByTagNameNS(WORD_NS, "t");
          for (const t of Array.from(ts)) {
            if ((t.textContent || "").trim().length > 0) return true;
          }
          return false;
        });
        const hasAnchorSiblingLayout =
          !hasColumnInHeader &&
          !hasTableInHeader &&
          hasAnchoredImage &&
          hasSiblingText;

        if (hasColumnInHeader) {
          const leftColumnContent: any[] = [];
          const rightColumnContent: any[] = [];

          for (const paragraph of paragraphArray) {
            if (hasColumnLayout(paragraph)) {
              // ── Direct-extract pass ─────────────────────────────
              // Walk the paragraph's top-level runs once and pull
              // out exactly two things:
              //   1) the FIRST real picture (pic:pic inside a
              //      w:drawing whose graphicData uri is the
              //      picture uri, whose cNvPr name isn't a
              //      WordPictureWatermark). VML <w:pict> shapes
              //      are watermarks/legacy — we do NOT emit those
              //      here; they're painted as page background by
              //      extractDocumentBackgroundImage.
              //   2) all bare <w:t> text (concatenated) — the
              //      "Hallmark Global Technologies Ltd" title runs.
              //
              // No call to processParagraph — that path bleeds in
              // AlternateContent Fallback images (VML watermarks in
              // the same paragraph) which then get mistaken for the
              // header logo. Direct extraction is dead-simple and
              // doesn't have that surprise.
              let logoImageBlock: any = null;
              // Preserve per-run rPr styling (color, font, size, bold,
              // italic) — the DOCX header title is "Hallmark Global
              // Technologies Ltd" in Book Antiqua, size 40, colour
              // #0E61AF, bold. Emitting plain text loses all of that
              // and drops the header to default black.
              let titleHtml = "";
              const escape = (s: string) =>
                s
                  .replace(/&/g, "&amp;")
                  .replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;");
              const runToStyledSpan = (run: Element, text: string): string => {
                const rPr = Array.from(run.children).find(
                  (c) => c.namespaceURI === WORD_NS && c.localName === "rPr",
                );
                const styles: string[] = [];
                let bold = false;
                let italic = false;
                if (rPr) {
                  for (const p of Array.from(rPr.children)) {
                    if (p.namespaceURI !== WORD_NS) continue;
                    switch (p.localName) {
                      case "b":
                        bold = true;
                        break;
                      case "i":
                        italic = true;
                        break;
                      case "color": {
                        const v =
                          p.getAttributeNS(WORD_NS, "val") ||
                          p.getAttribute("w:val");
                        if (v && v !== "auto") styles.push(`color:#${v}`);
                        break;
                      }
                      case "sz": {
                        // w:sz is in half-points → CSS pt = val / 2
                        const v =
                          p.getAttributeNS(WORD_NS, "val") ||
                          p.getAttribute("w:val");
                        if (v) styles.push(`font-size:${parseInt(v) / 2}pt`);
                        break;
                      }
                      case "rFonts": {
                        const fn =
                          p.getAttributeNS(WORD_NS, "ascii") ||
                          p.getAttribute("w:ascii") ||
                          p.getAttributeNS(WORD_NS, "hAnsi") ||
                          p.getAttribute("w:hAnsi");
                        if (fn) {
                          // Mirror getTextStyles: add a generic
                          // fallback so unavailable fonts don't fall
                          // to the browser default (Times New Roman)
                          // when the source is sans-serif or mono.
                          const lower = fn.toLowerCase();
                          const isSerif =
                            /(times|antiqua|garamond|georgia|palatino|caslon|baskerville|cambria|constantia|didot|goudy|minion|serif)/i.test(
                              lower,
                            );
                          const isMono =
                            /(consolas|courier|monaco|menlo|inconsolata|source code|mono)/i.test(
                              lower,
                            );
                          const generic = isMono
                            ? "monospace"
                            : isSerif
                              ? "serif"
                              : "sans-serif";
                          styles.push(
                            `font-family:${expandOfficeFontStack(fn, generic)}`,
                          );
                        }
                        break;
                      }
                    }
                  }
                }
                let html = escape(text);
                if (bold) html = `<b>${html}</b>`;
                if (italic) html = `<i>${html}</i>`;
                return styles.length > 0
                  ? `<span style="${styles.join(";")}">${html}</span>`
                  : html;
              };
              const topRuns = Array.from(paragraph.children).filter(
                (c) => c.namespaceURI === WORD_NS && c.localName === "r",
              );
              for (const run of topRuns) {
                if (!logoImageBlock) {
                  const drawings = Array.from(run.children).filter(
                    (c) =>
                      c.namespaceURI === WORD_NS && c.localName === "drawing",
                  );
                  for (const drawing of drawings) {
                    const gd = drawing.getElementsByTagNameNS(
                      MAIN_NS,
                      "graphicData",
                    )[0];
                    const uri = gd?.getAttribute("uri") || "";
                    if (!uri.includes("/picture")) continue;
                    const nvPr = drawing.getElementsByTagNameNS(
                      PICTURE_NS,
                      "cNvPr",
                    )[0];
                    const picName = nvPr?.getAttribute("name") || "";
                    if (/WordPictureWatermark/i.test(picName)) continue;
                    const block = await processDrawing(
                      drawing,
                      relationships,
                      images,
                      paragraph,
                    );
                    if (block) {
                      logoImageBlock = block;
                      break;
                    }
                  }
                }
                // Concatenate every bare <w:t> child of this run,
                // wrapping in a styled span so the run's colour /
                // font / size / bold survives. Skip drawings and
                // AlternateContent — those are structural.
                for (const child of Array.from(run.children)) {
                  if (
                    child.namespaceURI === WORD_NS &&
                    child.localName === "t"
                  ) {
                    const t = child.textContent || "";
                    if (t) titleHtml += runToStyledSpan(run, t);
                  }
                }
              }
              // Text-box (wsp/txbx) content lift. DOC → DOCX converters
              // (and Word itself for classification-labelled headers)
              // sometimes wrap the title + address in a
              // <mc:AlternateContent><mc:Choice><w:drawing>…wsp…
              // <w:txbxContent><w:p>…</w:p></w:txbxContent></wsp>…
              // structure. The top-run <w:t> loop above misses that
              // because the text lives inside the wsp descendant.
              // Iterate every txbxContent descendant of this paragraph
              // and lift its paragraph-level text (with styling) into
              // the right column so the printed header shows the
              // title + address lines instead of just the URL below
              // the logo.
              const txbxContents = paragraph.getElementsByTagNameNS(
                WORD_NS,
                "txbxContent",
              );
              // Pull the paragraph-level justification (w:jc) so the
              // centred DOCX address lines don't render left-aligned.
              // Also convert w:br → <br> and drop w:tab (used by Word
              // to fake centring inside left-aligned text boxes; if
              // we render tabs as literal whitespace we get the
              // "…Floor        Near" gap the user reported).
              const jcVal = (p: Element): string | undefined => {
                const pPr = Array.from(p.children).find(
                  (c) => c.namespaceURI === WORD_NS && c.localName === "pPr",
                );
                if (!pPr) return undefined;
                const jc = Array.from(pPr.children).find(
                  (c) => c.namespaceURI === WORD_NS && c.localName === "jc",
                );
                if (!jc) return undefined;
                const v =
                  jc.getAttributeNS(WORD_NS, "val") ||
                  jc.getAttribute("w:val") ||
                  jc.getAttribute("val");
                if (!v) return undefined;
                if (v === "both") return "justify";
                if (["left", "right", "center"].includes(v)) return v;
                return undefined;
              };
              for (const txbx of Array.from(txbxContents)) {
                const innerParas = Array.from(txbx.children).filter(
                  (c) => c.namespaceURI === WORD_NS && c.localName === "p",
                );
                for (const p of innerParas) {
                  let lineHtml = "";
                  const innerRuns = Array.from(p.children).filter(
                    (c) => c.namespaceURI === WORD_NS && c.localName === "r",
                  );
                  for (const r of innerRuns) {
                    for (const child of Array.from(r.children)) {
                      if (child.namespaceURI !== WORD_NS) continue;
                      if (child.localName === "t") {
                        const t = child.textContent || "";
                        if (t) lineHtml += runToStyledSpan(r, t);
                      } else if (child.localName === "br") {
                        lineHtml += "<br>";
                      }
                      // w:tab intentionally skipped — Word uses tabs
                      // to justify text inside a text box, but our
                      // block-level paragraph has its own text-align
                      // now, so rendering the tab as whitespace
                      // produces the weird "gap in the middle" the
                      // user saw.
                    }
                  }
                  if (lineHtml.trim()) {
                    // Text-box paragraphs in a header are almost
                    // always centred in Word (that's the corporate-
                    // letterhead default). DOC→DOCX converters
                    // frequently strip the <w:jc w:val="center"/>
                    // pPr, so if we can't read an explicit
                    // justification we fall back to center — matches
                    // the visual intent of every header letterhead
                    // we've seen. jcVal still wins when explicit.
                    const align = jcVal(p) || "center";
                    rightColumnContent.push({
                      type: "paragraph",
                      data: {
                        text: `<div style="text-align:${align}">${lineHtml}</div>`,
                      },
                    });
                  }
                }
              }
              if (logoImageBlock) leftColumnContent.push(logoImageBlock);
              if (titleHtml.trim()) {
                rightColumnContent.push({
                  type: "paragraph",
                  data: { text: titleHtml },
                });
              }
              console.log("[DocxParser:header] direct-extract", path, {
                hasLogo: !!logoImageBlock,
                logoUrlSample: (logoImageBlock?.data?.url || "").slice(0, 40),
                titleHtml: titleHtml.slice(0, 120),
              });
              // Skip the run-by-run drawing loop below — the direct
              // extract handled logo + title. Continue to the next
              // paragraph in the header.
              continue;
              /* eslint-disable-next-line no-unreachable */
              const runs = paragraph.getElementsByTagNameNS(WORD_NS, "r");
              let processedImage = false;

              for (const run of Array.from(runs)) {
                const drawings = run.getElementsByTagNameNS(WORD_NS, "drawing");
                if (drawings.length > 0 && !processedImage) {
                  for (const drawing of Array.from(drawings)) {
                    const gd = drawing.getElementsByTagNameNS(
                      MAIN_NS,
                      "graphicData",
                    )[0];
                    const uri = gd?.getAttribute("uri") || "";
                    if (uri && !uri.includes("/picture")) continue;
                    const imageBlock = await processDrawing(
                      drawing,
                      relationships,
                      images,
                      paragraph,
                    );
                    if (imageBlock) {
                      leftColumnContent.push(imageBlock);
                      processedImage = true;
                    }
                  }
                }

                const alternateContents = run.getElementsByTagNameNS(
                  "http://schemas.openxmlformats.org/markup-compatibility/2006",
                  "AlternateContent",
                );
                if (alternateContents.length > 0) {
                  for (const altContent of Array.from(alternateContents)) {
                    const choice = altContent.getElementsByTagNameNS(
                      "http://schemas.openxmlformats.org/markup-compatibility/2006",
                      "Choice",
                    )[0];
                    if (choice) {
                      const drawings = choice.getElementsByTagNameNS(
                        WORD_NS,
                        "drawing",
                      );
                      for (const drawing of Array.from(drawings)) {
                        const anchor = drawing.getElementsByTagNameNS(
                          DRAWING_NS,
                          "anchor",
                        )[0];
                        if (anchor) {
                          const graphic = anchor.getElementsByTagNameNS(
                            MAIN_NS,
                            "graphic",
                          )[0];
                          if (graphic) {
                            const graphicData = graphic.getElementsByTagNameNS(
                              MAIN_NS,
                              "graphicData",
                            )[0];
                            if (
                              graphicData &&
                              graphicData.getAttribute("uri") ===
                                "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
                            ) {
                              const wps = graphicData.getElementsByTagNameNS(
                                "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                                "wsp",
                              )[0];
                              if (wps) {
                                const txbx = wps.getElementsByTagNameNS(
                                  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                                  "txbx",
                                )[0];
                                if (txbx) {
                                  const txbxContent =
                                    txbx.getElementsByTagNameNS(
                                      WORD_NS,
                                      "txbxContent",
                                    )[0];
                                  if (txbxContent) {
                                    const textParagraphs =
                                      txbxContent.getElementsByTagNameNS(
                                        WORD_NS,
                                        "p",
                                      );
                                    for (const textPara of Array.from(
                                      textParagraphs,
                                    )) {
                                      const block = await processParagraph(
                                        textPara,
                                        relationships,
                                        images,
                                      );
                                      if (block) {
                                        if (Array.isArray(block)) {
                                          rightColumnContent.push(
                                            ...block.filter((b) => b),
                                          );
                                        } else {
                                          rightColumnContent.push(block);
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            } else {
              const block = await processParagraph(
                paragraph,
                relationships,
                images,
                true,
              );
              if (block) {
                if (Array.isArray(block)) {
                  leftColumnContent.push(...block.filter((b) => b));
                } else {
                  leftColumnContent.push(block);
                }
              }
            }
          }

          if (leftColumnContent.length > 0 || rightColumnContent.length > 0) {
            // Two-cell hidden-border table: [logo/URL stack | title/address stack].
            // Each cell renders its blocks stacked (block-flow) so a
            // logo + URL in the left column show as [logo] over [URL],
            // and the right column's title over 3 address lines
            // stacks vertically too. Previously everything was
            // merged into ONE flex row with `nowrap` which shoved
            // the URL right of the logo and the address to the right
            // of the title on the same horizontal line.
            const imagesFirst = (blocks: any[]) => {
              const imgs = blocks.filter((b) => b?.type === "image");
              const rest = blocks.filter((b) => b?.type !== "image");
              const seen = new Set<string>();
              const dedupedRest = rest.filter((b) => {
                const key = (b?.data?.text || "").replace(/\s+/g, " ").trim();
                if (!key) return true;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              return [...imgs, ...dedupedRest];
            };
            const stackHtml = (blocks: any[]) => {
              if (blocks.length === 0) return "";
              // Wrap each block's HTML in its own <div> so
              // consecutive plain-text paragraphs don't
              // concatenate into one flowing line. blockToHtml
              // returns raw text for paragraph blocks (no <p>
              // wrapper), so without this the title + 3 address
              // lines all render as one inline stream inside the
              // cell — which is what the sender complained about.
              // Images stay unwrapped so their inline-block sizing
              // survives; only text-like blocks get the row wrap.
              const inner = imagesFirst(blocks)
                .map((b) => {
                  const raw = blockToHtml(b);
                  if (!raw) return "";
                  if (b?.type === "image") return raw;
                  return `<div>${raw}</div>`;
                })
                .join("");
              return `<div style="display:block;line-height:1.35;word-wrap:break-word;">${inner}</div>`;
            };
            const leftHtml = stackHtml(leftColumnContent);
            const rightHtml = stackHtml(rightColumnContent);
            if (leftHtml && rightHtml) {
              // Logo column narrow, text column wide. Matches the
              // typical corporate-letterhead ratio where the mark
              // sits in ~20% of the header band and the title +
              // address occupies the rest.
              headerBlocks.push(
                createHiddenBorderTable([[leftHtml, rightHtml]], [22, 78]),
              );
            } else {
              headerBlocks.push(
                createHiddenBorderTable([[leftHtml || rightHtml]]),
              );
            }
          }
        } else if (hasAnchorSiblingLayout) {
          // Anchored image + sibling text pattern — route each paragraph
          // by content type, drop empty spacers, render as a 2-column
          // hidden-border table so the two visually align.
          //
          // Side routing: for a paragraph carrying a wp:anchor image,
          // read positionH.posOffset — negative or small offsets mean
          // the image sits on the left of the page. For a text
          // paragraph, read its pPr/jc alignment — jc="right" pins it
          // right, otherwise left. When both land on the same side,
          // fall back to "image=left, text=right" (the classic
          // corporate-header pattern the operator is authoring).
          const anchorSide = (
            paragraph: Element,
          ): "left" | "right" | null => {
            const anchors = paragraph.getElementsByTagNameNS(
              DRAWING_NS,
              "anchor",
            );
            if (!anchors.length) return null;
            const posH = anchors[0].getElementsByTagNameNS(
              DRAWING_NS,
              "positionH",
            )[0];
            if (!posH) return "left";
            const align = posH
              .getElementsByTagNameNS(DRAWING_NS, "align")[0]
              ?.textContent?.trim()
              .toLowerCase();
            if (align === "right") return "right";
            if (align === "left") return "left";
            const off = posH.getElementsByTagNameNS(DRAWING_NS, "posOffset")[0];
            if (off) {
              const val = parseInt(off.textContent || "0", 10);
              return val > 3600000 ? "right" : "left";
            }
            return "left";
          };
          const textSide = (paragraph: Element): "left" | "right" => {
            const pPr = Array.from(paragraph.children).find(
              (c) => c.namespaceURI === WORD_NS && c.localName === "pPr",
            );
            if (!pPr) return "left";
            const jc = Array.from(pPr.children).find(
              (c) => c.namespaceURI === WORD_NS && c.localName === "jc",
            );
            const val = jc?.getAttribute("w:val") || jc?.getAttribute("val");
            return val === "right" ? "right" : "left";
          };

          const leftHtmlParts: string[] = [];
          const rightHtmlParts: string[] = [];
          let sawImage = false;
          let sawText = false;

          for (const paragraph of paragraphArray) {
            const side = anchorSide(paragraph);
            if (side !== null) {
              // Image-carrying paragraph. Run processParagraph so the
              // pic:pic → <img> conversion (with EMU-derived
              // dimensions) is handled centrally.
              const block = await processParagraph(
                paragraph,
                relationships,
                images,
              );
              const html = blockToHtml(block);
              if (html) {
                sawImage = true;
                (side === "right" ? rightHtmlParts : leftHtmlParts).push(html);
              }
              continue;
            }
            // Text paragraph (or an empty spacer — filter empties).
            const ts = paragraph.getElementsByTagNameNS(WORD_NS, "t");
            let hasText = false;
            for (const t of Array.from(ts)) {
              if ((t.textContent || "").trim().length > 0) {
                hasText = true;
                break;
              }
            }
            if (!hasText) continue;
            const block = await processParagraph(
              paragraph,
              relationships,
              images,
            );
            const html = blockToHtml(block);
            if (!html) continue;
            sawText = true;
            const side2 = textSide(paragraph);
            // Ambiguity resolver: if image already took left and text
            // isn't explicitly right-aligned, still route text to
            // right — the corporate-letterhead intent Word encodes
            // via anchored logo + trailing paragraphs.
            const target =
              side2 === "right" || (sawImage && leftHtmlParts.length > 0)
                ? rightHtmlParts
                : leftHtmlParts;
            target.push(html);
          }

          // Right cell inherits the source paragraph's jc="right"
          // alignment via text-align, otherwise the text lands at
          // the LEFT of the right column (~22% of page) instead of
          // the FAR RIGHT (~100%) that the original DOCX renders.
          // Left cell stays default-aligned so anchored images sit
          // flush against the page edge.
          const wrap = (parts: string[], align?: "left" | "right") => {
            if (parts.length === 0) return "";
            const alignStyle = align === "right" ? "text-align:right;" : "";
            return `<div style="display:block;line-height:1.35;word-wrap:break-word;${alignStyle}">${parts.map((p) => `<div>${p}</div>`).join("")}</div>`;
          };
          const leftHtml = wrap(leftHtmlParts);
          const rightHtml = wrap(rightHtmlParts, "right");
          if (sawImage && sawText && leftHtml && rightHtml) {
            headerBlocks.push(
              createHiddenBorderTable([[leftHtml, rightHtml]], [22, 78]),
            );
          } else if (leftHtml || rightHtml) {
            headerBlocks.push(
              createHiddenBorderTable([[leftHtml || rightHtml]]),
            );
          }
        } else {
          const allBlocks = await processContainerChildrenInOrder(
            xmlDoc.documentElement,
            relationships,
            images,
          );
          const processedBlocks = processLists(allBlocks);
          headerBlocks.push(...processedBlocks);
        }
      } catch (error) {
        console.error(`Error processing header ${path}:`, error);
      }
    }
  }

  for (const path in zip.files) {
    if (path.startsWith("word/footer") && path.endsWith(".xml")) {
      if (allowedFooterPaths.size > 0) {
        if (!allowedFooterPaths.has(path)) continue;
      } else if (path !== fallbackFooterPath) {
        continue;
      }
      try {
        const footerXml = await zip.file(path)?.async("text");
        if (!footerXml) continue;

        const relationships = allRelationships[path] || {};

        for (const [relId, target] of Object.entries(relationships)) {
          if (
            relId.startsWith("rId") &&
            (target.includes("/media/") || target.includes("/images/"))
          ) {
            const imagePath = target.startsWith("/")
              ? `word${target}`
              : `word/${target}`;

            if (!images[relId] && !images[imagePath]) {
              try {
                const imageFile = zip.file(imagePath);
                if (imageFile) {
                  const imageData = await imageFile.async("base64");
                  const imageType =
                    imagePath.split(".").pop()?.toLowerCase() || "";
                  const mimeType = getMimeType(imageType);
                  if (mimeType) {
                    images[relId] = `data:${mimeType};base64,${imageData}`;
                    images[imagePath] = `data:${mimeType};base64,${imageData}`;
                  }
                }
              } catch (error) {
                console.error(
                  `Error loading footer image ${imagePath}:`,
                  error,
                );
              }
            }
          }
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(footerXml, "text/xml");

        // Top-level <w:p> only — see the matching comment in the
        // header branch. Recursing here pulls the same textbox
        // paragraph out of both Choice and Fallback and prints it
        // twice ("Internal Use OnlyInternal Use Only").
        const paragraphArray = Array.from(
          xmlDoc.documentElement.children,
        ).filter((el) => el.namespaceURI === WORD_NS && el.localName === "p");

        // Footer's element-level backgroundColor lives on a wsp
        // shape's a:solidFill (Prateek's offer letter puts the
        // blue band there). Lift it so the HeaderFooterProperties
        // side panel reflects the DOCX bg without setting it on
        // each individual block/table.
        const ftrBg = extractShapeSolidFillColor(xmlDoc.documentElement);
        if (ftrBg && !footerProperties.backgroundColor) {
          footerProperties.backgroundColor = ftrBg;
        }

        // Read horizontal side ("left" | "right") from a
        // <wp:anchor>'s positionH. Word footers with icon+text
        // pairs (location-pin + address on one side, globe +
        // website URL on the other) rely on posOffset / align to
        // place each anchor. Without honouring position, we end
        // up piling every image on the left and every textbox on
        // the right — losing the pairing. Threshold half of A4
        // width in EMU (~3,600,000) as a rough center.
        const HALF_PAGE_EMU = 3600000;
        const getAnchorSide = (anchor: Element): "left" | "right" => {
          const posH = anchor.getElementsByTagNameNS(
            DRAWING_NS,
            "positionH",
          )[0];
          if (!posH) return "left";
          const align = posH.getElementsByTagNameNS(DRAWING_NS, "align")[0];
          const alignText = align?.textContent?.trim().toLowerCase();
          if (alignText === "right") return "right";
          if (alignText === "left") return "left";
          const off = posH.getElementsByTagNameNS(DRAWING_NS, "posOffset")[0];
          if (off) {
            const val = parseInt(off.textContent || "0", 10);
            return val > HALF_PAGE_EMU ? "right" : "left";
          }
          return "left";
        };

        let hasColumnInFooter = false;
        for (const paragraph of paragraphArray) {
          if (hasColumnLayout(paragraph)) {
            hasColumnInFooter = true;
            break;
          }
        }

        // Same guard as the header: if the footer wraps its content
        // in a nested <w:tbl>, skip the flex direct-extract (which
        // only iterates <w:p>) and let processContainerChildrenInOrder
        // render the table properly.
        const hasTableInFooter = Array.from(
          xmlDoc.documentElement.children,
        ).some((c) => c.namespaceURI === WORD_NS && c.localName === "tbl");
        if (hasTableInFooter) hasColumnInFooter = false;

        if (hasColumnInFooter) {
          const leftColumnContent: any[] = [];
          const rightColumnContent: any[] = [];

          for (const paragraph of paragraphArray) {
            if (hasColumnLayout(paragraph)) {
              // Word often puts the image/textbox at the start of a
              // paragraph that ALSO carries direct <w:t> text runs
              // (e.g. header2 has an Image 1 drawing followed by
              // "Hallmark Global Technologies Ltd" as bare runs).
              // The column-layout loop below only pulls drawings +
              // wsp:txbx content, so it used to silently drop the
              // bare text. Run processParagraph first (with
              // skipTextBoxes=true so we don't double-emit the
              // textbox content we're about to extract into
              // rightColumnContent) and prepend anything text-only
              // it returns to the left column.
              const bareTextBlock = await processParagraph(
                paragraph,
                relationships,
                images,
                true,
              );
              if (bareTextBlock) {
                const arr = Array.isArray(bareTextBlock)
                  ? bareTextBlock
                  : [bareTextBlock];
                for (const b of arr) {
                  // Skip image blocks — the drawing-extraction loop
                  // below already picks up drawings from runs. Only
                  // graft the text-only paragraph output here. Put
                  // the title/text into the RIGHT column so the
                  // image sits on the left and the title reads to
                  // its right, matching the DOCX visual layout.
                  if (b && b.type !== "image") rightColumnContent.push(b);
                }
              }

              // Helper that routes a block into left OR right column
              // based on the anchor's horizontal position.
              const routeToSide = (block: any, anchor: Element | null) => {
                const side = anchor ? getAnchorSide(anchor) : "left";
                const target =
                  side === "right" ? rightColumnContent : leftColumnContent;
                if (!block) return;
                if (Array.isArray(block)) {
                  for (const b of block) if (b) target.push(b);
                } else {
                  target.push(block);
                }
              };

              const runs = paragraph.getElementsByTagNameNS(WORD_NS, "r");

              for (const run of Array.from(runs)) {
                // Inline drawings (both images and shapes) — route by
                // the wp:anchor positionH so icon+text pairs stay
                // together on the same side.
                const drawings = run.getElementsByTagNameNS(WORD_NS, "drawing");
                for (const drawing of Array.from(drawings)) {
                  const anchor = drawing.getElementsByTagNameNS(
                    DRAWING_NS,
                    "anchor",
                  )[0];
                  const imageBlock = await processDrawing(
                    drawing,
                    relationships,
                    images,
                    paragraph,
                  );
                  if (imageBlock) routeToSide(imageBlock, anchor);
                }

                // AlternateContent's Choice branch — typically holds
                // a wsp text-box drawing OR a wsp shape.
                const alternateContents = run.getElementsByTagNameNS(
                  "http://schemas.openxmlformats.org/markup-compatibility/2006",
                  "AlternateContent",
                );
                for (const altContent of Array.from(alternateContents)) {
                  const choice = altContent.getElementsByTagNameNS(
                    "http://schemas.openxmlformats.org/markup-compatibility/2006",
                    "Choice",
                  )[0];
                  if (!choice) continue;
                  const choiceDrawings = choice.getElementsByTagNameNS(
                    WORD_NS,
                    "drawing",
                  );
                  for (const drawing of Array.from(choiceDrawings)) {
                    const anchor = drawing.getElementsByTagNameNS(
                      DRAWING_NS,
                      "anchor",
                    )[0];
                    if (!anchor) continue;
                    const graphic = anchor.getElementsByTagNameNS(
                      MAIN_NS,
                      "graphic",
                    )[0];
                    const graphicData = graphic?.getElementsByTagNameNS(
                      MAIN_NS,
                      "graphicData",
                    )[0];
                    if (
                      graphicData &&
                      graphicData.getAttribute("uri") ===
                        "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
                    ) {
                      const wps = graphicData.getElementsByTagNameNS(
                        "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                        "wsp",
                      )[0];
                      const txbx = wps?.getElementsByTagNameNS(
                        "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
                        "txbx",
                      )[0];
                      const txbxContent = txbx?.getElementsByTagNameNS(
                        WORD_NS,
                        "txbxContent",
                      )[0];
                      if (txbxContent) {
                        const textParagraphs =
                          txbxContent.getElementsByTagNameNS(WORD_NS, "p");
                        for (const textPara of Array.from(textParagraphs)) {
                          const block = await processParagraph(
                            textPara,
                            relationships,
                            images,
                          );
                          if (block) routeToSide(block, anchor);
                        }
                      }
                    }
                  }
                }
              }
            } else {
              const block = await processParagraph(
                paragraph,
                relationships,
                images,
              );
              if (block) {
                if (Array.isArray(block)) {
                  leftColumnContent.push(...block.filter((b) => b));
                } else {
                  leftColumnContent.push(block);
                }
              }
            }
          }

          if (leftColumnContent.length > 0 || rightColumnContent.length > 0) {
            // Icon + text pairs need to sit side-by-side (globe |
            // www.hgtechinc.net), not stack. Three things make
            // that work:
            //   1) Sort each column's blocks so images come FIRST.
            //      Word writes the textbox anchor before the icon
            //      drawing in run order, so a naive concat renders
            //      "text on top, icon below"; images-first gives
            //      the visual [icon][text] pairing.
            //   2) De-dupe text blocks with the same rendered
            //      content — Word's wsp Choice + Fallback branches
            //      often round-trip the same string, which our
            //      per-anchor extraction would otherwise emit
            //      twice on the same side.
            //   3) Wrap the concatenated HTML in a flex container
            //      so image + text share the row instead of the
            //      text taking a full-width block on its own line.
            const imagesFirst = (blocks: any[]) => {
              const imgs = blocks.filter((b) => b?.type === "image");
              const rest = blocks.filter((b) => b?.type !== "image");
              const seen = new Set<string>();
              const dedupedRest = rest.filter((b) => {
                const key = (b?.data?.text || "").replace(/\s+/g, " ").trim();
                if (!key) return true;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              return [...imgs, ...dedupedRest];
            };
            const flexWrap = (html: string) =>
              html
                ? `<div style="display:flex;align-items:center;gap:10px;flex-wrap:nowrap;">${html}</div>`
                : "";
            const leftHtml = flexWrap(
              imagesFirst(leftColumnContent).map(blockToHtml).join(""),
            );
            const rightHtml = flexWrap(
              imagesFirst(rightColumnContent).map(blockToHtml).join(""),
            );
            const cols = rightHtml ? [[leftHtml, rightHtml]] : [[leftHtml]];
            // Address text typically fills most of the footer band,
            // with the website URL sitting to the right. Match the
            // DOCX visual by giving the left column ~65% width.
            // Background color for the footer is applied at the
            // element/properties level (HeaderFooterProperties panel),
            // not on the table itself — see footerProperties above.
            const footerColWidths = rightHtml ? [65, 35] : undefined;
            footerBlocks.push(createHiddenBorderTable(cols, footerColWidths));
          }
        } else {
          // Same document-order + no-recursive-descent fix as the
          // header branch — see the comment there for why.
          const allBlocks = await processContainerChildrenInOrder(
            xmlDoc.documentElement,
            relationships,
            images,
          );
          const processedBlocks = processLists(allBlocks);
          footerBlocks.push(...processedBlocks);
        }
      } catch (error) {
        console.error(`Error processing footer ${path}:`, error);
      }
    }
  }

  return { headerBlocks, footerBlocks, headerProperties, footerProperties };
};
function findAncestorByLocalName(
  el: Element,
  localName: string,
): Element | null {
  let parent: Element | null = el.parentElement;
  while (parent) {
    if (parent.localName === localName) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function genDocxId(): string {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 9)
  );
}

/**
 * Renders a text watermark onto an HTML5 Canvas and returns a transparent PNG
 * data URL with the rotation already baked in.
 */
function textWatermarkToDataUrl(text: string, rotation: number): string {
  try {
    const canvas = document.createElement("canvas");
    const SIZE = 800;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Auto-scale font so text fills ~65% of canvas width
    let fontSize = 120;
    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    const measured = ctx.measureText(text.toUpperCase()).width;
    if (measured > 0) {
      fontSize = Math.round(fontSize * ((SIZE * 0.65) / measured));
      fontSize = Math.max(40, Math.min(220, fontSize));
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    }

    // Darker than the previous #808080. When combined with the
    // CSS-level 0.85 opacity on the watermark layer, this reads as
    // Word's typical mid-grey stamp instead of a nearly-invisible
    // ghost. #4a4a4a * 0.85 ≈ visible on light backgrounds without
    // obscuring body text.
    ctx.fillStyle = "#4a4a4a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.fillText(text.toUpperCase(), 0, 0);
    ctx.restore();

    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

/**
 * Extracts page-level background and watermark data from a DOCX zip.
 * Returns an array of pageProperties fields (backgroundImage and/or watermark)
 * in the same format used by PagePropertiesDropDown / RenderPagePropertiesFields.
 */
async function extractDocxPageProperties(
  zip: JSZip,
  documentXml: string,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
): Promise<any[]> {
  const pageProps: any[] = [];
  const parser = new DOMParser();

  // ── 1. Document-level background image (<w:background r:id="..."/>) ─────
  const xmlDoc = parser.parseFromString(documentXml, "text/xml");
  const bgEls = xmlDoc.getElementsByTagNameNS(WORD_NS, "background");
  if (bgEls.length > 0) {
    const bg = bgEls[0];
    const rId =
      bg.getAttributeNS(RELATIONSHIP_NS, "id") || bg.getAttribute("r:id");
    if (rId && relationships[rId]) {
      const target = relationships[rId];
      const imgPath = target.startsWith("/")
        ? `word${target}`
        : `word/${target}`;
      const imgData = images[imgPath] || images[rId];
      if (imgData) {
        const id = genDocxId();
        pageProps.push({
          fieldName: `backgroundImage-${id}`,
          fieldType: "backgroundImage",
          fieldId: id,
          properties: {
            placeholder: "Upload Image",
            required: false,
            label: "BackgroundImage",
            value: "",
            opacity: 1,
            imageUrl: imgData,
            croppedValue: imgData,
            originalUrl: imgData,
            rotation: 0,
            imageSize: "cover",
            borderRadius: 0,
            applyToAllPages: true,
          },
          position: { x: 0, y: 0, width: 1, height: 1 },
        });
      }
    }
  }

  // ── 2. Watermarks in header XMLs ─────────────────────────────────────────
  // DOCX watermarks live in headers as either:
  //   a) VML <v:textpath string="CONFIDENTIAL"/> (text watermark)
  //   b) VML <v:imagedata r:id="..."/> (image watermark)
  for (const path in zip.files) {
    if (!path.startsWith("word/header") || !path.endsWith(".xml")) continue;

    const headerXml = await zip.file(path)?.async("text");
    if (!headerXml) continue;

    // Load header-specific relationships
    const relsPath = `word/_rels/${path.replace("word/", "")}.rels`;
    const relsXml = await zip.file(relsPath)?.async("text");
    const headerRels: { [key: string]: string } = {};
    if (relsXml) {
      const relsDoc = parser.parseFromString(relsXml, "text/xml");
      for (const rel of Array.from(
        relsDoc.getElementsByTagName("Relationship"),
      )) {
        const rid = rel.getAttribute("Id");
        const tgt = rel.getAttribute("Target");
        if (rid && tgt) headerRels[rid] = tgt;
      }
    }

    const headerDoc = parser.parseFromString(headerXml, "text/xml");
    const allEls = Array.from(headerDoc.getElementsByTagName("*"));

    let found = false;

    // a) VML text watermark: <v:textpath string="..."/>
    for (const el of allEls) {
      if (el.localName !== "textpath") continue;
      const text = el.getAttribute("string") || el.getAttribute("v:string");
      if (!text?.trim()) continue;

      // Get rotation from the parent <v:shape> style attribute.
      // VML stores rotation as clockwise degrees (e.g. 315 = -45°).
      // CSS rotate() is also clockwise, so we just normalise to [-180, 180].
      const shape = findAncestorByLocalName(el, "shape");
      const style = shape?.getAttribute("style") ?? "";
      const rotMatch = style.match(/rotation:\s*(-?[\d.]+)/);
      let rotation = -45; // default diagonal
      if (rotMatch) {
        rotation = parseFloat(rotMatch[1]);
        if (rotation > 180) rotation -= 360; // 315 → -45
      }

      // Bake rotation into the canvas PNG so the existing image renderer works
      const wmImageUrl = textWatermarkToDataUrl(text.trim(), rotation);
      const id = genDocxId();
      pageProps.push({
        fieldName: `watermark-${id}`,
        fieldType: "watermark",
        fieldId: id,
        properties: {
          placeholder: "Enter watermark",
          required: false,
          label: "Watermark",
          value: text.trim(),
          // Word paints watermarks at ~50% grey behind the body text.
          // 0.6 was still fading behind light backgrounds — 0.85
          // reads clearly as a watermark stamp without obscuring
          // content (paired with the canvas fill in
          // textWatermarkToDataUrl for text watermarks).
          opacity: 0.85,
          imageUrl: wmImageUrl,
          croppedValue: wmImageUrl,
          originalUrl: wmImageUrl,
          rotation: 0, // rotation already baked into the canvas image
          repeat: false,
          imageSize: "contain",
          applyToAllPages: true,
        },
        position: { x: 0, y: 0, width: 1, height: 1 },
      });
      found = true;
      break;
    }

    // b) VML image watermark: <v:imagedata r:id="..."/>
    // Word's <v:shape id="WordPictureWatermark…"> is the built-in
    // picture-watermark; it's typically anchored behindDoc as a
    // faint page background. We used to skip these to avoid
    // "drowning out" the header text — but that also lost the
    // watermark on body pages, which is legitimate DOCX content.
    // Now that the header column-layout renders the actual title
    // text on top, we let the watermark through unchanged.
    if (!found) {
      for (const el of allEls) {
        if (el.localName !== "imagedata") continue;

        const rId =
          el.getAttribute("r:id") || el.getAttributeNS(RELATIONSHIP_NS, "id");
        if (!rId || !headerRels[rId]) continue;

        const tgt = headerRels[rId];
        const imgPath = tgt.startsWith("/") ? `word${tgt}` : `word/${tgt}`;
        const imgData = images[imgPath] || images[rId];
        if (!imgData) continue;

        const id = genDocxId();
        pageProps.push({
          fieldName: `watermark-${id}`,
          fieldType: "watermark",
          fieldId: id,
          properties: {
            placeholder: "Enter watermark",
            required: false,
            label: "Watermark",
            value: "",
            // See text-watermark branch above — 0.85 keeps the mark
            // clearly visible without overpowering body content.
            opacity: 0.85,
            imageUrl: imgData,
            croppedValue: imgData,
            originalUrl: imgData,
            rotation: 0,
            repeat: false,
            imageSize: "contain",
            applyToAllPages: true,
          },
          position: { x: 0, y: 0, width: 1, height: 1 },
        });
        found = true;
        break;
      }
    }

    if (found) break; // Use the first header that has a watermark
  }

  return pageProps;
}
async function processTOC(
  sdtNode: Element,
  relationships: any,
  images: any,
): Promise<any[]> {
  const galleryEls = sdtNode.getElementsByTagNameNS(WORD_NS, "docPartGallery");
  if (galleryEls.length > 0) {
    const galleryVal = galleryEls[0].getAttribute("w:val");
    if (galleryVal && galleryVal.toLowerCase().includes("table of contents")) {
      const tocEntries: any[] = [];
      const paragraphs = sdtNode.getElementsByTagNameNS(WORD_NS, "p");
      for (const p of Array.from(paragraphs)) {
        const block = await processParagraph(p, relationships, images);
        if (block) tocEntries.push(block);
      }
      return tocEntries;
    }
  }
  return [];
}

/**
 * True if the given `<w:sdt>` element is a Table-of-Contents structured
 * document tag. TOC sdts get a dedicated renderer (processTOC); every
 * other sdt (form fields, checkboxes, dropdowns, plain-text content
 * controls, bound data) is walked into by the body iterator so its
 * `<w:sdtContent>` renders as ordinary paragraph/table content.
 * Without this branch, non-TOC sdt content was silently dropped —
 * common in contract templates that use bound content controls for
 * signature blocks, party names, or effective-date pickers.
 */
const isTOCSdt = (sdt: Element): boolean => {
  const gallery = sdt.getElementsByTagNameNS(WORD_NS, "docPartGallery")[0];
  if (!gallery) return false;
  const val = (
    gallery.getAttributeNS(WORD_NS, "val") ||
    gallery.getAttribute("w:val") ||
    ""
  ).toLowerCase();
  return val.includes("table of contents");
};

const isPageBreak = (element: Element): boolean => {
  if (element.localName !== "p") return false;

  const pPr = getElementByTagNameNS(element, "pPr");
  if (pPr) {
    const sectPr = getElementByTagNameNS(pPr, "sectPr");
    if (sectPr) {
      // Per OOXML spec, `<w:sectPr>` without an explicit `<w:type>` defaults
      // to `"nextPage"` — a hard page break. pdf2docx (our PDF→DOCX converter)
      // emits section breaks between PDF pages WITHOUT the type attribute,
      // so the previous check that required `type === "nextPage"` silently
      // ignored every page boundary in a converted PDF and collapsed the
      // whole document into a single editor page. Explicit `"continuous"`
      // is the only sectPr variant that should NOT trigger a page break.
      const type = getElementByTagNameNS(sectPr, "type");
      const val = type?.getAttributeNS(WORD_NS, "val");
      if (
        !val ||
        val === "nextPage" ||
        val === "oddPage" ||
        val === "evenPage"
      ) {
        return true;
      }
    }

    const pageBreakBefore = getElementByTagNameNS(pPr, "pageBreakBefore");
    if (pageBreakBefore) {
      return true;
    }
  }

  const runs = getElementsByTagNameNS(element, "r");
  for (const run of runs) {
    const br = getElementByTagNameNS(run, "br");
    if (br) {
      const type = br.getAttributeNS(WORD_NS, "type");
      if (type === "page") {
        return true;
      }
    }
  }

  return false;
};

const getElementByTagNameNS = (
  element: Element,
  localName: string,
): Element | null => {
  return element.getElementsByTagNameNS(WORD_NS, localName)[0] || null;
};

const getElementsByTagNameNS = (
  element: Element,
  localName: string,
): Element[] => {
  return Array.from(element.getElementsByTagNameNS(WORD_NS, localName));
};

// Direct-child WORD_NS elements only. Use this whenever a nested table
// inside a cell would poison a descendant-walk — e.g. iterating cells
// of a row (nested rows would leak in) or paragraphs of a cell (nested
// cells' paragraphs would leak in). Silent duplication of cell content
// is the failure mode; hard to spot in review.
const getDirectChildrenNS = (
  element: Element,
  localName: string,
): Element[] => {
  const out: Element[] = [];
  for (const child of Array.from(element.children)) {
    if (child.namespaceURI === WORD_NS && child.localName === localName) {
      out.push(child);
    }
  }
  return out;
};

const processHyperlink = (hyperlink: Element, relationships: any): string => {
  try {
    let linkText = "";
    let href = "";

    const relId = hyperlink.getAttributeNS(RELATIONSHIP_NS, "id");
    if (relId && relationships[relId]) {
      href = relationships[relId];
    }

    const anchor = hyperlink.getAttributeNS(WORD_NS, "anchor") || "";
    if (anchor && !href) {
      href = `#${anchor}`;
    }

    // Synthetic hyperlinks materialised from <w:fldSimple
    // w:instr="HYPERLINK ..."> stash the extracted URL here since
    // they have no r:id in the relationships map.
    if (!href) {
      const inlineHref = hyperlink.getAttribute("data-inline-href");
      if (inlineHref) href = inlineHref;
    }

    const textRuns = getElementsByTagNameNS(hyperlink, "r");
    for (const run of textRuns) {
      const textElement = getElementByTagNameNS(run, "t");
      if (textElement) {
        let runText = textElement.textContent || "";

        if (textElement.getAttributeNS(WORD_NS, "space") === "preserve") {
          runText = " " + runText + " ";
        }

        const rPr = getElementByTagNameNS(run, "rPr");
        const textStyles = getTextStyles(rPr);
        if (textStyles.length > 0) {
          const safeStyles = textStyles
            .map((s) => s.replace(/"/g, "'"))
            .join("; ");

          runText = `<span style="${safeStyles}">${runText}</span>`;
        }

        linkText += runText;
      }
    }

    if (!href && linkText.trim()) {
      href = "#";
    }

    if (linkText.trim()) {
      const linkStyles = [
        "color: #0563C1",
        "text-decoration: underline",
        "cursor: pointer",
      ];

      return `<a href="${href}" style="${linkStyles.join(";")}">${linkText}</a>`;
    }

    return linkText;
  } catch (error) {
    console.error("Error processing hyperlink:", error);
    return "";
  }
};

const processDrawing = async (
  drawingElement: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
  paragraphElement?: Element | null,
): Promise<any> => {
  try {
    let inline: Element | null = null;
    let anchor: Element | null = null;

    for (const child of Array.from(drawingElement.children)) {
      if (child.localName === "inline") {
        inline = child;
        break;
      } else if (child.localName === "anchor") {
        anchor = child;
      }
    }

    const container = inline || anchor;
    if (!container) {
      console.warn("No inline or anchor found in drawing");
      return null;
    }

    const extent = container.getElementsByTagNameNS(DRAWING_NS, "extent")[0];
    const originalWidth = extent?.getAttribute("cx")
      ? Number.parseInt(extent.getAttribute("cx")!)
      : 0;
    const originalHeight = extent?.getAttribute("cy")
      ? Number.parseInt(extent.getAttribute("cy")!)
      : 0;

    const graphic = container.getElementsByTagNameNS(MAIN_NS, "graphic")[0];
    if (!graphic) {
      console.warn("No graphic element found");
      return null;
    }

    const graphicData = graphic.getElementsByTagNameNS(
      MAIN_NS,
      "graphicData",
    )[0];
    if (!graphicData) {
      console.warn("No graphicData element found");
      return null;
    }

    const pic = graphicData.getElementsByTagNameNS(PICTURE_NS, "pic")[0];
    if (!pic) {
      console.warn("No pic element found");
      return null;
    }

    const blipFill = pic.getElementsByTagNameNS(PICTURE_NS, "blipFill")[0];
    if (!blipFill) {
      console.warn("No blipFill element found");
      return null;
    }

    const blip = blipFill.getElementsByTagNameNS(MAIN_NS, "blip")[0];
    if (!blip) {
      console.warn("No blip element found");
      return null;
    }

    const imageId =
      blip.getAttributeNS(RELATIONSHIP_NS, "embed") ||
      blip.getAttributeNS(RELATIONSHIP_NS, "link");

    if (!imageId) {
      console.warn("No image ID found in blip element");
      return null;
    }

    let imageData: string | undefined;

    // Resolve via the CALLER's relationships first: rId → target
    // path → images[path]. rIds are file-scoped in DOCX (rId1 in
    // header1 may point to media/image1.png while rId1 in header2
    // points to media/image2.png), so the global images[rId] key
    // gets shadowed by whichever file was loaded first. Path-based
    // lookup uses the unique media path and dodges the collision.
    // Only fall back to images[rId] / broad pattern matching when
    // the caller's relationships map didn't resolve.
    if (relationships[imageId]) {
      const target = relationships[imageId];

      const possiblePaths = [
        target,
        `word/${target}`,
        target.startsWith("/") ? `word${target}` : target,
        `media/${target.split("/").pop()}`,
        target.replace("../", ""),
      ];

      for (const path of possiblePaths) {
        if (images[path]) {
          imageData = images[path];
          break;
        }
      }
    }

    if (!imageData && images[imageId]) {
      imageData = images[imageId];
    }

    if (!imageData) {
      const searchPatterns = [
        imageId,
        `rId${imageId.replace("rId", "")}`,
        imageId.toLowerCase(),
        `media/image${imageId.replace("rId", "")}`,
      ];

      for (const pattern of searchPatterns) {
        const matchingKey = Object.keys(images).find(
          (key) => key.includes(pattern) || key.endsWith(pattern),
        );
        if (matchingKey) {
          imageData = images[matchingKey];
          break;
        }
      }
    }

    if (!imageData) {
      return null;
    }

    const img = new Image();
    const actualDimensions = await new Promise<{
      width: number;
      height: number;
    }>((resolve) => {
      img.onload = () => {
        resolve({
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
        });
      };
      img.onerror = () => {
        console.warn("Failed to load image for dimension detection");
        resolve({
          width: originalWidth / 9525,
          height: originalHeight / 9525,
        });
      };
      img.src = imageData;
    });

    let alignment = "left";
    let wrapType = "none";
    let floatValue = "inline";

    if (anchor) {
      // Extract alignment
      const positionH = anchor.getElementsByTagNameNS(
        DRAWING_NS,
        "positionH",
      )[0];

      if (positionH) {
        const align = positionH.getElementsByTagNameNS(DRAWING_NS, "align")[0];
        if (align) {
          const alignValue = align.textContent?.toLowerCase() || "";
          if (alignValue === "center" || alignValue === "centered") {
            alignment = "center";
          } else if (alignValue === "right") {
            alignment = "right";
          } else if (alignValue === "left") {
            alignment = "left";
          }
        }
      } else if (paragraphElement) {
        const pPr = getElementByTagNameNS(paragraphElement, "pPr");
        alignment = getAlignmentFromPPr(pPr);
      }

      const wrapSquare = anchor.getElementsByTagNameNS(
        DRAWING_NS,
        "wrapSquare",
      )[0];
      const wrapTight = anchor.getElementsByTagNameNS(
        DRAWING_NS,
        "wrapTight",
      )[0];
      const wrapThrough = anchor.getElementsByTagNameNS(
        DRAWING_NS,
        "wrapThrough",
      )[0];
      const wrapTopBottom = anchor.getElementsByTagNameNS(
        DRAWING_NS,
        "wrapTopAndBottom",
      )[0];
      const wrapNone = anchor.getElementsByTagNameNS(DRAWING_NS, "wrapNone")[0];

      if (wrapSquare) {
        wrapType = "square";
        floatValue = alignment === "center" ? "inline" : alignment;
      } else if (wrapTight) {
        wrapType = "tight";
        floatValue = alignment === "center" ? "inline" : alignment;
      } else if (wrapThrough) {
        wrapType = "through";
        floatValue = alignment === "center" ? "inline" : alignment;
      } else if (wrapTopBottom) {
        wrapType = "top-bottom";
        floatValue = "inline";
      } else if (wrapNone) {
        wrapType = "none";
        floatValue = "inline";
      } else {
        // No explicit wrap element on the anchor — Word behaves like
        // "none" here (image flows inline with the paragraph). The old
        // default of "square" combined with the renderer's float-based
        // margin math to silently offset centered images to one side.
        wrapType = "none";
        floatValue = "inline";
      }
    } else if (inline && paragraphElement) {
      const pPr = getElementByTagNameNS(paragraphElement, "pPr");
      alignment = getAlignmentFromPPr(pPr);
    }

    // Images can't be justified — Word treats `w:jc=both` on an image
    // paragraph as "start" internally. Silently normalise to left so the
    // image doesn't stretch or misalign. If we ever add a "distribute
    // horizontally" image tune we should revisit this.
    if (alignment === "justify") {
      alignment = "left";
    }

    // ── CustomImageTool Tier-1 + Tier-2 fields ────────────────────────────
    // Alt text — Word's "Alt text" (Format Picture → Alt Text) is written
    // to the `descr` attribute of <wp:docPr>. The adjacent `title` attr
    // is Word's internal name; we don't ingest it since it isn't shown
    // to screen readers.
    const docPr = container.getElementsByTagNameNS(DRAWING_NS, "docPr")[0];
    const altText = docPr?.getAttribute("descr") || "";

    // Hyperlink — stored on <wp:docPr><a:hlinkClick r:id="rIdN"/>. The
    // rId resolves through the same relationships map we use for the
    // image blob itself. tgtFrame="_blank" means "open in new tab".
    let link: { url: string; openInNewTab: boolean } | undefined;
    const hlinkClick = docPr
      ? docPr.getElementsByTagNameNS(MAIN_NS, "hlinkClick")[0]
      : null;
    if (hlinkClick) {
      const linkRId =
        hlinkClick.getAttributeNS(RELATIONSHIP_NS, "id") ||
        hlinkClick.getAttribute("r:id");
      const tgtFrame = hlinkClick.getAttribute("tgtFrame") || "";
      if (linkRId && relationships[linkRId]) {
        link = {
          url: relationships[linkRId],
          openInNewTab: tgtFrame === "_blank" || tgtFrame === "",
        };
      }
    }

    // Crop — <pic:blipFill><a:srcRect l=".." t=".." r=".." b=".."/>. Values
    // are 1000ths of a percent (10000 = 10%). Omit the whole object when
    // every side is 0 so CustomImageTool treats it as uncropped.
    let crop:
      | { top: number; right: number; bottom: number; left: number }
      | undefined;
    const srcRect = blipFill.getElementsByTagNameNS(MAIN_NS, "srcRect")[0];
    if (srcRect) {
      const sr = (name: string) => {
        const raw = parseInt(srcRect.getAttribute(name) || "0", 10);
        return isNaN(raw) ? 0 : raw / 1000;
      };
      const t = sr("t");
      const r = sr("r");
      const b = sr("b");
      const l = sr("l");
      if (t > 0 || r > 0 || b > 0 || l > 0) {
        crop = { top: t, right: r, bottom: b, left: l };
      }
    }

    // Shape properties — rotation, flip, preset shape and border all
    // live under <pic:spPr>. prstGeom distinguishes "ellipse"/"roundRect"
    // from the plain "rect" default; a:xfrm carries rotation + flip
    // attrs; a:ln is the picture-frame border.
    const spPr = pic.getElementsByTagNameNS(PICTURE_NS, "spPr")[0];
    let rotation = 0;
    let flipX = false;
    let flipY = false;
    let shape: "rectangle" | "rounded" | "circle" | undefined;
    let border:
      | { width: string; style: string; color: string }
      | undefined;
    if (spPr) {
      const xfrm = spPr.getElementsByTagNameNS(MAIN_NS, "xfrm")[0];
      if (xfrm) {
        // DrawingML rotation is stored in 60000ths of a degree.
        const rotRaw = parseInt(xfrm.getAttribute("rot") || "0", 10);
        if (!isNaN(rotRaw) && rotRaw !== 0) {
          rotation = Math.round(rotRaw / 60000) % 360;
        }
        if (xfrm.getAttribute("flipH") === "1") flipX = true;
        if (xfrm.getAttribute("flipV") === "1") flipY = true;
      }
      const prstGeom = spPr.getElementsByTagNameNS(MAIN_NS, "prstGeom")[0];
      const prst = prstGeom?.getAttribute("prst") || "";
      if (prst === "ellipse") shape = "circle";
      else if (
        prst === "roundRect" ||
        prst === "round1Rect" ||
        prst === "round2SameRect"
      ) {
        shape = "rounded";
      }
      // Picture-frame border — <a:ln w="12700"><a:solidFill><a:srgbClr/>
      // </a:solidFill><a:prstDash val="dash"/></a:ln>. Width is in EMU
      // (12700 EMU = 1 pt ≈ 1.333 px); map a few common widths to px
      // without going through sub-pixel values.
      const ln = spPr.getElementsByTagNameNS(MAIN_NS, "ln")[0];
      if (ln) {
        const w = parseInt(ln.getAttribute("w") || "0", 10);
        const noFill = ln.getElementsByTagNameNS(MAIN_NS, "noFill")[0];
        if (w > 0 && !noFill) {
          const solidFill = ln.getElementsByTagNameNS(MAIN_NS, "solidFill")[0];
          const srgbClr = solidFill?.getElementsByTagNameNS(
            MAIN_NS,
            "srgbClr",
          )[0];
          const color = srgbClr
            ? `#${srgbClr.getAttribute("val") || "000000"}`
            : "#000000";
          const prstDash = ln
            .getElementsByTagNameNS(MAIN_NS, "prstDash")[0]
            ?.getAttribute("val");
          const styleMap: Record<string, string> = {
            solid: "solid",
            dash: "dashed",
            dashDot: "dashed",
            lgDash: "dashed",
            sysDash: "dashed",
            dot: "dotted",
            sysDot: "dotted",
          };
          const style = styleMap[prstDash || "solid"] || "solid";
          // 1 pt ≈ 1.333 px; round to the nearest common width step.
          const widthPx = Math.max(1, Math.round(w / 12700));
          border = {
            width: `${widthPx}px`,
            style,
            color,
          };
        }
      }
    }

    return {
      type: "image",
      data: {
        url: imageData,
        dimensions: {
          width: originalWidth / 9525,
          height: originalHeight / 9525,
          actual: actualDimensions,
          current: actualDimensions,
        },
        altText: altText || undefined,
        link,
        crop,
        shape,
        border,
        rotation,
        flipX,
        flipY,
        tunes: {
          alignment: {
            alignment: alignment,
          },
          imageTune: {
            float: floatValue,
            wrapText: wrapType,
            position: floatValue === "inline" ? "inline" : "relative",
            marginTop: "0px",
            marginRight: "0px",
            marginBottom: "0px",
            marginLeft: "0px",
          },
        },
      },
    };
  } catch (error) {
    console.error("Error processing drawing:", error);
    return null;
  }
};
const DEFAULT_STYLES = {
  Title: {
    fontSize: "36px",
    color: "#17365D",
    marginBottom: "24px",
    lineHeight: "1.3",
    align: "center",
  },
  Heading1: {
    fontSize: "19px",
    color: "#365F91",
    fontWeight: "bold",
    marginBottom: "20px",
    lineHeight: "1.3",
  },
  Heading2: {
    fontSize: "17px",
    color: "#4F81BD",
    fontWeight: "bold",
    marginBottom: "16px",
    lineHeight: "1.3",
  },
  Heading3: {
    fontSize: "15px",
    color: "#4F81BD",
    fontWeight: "bold",
    marginBottom: "12px",
    lineHeight: "1.3",
  },
};

const getStyleString = (styleObj: Record<string, string>): string => {
  return Object.entries(styleObj)
    .map(
      ([key, value]) =>
        `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${value}`,
    )
    .join(";");
};

const processCustomParagraphs = async (
  paragraph: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
) => {};

// Short url-safe id generator (nanoid-ish, no new deps). ~10 chars from
// alphanumerics is enough collision-resistance for in-document chip ids.
const generatePlaceholderId = (): string => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return out;
};

/**
 * Build a TP Writer-shaped variable-chip `<mark>` for an underscore run.
 * The attribute set here MUST stay in sync with MARK_SANITIZER (see
 * src/lib/editor/sanitizers.ts) — any attr not whitelisted there is
 * stripped by EditorJS on save, breaking the chip's data link.
 */
const generatePlaceholder = (
  placeholderName: string,
  originalText: string,
  uniqueId: string = "",
): string => {
  const id = uniqueId || generatePlaceholderId();
  const underscoreCount = originalText.length;
  const width = Math.max(40, underscoreCount * 8);
  return `<mark class="variable-chip" data-placeholder-name="${placeholderName}" data-unique-id="${id}" data-field-type="text" data-custom-width="${width}px" data-empty="true" contenteditable="false">&nbsp;</mark>`;
};

/**
 * Replace runs of 3+ underscores with inline variable-chip marks. Lets
 * DOCX authors scaffold form fields with the familiar "sign on the line"
 * convention and have them land as real chips in TP Writer.
 */
const processUnderscorePlaceholders = (text: string): string => {
  const underscoreRegex = /_{3,}/g;
  return text.replace(underscoreRegex, (match) => {
    const placeholderName = `Field ${match.length}`;
    return generatePlaceholder(placeholderName, match);
  });
};

const getParagraphBordersAndShading = (pPr: Element | null): string[] => {
  const styles: string[] = [];
  if (!pPr) return styles;

  const shd = getElementByTagNameNS(pPr, "shd");
  if (shd) {
    const fill = shd.getAttributeNS(WORD_NS, "fill");
    if (fill && fill !== "auto" && fill !== "000000") {
      styles.push(`background-color: #${fill}`);
      styles.push(`padding: 8px 12px`);
    }
  }

  const pBdr = getElementByTagNameNS(pPr, "pBdr");
  if (pBdr) {
    const borderElements = {
      top: getElementByTagNameNS(pBdr, "top"),
      bottom: getElementByTagNameNS(pBdr, "bottom"),
      left: getElementByTagNameNS(pBdr, "left"),
      right: getElementByTagNameNS(pBdr, "right"),
    };

    let hasBorder = false;
    const borderStyles: { [key: string]: string } = {};

    for (const [side, element] of Object.entries(borderElements)) {
      if (element) {
        const val = element.getAttributeNS(WORD_NS, "val");
        const sz = element.getAttributeNS(WORD_NS, "sz");
        const color = element.getAttributeNS(WORD_NS, "color");

        if (val && val !== "none" && val !== "nil") {
          hasBorder = true;
          const width = sz ? `${Math.max(1, parseInt(sz) / 8)}px` : "1px";
          const borderColor =
            color && color !== "auto" ? `#${color}` : "#000000";
          const borderStyle =
            val === "single" ? "solid" : val === "double" ? "double" : "solid";

          borderStyles[side] = `${width} ${borderStyle} ${borderColor}`;
        }
      }
    }

    if (hasBorder) {
      if (borderStyles.top) styles.push(`border-top: ${borderStyles.top}`);
      if (borderStyles.bottom)
        styles.push(`border-bottom: ${borderStyles.bottom}`);
      if (borderStyles.left) styles.push(`border-left: ${borderStyles.left}`);
      if (borderStyles.right)
        styles.push(`border-right: ${borderStyles.right}`);

      if (!shd) {
        styles.push(`padding: 8px 12px`);
      }
    }
  }

  return styles;
};
const createTextBlock = (textContent: string, pPr: Element | null) => {
  const pStyle = pPr ? getElementByTagNameNS(pPr, "pStyle") : null;
  const styleVal = pStyle?.getAttributeNS(WORD_NS, "val");

  // Check for drop cap
  const framePr = pPr ? getElementByTagNameNS(pPr, "framePr") : null;
  const dropCap = framePr?.getAttributeNS(WORD_NS, "dropCap");
  const lines = framePr?.getAttributeNS(WORD_NS, "lines") || "3";

  // Bullet-marker auto-split. pdf2docx's line_merging_threshold tuning
  // (which we lifted so signature blocks stop fragmenting) sometimes
  // eats the `<w:br/>` between adjacent bulleted items when they sit
  // close together vertically in the source PDF — leaving a text
  // stream like "SECTION ONE: ...EVENT❖Company...❖Event Name...".
  // The bullet character (Wingdings ❖ U+2756, plus common alternates)
  // is a reliable "start of a new item" marker, so we insert `<br>`
  // before each bullet that isn't already at the start or preceded by
  // a `<br>` tag. Simple lookbehind isn't cross-browser-reliable, so
  // walk each match with the offset argument and inspect the
  // preceding slice for a `<br>`.
  let processedText = textContent.replace(
    /[❖•▪■◆★]/g,
    (match, offset, str) => {
      if (offset === 0) return match;
      const window = str.slice(Math.max(0, offset - 10), offset);
      if (/<br\s*\/?>\s*$/i.test(window)) return match;
      return `<br>${match}`;
    },
  );
  if ((dropCap === "drop" || dropCap === "margin") && textContent.trim()) {
    const lineCount = parseInt(lines) || 3;
    const dropCapStyle = [
      `font-size: ${lineCount * 1.5}em`,
      `font-weight: bold`,
      `float: left`,
      `line-height: 0.8`,
      `margin-right: 8px`,
      `margin-top: 4px`,
      `color: inherit`,
    ].join("; ");

    processedText = textContent.replace(
      /^(\s*(?:<[^>]+>)*)(\S)/,
      `$1<span style="${dropCapStyle}">$2</span>`,
    );
  }

  // Extract borders and shading
  const bordersAndShading = getParagraphBordersAndShading(pPr);
  if (bordersAndShading.length > 0) {
    const styleString = bordersAndShading.join("; ");
    processedText = `<span style="${styleString}; padding: 8px 12px">${processedText}</span>`;
  }

  // Wrap with a `<span style="display:block; …">` carrying precise
  // indent + line spacing + before/after spacing. The block-level
  // tunes (alignment + indentLevel) still fire — this wrapper is what
  // lets us preserve fractional indents (e.g. 0.35"), first-line vs
  // hanging indent, and Word's actual line-height. Skipped when
  // there's nothing to apply so we don't bloat the HTML.
  const layoutStyle = getParagraphLayoutStyle(pPr);
  if (layoutStyle) {
    processedText = `<span style="display:block; ${layoutStyle}">${processedText}</span>`;
  }

  // Resolve alignment: explicit `w:jc` on the paragraph always wins.
  // Title / Heading1 fall back to center ONLY if the author didn't
  // pick one — matches how Word renders these styles when the template
  // sets a default but the paragraph overrides it. Previously we
  // hardcoded center for Title/Heading1, silently clobbering any
  // left/right-aligned title in the source DOCX.
  const explicitAlign = hasExplicitAlignment(pPr);
  const resolvedAlignment = explicitAlign
    ? getAlignmentFromPPr(pPr)
    : styleVal === "Title" || styleVal === "Heading1"
      ? "center"
      : getAlignmentFromPPr(pPr);

  const baseBlock = {
    tunes: {
      alignment: {
        alignment: resolvedAlignment,
      },
      indentTune: {
        indentLevel: getIndentLevel(pPr),
      },
    },
  };

  if (
    styleVal === "Title" ||
    styleVal === "Heading1" ||
    styleVal === "Heading2" ||
    styleVal === "Heading3"
  ) {
    const styleObj = DEFAULT_STYLES[styleVal as keyof typeof DEFAULT_STYLES];
    const styleString = getStyleString(styleObj);

    return {
      type: "paragraph",
      data: {
        text: `<span style="${styleString}">${processedText}</span>`,
      },
      tunes: {
        alignment: {
          alignment: resolvedAlignment,
        },
        indentTune: {
          indentLevel: getIndentLevel(pPr),
        },
      },
    };
  } else if (styleVal?.startsWith("Heading")) {
    const level = Number.parseInt(styleVal.replace("Heading", "")) || 1;
    return {
      type: "header",
      data: {
        text: processedText,
        level,
      },
      ...baseBlock,
    };
  }

  const numPr = pPr ? getElementByTagNameNS(pPr, "numPr") : null;
  if (numPr) {
    const numId = getElementByTagNameNS(numPr, "numId")?.getAttributeNS(
      WORD_NS,
      "val",
    );
    const ilvl =
      getElementByTagNameNS(numPr, "ilvl")?.getAttributeNS(WORD_NS, "val") ||
      "0";

    return {
      type: "list",
      data: {
        style: numId === "1" ? "unordered" : "ordered",
        items: [processedText],
        level: Number.parseInt(ilvl),
      },
      ...baseBlock,
    };
  }

  // "Tight-with-next" signal: paragraphs whose pPr carries no
  // <w:spacing> element inherit Normal's `w:after=0` (Word's default
  // for plain paragraphs — the address block, multi-line signature
  // stack, etc.). Word paints those with zero gap between them. Our
  // EditorJS wrapper doesn't know about style inheritance and would
  // otherwise render each as a separate block with the editor's
  // built-in inter-block gap, breaking the "one visual chunk" feel.
  //
  // Stamp the flag here and let the body-iteration merge pass collapse
  // consecutive tight paragraphs into a single block joined by <br>.
  // Runs / images / lists / headers etc. clear the flag by construction
  // (they take an earlier return path above).
  const hasExplicitSpacing = !!(pPr && getElementByTagNameNS(pPr, "spacing"));
  const block: any = {
    type: "paragraph",
    data: {
      text: processedText,
    },
    ...baseBlock,
  };
  if (!hasExplicitSpacing) block._tightWithNext = true;
  return block;
};

const preserveSpacing = (text: string): string => {
  return text.replace(/ {2,}/g, (spaces) => {
    return "&nbsp;".repeat(spaces.length);
  });
};

// Flattens paragraph children so wrapper elements pdf2docx and Word
// emit around hyperlinks — `<w:sdt>` structured document tags,
// `<w:smartTag>`, `<w:fldSimple>` field simplers — yield their inner
// runs / hyperlinks in document order. Without this the wrapper is
// hit as an unknown localName and silently dropped, taking every
// enclosed <w:r>/<w:hyperlink> with it (the symptom: phone numbers
// and mailto links come through as blank cells). fldSimple with a
// HYPERLINK instruction is upgraded to a synthetic <w:hyperlink> so
// the caller's existing hyperlink case renders it as an <a> tag.
const HYPERLINK_INSTR_RE = /\bHYPERLINK\s+"?([^"]+)"?/i;
const flattenParagraphChildren = (parent: Element): Element[] => {
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI !== WORD_NS) {
      out.push(child);
      continue;
    }
    if (child.localName === "sdt" && !isTOCSdt(child)) {
      const content = getElementByTagNameNS(child, "sdtContent");
      if (content) out.push(...flattenParagraphChildren(content));
      continue;
    }
    if (child.localName === "smartTag") {
      out.push(...flattenParagraphChildren(child));
      continue;
    }
    if (child.localName === "fldSimple") {
      const instr = child.getAttributeNS(WORD_NS, "instr") || "";
      const match = HYPERLINK_INSTR_RE.exec(instr);
      if (match) {
        const synth = child.ownerDocument!.createElementNS(
          WORD_NS,
          "hyperlink",
        );
        synth.setAttribute("data-inline-href", match[1].trim());
        for (const c of Array.from(child.children)) {
          synth.appendChild(c.cloneNode(true));
        }
        out.push(synth);
      } else {
        out.push(...flattenParagraphChildren(child));
      }
      continue;
    }
    out.push(child);
  }
  return out;
};

const processParagraph = async (
  paragraph: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
  skipTextBoxes: boolean = false,
) => {
  try {
    const pPr = getElementByTagNameNS(paragraph, "pPr");
    const paragraphStyles = getParagraphStyles(pPr);

    let text = "";
    let hasContent = false;
    const imageBlocks: any[] = [];
    const processedBlocks: any[] = [];

    // Bookmark tracking
    const bookmarkStarts: Map<string, string> = new Map(); // id -> name
    let activeBookmarks: string[] = [];

    if (skipTextBoxes) {
      let parent = paragraph.parentElement;
      while (parent) {
        if (
          parent.localName === "txbxContent" &&
          parent.namespaceURI === WORD_NS
        ) {
          return null;
        }
        parent = parent.parentElement;
      }
    }

    for (const child of flattenParagraphChildren(paragraph)) {
      if (child.namespaceURI === WORD_NS) {
        if (child.localName === "bookmarkStart") {
          const id = child.getAttributeNS(WORD_NS, "id");
          const name = child.getAttributeNS(WORD_NS, "name");
          if (id && name && !name.startsWith("_")) {
            bookmarkStarts.set(id, name);
            activeBookmarks.push(name);
            text += `<span id="${name}" class="bookmark-marker" style="position: relative;"></span>`;
          }
        } else if (child.localName === "bookmarkEnd") {
          const id = child.getAttributeNS(WORD_NS, "id");
          if (id && bookmarkStarts.has(id)) {
            const name = bookmarkStarts.get(id)!;
            const index = activeBookmarks.indexOf(name);
            if (index > -1) {
              activeBookmarks.splice(index, 1);
            }
          }
        } else if (child.localName === "r") {
          const run = child;

          // ⚠️ Runs can carry MULTIPLE `<w:t>` / `<w:br>` / `<w:tab>`
          // interleaved in a single `<w:r>`. Word emits this shape
          // whenever it authors a paragraph with soft line breaks
          // (Shift+Enter) between spans of same-styled text — a
          // resume template with a single paragraph holding contact
          // info, sections, and bullet-list content is the extreme
          // case. The previous code used getElementByTagNameNS(run,
          // "t") which returns only the FIRST match, so every
          // subsequent line silently disappeared. We now iterate the
          // run's children in document order and dispatch each one.
          const rPr = getElementByTagNameNS(run, "rPr");
          const textStyles = getTextStyles(rPr);
          const safeRunStyles =
            textStyles.length > 0
              ? textStyles.map((s) => s.replace(/"/g, "'")).join("; ")
              : "";
          const wrapWithStyles = (s: string): string =>
            safeRunStyles ? `<span style="${safeRunStyles}">${s}</span>` : s;

          const hasMultipleTabsInPara =
            paragraph.getElementsByTagNameNS(WORD_NS, "tab").length > 1;

          for (const rChild of Array.from(run.children)) {
            if (rChild.namespaceURI !== WORD_NS) continue;
            switch (rChild.localName) {
              case "t": {
                let runText = rChild.textContent || "";
                const xmlSpace =
                  rChild.getAttribute("xml:space") ||
                  rChild.getAttributeNS(
                    "http://www.w3.org/XML/1998/namespace",
                    "space",
                  );
                if (xmlSpace === "preserve") {
                  runText = preserveSpacing(runText);
                }
                runText = processUnderscorePlaceholders(runText);
                if (rChild.getAttributeNS(WORD_NS, "space") === "preserve") {
                  runText = " " + runText + " ";
                }
                if (runText.trim()) hasContent = true;
                text += wrapWithStyles(runText);
                break;
              }
              case "br": {
                // Page-break `<w:br w:type="page">` inside a run is
                // detected + processed at the body-walk level via
                // isPageBreak(); here we just render soft breaks as
                // `<br>` so the paragraph HTML shows the line splits.
                text += "<br>";
                break;
              }
              case "cr": {
                // Carriage return — same visual as `<w:br>`.
                text += "<br>";
                break;
              }
              case "tab": {
                if (hasMultipleTabsInPara) {
                  text +=
                    '<span style="display: inline-block; min-width: 50px; width: auto; flex-grow: 1;"></span>';
                } else {
                  text += "&emsp;&emsp;&emsp;";
                }
                break;
              }
              case "noBreakHyphen": {
                text += wrapWithStyles("‑");
                break;
              }
              case "softHyphen": {
                text += wrapWithStyles("­");
                break;
              }
              case "sym": {
                // Symbol character — `<w:sym w:font="Wingdings" w:char="F0B7"/>`.
                // We can't map arbitrary font glyphs so we just try
                // to interpret the hex code as a Unicode code point.
                const symChar = rChild.getAttributeNS(WORD_NS, "char");
                if (symChar) {
                  try {
                    const codePoint = parseInt(symChar, 16);
                    if (Number.isFinite(codePoint)) {
                      text += wrapWithStyles(String.fromCodePoint(codePoint));
                    }
                  } catch (_) {
                    /* ignore */
                  }
                }
                break;
              }
              case "drawing": {
                // Inline drawing inside a run. Delegates to the same
                // drawing / WPS-textbox fallback pipeline used before
                // — we just call it in-order rather than assuming
                // a single drawing per run.
                await handleInlineDrawing(rChild);
                break;
              }
              case "hyperlink": {
                // pdf2docx (and legacy Word field-based hyperlink
                // emitters) nest <w:hyperlink> INSIDE <w:r> instead of
                // as a direct child of <w:p>. Technically invalid OOXML
                // — hyperlink is a paragraph-level element per the
                // spec — but Word tolerates it, so we must too or we
                // silently drop every phone-number and email-address
                // auto-link in PDF-converted documents (they render as
                // blank cells with just the surrounding punctuation
                // leaking through). Route to the same processHyperlink
                // that the paragraph-level case uses.
                const linkText = processHyperlink(rChild, relationships);
                if (linkText) {
                  hasContent = true;
                  text += linkText;
                }
                break;
              }
              // w:delText, w:instrText, w:fldChar, w:pict, w:object
              // fall through here silently. delText belongs to
              // tracked-changes deletions (round-tripped elsewhere);
              // field codes are ignored for now; VML pict is
              // handled via the AlternateContent fallback path at
              // paragraph level.
              default:
                break;
            }
          }

          // The old code kept a separate branch for w:drawing at the
          // top level of the run handler. That's now inside the loop
          // above; the block below is a legacy fallthrough kept for
          // the case where a run somehow surfaces a drawing element
          // outside `<w:r>` semantics — leaving it as a defensive
          // no-op wrapped in an `if (false)` would be clearer but
          // preserving the existing shape avoids a big diff and the
          // block's cost is zero since drawingElement is unused.
          const drawingElement: Element | null = null;

          async function handleInlineDrawing(drawing: Element): Promise<void> {
            const imageBlock = await processDrawing(
              drawing,
              relationships,
              images,
              paragraph,
            );
            if (imageBlock) {
              if (text.trim()) {
                processedBlocks.push(createTextBlock(text, pPr));
                text = "";
                hasContent = false;
              }
              processedBlocks.push(imageBlock);
              return;
            }
            // No image resolved — try WPS textbox fallback (existing
            // logic, extracted so both the loop dispatch and the
            // legacy fallthrough block can share it).
            const anchor = drawing.getElementsByTagNameNS(
              DRAWING_NS,
              "anchor",
            )[0];
            if (!anchor) return;
            const graphic = anchor.getElementsByTagNameNS(
              MAIN_NS,
              "graphic",
            )[0];
            const graphicData = graphic?.getElementsByTagNameNS(
              MAIN_NS,
              "graphicData",
            )[0];
            if (
              graphicData &&
              graphicData.getAttribute("uri") ===
                "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            ) {
              const wsp = graphicData.getElementsByTagNameNS(WPS_NS, "wsp")[0];
              const txbx = wsp?.getElementsByTagNameNS(WPS_NS, "txbx")[0];
              const txbxContent = txbx?.getElementsByTagNameNS(
                WORD_NS,
                "txbxContent",
              )[0];
              if (txbxContent) {
                const cellHtml = await processCellContent(
                  txbxContent,
                  relationships,
                  images,
                );
                if (text.trim()) {
                  processedBlocks.push(createTextBlock(text, pPr));
                  text = "";
                  hasContent = false;
                }
                processedBlocks.push(createHiddenBorderTable([[cellHtml]]));
              }
            }
          }

          if (drawingElement) {
            const imageBlock = await processDrawing(
              drawingElement,
              relationships,
              images,
              paragraph,
            );
            if (imageBlock) {
              if (text.trim()) {
                processedBlocks.push(createTextBlock(text, pPr));
                text = "";
                hasContent = false;
              }
              processedBlocks.push(imageBlock);
            } else {
              // Check for textbox (wps:wsp/wps:txbx) in anchor
              const anchor = drawingElement.getElementsByTagNameNS(
                DRAWING_NS,
                "anchor",
              )[0];
              if (anchor) {
                const graphic = anchor.getElementsByTagNameNS(
                  MAIN_NS,
                  "graphic",
                )[0];
                const graphicData = graphic?.getElementsByTagNameNS(
                  MAIN_NS,
                  "graphicData",
                )[0];
                if (
                  graphicData &&
                  graphicData.getAttribute("uri") ===
                    "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
                ) {
                  const wsp = graphicData.getElementsByTagNameNS(
                    WPS_NS,
                    "wsp",
                  )[0];
                  const txbx = wsp?.getElementsByTagNameNS(WPS_NS, "txbx")[0];
                  const txbxContent = txbx?.getElementsByTagNameNS(
                    WORD_NS,
                    "txbxContent",
                  )[0];
                  if (txbxContent) {
                    const cellHtml = await processCellContent(
                      txbxContent,
                      relationships,
                      images,
                    );
                    if (text.trim()) {
                      processedBlocks.push(createTextBlock(text, pPr));
                      text = "";
                      hasContent = false;
                    }
                    processedBlocks.push(createHiddenBorderTable([[cellHtml]]));
                  }
                }
              }
            }
          }
        } else if (child.localName === "hyperlink") {
          const linkText = processHyperlink(child, relationships);
          if (linkText) {
            hasContent = true;
            text += linkText;
          }
        } else if (child.localName === "br") {
          text += "<br>";
        } else if (child.localName === "AlternateContent") {
          const choice = child.getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/markup-compatibility/2006",
            "Choice",
          )[0];
          const fallback = child.getElementsByTagNameNS(
            "http://schemas.openxmlformats.org/markup-compatibility/2006",
            "Fallback",
          )[0];

          if (choice) {
            const drawings = choice.getElementsByTagNameNS(WORD_NS, "drawing");
            for (const drawing of Array.from(drawings)) {
              const imageBlock = await processDrawing(
                drawing,
                relationships,
                images,
                paragraph,
              );
              if (imageBlock) {
                if (text.trim()) {
                  processedBlocks.push(createTextBlock(text, pPr));
                  text = "";
                  hasContent = false;
                }
                processedBlocks.push(imageBlock);
              }
            }
          }

          if (fallback && processedBlocks.length === 0) {
            const pict = fallback.getElementsByTagNameNS(WORD_NS, "pict")[0];
            if (pict) {
              const vmlShapes = pict.getElementsByTagName("v:shape");
              for (const shape of Array.from(vmlShapes)) {
                const imagedata = shape.getElementsByTagName("v:imagedata")[0];
                if (imagedata) {
                  const imageId = imagedata.getAttributeNS(
                    RELATIONSHIP_NS,
                    "id",
                  );
                  if (imageId && relationships[imageId]) {
                    const imagePath = relationships[imageId].startsWith("/")
                      ? `word${relationships[imageId]}`
                      : `word/${relationships[imageId]}`;
                    const imageData = images[imagePath];

                    if (imageData) {
                      if (text.trim()) {
                        processedBlocks.push(createTextBlock(text, pPr));
                        text = "";
                        hasContent = false;
                      }

                      processedBlocks.push({
                        type: "image",
                        data: {
                          url: imageData,
                          float: "inline",
                          dimensions: {
                            width: 100,
                            height: 100,
                            actual: { width: 100, height: 100 },
                            current: { width: 100, height: 100 },
                          },
                        },
                      });
                    }
                  }
                }
              }
            }
          }
        } else if (child.localName === "t") {
          let runText = child.textContent || "";
          runText = processUnderscorePlaceholders(runText);

          if (child.getAttributeNS(WORD_NS, "space") === "preserve") {
            runText = " " + runText + " ";
          }

          if (runText.trim()) {
            hasContent = true;
          }

          text += runText;
        }
      } else if (child.localName === "AlternateContent") {
        // AlternateContent as a direct <w:p> child (MC namespace)
        const MC_NS =
          "http://schemas.openxmlformats.org/markup-compatibility/2006";
        const choice = child.getElementsByTagNameNS(MC_NS, "Choice")[0];
        if (choice) {
          const drawings = choice.getElementsByTagNameNS(WORD_NS, "drawing");
          for (const drawing of Array.from(drawings)) {
            const imageBlock = await processDrawing(
              drawing,
              relationships,
              images,
              paragraph,
            );
            if (imageBlock) {
              if (text.trim()) {
                processedBlocks.push(createTextBlock(text, pPr));
                text = "";
                hasContent = false;
              }
              processedBlocks.push(imageBlock);
            } else {
              const anchor = drawing.getElementsByTagNameNS(
                DRAWING_NS,
                "anchor",
              )[0];
              if (anchor) {
                const graphic = anchor.getElementsByTagNameNS(
                  MAIN_NS,
                  "graphic",
                )[0];
                const graphicData = graphic?.getElementsByTagNameNS(
                  MAIN_NS,
                  "graphicData",
                )[0];
                if (
                  graphicData &&
                  graphicData.getAttribute("uri") ===
                    "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
                ) {
                  const txbxContent = graphicData
                    .getElementsByTagNameNS(WPS_NS, "wsp")[0]
                    ?.getElementsByTagNameNS(WPS_NS, "txbx")[0]
                    ?.getElementsByTagNameNS(WORD_NS, "txbxContent")[0];
                  if (txbxContent) {
                    const cellHtml = await processCellContent(
                      txbxContent,
                      relationships,
                      images,
                    );
                    if (text.trim()) {
                      processedBlocks.push(createTextBlock(text, pPr));
                      text = "";
                      hasContent = false;
                    }
                    processedBlocks.push(createHiddenBorderTable([[cellHtml]]));
                  }
                }
              }
            }
          }
        }
      }
    }

    if (text.trim() || text.includes("<br>")) {
      processedBlocks.push(createTextBlock(text, pPr));
    } else if (processedBlocks.length === 0) {
      // Preserve the empty paragraph as a spacer block. Word paints
      // each empty <w:p> as one blank line — dropping them entirely
      // (previous behaviour) collapses the visible gaps between
      // "Date", "To", the address, "Dear Mr. …", "Subject", etc.,
      // and — worse — lets the tight-merge pass fuse everything into
      // a single block. Keeping the empty around gives the reader a
      // real gap and acts as a hard barrier the merge pass respects.
      processedBlocks.push({
        type: "paragraph",
        data: { text: "" },
        _isEmptySpacer: true,
      });
    }

    if (processedBlocks.length === 0) {
      return null;
    } else if (processedBlocks.length === 1) {
      return processedBlocks[0];
    } else {
      return processedBlocks;
    }
  } catch (error) {
    console.error("Error processing paragraph:", error);
    console.error(
      "Paragraph content:",
      paragraph?.outerHTML?.substring(0, 500),
    );
    return null;
  }
};
/**
 * Merge consecutive plain-paragraph blocks that the source DOCX left
 * with no explicit `<w:spacing>` into a single block joined by `<br>`.
 *
 * Word inherits `w:after=0` from Normal for such paragraphs, so it
 * paints them as one tight visual chunk (typical for To-address
 * blocks, multi-line signatures, contact info). EditorJS otherwise
 * renders each as a separate block with its default inter-block gap,
 * which visually chops the chunk apart.
 *
 * Only merges when BOTH neighbours:
 *   • carry the `_tightWithNext` transient flag (paragraph builder
 *     stamps it when pPr has no <w:spacing>);
 *   • are `type: "paragraph"`;
 *   • share the same alignment + indentLevel (differing tunes mean
 *     the author intended two separate blocks even if tight).
 *
 * The flag is stripped from every returned block so nothing downstream
 * ever sees it.
 */
const mergeTightParagraphs = (blocks: any[]): any[] => {
  const flat: any[] = [];
  for (const b of blocks) {
    if (Array.isArray(b)) flat.push(...b);
    else if (b) flat.push(b);
  }
  const out: any[] = [];
  // Count of consecutive empty paragraphs seen since the last real
  // block. Two uses:
  //   1. Any non-zero count breaks the tight-merge chain — the source
  //      author put a blank line between the two paragraphs, so they
  //      aren't a single visual chunk.
  //   2. The count is turned into leading `<br>` tags on the next
  //      real block so the visible gap survives BOTH the editor
  //      render AND the HTML→PDF conversion. EditorJS's default
  //      .ce-block padding covers roughly one line's gap already, so
  //      only counts >1 need extra breaks (`emptyCount - 1`); a
  //      single blank line becomes "no extra <br>, rely on block
  //      padding" — matches Word's rendering.
  //
  //   Why not emit spacer blocks? A spacer block stacks THREE lots
  //   of padding (bottom of previous + spacer's top+bottom + top of
  //   next) and renders ~3× too roomy vs Word. Leading `<br>` on the
  //   next block adds one line-height per break — clean and matches
  //   Word's blank-line spacing.
  //
  //   Why not always emit `emptyCount` breaks? The editor's inter-
  //   block padding already accounts for one line. So a single empty
  //   paragraph in the source → zero extra `<br>` needed; two → one
  //   extra `<br>`; three → two; etc.
  let emptyCountSinceLastBlock = 0;
  for (const block of flat) {
    if (block._isEmptySpacer) {
      emptyCountSinceLastBlock++;
      continue;
    }
    const prev = out.length > 0 ? out[out.length - 1] : null;
    const bothParagraphs =
      prev &&
      block.type === "paragraph" &&
      prev.type === "paragraph" &&
      prev._tightWithNext === true &&
      block._tightWithNext === true;
    const sameAlignment =
      prev?.tunes?.alignment?.alignment === block?.tunes?.alignment?.alignment;
    const sameIndent =
      (prev?.tunes?.indentTune?.indentLevel ?? 0) ===
      (block?.tunes?.indentTune?.indentLevel ?? 0);
    if (
      emptyCountSinceLastBlock === 0 &&
      bothParagraphs &&
      sameAlignment &&
      sameIndent
    ) {
      prev.data.text = `${prev.data.text}<br>${block.data.text}`;
      // Preserve tightness so a run of ≥3 lines keeps merging.
      prev._tightWithNext = true;
    } else {
      const copy = { ...block };
      // Restore Word's blank-line spacing by prepending `<br>` for
      // each empty paragraph beyond the first — the first is
      // absorbed by the editor's default inter-block gap.
      const extraBreaks = Math.max(0, emptyCountSinceLastBlock - 1);
      if (extraBreaks > 0 && typeof copy.data?.text === "string") {
        copy.data = {
          ...copy.data,
          text: "<br>".repeat(extraBreaks) + copy.data.text,
        };
      }
      out.push(copy);
    }
    emptyCountSinceLastBlock = 0;
  }
  // Strip transient flags before returning — no downstream consumer
  // should ever see them.
  for (const b of out) {
    delete b._tightWithNext;
    delete b._isEmptySpacer;
  }
  return out;
};

const processLists = (blocks: any[]): any[] => {
  const processedBlocks: any[] = [];
  let currentList: EditorJSList | null = null;

  const flattenBlocks = (blocks: any[]): any[] => {
    return blocks.reduce((acc: any[], block) => {
      if (Array.isArray(block)) {
        return acc.concat(flattenBlocks(block));
      }
      acc.push(block);
      return acc;
    }, []);
  };

  const flattenedBlocks = flattenBlocks(blocks);

  const createNewList = (block: any): EditorJSList => ({
    type: "list",
    data: {
      style: block.data.style,
      items: [],
    },
  });

  const addItemToList = (list: EditorJSList, item: any, level: number) => {
    const newItem: EditorJSListItem = {
      content: item.data.items[0],
      items: [],
    };

    if (level === 0) {
      list.data.items.push(newItem);
    } else {
      let currentLevel = list.data.items;
      for (let i = 0; i < level; i++) {
        if (!currentLevel[currentLevel.length - 1]) {
          currentLevel.push({ content: "", items: [] });
        }
        if (!currentLevel[currentLevel.length - 1].items) {
          currentLevel[currentLevel.length - 1].items = [];
        }
        currentLevel = currentLevel[currentLevel.length - 1].items!;
      }
      currentLevel.push(newItem);
    }
  };

  for (const block of flattenedBlocks) {
    if (block && block.type === "list") {
      if (!currentList || currentList.data.style !== block.data.style) {
        if (currentList) {
          processedBlocks.push(currentList);
        }
        currentList = createNewList(block);
      }
      addItemToList(currentList, block, block.data.level || 0);
    } else {
      if (currentList) {
        processedBlocks.push(currentList);
        currentList = null;
      }
      processedBlocks.push(block);
    }
  }

  if (currentList) {
    processedBlocks.push(currentList);
  }

  return processedBlocks;
};

const getAlignmentFromPPr = (pPr: Element | null): string => {
  if (!pPr) return "left";
  const jc = getElementByTagNameNS(pPr, "jc");
  const val = jc?.getAttributeNS(WORD_NS, "val");

  const alignmentMap: { [key: string]: string } = {
    left: "left",
    right: "right",
    center: "center",
    both: "justify",
    justify: "justify",
    start: "left",
    end: "right",
  };

  return alignmentMap[val?.toLowerCase() || ""] || "left";
};

/**
 * Returns true only when `w:jc` is present on `w:pPr`. Lets caller
 * differentiate "author explicitly picked an alignment" from "align
 * default". Fixes the Title/Heading1 bug where hardcoded-center was
 * clobbering left-aligned titles in the source DOCX.
 */
const hasExplicitAlignment = (pPr: Element | null): boolean => {
  if (!pPr) return false;
  return !!getElementByTagNameNS(pPr, "jc");
};

/**
 * Coarse indent level for the EditorJS indent tune (0–5). Kept for
 * backwards compat with older documents that stored indent at this
 * granularity. Precise indent lives on the inline style wrapper — see
 * getPreciseIndentStyle. Reads `left` and `firstLine` separately so a
 * `firstLine`-only indent doesn't spill into the full-paragraph indent.
 */
const getIndentLevel = (pPr: Element | null): number => {
  if (!pPr) return 0;
  const ind = getElementByTagNameNS(pPr, "ind");
  if (!ind) return 0;

  // Prefer `left` — that's the whole-paragraph indent Word treats as
  // "indent level". `firstLine` alone only indents the first line and
  // shouldn't bump the tune.
  const leftInd = ind.getAttributeNS(WORD_NS, "left") || "0";
  return Math.floor(parseInt(leftInd) / 720);
};

/**
 * Builds a precise indent CSS string from `w:ind`, reflecting each
 * attribute separately:
 *   • `left`      → margin-left    (whole-paragraph indent)
 *   • `right`     → margin-right   (right-side indent)
 *   • `firstLine` → text-indent    (positive indent on first line only)
 *   • `hanging`   → text-indent + padding-left (negative first-line
 *                   indent for hanging bullets / definitions)
 *
 * Word uses twips (1/20 pt); we emit `pt` since browsers render it
 * exactly at print scale. Returns "" when there's nothing to apply so
 * the caller can skip the wrapper.
 */
const getPreciseIndentStyle = (pPr: Element | null): string => {
  if (!pPr) return "";
  const ind = getElementByTagNameNS(pPr, "ind");
  if (!ind) return "";
  const styles: string[] = [];
  const twips = (attr: string): number => {
    const v = ind.getAttributeNS(WORD_NS, attr);
    if (!v) return 0;
    const n = parseInt(v);
    return Number.isFinite(n) ? n : 0;
  };

  const leftTw = twips("left") || twips("start");
  const rightTw = twips("right") || twips("end");
  const firstLineTw = twips("firstLine");
  const hangingTw = twips("hanging");

  if (leftTw > 0) styles.push(`margin-left: ${leftTw / 20}pt`);
  if (rightTw > 0) styles.push(`margin-right: ${rightTw / 20}pt`);
  if (hangingTw > 0) {
    // A hanging indent moves the first line LEFT of the block indent
    // by `hangingTw` and pads the wrapped lines back. That's how Word
    // renders numbered lists with wrapped continuation.
    styles.push(`text-indent: -${hangingTw / 20}pt`);
    styles.push(`padding-left: ${hangingTw / 20}pt`);
  } else if (firstLineTw > 0) {
    styles.push(`text-indent: ${firstLineTw / 20}pt`);
  }
  return styles.join("; ");
};

/**
 * Builds a CSS string from `w:spacing` — line-height + before/after
 * paragraph margins. Word's `line` semantics depend on `lineRule`:
 *   • auto     → multiplier: value / 240 (240 = single, 360 = 1.5x, 480 = double)
 *   • exact    → fixed absolute height in twips
 *   • atLeast  → minimum absolute height in twips (rendered same as
 *                exact for our purposes; CSS min-line-height is rare)
 * before/after are always twips; we convert to pt.
 */
const getSpacingStyle = (pPr: Element | null): string => {
  if (!pPr) return "";
  const sp = getElementByTagNameNS(pPr, "spacing");
  if (!sp) return "";
  const styles: string[] = [];
  const line = sp.getAttributeNS(WORD_NS, "line");
  const lineRule = (
    sp.getAttributeNS(WORD_NS, "lineRule") || "auto"
  ).toLowerCase();
  const before = sp.getAttributeNS(WORD_NS, "before");
  const after = sp.getAttributeNS(WORD_NS, "after");

  if (line) {
    const n = parseInt(line);
    if (Number.isFinite(n) && n > 0) {
      if (lineRule === "exact" || lineRule === "atleast") {
        styles.push(`line-height: ${n / 20}pt`);
      } else {
        // auto — Word's `line` is "N × single-line-height" where
        // single-line-height already includes Word's built-in leading
        // (font-size × ~1.2). CSS `line-height: N` is just N × font-size
        // — so a 1.5 in Word visibly reads tighter than a 1.5 in CSS
        // when combined with the reflow width and font-metric
        // differences a browser applies. Compensate by anchoring 1.0 to
        // 1.0 and compressing the excess above single-spacing so a
        // Word 1.5 lands near 1.35 in the editor (visually closer to
        // Word's rendered output). Exact/atLeast are absolute measures
        // in the source doc — leave those untouched.
        const rawMultiplier = n / 240;
        const compensated = 1 + Math.max(0, rawMultiplier - 1) * 0.7;
        styles.push(`line-height: ${Math.round(compensated * 100) / 100}`);
      }
    }
  }
  if (before) {
    const n = parseInt(before);
    if (Number.isFinite(n) && n > 0) styles.push(`margin-top: ${n / 20}pt`);
  }
  if (after) {
    const n = parseInt(after);
    if (Number.isFinite(n) && n > 0) styles.push(`margin-bottom: ${n / 20}pt`);
  }
  return styles.join("; ");
};

/**
 * Combines precise indent + spacing styles from a `w:pPr` into a
 * single semicolon-joined CSS string. Returns "" when neither has
 * anything applicable so the caller can omit the wrapping span.
 */
const getParagraphLayoutStyle = (pPr: Element | null): string => {
  const parts = [getPreciseIndentStyle(pPr), getSpacingStyle(pPr)].filter(
    Boolean,
  );
  return parts.join("; ");
};

const processTable = async (
  table: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
): Promise<any> => {
  try {
    const rows = getElementsByTagNameNS(table, "tr");
    const tblPr = getElementByTagNameNS(table, "tblPr");
    const tblGrid = getElementByTagNameNS(table, "tblGrid");

    const gridCols = tblGrid
      ? Array.from(getElementsByTagNameNS(tblGrid, "gridCol"))
      : [];
    const totalGridCols = gridCols.length;

    // Extract column widths as percentages. pdf2docx sometimes emits
    // absurdly narrow columns (< 3% of the row) — usually left-over
    // artifacts from the PDF's internal layout grid. When any column
    // would be that narrow the whole width array is unreliable, so we
    // drop it and let the renderer fall back to browser auto-sizing.
    // Without this a "$139.00" cell wraps to one character per line
    // because a 5px column can't fit anything visible.
    const rawColWidths = gridCols.map((col) =>
      parseInt(col.getAttributeNS(WORD_NS, "w") || "0", 10),
    );
    const totalColWidth = rawColWidths.reduce((sum, w) => sum + w, 0);
    const rawPercents =
      totalColWidth > 0
        ? rawColWidths.map((w) => Math.round((w / totalColWidth) * 10000) / 100)
        : [];
    const MIN_COL_PERCENT = 3;
    const hasTooNarrowColumn = rawPercents.some(
      (p) => p > 0 && p < MIN_COL_PERCENT,
    );
    const columnWidths = hasTooNarrowColumn ? [] : rawPercents;

    const tblLook = tblPr ? getElementByTagNameNS(tblPr, "tblLook") : null;
    const tblStyle = tblPr ? getElementByTagNameNS(tblPr, "tblStyle") : null;
    const tblStyleVal: any = tblStyle
      ? tblStyle.getAttributeNS(WORD_NS, "val")
      : "";

    const tableStyleConfig =
      TABLE_STYLES[tblStyleVal] || TABLE_STYLES["TableNormal"];
    const conditionalFormatting = getTableConditionalFormatting(tblLook);

    if (tableStyleConfig.firstRow) {
      conditionalFormatting.firstRow = true;
    }

    const tableStyles = getTableStyles(tblPr);
    const customTableStyles = tableStyleConfig.table || {};
    const mergedTableStyles = { ...tableStyles, ...customTableStyles };

    // Table alignment on the page — <w:jc> inside <w:tblPr>. Word's values
    // "start"/"end" are LTR-aware aliases for left/right; both parsers in
    // the wild emit them, so we coalesce. CustomTableTool reads this and
    // applies margin-auto accordingly (center / right / left).
    let tableAlign: "left" | "center" | "right" | undefined;
    if (tblPr) {
      const tblJc = getElementByTagNameNS(tblPr, "jc");
      const tblJcVal = tblJc?.getAttributeNS(WORD_NS, "val") || "";
      if (tblJcVal === "center") tableAlign = "center";
      else if (tblJcVal === "right" || tblJcVal === "end") tableAlign = "right";
      else if (tblJcVal === "left" || tblJcVal === "start")
        tableAlign = "left";
    }

    // Match Word's default: no visible borders unless <w:tblBorders>
    // explicitly requests them. pdf2docx over-detects table structure
    // when a PDF has any consistent visual alignment (bullet lists,
    // indented paragraphs, signature blocks), producing tables the
    // author never intended. The old renderer painted a light-gray
    // border on every table regardless, so SECTION ONE and other
    // layout-only regions rendered as boxed tables in the editor.
    // We flip the flag when either tblBorders is absent OR every side
    // is explicitly "nil"/"none" — either way Word would show no
    // visible border, and neither should we.
    const tblBordersEl = tblPr
      ? getElementByTagNameNS(tblPr, "tblBorders")
      : null;
    const explicitBordersHidden = (() => {
      if (!tblBordersEl) return true;
      const sides = ["top", "bottom", "left", "right", "insideH", "insideV"];
      const anyVisible = sides.some((side) => {
        const el = getElementByTagNameNS(tblBordersEl, side);
        if (!el) return false;
        const val = (el.getAttributeNS(WORD_NS, "val") || "").toLowerCase();
        return val && val !== "none" && val !== "nil";
      });
      return !anyVisible;
    })();

    // Layout-table heuristic — pdf2docx writes `<w:tblBorders w:val="single"/>`
    // and full <w:tc> cell structure even for regions it hallucinated
    // from PDF layout (SECTION ONE bullet lists with a floating name
    // on the right, address blocks that visually align, etc). Real
    // data tables typically have many rows with short single-paragraph
    // cells; layout tables have few rows with a lot of content or
    // many line breaks packed into one cell. Any of these signals
    // flips the table into layout mode: ≤3 rows AND (any cell with
    // ≥3 paragraphs OR any cell with ≥3 <w:br/> OR any cell whose
    // text content exceeds 150 chars). The character-count branch is
    // essential because pdf2docx often collapses a bullet list into a
    // single <w:p> with soft breaks — the paragraph-count branch
    // alone misses that.
    const isLikelyLayoutTable = (() => {
      if (rows.length > 3) return false;
      for (const row of rows) {
        const cells = getDirectChildrenNS(row, "tc");
        for (const cell of cells) {
          const cellParagraphs = getDirectChildrenNS(cell, "p");
          if (cellParagraphs.length >= 3) return true;
          let brCount = 0;
          let textLen = 0;
          for (const p of cellParagraphs) {
            brCount += p.getElementsByTagNameNS(WORD_NS, "br").length;
            textLen += (p.textContent || "").length;
          }
          if (brCount >= 3) return true;
          if (textLen >= 150) return true;
        }
      }
      return false;
    })();

    // When we identify a layout table, don't emit a `<table>` block at
    // all — flatten every cell's paragraphs into standalone paragraph
    // blocks in document order. The 2-column visual arrangement is
    // sacrificed (Word/pdf2docx column data doesn't map cleanly to
    // EditorJS), but the content flow matches the PDF: header, list,
    // signature name, footer. That's what the user asked for when
    // they said "there is no table in the PDF — get the structure
    // right."
    if (isLikelyLayoutTable) {
      const flat: any[] = [];
      for (const row of rows) {
        const cells = getDirectChildrenNS(row, "tc");
        for (const cell of cells) {
          for (const p of getDirectChildrenNS(cell, "p")) {
            const block = await processParagraph(p, relationships, images);
            if (block) {
              if (Array.isArray(block)) {
                for (const b of block) if (b) flat.push(b);
              } else {
                flat.push(block);
              }
            }
          }
        }
      }
      return flat.length > 0 ? flat : null;
    }

    const bordersHidden = explicitBordersHidden;

    const vMergeTracker: {
      [key: number]: { startRow: number; colspan: number };
    } = {};
    const cellsToSkip: Set<string> = new Set();

    const content: string[][] = [];
    const cellStyles: any = {};
    const rowStyles: any = {};
    const headerRows: number[] = [];
    // Per-row explicit heights (px) harvested from <w:trHeight>. Sparse —
    // only rows with an explicit height get a non-zero entry; others fall
    // through to the editor's auto-sizing.
    const rowHeights: number[] = [];
    // Flipped true when any <w:trPr><w:tblHeader/></w:trPr> is seen. Those
    // rows ALSO join headerRows so CustomTableTool wraps them in <thead>.
    let repeatHeaderOnPrint = false;

    for (const [rowIndex, row] of rows.entries()) {
      // Direct-child cells only. `getElementsByTagNameNS` descends into
      // nested tables and yields their cells too, silently duplicating
      // content in the parent row — the PDF→DOCX converter sometimes
      // produces nested table layouts for complex cells.
      const cells = getDirectChildrenNS(row, "tc");
      const rowData: string[] = [];

      const trPr = getElementByTagNameNS(row, "trPr");
      const rowStyleList = getRowStyles(trPr, rowIndex, conditionalFormatting);

      // Row height — <w:trHeight w:val="500"/> in twips. Convert twips
      // → px: 1 twip = 1/1440 inch and CSS uses 96 px/inch, so px = twips
      // ÷ 15. hRule="exact" vs "atLeast" only affects whether the row can
      // grow; CustomTableTool stores a single number and lets the browser
      // decide (behaves like atLeast). hRule="auto" is a no-op — skip.
      if (trPr) {
        const trHeight = getElementByTagNameNS(trPr, "trHeight");
        const hVal = trHeight?.getAttributeNS(WORD_NS, "val");
        const hRule = trHeight?.getAttributeNS(WORD_NS, "hRule");
        if (hVal && hRule !== "auto") {
          const twips = parseInt(hVal, 10);
          if (!isNaN(twips) && twips > 0) {
            rowHeights[rowIndex] = Math.round(twips / 15);
          }
        }
        // Table-header rows repeat on page break. Mark the whole table
        // as repeat-on-print AND add the row to headerRows so <thead>
        // wrapping fires at render time.
        const tblHeader = getElementByTagNameNS(trPr, "tblHeader");
        if (tblHeader) {
          repeatHeaderOnPrint = true;
          if (!headerRows.includes(rowIndex)) headerRows.push(rowIndex);
        }
      }

      if (rowStyleList.length > 0) {
        const rowStyleObj: any = {};
        rowStyleList.forEach((style) => {
          const [prop, val] = style.split(": ");
          const camelProp = prop.replace(/-([a-z])/g, (g) =>
            g[1].toUpperCase(),
          );
          rowStyleObj[camelProp] = val;
        });
        rowStyles[rowIndex] = rowStyleObj;
      }

      if (rowIndex === 0 && conditionalFormatting.firstRow) {
        headerRows.push(rowIndex);
      }

      if (!cellStyles[rowIndex]) {
        cellStyles[rowIndex] = {};
      }

      let currentGridCol = 0;
      let visualColIndex = 0;

      for (const [cellIndex, cell] of cells.entries()) {
        while (cellsToSkip.has(`${rowIndex}-${currentGridCol}`)) {
          currentGridCol++;
        }

        const tcPr = getElementByTagNameNS(cell, "tcPr");

        const gridSpan = tcPr ? getElementByTagNameNS(tcPr, "gridSpan") : null;
        const colspan = gridSpan
          ? parseInt(gridSpan.getAttributeNS(WORD_NS, "val") || "1", 10)
          : 1;

        const vMerge = tcPr ? getElementByTagNameNS(tcPr, "vMerge") : null;
        let rowspan = 1;

        if (vMerge) {
          const val = vMerge.getAttributeNS(WORD_NS, "val");

          // OOXML: `<w:vMerge w:val="restart"/>` = origin (starts a new
          // merge group). `<w:vMerge/>` with no val = continuation
          // (absorbed into the origin above). The old check
          // `val === "restart" || val === null` inverted this — every
          // continuation cell got treated as an origin, silently
          // pushing a spurious empty cell that shifted every remaining
          // cell in the row and completely scrambled tables with a
          // vertically-merged first column (e.g. rate tables where the
          // room-type label spans multiple rate rows).
          if (val === "restart") {
            rowspan = 1;
            let checkRow = rowIndex + 1;

            while (checkRow < rows.length) {
              const nextRowCells = getDirectChildrenNS(rows[checkRow], "tc");
              let nextGridCol = 0;
              let found = false;

              for (const nextCell of Array.from(nextRowCells)) {
                while (cellsToSkip.has(`${checkRow}-${nextGridCol}`)) {
                  nextGridCol++;
                }

                const nextTcPr = getElementByTagNameNS(nextCell, "tcPr");
                const nextGridSpan = nextTcPr
                  ? getElementByTagNameNS(nextTcPr, "gridSpan")
                  : null;
                const nextColspan = nextGridSpan
                  ? parseInt(
                      nextGridSpan.getAttributeNS(WORD_NS, "val") || "1",
                      10,
                    )
                  : 1;

                if (nextGridCol === currentGridCol) {
                  const nextVMerge = nextTcPr
                    ? getElementByTagNameNS(nextTcPr, "vMerge")
                    : null;

                  if (
                    nextVMerge &&
                    !nextVMerge.getAttributeNS(WORD_NS, "val")
                  ) {
                    rowspan++;
                    for (
                      let skipCol = nextGridCol;
                      skipCol < nextGridCol + nextColspan;
                      skipCol++
                    ) {
                      cellsToSkip.add(`${checkRow}-${skipCol}`);
                    }
                    found = true;
                    break;
                  } else {
                    found = false;
                    break;
                  }
                }

                nextGridCol += nextColspan;
              }

              if (!found) break;
              checkRow++;
            }
          } else {
            currentGridCol += colspan;
            continue;
          }
        }

        let cellContent = await processCellContent(cell, relationships, images);

        rowData.push(cellContent);

        const cellStyleList = getCellStyles(
          tcPr,
          rowIndex,
          visualColIndex,
          conditionalFormatting,
          rowStyleList,
          tableStyleConfig,
        );

        const cellStyleObj: any = {};

        cellStyleList.forEach((style) => {
          const [prop, val] = style.split(": ");
          const camelProp = prop.replace(/-([a-z])/g, (g) =>
            g[1].toUpperCase(),
          );
          cellStyleObj[camelProp] = val;
        });

        const bgColor = getCellBackgroundColor(tcPr);
        const textColor = getCellTextColor(tcPr);

        if (bgColor && !cellStyleObj.backgroundColor) {
          cellStyleObj.backgroundColor = `#${bgColor}`;
        }
        if (textColor && !cellStyleObj.color) {
          cellStyleObj.color = `#${textColor}`;
        }

        // Diagonal borders — Word stores them as children of <w:tcBorders>:
        //   <w:tl2br/> = top-left → bottom-right  (CustomTableTool "down")
        //   <w:tr2bl/> = top-right → bottom-left  (CustomTableTool "up")
        // Each tag carries a w:val style; "nil"/"none" means the diagonal
        // isn't actually drawn, same convention as the four cardinal sides.
        if (tcPr) {
          const tcBordersEl = getElementByTagNameNS(tcPr, "tcBorders");
          if (tcBordersEl) {
            const tl2br = getElementByTagNameNS(tcBordersEl, "tl2br");
            const tr2bl = getElementByTagNameNS(tcBordersEl, "tr2bl");
            const diagVisible = (el: Element | null) => {
              if (!el) return false;
              const val = (
                el.getAttributeNS(WORD_NS, "val") || ""
              ).toLowerCase();
              return !!val && val !== "none" && val !== "nil";
            };
            if (diagVisible(tl2br)) cellStyleObj.diagonalBorder = "down";
            else if (diagVisible(tr2bl)) cellStyleObj.diagonalBorder = "up";
          }
        }

        const vAlign = tcPr ? getElementByTagNameNS(tcPr, "vAlign") : null;
        if (vAlign) {
          const alignVal = vAlign.getAttributeNS(WORD_NS, "val");
          if (alignVal === "center") {
            cellStyleObj.verticalAlign = "middle";
          } else if (alignVal === "bottom") {
            cellStyleObj.verticalAlign = "bottom";
          } else if (alignVal === "top") {
            cellStyleObj.verticalAlign = "top";
          }
        }
        // Direct-child paragraphs of this cell only. See the same
        // reasoning attached to the row-cell iteration above.
        const paragraphs = getDirectChildrenNS(cell, "p");
        if (paragraphs.length > 0) {
          const firstParagraph = paragraphs[0];
          const pPr = getElementByTagNameNS(firstParagraph, "pPr");
          if (pPr) {
            const jc = getElementByTagNameNS(pPr, "jc");
            if (jc) {
              const alignment = jc.getAttributeNS(WORD_NS, "val");
              if (alignment && !cellStyleObj.textAlign) {
                cellStyleObj.textAlign =
                  alignment === "both" ? "justify" : alignment;
              }
            }
          }
        }

        const tcMar = tcPr ? getElementByTagNameNS(tcPr, "tcMar") : null;
        if (tcMar) {
          const top = getElementByTagNameNS(tcMar, "top");
          const bottom = getElementByTagNameNS(tcMar, "bottom");
          const left = getElementByTagNameNS(tcMar, "left");
          const right = getElementByTagNameNS(tcMar, "right");

          if (top) {
            const val = top.getAttributeNS(WORD_NS, "w");
            if (val) cellStyleObj.paddingTop = `${parseInt(val) / 20}pt`;
          }
          if (bottom) {
            const val = bottom.getAttributeNS(WORD_NS, "w");
            if (val) cellStyleObj.paddingBottom = `${parseInt(val) / 20}pt`;
          }
          if (left) {
            const val = left.getAttributeNS(WORD_NS, "w");
            if (val) cellStyleObj.paddingLeft = `${parseInt(val) / 20}pt`;
          }
          if (right) {
            const val = right.getAttributeNS(WORD_NS, "w");
            if (val) cellStyleObj.paddingRight = `${parseInt(val) / 20}pt`;
          }
        }

        if (colspan > 1) {
          cellStyleObj.colSpan = colspan;
        }
        if (rowspan > 1) {
          cellStyleObj.rowSpan = rowspan;
        }

        if (Object.keys(cellStyleObj).length > 0) {
          cellStyles[rowIndex][visualColIndex] = cellStyleObj;
        }

        currentGridCol += colspan;
        visualColIndex++;
      }

      if (rowData.length > 0) {
        content.push(rowData);
      }
    }

    return {
      type: "table",
      data: {
        content,
        withHeading: headerRows.length > 0,
        headerRows,
        hideBorders: bordersHidden,
        columnWidths: columnWidths.length > 0 ? columnWidths : undefined,
        // Omit rowHeights entirely when nothing was explicit — a sparse
        // array with holes serializes as nulls and the editor's defaulting
        // treats a present-but-empty array differently from undefined.
        rowHeights:
          rowHeights.some((h) => typeof h === "number" && h > 0)
            ? Array.from(
                { length: rows.length },
                (_, i) => rowHeights[i] || 0,
              )
            : undefined,
        repeatHeaderOnPrint: repeatHeaderOnPrint || undefined,
        tableAlign,
        styles: {
          table: mergedTableStyles,
          rows: rowStyles,
          cells: cellStyles,
        },
      },
    };
  } catch (error) {
    console.error("Error processing table:", error);
    return null;
  }
};

const processCellContent = async (
  cell: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
): Promise<string> => {
  try {
    let cellContent = "";
    // Direct-child paragraphs only. A descendant walk would slurp in
    // paragraphs from nested tables and flatten them into this cell's
    // text, duplicating content and destroying the nested layout.
    const paragraphs = getDirectChildrenNS(cell, "p");

    for (const [paraIndex, paragraph] of paragraphs.entries()) {
      if (paraIndex > 0) cellContent += "\n";

      const pPr = getElementByTagNameNS(paragraph, "pPr");
      const paragraphStyles = getParagraphStyles(pPr);

      // Detect list item (w:numPr in paragraph properties)
      const numPrEl = pPr ? getElementByTagNameNS(pPr, "numPr") : null;
      const isListItem = !!numPrEl;
      const ilvlEl = numPrEl ? getElementByTagNameNS(numPrEl, "ilvl") : null;
      const listItemLevel = ilvlEl
        ? parseInt(ilvlEl.getAttributeNS(WORD_NS, "val") || "0")
        : 0;

      let paragraphContent = "";

      for (const child of flattenParagraphChildren(paragraph)) {
        if (child.namespaceURI !== WORD_NS) continue;

        if (child.localName === "r") {
          const run = child;
          const textElement = getElementByTagNameNS(run, "t");
          const brElement = getElementByTagNameNS(run, "br");
          const drawingElement = getElementByTagNameNS(run, "drawing");
          // pdf2docx nests <w:hyperlink> inside <w:r>. See the paragraph
          // loop for the full explanation — same silent-drop bug lands
          // in table cells whenever a cell contains a phone/email link.
          const hyperlinkEl = getElementByTagNameNS(run, "hyperlink");

          if (brElement) paragraphContent += "\n";

          if (hyperlinkEl) {
            const linkHtml = processHyperlink(hyperlinkEl, relationships);
            if (linkHtml) paragraphContent += linkHtml;
          }

          if (textElement) {
            let runText = textElement.textContent || "";

            if (!runText.trim()) {
              runText = "&nbsp;";
            }

            runText = processUnderscorePlaceholders(runText);

            if (textElement.getAttributeNS(WORD_NS, "space") === "preserve") {
              runText = " " + runText + " ";
            }

            const rPr = getElementByTagNameNS(run, "rPr");
            const textStyles = getTextStyles(rPr);

            if (textStyles.length > 0) {
              const safeStyles = textStyles
                .map((s) => s.replace(/"/g, "'"))
                .join("; ");

              runText = `<span style="${safeStyles}">${runText}</span>`;
            }

            paragraphContent += runText;
          } else if (drawingElement) {
            const imageBlock = await processDrawing(
              drawingElement,
              relationships,
              images,
              paragraph,
            );
            if (imageBlock) {
              const imgW = imageBlock.data.dimensions?.width;
              const imgStyle = imgW
                ? `max-width:100%;width:${Math.min(imgW, 300)}px;height:auto;display:block;`
                : `max-width:100%;height:auto;display:block;`;
              paragraphContent += `<img src="${imageBlock.data.url}" style="${imgStyle}" />`;
            }
          }
        } else if (child.localName === "hyperlink") {
          const linkText = processHyperlink(child, relationships);
          if (linkText) paragraphContent += linkText;
        } else if (child.localName === "br") {
          paragraphContent += "\n";
        }
      }

      if (paragraphStyles.length > 0) {
        const safePStyles = paragraphStyles
          .map((s) => s.replace(/"/g, "'"))
          .join("; ");

        paragraphContent = `<div style="${safePStyles}">${paragraphContent}</div>`;
      }

      if (isListItem && paragraphContent.trim()) {
        const indent = "&nbsp;&nbsp;".repeat(listItemLevel);
        paragraphContent = `${indent}• ${paragraphContent}`;
      }
      cellContent += paragraphContent;
    }

    if (!cellContent.trim() && cell.textContent?.trim()) {
      cellContent = processUnderscorePlaceholders(cell.textContent);
    }

    return cellContent.trim() ? cellContent : "&nbsp;";
  } catch (error) {
    console.error("Error processing cell content:", error);
    return "&nbsp;";
  }
};

// OOXML "toggle" property reader. `<w:b/>`, `<w:i/>`, `<w:strike/>`,
// `<w:dstrike/>` are toggle-on when present with no val OR with val
// `"true"`/`"1"`/`"on"`, and explicitly toggle-OFF when val is
// `"false"`/`"0"`/`"off"`. The plain existence check we used before
// silently turned every `<w:i w:val="0"/>` into italic — pdf2docx
// (our PDF→DOCX converter) emits these off-toggles on every non-italic
// run as a belt-and-suspenders override against style inheritance, so
// converted documents rendered as fully italic and fully bold in the
// editor. Only the val="0"/"false" case is a hard OFF; anything else,
// including a missing val, means the toggle is ON.
const isToggleOn = (rPr: Element, name: string): boolean => {
  const el = getElementByTagNameNS(rPr, name);
  if (!el) return false;
  const val = (el.getAttributeNS(WORD_NS, "val") || "").toLowerCase();
  if (val === "0" || val === "false" || val === "off") return false;
  return true;
};

const getTextStyles = (rPr: Element | null): string[] => {
  const styles: string[] = [];

  if (!rPr) return styles;

  const rFonts = getElementByTagNameNS(rPr, "rFonts");
  if (rFonts) {
    // Direct font names first, then theme-font fallbacks. pdf2docx
    // usually emits direct names but Word-authored DOCX can use
    // asciiTheme/hAnsiTheme references — falling through covers both
    // sources. eastAsia is last so Latin text picks up Arial rather
    // than a CJK font when the run has both.
    const ascii = rFonts.getAttributeNS(WORD_NS, "ascii");
    const hAnsi = rFonts.getAttributeNS(WORD_NS, "hAnsi");
    const cs = rFonts.getAttributeNS(WORD_NS, "cs");
    const eastAsia = rFonts.getAttributeNS(WORD_NS, "eastAsia");
    const asciiTheme = rFonts.getAttributeNS(WORD_NS, "asciiTheme");
    const hAnsiTheme = rFonts.getAttributeNS(WORD_NS, "hAnsiTheme");

    const rawFontFamily =
      ascii || hAnsi || cs || eastAsia || asciiTheme || hAnsiTheme;
    if (rawFontFamily) {
      // Strip PDF-embedded subset prefix like "AAABBB+Helvetica-Bold".
      // Embedded subsets tag the font name with six uppercase letters
      // and a "+", per PDF Reference §5.5.3. pdf2docx passes the
      // subset name through verbatim, so browsers can't match it —
      // every subsetted font falls back to the default system font,
      // making PDF-converted docs look like Times New Roman regardless
      // of the source. Strip the prefix so "Helvetica-Bold" reaches
      // the browser's font stack.
      const subsetStripped = rawFontFamily.replace(/^[A-Z]{6}\+/, "");
      // Also drop the trailing style suffix Word/PDF uses for weight
      // variants (e.g. "-Bold", "-Italic", "-BoldItalic") — our bold
      // and italic are already carried separately, and browsers match
      // the plain family name against system fonts.
      const styleSuffix =
        /-?(Bold|Italic|BoldItalic|Regular|Light|Medium|SemiBold|ExtraBold|Black|Thin|Oblique)$/;
      const fontFamily = subsetStripped.replace(styleSuffix, "").trim();
      if (fontFamily) {
        // Add a generic-family fallback so the browser falls back
        // sensibly when the exact font isn't installed. Without this,
        // "Book Antiqua" (a serif) with no match falls to the browser
        // default (Times New Roman on most systems — fine here, but
        // "Calibri" would fall to the same default when it should
        // land on a sans-serif). Pick the fallback bucket by known
        // font names first; default to `sans-serif` for unrecognised
        // Word-family fonts (the majority of modern Word defaults are
        // sans-serif — Calibri, Arial, Segoe UI, Aptos).
        const lower = fontFamily.toLowerCase();
        const isSerif =
          /(times|antiqua|garamond|georgia|palatino|caslon|baskerville|cambria|constantia|didot|goudy|minion|serif)/i.test(
            lower,
          );
        const isMono =
          /(consolas|courier|monaco|menlo|inconsolata|source code|mono)/i.test(
            lower,
          );
        const generic = isMono ? "monospace" : isSerif ? "serif" : "sans-serif";
        styles.push(
          `font-family: ${expandOfficeFontStack(fontFamily, generic)}`,
        );
      }
    }
  }

  // Read `<w:sz>` first (Latin/main script), fall back to `<w:szCs>`
  // (complex script) — pdf2docx sometimes only emits szCs when the
  // source PDF uses a font we categorize as complex-script. `val` is
  // in half-points per spec, so divide by 2. Use parseFloat since some
  // converters emit fractional half-points ("21.5" → 10.75pt).
  const sz = getElementByTagNameNS(rPr, "sz");
  const szCs = getElementByTagNameNS(rPr, "szCs");
  const sizeVal =
    sz?.getAttributeNS(WORD_NS, "val") || szCs?.getAttributeNS(WORD_NS, "val");
  if (sizeVal) {
    const halfPts = parseFloat(sizeVal);
    if (Number.isFinite(halfPts) && halfPts > 0) {
      styles.push(`font-size: ${halfPts / 2}pt`);
    }
  }

  const color = getElementByTagNameNS(rPr, "color");
  if (color) {
    const val = color.getAttributeNS(WORD_NS, "val");
    if (val && val !== "auto") {
      styles.push(`color: #${val}`);
    }
  }

  const highlight = getElementByTagNameNS(rPr, "highlight");
  if (highlight) {
    const val = highlight.getAttributeNS(WORD_NS, "val");
    if (val) {
      const backgroundColor = getHighlightColor(val);
      styles.push(`background-color: ${backgroundColor}`);
    }
  }

  const shd = getElementByTagNameNS(rPr, "shd");
  if (shd) {
    const fill = shd.getAttributeNS(WORD_NS, "fill");
    if (fill && fill !== "auto") {
      styles.push(`background-color: #${fill}`);
    }
  }

  const vertAlign = getElementByTagNameNS(rPr, "vertAlign");
  if (vertAlign) {
    const val = vertAlign.getAttributeNS(WORD_NS, "val");
    switch (val) {
      case "superscript":
        styles.push("vertical-align: super");
        styles.push("font-size: smaller");
        break;
      case "subscript":
        styles.push("vertical-align: sub");
        styles.push("font-size: smaller");
        break;
    }
  }

  if (isToggleOn(rPr, "strike") || isToggleOn(rPr, "dstrike")) {
    styles.push("text-decoration: line-through");
  }

  if (isToggleOn(rPr, "b")) {
    styles.push("font-weight: bold");
  }

  if (isToggleOn(rPr, "i")) {
    styles.push("font-style: italic");
  }

  const u = getElementByTagNameNS(rPr, "u");
  if (u) {
    const val = u.getAttributeNS(WORD_NS, "val") || "single";
    // `<w:u w:val="none"/>` explicitly turns underline OFF. Missing val
    // defaults to "single" per spec, so an underline element with no
    // val is still an underline. Same class of toggle-off bug as `<w:i>`.
    if (val !== "none") {
      const colorAttr = u.getAttributeNS(WORD_NS, "color");

      let underlineStyle = "underline";
      switch (val) {
        case "double":
          underlineStyle = "underline double";
          break;
        case "wave":
          underlineStyle = "underline wavy";
          break;
        default:
          underlineStyle = "underline";
      }

      if (colorAttr && colorAttr !== "auto") {
        styles.push(`text-decoration: ${underlineStyle} #${colorAttr}`);
      } else {
        styles.push(`text-decoration: ${underlineStyle}`);
      }
    }
  }

  return styles;
};

const getCellBackgroundColor = (tcPr: Element | null): string | null => {
  if (tcPr) {
    const shd = getElementByTagNameNS(tcPr, "shd");
    if (shd) {
      return shd.getAttributeNS(WORD_NS, "fill") || null;
    }
  }
  return null;
};

const getCellTextColor = (tcPr: Element | null): string | null => {
  if (tcPr) {
    const color = getElementByTagNameNS(tcPr, "color");
    if (color) {
      return color.getAttributeNS(WORD_NS, "val") || null;
    }
  }
  return null;
};

const getRowStyles = (
  trPr: Element | null,
  rowIndex: number,
  conditionalFormatting: ReturnType<typeof getTableConditionalFormatting>,
): string[] => {
  const styles: string[] = [];

  if (!trPr) return styles;

  // Row background color
  const shd = getElementByTagNameNS(trPr, "shd");
  if (shd) {
    const fill = shd.getAttributeNS(WORD_NS, "fill");
    if (fill && fill !== "auto") {
      styles.push(`background-color: #${fill}`);
    }
  }
  if (conditionalFormatting.firstRow && rowIndex === 0) {
    styles.push("font-weight: bold");
  }

  return styles;
};

const getDetailedBorders = (borders: Element): string[] => {
  const styles: string[] = [];
  const sides = ["top", "right", "bottom", "left"];

  sides.forEach((side) => {
    const border = getElementByTagNameNS(borders, side);
    if (border) {
      const val = border.getAttributeNS(WORD_NS, "val");
      const size = border.getAttributeNS(WORD_NS, "sz");
      const color = border.getAttributeNS(WORD_NS, "color");

      if (val && val !== "none") {
        const width = size
          ? `${Math.max(1, Number.parseInt(size) / 8)}px`
          : "1px";
        const borderColor = color && color !== "auto" ? `#${color}` : "#000000";
        styles.push(`border-${side}: ${width} solid ${borderColor}`);
      }
    }
  });

  return styles;
};

const getTableConditionalFormatting = (
  tblLook: Element | null,
): {
  firstRow: boolean;
  lastRow: boolean;
  firstColumn: boolean;
  lastColumn: boolean;
  noHBand: boolean;
  noVBand: boolean;
} => {
  const defaultValue = {
    firstRow: false,
    lastRow: false,
    firstColumn: false,
    lastColumn: false,
    noHBand: false,
    noVBand: false,
  };

  if (!tblLook) return defaultValue;

  try {
    return {
      firstRow: tblLook.getAttributeNS(WORD_NS, "firstRow") === "1",
      lastRow: tblLook.getAttributeNS(WORD_NS, "lastRow") === "1",
      firstColumn: tblLook.getAttributeNS(WORD_NS, "firstColumn") === "1",
      lastColumn: tblLook.getAttributeNS(WORD_NS, "lastColumn") === "1",
      noHBand: tblLook.getAttributeNS(WORD_NS, "noHBand") === "1",
      noVBand: tblLook.getAttributeNS(WORD_NS, "noVBand") === "1",
    };
  } catch (error) {
    console.error("Error parsing table look:", error);
    return defaultValue;
  }
};

// const getTextStyles = (rPr: Element | null) => {
//   const styles: string[] = [];

//   if (!rPr) return styles;

//   // Font family
//   const rFonts = getElementByTagNameNS(rPr, "rFonts");
//   if (rFonts) {
//     const themeFont =
//       rFonts.getAttributeNS(WORD_NS, "asciiTheme") ||
//       rFonts.getAttributeNS(WORD_NS, "hAnsiTheme") ||
//       rFonts.getAttributeNS(WORD_NS, "cstheme");

//     if (themeFont) {
//       const fontFamily = mapThemeFont(themeFont);
//       styles.push(`font-family: ${fontFamily}`);
//     } else {
//       const fontFamily =
//         rFonts.getAttributeNS(WORD_NS, "ascii") ||
//         rFonts.getAttributeNS(WORD_NS, "hAnsi") ||
//         rFonts.getAttributeNS(WORD_NS, "cs");

//       if (fontFamily) {
//         styles.push(`font-family: "${fontFamily}, Arial, sans-serif"`);
//       }
//     }
//   }

//   // Font size
//   const sz = getElementByTagNameNS(rPr, "sz");
//   if (sz) {
//     const size = sz.getAttributeNS(WORD_NS, "val");
//     if (size) {
//       styles.push(`font-size: ${Number.parseInt(size) / 2}pt`);
//     }
//   }

//   // Text color
//   const color = getElementByTagNameNS(rPr, "color");
//   if (color) {
//     const val = color.getAttributeNS(WORD_NS, "val");
//     if (val && val !== "auto") {
//       styles.push(`color: #${val}`);
//     }
//   }

//   // Background color (highlight)
//   const highlight = getElementByTagNameNS(rPr, "highlight");
//   if (highlight) {
//     const val = highlight.getAttributeNS(WORD_NS, "val");
//     if (val) {
//       const backgroundColor = getHighlightColor(val);
//       styles.push(`background-color: ${backgroundColor}`);
//     }
//   }

//   // Background color (shading)
//   const shd = getElementByTagNameNS(rPr, "shd");
//   if (shd) {
//     const fill = shd.getAttributeNS(WORD_NS, "fill");
//     if (fill && fill !== "auto") {
//       styles.push(`background-color: #${fill}`);
//     }
//   }

//   // Vertical alignment (superscript/subscript)
//   const vertAlign = getElementByTagNameNS(rPr, "vertAlign");
//   if (vertAlign) {
//     const val = vertAlign.getAttributeNS(WORD_NS, "val");
//     switch (val) {
//       case "superscript":
//         styles.push("vertical-align: super");
//         styles.push("font-size: smaller");
//         break;
//       case "subscript":
//         styles.push("vertical-align: sub");
//         styles.push("font-size: smaller");
//         break;
//     }
//   }

//   // Strike through and double strike through
//   const strike = getElementByTagNameNS(rPr, "strike");
//   const dstrike = getElementByTagNameNS(rPr, "dstrike");
//   if (strike || dstrike) {
//     styles.push("text-decoration: line-through");
//   }

//   // Bold
//   if (getElementByTagNameNS(rPr, "b")) {
//     styles.push("font-weight: bold");
//   }

//   // Italic
//   if (getElementByTagNameNS(rPr, "i")) {
//     styles.push("font-style: italic");
//   }

//   // Underline
//   const u = getElementByTagNameNS(rPr, "u");
//   if (u) {
//     const val = u.getAttributeNS(WORD_NS, "val") || "single";
//     switch (val) {
//       case "double":
//         styles.push("text-decoration: underline double");
//         break;
//       case "wave":
//         styles.push("text-decoration: underline wavy");
//         break;
//       default:
//         styles.push("text-decoration: underline");
//     }
//   }

//   return styles;
// };

const getParagraphStyles = (pPr: Element | null) => {
  const styles: string[] = [];

  if (!pPr) return styles;

  // ⚠️ This function used to access pPr.jc["@_val"] (fast-xml-parser
  // shape) but is called with DOM Elements produced by
  // getElementByTagNameNS. Every lookup silently returned undefined,
  // which is why per-paragraph alignment / indent / spacing was missing
  // inside table cells (cells relied on this to build inline styles per
  // <p>). Rewritten to use the same DOM API the rest of the parser
  // already speaks.

  // Alignment (w:jc) — per-paragraph, so a cell can have a left-aligned
  // "Name:" and a right-aligned "Signed by:" side by side.
  const jc = getElementByTagNameNS(pPr, "jc");
  if (jc) {
    const alignment = (jc.getAttributeNS(WORD_NS, "val") || "").toLowerCase();
    switch (alignment) {
      case "center":
        styles.push("text-align: center");
        break;
      case "right":
      case "end":
        styles.push("text-align: right");
        break;
      case "both":
      case "justify":
        styles.push("text-align: justify");
        break;
      default:
        styles.push("text-align: left");
    }
  }

  // Indentation (w:ind) — same precise-twips model as
  // getPreciseIndentStyle in the body flow. Hanging beats firstLine so
  // wrapped lines align correctly with numbered / bulleted content.
  const ind = getElementByTagNameNS(pPr, "ind");
  if (ind) {
    const twips = (attr: string): number => {
      const v = ind.getAttributeNS(WORD_NS, attr);
      if (!v) return 0;
      const n = parseInt(v);
      return Number.isFinite(n) ? n : 0;
    };
    const leftTw = twips("left") || twips("start");
    const rightTw = twips("right") || twips("end");
    const firstLineTw = twips("firstLine");
    const hangingTw = twips("hanging");
    if (leftTw > 0) styles.push(`margin-left: ${leftTw / 20}pt`);
    if (rightTw > 0) styles.push(`margin-right: ${rightTw / 20}pt`);
    if (hangingTw > 0) {
      styles.push(`text-indent: -${hangingTw / 20}pt`);
      styles.push(`padding-left: ${hangingTw / 20}pt`);
    } else if (firstLineTw > 0) {
      styles.push(`text-indent: ${firstLineTw / 20}pt`);
    }
  }

  // Spacing (w:spacing) — line-height respects `lineRule`; before/after
  // are always twips.
  const sp = getElementByTagNameNS(pPr, "spacing");
  if (sp) {
    const before = sp.getAttributeNS(WORD_NS, "before");
    const after = sp.getAttributeNS(WORD_NS, "after");
    const line = sp.getAttributeNS(WORD_NS, "line");
    const lineRule = (
      sp.getAttributeNS(WORD_NS, "lineRule") || "auto"
    ).toLowerCase();

    if (before) {
      const n = parseInt(before);
      if (Number.isFinite(n) && n > 0) styles.push(`margin-top: ${n / 20}pt`);
    }
    if (after) {
      const n = parseInt(after);
      if (Number.isFinite(n) && n > 0)
        styles.push(`margin-bottom: ${n / 20}pt`);
    }
    if (line) {
      const n = parseInt(line);
      if (Number.isFinite(n) && n > 0) {
        if (lineRule === "exact" || lineRule === "atleast") {
          styles.push(`line-height: ${n / 20}pt`);
        } else {
          // See getSpacingStyle above for the compensation rationale
          // — keep the two paths in sync so headers/footers render at
          // the same visual density as body paragraphs.
          const rawMultiplier = n / 240;
          const compensated = 1 + Math.max(0, rawMultiplier - 1) * 0.7;
          styles.push(`line-height: ${Math.round(compensated * 100) / 100}`);
        }
      }
    }
  }

  return styles;
};

const getHighlightColor = (color: string): string => {
  const colorMap: { [key: string]: string } = {
    yellow: "#FFFF00",
    green: "#00FF00",
    cyan: "#00FFFF",
    magenta: "#FF00FF",
    blue: "#0000FF",
    red: "#FF0000",
    darkBlue: "#000080",
    darkCyan: "#008080",
    darkGreen: "#008000",
    darkMagenta: "#800080",
    darkRed: "#800000",
    darkYellow: "#808000",
    darkGray: "#808080",
    lightGray: "#C0C0C0",
    black: "#000000",
  };
  return colorMap[color] || color;
};

const mapThemeFont = (themeFont: string): string => {
  const themeFontMap: { [key: string]: string } = {
    minorHAnsi: "Arial, sans-serif",
    minorBidi: "Arial, sans-serif",
    minorEastAsia: "Arial, sans-serif",
    majorHAnsi: "Times New Roman, serif",
    majorBidi: "Times New Roman, serif",
    majorEastAsia: "Times New Roman, serif",
  };
  return themeFontMap[themeFont] || "Arial, sans-serif";
};
const createHiddenBorderTable = (
  content: string[][],
  columnWidths?: number[],
  backgroundColor: string = "transparent",
): any => {
  const id =
    "table-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
  return {
    type: "table",
    data: {
      id,
      content,
      withHeading: false,
      headerRows: [],
      hideBorders: true,
      columnWidths:
        columnWidths && columnWidths.length > 0 ? columnWidths : undefined,
      styles: {
        table: {
          width: "100%",
          backgroundColor,
          borderColor: "transparent",
          borderWidth: "0px",
          borderStyle: "none",
          tableLayout: "fixed",
        },
        rows: {},
        cells: {},
      },
    },
  };
};

// Word footers frequently paint their blue/coloured "band" via a
// wsp shape whose spPr carries <a:solidFill>. The fill can be either
// <a:srgbClr val="RRGGBB"> (literal hex, easy) OR <a:schemeClr val="tx2"
// lumMod=".." lumOff="..">  (theme colour with luminance transform —
// what Word's default header/footer templates emit). The text lives
// in a separate wsp on top. Our editor renders the footer as a
// hidden-border-table, so we lift the fill color out of the
// underlying shape and plumb it onto the table's backgroundColor.
// Returns "" if no shape has a resolvable solid fill.
const extractShapeSolidFillColor = (root: Element): string => {
  const shapes = root.getElementsByTagNameNS(
    "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "wsp",
  );
  for (const wsp of Array.from(shapes)) {
    const spPr = wsp.getElementsByTagNameNS(
      "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
      "spPr",
    )[0];
    if (!spPr) continue;
    const solidFill = spPr.getElementsByTagNameNS(MAIN_NS, "solidFill")[0];
    if (!solidFill) continue;
    const srgb = solidFill.getElementsByTagNameNS(MAIN_NS, "srgbClr")[0];
    const srgbVal = srgb?.getAttribute("val");
    if (srgbVal && /^[0-9A-Fa-f]{6}$/.test(srgbVal)) {
      return `#${srgbVal}`;
    }
    // schemeClr fallback — resolve via the theme palette + lumMod/lumOff
    // so "tx2 lightened 40%" bands (default Word footer accent) don't
    // silently render as transparent.
    const scheme = solidFill.getElementsByTagNameNS(MAIN_NS, "schemeClr")[0];
    if (scheme) {
      const schemeVal = scheme.getAttribute("val") ?? "";
      const lumModEl = scheme.getElementsByTagNameNS(MAIN_NS, "lumMod")[0];
      const lumOffEl = scheme.getElementsByTagNameNS(MAIN_NS, "lumOff")[0];
      const lumMod = lumModEl
        ? parseInt(lumModEl.getAttribute("val") ?? "100000")
        : undefined;
      const lumOff = lumOffEl
        ? parseInt(lumOffEl.getAttribute("val") ?? "0")
        : undefined;
      if (schemeVal) return resolveSchemeColor(schemeVal, lumMod, lumOff);
    }
  }
  return "";
};

const blockToHtml = (block: any): string => {
  if (!block) return "";
  if (Array.isArray(block)) return block.map(blockToHtml).join("");
  if (block.type === "image") {
    const url = block.data?.url || "";
    // Respect the DOCX-authored image dimensions (EMU → CSS px is
    // handled where the block is built). Without this the logo used
    // to stretch to 100% of the surrounding column (making a 60px
    // Hallmark logo fill 40% of the header). Fall back to max-width
    // 100% only when the source didn't record a size.
    const w = block.data?.dimensions?.width;
    const h = block.data?.dimensions?.height;
    const style =
      w && h
        ? `width:${w}px;height:${h}px;max-width:100%;object-fit:contain;display:inline-block;vertical-align:middle;`
        : `max-width:100%;height:auto;`;
    return `<img src="${url}" style="${style}" />`;
  }
  return block.data?.text || "";
};

// ─── Floating-layout helpers (for anchor/textbox-heavy documents) ────────────

/**
 * Resolve a DrawingML scheme color name + optional lumMod / lumOff to a
 * hex string. Based on the default Office "Office" theme palette.
 *
 * DrawingML luminance transforms operate in HSL space: the new
 * luminance is `L * (lumMod/100000) + (lumOff/100000)`. Multiplying
 * RGB directly (the prior implementation) darkens colors correctly
 * for pure lumMod but breaks entirely when lumOff is present — the
 * "tx2 lighter 40%" pattern Word emits for header/footer bands
 * (lumMod=60000 + lumOff=40000) ended up 60% of the base color
 * (darker) instead of 60% + 40% offset (lighter). Doing it in HSL
 * gets both cases right.
 */
const resolveSchemeColor = (
  schemeVal: string,
  lumMod?: number,
  lumOff?: number,
): string => {
  const SCHEME_MAP: Record<string, string> = {
    bg1: "FFFFFF",
    dk1: "000000",
    lt1: "FFFFFF",
    tx1: "000000",
    bg2: "E7E6E6",
    dk2: "44546A",
    lt2: "E7E6E6",
    tx2: "44546A",
    accent1: "4472C4",
    accent2: "ED7D31",
    accent3: "A9D18E",
    accent4: "FFC000",
    accent5: "5B9BD5",
    accent6: "70AD47",
  };
  const baseHex = SCHEME_MAP[schemeVal] ?? "808080";
  const r = parseInt(baseHex.slice(0, 2), 16) / 255;
  const g = parseInt(baseHex.slice(2, 4), 16) / 255;
  const b = parseInt(baseHex.slice(4, 6), 16) / 255;
  // RGB → HSL
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  // Apply lumMod × luminance + lumOff. Both are permille (100000 = 100%).
  const mod = lumMod !== undefined ? lumMod / 100000 : 1;
  const off = lumOff !== undefined ? lumOff / 100000 : 0;
  const newL = Math.min(1, Math.max(0, l * mod + off));
  // HSL → RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let nr: number;
  let ng: number;
  let nb: number;
  if (s === 0) {
    nr = ng = nb = newL;
  } else {
    const q = newL < 0.5 ? newL * (1 + s) : newL + s - newL * s;
    const p = 2 * newL - q;
    nr = hue2rgb(p, q, h + 1 / 3);
    ng = hue2rgb(p, q, h);
    nb = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
};

/** Extract fill color from a DrawingML <a:spPr> → returns hex like "#D9D9D9" or null */
const getAnchorFillColor = (anchor: Element): string | null => {
  const solidFills = anchor.getElementsByTagNameNS(MAIN_NS, "solidFill");
  if (!solidFills.length) return null;
  const sf = solidFills[0];
  const srgb = sf.getElementsByTagNameNS(MAIN_NS, "srgbClr")[0];
  if (srgb) {
    const val = srgb.getAttribute("val");
    return val ? `#${val}` : null;
  }
  const scheme = sf.getElementsByTagNameNS(MAIN_NS, "schemeClr")[0];
  if (scheme) {
    const schemeVal = scheme.getAttribute("val") ?? "";
    const lumModEl = scheme.getElementsByTagNameNS(MAIN_NS, "lumMod")[0];
    const lumOffEl = scheme.getElementsByTagNameNS(MAIN_NS, "lumOff")[0];
    const lumMod = lumModEl
      ? parseInt(lumModEl.getAttribute("val") ?? "100000")
      : undefined;
    const lumOff = lumOffEl
      ? parseInt(lumOffEl.getAttribute("val") ?? "0")
      : undefined;
    return resolveSchemeColor(schemeVal, lumMod, lumOff);
  }
  return null;
};

interface AnchorInfo {
  posX: number; // EMUs from left
  posY: number; // EMUs from top
  width: number; // EMUs
  height: number; // EMUs
  type: "textbox" | "image" | "shape";
  html: string; // HTML string content
  bgColor: string | null;
}

/** Extract position, size, type and HTML content from a single <wp:anchor> */
const processAnchorElement = async (
  anchor: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
): Promise<AnchorInfo | null> => {
  try {
    const extent = anchor.getElementsByTagNameNS(DRAWING_NS, "extent")[0];
    const width = extent ? parseInt(extent.getAttribute("cx") ?? "0") : 0;
    const height = extent ? parseInt(extent.getAttribute("cy") ?? "0") : 0;

    const posHEl = anchor.getElementsByTagNameNS(DRAWING_NS, "positionH")[0];
    const posVEl = anchor.getElementsByTagNameNS(DRAWING_NS, "positionV")[0];
    let posX = 0,
      posY = 0;
    if (posHEl) {
      const off = posHEl.getElementsByTagNameNS(DRAWING_NS, "posOffset")[0];
      const aln = posHEl.getElementsByTagNameNS(DRAWING_NS, "align")[0];
      if (off) posX = parseInt(off.textContent ?? "0");
      else if (aln?.textContent === "right") posX = 7 * EMU_PER_INCH;
    }
    if (posVEl) {
      const off = posVEl.getElementsByTagNameNS(DRAWING_NS, "posOffset")[0];
      if (off) posY = parseInt(off.textContent ?? "0");
    }

    const bgColor = getAnchorFillColor(anchor);

    // Check for image (<pic:pic>)
    const hasPic = anchor.getElementsByTagNameNS(PICTURE_NS, "pic").length > 0;
    if (hasPic) {
      const imageBlock = await processDrawing(
        anchor,
        relationships,
        images,
        null,
      );
      if (imageBlock) {
        const imgW = imageBlock.data?.dimensions?.width;
        const imgStyle = imgW
          ? `max-width:100%;width:${Math.min(imgW, 200)}px;height:auto;display:block;`
          : `max-width:100%;height:auto;display:block;`;
        return {
          posX,
          posY,
          width,
          height,
          type: "image",
          html: `<img src="${imageBlock.data.url}" style="${imgStyle}" />`,
          bgColor,
        };
      }
    }

    // Check for text box (<wps:txbx>)
    const txbxEl = anchor.getElementsByTagNameNS(WPS_NS, "txbx")[0];
    if (txbxEl) {
      const txbxContent = txbxEl.getElementsByTagNameNS(
        WORD_NS,
        "txbxContent",
      )[0];
      if (txbxContent) {
        const html = await processCellContent(
          txbxContent,
          relationships,
          images,
        );
        return { posX, posY, width, height, type: "textbox", html, bgColor };
      }
    }

    // Pure shape (no text, no image) — useful for background colors
    return { posX, posY, width, height, type: "shape", html: "", bgColor };
  } catch (err) {
    console.error("Error processing anchor element:", err);
    return null;
  }
};

/**
 * Create a layout table block with per-column background color support.
 * columns: array of { html, widthPct, bgColor? }
 */
const createLayoutTable = (
  columns: Array<{ html: string; widthPct: number; bgColor?: string | null }>,
): any => {
  const id =
    "table-" + Date.now() + "-" + Math.random().toString(36).substring(2, 9);
  const totalPct = columns.reduce((s, c) => s + c.widthPct, 0);
  const columnWidths = columns.map(
    (c) => Math.round((c.widthPct / totalPct) * 10000) / 100,
  );
  const cells: any = { "0": {} };
  columns.forEach((col, idx) => {
    if (col.bgColor) {
      cells["0"][idx] = { backgroundColor: col.bgColor, verticalAlign: "top" };
    } else {
      cells["0"][idx] = { verticalAlign: "top" };
    }
  });
  return {
    type: "table",
    data: {
      id,
      content: [columns.map((c) => c.html)],
      withHeading: false,
      headerRows: [],
      hideBorders: true,
      columnWidths,
      styles: {
        table: {
          width: "100%",
          backgroundColor: "transparent",
          borderColor: "transparent",
          borderWidth: "0px",
          borderStyle: "none",
          tableLayout: "fixed",
        },
        rows: {},
        cells,
      },
    },
  };
};

/**
 * Process a floating-layout document body (where all content is in <wp:anchor> shapes).
 * Groups text boxes by horizontal position into columns and returns EditorJS blocks.
 */
const processFloatingDocumentLayout = async (
  body: Element,
  relationships: { [key: string]: string },
  images: { [key: string]: string },
): Promise<any[] | null> => {
  const allAnchors = Array.from(
    body.getElementsByTagNameNS(DRAWING_NS, "anchor"),
  );
  if (allAnchors.length < 2) return null;

  // Process every anchor concurrently
  const infos = (
    await Promise.all(
      allAnchors.map((a) => processAnchorElement(a, relationships, images)),
    )
  ).filter((x): x is AnchorInfo => x !== null);

  if (!infos.length) return null;

  // Only textboxes/images with actual content form the column layout
  const contentAnchors = infos.filter(
    (a) => (a.type === "textbox" || a.type === "image") && a.html.trim(),
  );
  if (!contentAnchors.length) return null;

  // Find a column split point: the largest horizontal gap between anchor groups
  // Sort by posX and look for the biggest gap between (posX+width) of one group and posX of the next
  const sorted = [...contentAnchors].sort((a, b) => a.posX - b.posX);
  const SPLIT_THRESHOLD = 0.8 * EMU_PER_INCH; // gap must be ≥ 0.8" to count as a column split

  let splitX = -Infinity;
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const rightEdge = sorted[i].posX + sorted[i].width;
    const nextLeft = sorted[i + 1].posX;
    const gap = nextLeft - rightEdge;
    if (gap > maxGap) {
      maxGap = gap;
      splitX = (rightEdge + nextLeft) / 2;
    }
  }

  const hasMultipleColumns = maxGap >= SPLIT_THRESHOLD;

  if (!hasMultipleColumns) {
    // Single-column — just stack all content
    sorted.sort((a, b) => a.posY - b.posY);
    const html = sorted.map((a) => a.html).join("");
    return [createLayoutTable([{ html, widthPct: 100, bgColor: null }])];
  }

  // Two-column layout detected
  const leftAnchors = contentAnchors
    .filter((a) => a.posX < splitX)
    .sort((a, b) => a.posY - b.posY);
  const rightAnchors = contentAnchors
    .filter((a) => a.posX >= splitX)
    .sort((a, b) => a.posY - b.posY);

  // Background colors: find tall shape anchors that span the full height (sidebar bg)
  const shapeAnchors = infos.filter((a) => a.type === "shape" && a.bgColor);
  const leftBgColor = (() => {
    const candidate = shapeAnchors.find(
      (s) => s.posX < splitX && s.height > 5 * EMU_PER_INCH,
    );
    return candidate?.bgColor ?? null;
  })();

  const leftHtml = leftAnchors.map((a) => a.html).join("");
  const rightHtml = rightAnchors.map((a) => a.html).join("");

  // Compute approximate column width percentages from EMU widths
  const leftWidthEmu =
    leftAnchors.reduce((max, a) => Math.max(max, a.width), 0) ||
    2.5 * EMU_PER_INCH;
  const rightWidthEmu =
    rightAnchors.reduce((max, a) => Math.max(max, a.width), 0) ||
    4.5 * EMU_PER_INCH;
  const totalEmu = leftWidthEmu + rightWidthEmu;
  const leftPct = Math.round((leftWidthEmu / totalEmu) * 100);
  const rightPct = 100 - leftPct;

  const blocks: any[] = [];

  // Check for a "header" row — anchors that appear above both columns (shared name banner)
  const minBodyY = Math.min(
    ...[...leftAnchors, ...rightAnchors].map((a) => a.posY),
  );
  const headerTextAnchors = contentAnchors
    .filter((a) => a.posY < minBodyY - 0.3 * EMU_PER_INCH)
    .sort((a, b) => a.posY - b.posY);

  if (headerTextAnchors.length > 0) {
    const headerBgShape = shapeAnchors.find(
      (s) => s.posY < minBodyY && s.width > 5 * EMU_PER_INCH,
    );
    const headerBg = headerBgShape?.bgColor ?? null;
    const leftHeaderAnchors = headerTextAnchors.filter((a) => a.posX < splitX);
    const rightHeaderAnchors = headerTextAnchors.filter(
      (a) => a.posX >= splitX,
    );

    if (leftHeaderAnchors.length > 0 && rightHeaderAnchors.length > 0) {
      blocks.push(
        createLayoutTable([
          {
            html: leftHeaderAnchors.map((a) => a.html).join(""),
            widthPct: leftPct,
            bgColor: leftBgColor ?? headerBg,
          },
          {
            html: rightHeaderAnchors.map((a) => a.html).join(""),
            widthPct: rightPct,
            bgColor: headerBg,
          },
        ]),
      );
    } else {
      blocks.push(
        createLayoutTable([
          {
            html: headerTextAnchors.map((a) => a.html).join(""),
            widthPct: 100,
            bgColor: headerBg,
          },
        ]),
      );
    }
  }

  // Main two-column body
  if (leftHtml || rightHtml) {
    blocks.push(
      createLayoutTable([
        { html: leftHtml, widthPct: leftPct, bgColor: leftBgColor },
        { html: rightHtml, widthPct: rightPct, bgColor: null },
      ]),
    );
  }

  return blocks.length > 0 ? blocks : null;
};

const getMimeType = (extension: string): string | null => {
  const mimeTypes: { [key: string]: string } = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
    tiff: "image/tiff",
    tif: "image/tiff",
    // Word's native vector formats. Browsers can't render them, but we
    // still want the extraction step to succeed so the image lookup
    // by relationship ID matches. Downstream code substitutes a
    // placeholder for these when rendering — dropping them at
    // extraction meant WMF/EMF-only images (icons, company logos on
    // headers, older PDFs re-exported to DOCX) went missing entirely.
    emf: "image/x-emf",
    wmf: "image/x-wmf",
    // Newer / rarer formats that occasionally show up.
    heic: "image/heic",
    heif: "image/heif",
    ico: "image/x-icon",
    jfif: "image/jpeg",
    // JPEG-XR / HD Photo — Office SmartArt exports use these.
    wdp: "image/vnd.ms-photo",
    jxr: "image/jxr",
  };

  return mimeTypes[extension] || null;
};

const getTableStyles = (tblPr: Element | null): { [key: string]: string } => {
  const styles: { [key: string]: string } = {
    width: "100%",
    borderCollapse: "collapse",
  };

  if (!tblPr) return styles;

  const tblBorders = getElementByTagNameNS(tblPr, "tblBorders");
  if (tblBorders) {
    const borderStyles = getDetailedBorders(tblBorders);
    borderStyles.forEach((style) => {
      const [property, value] = style.split(": ");
      styles[property] = value;
    });
  }

  const tblW = getElementByTagNameNS(tblPr, "tblW");
  if (tblW) {
    const width = tblW.getAttributeNS(WORD_NS, "w");
    const type = tblW.getAttributeNS(WORD_NS, "type");
    if (width && type) {
      if (type === "pct") {
        styles.width = `${Number.parseInt(width) / 50}%`;
      } else if (type === "dxa") {
        styles.width = `${Number.parseInt(width) / 20}pt`;
      }
    }
  }

  return styles;
};
const getCellStyles = (
  tcPr: Element | null,
  rowIndex: number,
  cellIndex: number,
  conditionalFormatting: ReturnType<typeof getTableConditionalFormatting>,
  rowStyles: string[],
  tableStyleConfig: any = {},
): string[] => {
  const styles: string[] = [];

  if (tableStyleConfig) {
    if (rowIndex === 0 && tableStyleConfig.firstRow) {
      Object.entries(tableStyleConfig.firstRow).forEach(([key, value]) => {
        styles.push(
          `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value}`,
        );
      });
    } else if (rowIndex % 2 === 0 && tableStyleConfig.evenRow) {
      Object.entries(tableStyleConfig.evenRow).forEach(([key, value]) => {
        styles.push(
          `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value}`,
        );
      });
    } else if (rowIndex % 2 === 1 && tableStyleConfig.oddRow) {
      Object.entries(tableStyleConfig.oddRow).forEach(([key, value]) => {
        styles.push(
          `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value}`,
        );
      });
    }

    if (tableStyleConfig.cell) {
      Object.entries(tableStyleConfig.cell).forEach(([key, value]) => {
        styles.push(
          `${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${value}`,
        );
      });
    }
  }

  if (!tcPr) return styles;

  // Cell borders
  const tcBorders = getElementByTagNameNS(tcPr, "tcBorders");
  if (tcBorders) {
    const borderStyles = getDetailedBorders(tcBorders);
    styles.push(...borderStyles);
  }

  // Cell background color
  const shd = getElementByTagNameNS(tcPr, "shd");
  if (shd) {
    const fill = shd.getAttributeNS(WORD_NS, "fill");
    if (fill && fill !== "auto") {
      styles.push(`background-color: #${fill}`);
    }
  }

  const tcMar = getElementByTagNameNS(tcPr, "tcMar");
  if (tcMar) {
    const top = getElementByTagNameNS(tcMar, "top");
    const bottom = getElementByTagNameNS(tcMar, "bottom");
    const left = getElementByTagNameNS(tcMar, "left");
    const right = getElementByTagNameNS(tcMar, "right");

    if (top) {
      const val = top.getAttributeNS(WORD_NS, "w");
      if (val) styles.push(`padding-top: ${parseInt(val) / 20}pt`);
    }
    if (bottom) {
      const val = bottom.getAttributeNS(WORD_NS, "w");
      if (val) styles.push(`padding-bottom: ${parseInt(val) / 20}pt`);
    }
    if (left) {
      const val = left.getAttributeNS(WORD_NS, "w");
      if (val) styles.push(`padding-left: ${parseInt(val) / 20}pt`);
    }
    if (right) {
      const val = right.getAttributeNS(WORD_NS, "w");
      if (val) styles.push(`padding-right: ${parseInt(val) / 20}pt`);
    }
  }

  if (conditionalFormatting.firstColumn && cellIndex === 0) {
    styles.push("font-weight: bold");
  }

  return styles;
};

const processVerticalMerges = (content: string[][]) => {
  const rowCount = content.length;
  const colCount = content[0].length;

  for (let col = 0; col < colCount; col++) {
    let currentRowspan = 1;
    let startRow = 0;

    for (let row = 0; row < rowCount; row++) {
      const cell = content[row][col];
      if (cell && cell.includes('rowspan="1"')) {
        if (currentRowspan > 1) {
          content[startRow][col] = content[startRow][col].replace(
            'rowspan="1"',
            `rowspan="${currentRowspan}"`,
          );
        }
        startRow = row;
        currentRowspan = 1;
      } else if (!cell) {
        currentRowspan++;
      }
    }

    if (currentRowspan > 1) {
      content[startRow][col] = content[startRow][col].replace(
        'rowspan="1"',
        `rowspan="${currentRowspan}"`,
      );
    }
  }
};

// ─── Section-level layout extraction ──────────────────────────────────────
//
// Pulls `w:pgSz` (paper size + orientation) and `w:pgMar` (page margins)
// off the given `w:sectPr`. Both are twips (1/20 pt); CSS consumers want
// px, so we convert via 1 twip = 1/1440 inch × 96 px/inch = 1/15 px.
// Paper size snaps to the closest named preset (A4 / LETTER / LEGAL /
// A3 / A5) by comparing the stored width — DOCX stores the raw dimensions
// not a name, so we have to recognize them.

const PAPER_SIZE_PRESETS: Array<{
  name: "A4" | "LETTER" | "LEGAL" | "A3" | "A5";
  widthTw: number;
  heightTw: number;
}> = [
  { name: "A4", widthTw: 11906, heightTw: 16838 },
  { name: "LETTER", widthTw: 12240, heightTw: 15840 },
  { name: "LEGAL", widthTw: 12240, heightTw: 20160 },
  { name: "A3", widthTw: 16838, heightTw: 23811 },
  { name: "A5", widthTw: 8392, heightTw: 11906 },
];

const closestPaperSize = (
  wTw: number,
  hTw: number,
): "A4" | "LETTER" | "LEGAL" | "A3" | "A5" | undefined => {
  // Orientation is independent; compare using min/max to match either way.
  const minDim = Math.min(wTw, hTw);
  const maxDim = Math.max(wTw, hTw);
  let best: (typeof PAPER_SIZE_PRESETS)[number] | undefined;
  let bestDelta = Infinity;
  for (const p of PAPER_SIZE_PRESETS) {
    const delta =
      Math.abs(p.widthTw - minDim) + Math.abs(p.heightTw - maxDim);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  // Only snap if we're within ~0.5" tolerance; otherwise bail.
  if (best && bestDelta < 720) return best.name;
  return undefined;
};

const twipsToPx = (tw: string | null | undefined): number | undefined => {
  if (!tw) return undefined;
  const n = parseInt(tw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // 1 twip = 1/1440 inch; CSS px = inch × 96 → px = twips / 15
  return Math.round(n / 15);
};

const extractSectionLayout = (
  sectPr: Element | null,
): ParsedDocxPage["layout"] | undefined => {
  if (!sectPr) return undefined;
  const layout: ParsedDocxPage["layout"] = {};
  const pgSz = getElementByTagNameNS(sectPr, "pgSz");
  if (pgSz) {
    const wAttr =
      pgSz.getAttributeNS(WORD_NS, "w") || pgSz.getAttribute("w:w");
    const hAttr =
      pgSz.getAttributeNS(WORD_NS, "h") || pgSz.getAttribute("w:h");
    const orientAttr =
      pgSz.getAttributeNS(WORD_NS, "orient") || pgSz.getAttribute("w:orient");
    const w = wAttr ? parseInt(wAttr, 10) : 0;
    const h = hAttr ? parseInt(hAttr, 10) : 0;
    if (w > 0 && h > 0) {
      const paperSize = closestPaperSize(w, h);
      if (paperSize) layout.paperSize = paperSize;
    }
    if (orientAttr === "landscape" || orientAttr === "portrait") {
      layout.orientation = orientAttr;
    } else if (w > 0 && h > 0) {
      layout.orientation = w > h ? "landscape" : "portrait";
    }
  }
  const pgMar = getElementByTagNameNS(sectPr, "pgMar");
  if (pgMar) {
    const top = twipsToPx(
      pgMar.getAttributeNS(WORD_NS, "top") || pgMar.getAttribute("w:top"),
    );
    const right = twipsToPx(
      pgMar.getAttributeNS(WORD_NS, "right") || pgMar.getAttribute("w:right"),
    );
    const bottom = twipsToPx(
      pgMar.getAttributeNS(WORD_NS, "bottom") ||
        pgMar.getAttribute("w:bottom"),
    );
    const left = twipsToPx(
      pgMar.getAttributeNS(WORD_NS, "left") || pgMar.getAttribute("w:left"),
    );
    if (top !== undefined) layout.marginTop = top;
    if (right !== undefined) layout.marginRight = right;
    if (bottom !== undefined) layout.marginBottom = bottom;
    if (left !== undefined) layout.marginLeft = left;
  }
  return Object.keys(layout).length > 0 ? layout : undefined;
};

// Resolve the document's default section layout. OOXML stores one
// terminating `w:sectPr` as the last child of `w:body`; it's the
// authoritative paper size + margin set for every page that doesn't
// override via an inline `w:sectPr` on a paragraph's `w:pPr`.
const extractDefaultLayout = (
  body: Element,
): ParsedDocxPage["layout"] | undefined => {
  // Direct children only — nested sectPr inside paragraph pPr are
  // per-page overrides handled during the body walk, not defaults.
  for (const child of Array.from(body.children)) {
    if (child.namespaceURI === WORD_NS && child.localName === "sectPr") {
      return extractSectionLayout(child);
    }
  }
  return undefined;
};

// ─── Core parse ──────────────────────────────────────────────────────────
//
// Walks the DOCX body in document order, emitting one ParsedDocxPage per
// detected page break. Mirrors the behavior of the source parser's
// parseDocxWithJSZip but returns the new ParsedDocx shape (pages +
// headerBlocks + footerBlocks + defaultLayout).

const parseDocxCore = async (buffer: ArrayBuffer): Promise<ParsedDocx> => {
  const empty: ParsedDocx = {
    pages: [{ blocks: [{ type: "paragraph", data: { text: "" } }] }],
    headerBlocks: [],
    footerBlocks: [],
  };
  try {
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("text");
    const relsXml = await zip
      .file("word/_rels/document.xml.rels")
      ?.async("text");
    if (!documentXml) {
      console.error("[DocxImporter] Could not read word/document.xml");
      return empty;
    }

    const relationships: any = {};
    if (relsXml) {
      const relsDoc = new DOMParser().parseFromString(relsXml, "text/xml");
      const rels = relsDoc.getElementsByTagName("Relationship");
      for (const rel of Array.from(rels)) {
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target");
        if (id && target) relationships[id] = target;
      }
    }

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(documentXml, "text/xml");
    const body = xmlDoc.getElementsByTagNameNS(WORD_NS, "body")[0];
    if (!body) {
      console.error("[DocxImporter] No body found in document.xml");
      return empty;
    }

    // Load every image under word/media/** and word/images/** as a base64
    // data URL, keyed by both the absolute path and the leading-slash-
    // stripped relative path so processDrawing can find it either way.
    const images: { [key: string]: string } = {};
    for (const [path, file] of Object.entries(zip.files)) {
      if (
        path.startsWith("word/media/") ||
        path.startsWith("word/images/") ||
        path.includes("media/image") ||
        /word\/media\/image\d+\.\w+/.test(path)
      ) {
        try {
          const imageData = await (file as any).async("base64");
          const imageType = path.split(".").pop()?.toLowerCase() || "";
          const mimeType = getMimeType(imageType);
          if (mimeType) {
            images[path] = `data:${mimeType};base64,${imageData}`;
            const relPath = path.replace("word/", "");
            images[relPath] = `data:${mimeType};base64,${imageData}`;
          }
        } catch (error) {
          console.error(`[DocxImporter] Error loading image ${path}:`, error);
        }
      }
    }

    const { headerBlocks, footerBlocks } = await parseHeadersAndFooters(
      zip,
      images,
    );

    const defaultLayout = extractDefaultLayout(body);

    const pages: ParsedDocxPage[] = [];
    let currentPageBlocks: any[] = [];
    // Per-section-break layout override. Each `w:sectPr` on a paragraph's
    // pPr defines the layout from THAT point forward until the next
    // sectPr; apply it when flushing the page that contains the break.
    let pendingLayoutOverride: ParsedDocxPage["layout"] | undefined;

    const flushPage = (layoutOverride?: ParsedDocxPage["layout"]) => {
      if (currentPageBlocks.length === 0) return;
      const merged = mergeTightParagraphs(currentPageBlocks);
      const processed = processLists(merged);
      pages.push({
        blocks: processed,
        layout: layoutOverride || pendingLayoutOverride || defaultLayout,
      });
      currentPageBlocks = [];
      pendingLayoutOverride = undefined;
    };

    // Detect floating-layout document (every piece of content lives in
    // wp:anchor shapes with no direct body-level text). These need the
    // dedicated grouping pass to come out with a sane column layout.
    let usedFloatingLayout = false;
    const bodyAnchorCount = body.getElementsByTagNameNS(
      DRAWING_NS,
      "anchor",
    ).length;
    if (bodyAnchorCount >= 2) {
      const directBodyText = Array.from(
        body.getElementsByTagNameNS(WORD_NS, "r"),
      )
        .filter((r) => !r.getElementsByTagNameNS(WORD_NS, "drawing").length)
        .map(
          (r) =>
            r.getElementsByTagNameNS(WORD_NS, "t")[0]?.textContent ?? "",
        )
        .join("")
        .trim();
      if (!directBodyText) {
        const layoutBlocks = await processFloatingDocumentLayout(
          body,
          relationships,
          images,
        );
        if (layoutBlocks?.length) {
          currentPageBlocks.push(...layoutBlocks);
          usedFloatingLayout = true;
        }
      }
    }

    if (!usedFloatingLayout) {
      // Mirror the source's mixed-container iteration — expand
      // mc:AlternateContent + non-TOC w:sdt wrappers so their child
      // paragraphs / tables land in the work list in document order.
      const MC_NS =
        "http://schemas.openxmlformats.org/markup-compatibility/2006";

      const expandChild = (el: Element): Element[] => {
        if (el.namespaceURI === MC_NS && el.localName === "AlternateContent") {
          const choice = el.getElementsByTagNameNS(MC_NS, "Choice")[0];
          const fallback = el.getElementsByTagNameNS(MC_NS, "Fallback")[0];
          const source = choice || fallback;
          if (!source) return [];
          const out: Element[] = [];
          for (const c of Array.from(source.children))
            out.push(...expandChild(c));
          return out;
        }
        if (
          el.namespaceURI === WORD_NS &&
          el.localName === "sdt" &&
          !isTOCSdt(el)
        ) {
          const content = getElementByTagNameNS(el, "sdtContent");
          if (!content) return [];
          const out: Element[] = [];
          for (const c of Array.from(content.children))
            out.push(...expandChild(c));
          return out;
        }
        return [el];
      };

      const workList: Element[] = [];
      for (const child of Array.from(body.children)) {
        workList.push(...expandChild(child));
      }

      for (const child of workList) {
        if (child.namespaceURI !== WORD_NS) continue;

        if (child.localName === "sdt") {
          const tocBlocks = await processTOC(child, relationships, images);
          for (const block of tocBlocks) currentPageBlocks.push(block);
          continue;
        }

        if (child.localName === "tbl") {
          const block = await processTable(child, relationships, images);
          if (Array.isArray(block)) {
            for (const b of block) if (b) currentPageBlocks.push(b);
          } else if (block) {
            currentPageBlocks.push(block);
          }
          continue;
        }

        if (child.localName !== "p") continue;

        // flushPage() runs AFTER processParagraph so the paragraph's
        // visible content lands on the current page before we split.
        // `continue`-ing before processParagraph would silently delete
        // text on any paragraph carrying both a page break and runs.
        const carriesBreak = isPageBreak(child);
        // Capture inline section layout — a sectPr on a paragraph's pPr
        // changes the layout for the NEW page that starts after this break.
        let sectionOverride: ParsedDocxPage["layout"] | undefined;
        const pPr = getElementByTagNameNS(child, "pPr");
        const sectPr = pPr ? getElementByTagNameNS(pPr, "sectPr") : null;
        if (sectPr) sectionOverride = extractSectionLayout(sectPr);

        const block = await processParagraph(child, relationships, images);
        if (block) {
          if (Array.isArray(block)) {
            for (const singleBlock of block) {
              if (singleBlock) currentPageBlocks.push(singleBlock);
            }
          } else {
            currentPageBlocks.push(block);
          }
        }
        if (carriesBreak) {
          flushPage();
          if (sectionOverride) pendingLayoutOverride = sectionOverride;
        }
      }
    }

    // Trailing content without a terminating page break still forms a page.
    if (currentPageBlocks.length > 0) {
      flushPage();
    }

    if (pages.length === 0) {
      pages.push({
        blocks: [{ type: "paragraph", data: { text: "" } }],
        layout: defaultLayout,
      });
    }

    return { pages, headerBlocks, footerBlocks, defaultLayout };
  } catch (error) {
    console.error("[DocxImporter] Error parsing DOCX:", error);
    return empty;
  }
};

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Rich multi-page parse — preferred for new callers. Preserves page
 * breaks, per-section layouts (paper size, orientation, margins), and
 * the authored header/footer blocks separately from the body pages.
 */
export async function parseDocx(
  input: File | ArrayBuffer,
): Promise<ParsedDocx> {
  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  return parseDocxCore(arrayBuffer);
}

/**
 * Legacy flat parse. Concatenates every page's blocks into a single
 * EditorOutput so existing DocumentEditor callers that dump the result
 * into page 1 keep working during the multi-page migration.
 */
export async function importDocx(
  input: File | ArrayBuffer,
): Promise<EditorOutput> {
  const parsed = await parseDocx(input);
  const blocks: EditorBlock[] = [];
  for (const page of parsed.pages) {
    for (const block of page.blocks) blocks.push(block);
  }
  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", data: { text: "" } });
  }
  return { time: Date.now(), blocks, version: "2.30.7" };
}

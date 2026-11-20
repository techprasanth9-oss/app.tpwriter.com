/**
 * Document assembly: package → parts → body blocks with section breaks,
 * headers/footers, footnotes, page setup, named styles and images.
 */

import type { EditorBlock } from "~/lib/api/documents";
import { DEFAULT_PAGE_SETUP, type PageSetup } from "../../pageSetup";
import { DEFAULT_LAYOUT } from "../../pagination/paper";
import { convertBlocks } from "./blocks";
import { block, Warnings, type ImportContext } from "./context";
import { convertNotes } from "./footnotes";
import { convertHeadersFooters } from "./headersFooters";
import { hexColor, toBase64 } from "./html";
import { Numbering } from "./numbering";
import { DocxImportError, DocxPackage, REL, relKind, relOfKind } from "./package";
import { parseThemeFonts } from "./props";
import { parseSection, type SectionInfo } from "./sections";
import { deriveNamedStyles, StyleTable } from "./styles";
import type { ImportedDocument } from "./types";
import { attr, child, kids, onOff, parseXml, path, tag } from "./xml";

const WORD_MAIN = /wordprocessingml\.(document|template)\.main\+xml|ms-word\.(document|template)\.macroEnabled/i;

/** Paragraph-level sectPrs in document order (through sdt / customXml). */
function collectSectPrs(els: Element[], out: Element[]): void {
  for (const el of els) {
    const t = tag(el);
    if (t === "w:p") {
      const sp = path(el, "w:pPr", "w:sectPr");
      if (sp) out.push(sp);
    } else if (t === "w:sdt") collectSectPrs(kids(child(el, "w:sdtContent")), out);
    else if (t === "w:customXml") collectSectPrs(kids(el), out);
  }
}

function sniffImage(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/** Fill image blocks with data: URLs (each referenced part read once);
 *  returns the ids of image blocks that couldn't be filled. */
async function attachImages(ctx: ImportContext): Promise<Set<string>> {
  const failed = new Set<string>();
  const urls = new Map<string, string | null>();
  for (const job of ctx.imageJobs) {
    let url = urls.get(job.part);
    if (url === undefined) {
      const bytes = await ctx.pkg.readBytes(job.part).catch((e) => {
        if (e instanceof DocxImportError) throw e;
        return null;
      });
      const mime = bytes ? sniffImage(bytes) : null;
      if (!bytes) ctx.warnings.add("An image with a missing picture part was skipped.");
      else if (!mime) {
        const ext = job.part.slice(job.part.lastIndexOf(".") + 1).toUpperCase();
        ctx.warnings.add(`Images in an unsupported format (${ext}) were skipped.`);
      }
      url = bytes && mime ? `data:${mime};base64,${toBase64(bytes)}` : null;
      urls.set(job.part, url);
    }
    if (url) (job.block.data.file as { url: string }).url = url;
    else failed.add(job.block.id);
  }
  return failed;
}

const without = (blocks: EditorBlock[], ids: Set<string>) =>
  ids.size ? blocks.filter((b) => !ids.has(b.id)) : blocks;

export async function convertDocument(pkg: DocxPackage, warnings: Warnings): Promise<ImportedDocument> {
  // Main part.
  const rootRels = await pkg.rels("");
  const mainPath = relOfKind(rootRels, REL.officeDocument)?.target ?? "word/document.xml";
  const main = pkg.has(mainPath) ? mainPath : pkg.has("word/document.xml") ? "word/document.xml" : null;
  if (!main) throw new DocxImportError("This file isn't a Word document (word/document.xml is missing).");
  const ct = pkg.contentTypeOf(main);
  if (ct && !WORD_MAIN.test(ct) && /(spreadsheetml|presentationml)/i.test(ct)) {
    throw new DocxImportError("This file isn't a Word document.");
  }
  const docText = await pkg.readText(main);
  if (docText === null) throw new DocxImportError("The document body (word/document.xml) could not be read.");
  const doc = parseXml(docText);
  if (!doc) throw new DocxImportError("The document body (word/document.xml) is not valid XML.");
  if (tag(doc.root) !== "w:document") throw new DocxImportError("word/document.xml is not a WordprocessingML document.");
  const body = child(doc.root, "w:body");
  if (!body) throw new DocxImportError("The document has no body.");

  const docRels = await pkg.rels(main);
  const partOf = async (kind: string) => {
    const rel = relOfKind(docRels, kind);
    return rel ? await pkg.readXml(rel.target) : null;
  };

  const theme = parseThemeFonts((await partOf(REL.theme))?.root ?? null);
  const styles = new StyleTable((await partOf(REL.styles))?.root ?? null, theme);
  const numbering = new Numbering((await partOf(REL.numbering))?.root ?? null);
  const settings = (await partOf(REL.settings))?.root ?? null;
  const evenOdd = child(settings, "w:evenAndOddHeaders");

  // Sections: paragraph sectPrs end their section; body sectPr is last.
  const sectPrs: Element[] = [];
  const bodyKids = kids(body);
  collectSectPrs(bodyKids, sectPrs);
  const sections: SectionInfo[] = [...sectPrs, child(body, "w:sectPr")].map((sp) => parseSection(sp));
  for (const s of sections) {
    if (s.approxPaper) warnings.add(`Paper size ${s.approxPaper} isn't supported; the nearest size (${s.layout.paperSize}) was used.`);
  }

  const prefix = Math.random().toString(36).slice(2, 7);
  let n = 0;
  const ctx: ImportContext = {
    pkg,
    styles,
    numbering,
    theme,
    warnings,
    newId: () => `${prefix}${(n++).toString(36)}`,
    notes: new Map(),
    fields: [],
    watermark: null,
    imageJobs: [],
    paragraphCount: 0,
    contentWidth: sections[0]?.contentWidth ?? 602,
    maybeYield: () => new Promise((r) => setTimeout(r, 0)),
  };

  let sectionIndex = 0;
  const blocks = await convertBlocks(bodyKids, ctx, { path: main, rels: docRels, kind: "body" }, {
    onSectPr: () => {
      sectionIndex++;
      const next = sections[sectionIndex];
      if (!next) return [];
      ctx.contentWidth = next.contentWidth;
      if (next.type === "continuous") {
        warnings.add("Continuous section breaks were imported as section breaks that start a new page.");
      }
      return [block(ctx, "sectionBreak", { layout: { ...next.layout } })];
    },
  });
  ctx.fields = [];
  while (blocks.length && blocks[blocks.length - 1]!.type === "sectionBreak") blocks.pop();

  ctx.contentWidth = sections[0]?.contentWidth ?? ctx.contentWidth;
  const { headers, footers } = await convertHeadersFooters(ctx, docRels, sections);
  const footnotes = await convertNotes(ctx, docRels);

  // Images (body + headers/footers).
  const failed = await attachImages(ctx);
  const clean = (set: PageSetup["headers"]) => ({
    default: without(set.default, failed),
    first: without(set.first, failed),
    even: without(set.even, failed),
  });

  if ([...docRels.values()].some((r) => relKind(r.type) === REL.comments)) {
    warnings.add("Comments were not imported.");
  }

  const first = sections[0]!;
  const pageColor = hexColor(attr(child(doc.root, "w:background"), "w:color"));
  const pageSetup: PageSetup = {
    ...DEFAULT_PAGE_SETUP,
    headers: clean(headers),
    footers: clean(footers),
    differentFirstPage: first.titlePg,
    differentOddEven: !!evenOdd && onOff(attr(evenOdd, "w:val")),
    headerDistance: first.headerDistance ?? DEFAULT_PAGE_SETUP.headerDistance,
    footerDistance: first.footerDistance ?? DEFAULT_PAGE_SETUP.footerDistance,
    watermark: ctx.watermark,
    pageColor,
    pageBorder: first.pageBorder,
    footnotes,
  };

  // Title from docProps/core.xml.
  let title: string | undefined;
  const coreRel = relOfKind(rootRels, REL.coreProperties);
  const corePath = coreRel?.target ?? (pkg.has("docProps/core.xml") ? "docProps/core.xml" : null);
  if (corePath) {
    const core = await pkg.readXml(corePath);
    const t = kids(core?.root).find((el) => tag(el) === "dc:title")?.textContent?.trim();
    if (t) title = t.slice(0, 200);
  }

  return {
    blocks: without(blocks, failed),
    defaultLayout: first.layout ?? { ...DEFAULT_LAYOUT },
    pageSetup,
    styles: deriveNamedStyles(styles),
    ...(title ? { title } : {}),
    warnings: [],
  };
}

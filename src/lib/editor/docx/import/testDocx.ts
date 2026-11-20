/**
 * Test helper: builds minimal .docx packages with JSZip. Only imported by
 * the *.test.ts files next to it.
 */

import JSZip from "jszip";

export const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export const NS = [
  `xmlns:w="${W}"`,
  `xmlns:r="${R}"`,
  `xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`,
  `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`,
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`,
  `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`,
  `xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"`,
  `xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"`,
  `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`,
  `xmlns:v="urn:schemas-microsoft-com:vml"`,
  `xmlns:o="urn:schemas-microsoft-com:office:office"`,
  `xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"`,
].join(" ");

/** 1×1 transparent PNG. */
export const PNG_1x1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export interface DocxSpec {
  body: string;
  /** Extra <Relationship> elements for word/_rels/document.xml.rels. */
  rels?: string;
  styles?: string;
  numbering?: string;
  settings?: string;
  footnotes?: string;
  endnotes?: string;
  theme?: string;
  core?: string;
  /** Extra content inside <w:document> before <w:body> (e.g. background). */
  beforeBody?: string;
  /** Any other files (path → content). */
  files?: Record<string, string | Uint8Array>;
  /** Skip [Content_Types].xml / document etc. for malformed-package tests. */
  omitDocument?: boolean;
  rawDocument?: string;
}

const rel = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${REL_NS}/${type}" Target="${target}"/>`;

export const p = (inner: string, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${inner}</w:p>`;
export const r = (text: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;

export function stylesXml(inner: string, defaults = ""): string {
  return `<w:styles ${NS}>${defaults ? `<w:docDefaults>${defaults}</w:docDefaults>` : ""}${inner}</w:styles>`;
}

export function pStyle(id: string, name: string, extra = "", opts: { basedOn?: string; isDefault?: boolean; type?: string } = {}) {
  return `<w:style w:type="${opts.type ?? "paragraph"}" w:styleId="${id}"${opts.isDefault ? ' w:default="1"' : ""}><w:name w:val="${name}"/>${
    opts.basedOn ? `<w:basedOn w:val="${opts.basedOn}"/>` : ""
  }${extra}</w:style>`;
}

export async function buildDocx(spec: DocxSpec): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const docRels: string[] = [];
  const overrides: string[] = [];
  const add = (path: string, content: string, type: string, relType: string) => {
    zip.file(path, content);
    overrides.push(`<Override PartName="/${path}" ContentType="${type}"/>`);
    docRels.push(rel(`rId_${relType}`, relType, path.replace(/^word\//, "")));
  };
  const WML = "application/vnd.openxmlformats-officedocument.wordprocessingml";
  if (spec.styles) add("word/styles.xml", spec.styles, `${WML}.styles+xml`, "styles");
  if (spec.numbering) add("word/numbering.xml", `<w:numbering ${NS}>${spec.numbering}</w:numbering>`, `${WML}.numbering+xml`, "numbering");
  if (spec.settings) add("word/settings.xml", `<w:settings ${NS}>${spec.settings}</w:settings>`, `${WML}.settings+xml`, "settings");
  if (spec.footnotes) add("word/footnotes.xml", `<w:footnotes ${NS}>${spec.footnotes}</w:footnotes>`, `${WML}.footnotes+xml`, "footnotes");
  if (spec.endnotes) add("word/endnotes.xml", `<w:endnotes ${NS}>${spec.endnotes}</w:endnotes>`, `${WML}.endnotes+xml`, "endnotes");
  if (spec.theme) add("word/theme/theme1.xml", spec.theme, "application/vnd.openxmlformats-officedocument.theme+xml", "theme");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="png" ContentType="image/png"/>
      <Override PartName="/word/document.xml" ContentType="${WML}.document.main+xml"/>
      ${overrides.join("")}
    </Types>`,
  );
  const rootRels = [rel("rId1", "officeDocument", "word/document.xml")];
  if (spec.core) {
    zip.file(
      "docProps/core.xml",
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${spec.core}</cp:coreProperties>`,
    );
    rootRels.push(
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>`,
    );
  }
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rootRels.join("")}</Relationships>`,
  );
  if (!spec.omitDocument) {
    zip.file(
      "word/document.xml",
      spec.rawDocument ??
        `<?xml version="1.0"?><w:document ${NS}>${spec.beforeBody ?? ""}<w:body>${spec.body}</w:body></w:document>`,
    );
  }
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join("")}${spec.rels ?? ""}</Relationships>`,
  );
  for (const [path, content] of Object.entries(spec.files ?? {})) zip.file(path, content);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

export function relXml(id: string, type: string, target: string, external = false): string {
  return `<Relationship Id="${id}" Type="${REL_NS}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`;
}

export function relsFile(inner: string): string {
  return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
}

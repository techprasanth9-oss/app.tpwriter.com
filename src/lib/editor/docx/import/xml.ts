/**
 * Namespace-aware helpers for walking WordprocessingML with direct-child
 * traversal only (never `querySelectorAll` / `getElementsByTagName` over
 * the whole document per element — that is what made the old importer
 * quadratic and let nested pPr / table rows leak into the wrong parent).
 *
 * Elements are identified as "<prefix>:<localName>" with a canonical
 * prefix derived from the namespace URI, so documents that use unusual
 * prefixes (or Strict OOXML namespaces) are handled the same way.
 */

const NS: Record<string, string> = {
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
  "http://purl.oclc.org/ooxml/wordprocessingml/main": "w",
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
  "http://purl.oclc.org/ooxml/officeDocument/relationships": "r",
  "http://schemas.openxmlformats.org/officeDocument/2006/math": "m",
  "http://purl.oclc.org/ooxml/officeDocument/math": "m",
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing": "wp",
  "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": "wp",
  "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
  "http://purl.oclc.org/ooxml/drawingml/main": "a",
  "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",
  "http://purl.oclc.org/ooxml/drawingml/picture": "pic",
  "http://schemas.openxmlformats.org/drawingml/2006/chart": "c",
  "http://schemas.openxmlformats.org/drawingml/2006/diagram": "dgm",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingShape": "wps",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup": "wpg",
  "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas": "wpc",
  "http://schemas.microsoft.com/office/word/2010/wordml": "w14",
  "http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
  "urn:schemas-microsoft-com:vml": "v",
  "urn:schemas-microsoft-com:office:office": "o",
  "http://schemas.openxmlformats.org/package/2006/relationships": "pr",
  "http://schemas.openxmlformats.org/package/2006/content-types": "ct",
  "http://purl.org/dc/elements/1.1/": "dc",
  "http://www.w3.org/XML/1998/namespace": "xml",
};

function prefixOf(uri: string | null): string {
  if (!uri) return "";
  return NS[uri] ?? "x";
}

/** "w:p", "m:oMath", "wp:inline", … ("" prefix for no namespace). */
export function tag(el: Element): string {
  const p = prefixOf(el.namespaceURI);
  return p ? `${p}:${el.localName}` : el.localName;
}

export function is(el: Element | null | undefined, name: string): boolean {
  return !!el && tag(el) === name;
}

/** Direct element children. */
export function kids(el: Element | null | undefined): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) out.push(c);
  return out;
}

/** First direct child with the given name. */
export function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (tag(c) === name) return c;
  }
  return null;
}

/** All direct children with the given name. */
export function childrenNamed(el: Element | null | undefined, name: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (tag(c) === name) out.push(c);
  }
  return out;
}

/** Follow a path of direct children: path(el, "w:pPr", "w:sectPr"). */
export function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let cur: Element | null = el ?? null;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return null;
  }
  return cur;
}

/** Attribute by canonical "prefix:local" (or plain "local"). */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const i = name.indexOf(":");
  const want = i < 0 ? "" : name.slice(0, i);
  const local = i < 0 ? name : name.slice(i + 1);
  const attrs = el.attributes;
  for (let k = 0; k < attrs.length; k++) {
    const a = attrs[k]!;
    if (a.localName === local && prefixOf(a.namespaceURI) === want) return a.value;
  }
  return null;
}

/** `w:val` of a direct child, e.g. val(pPr, "w:jc"). */
export function val(el: Element | null | undefined, childName: string): string | null {
  return attr(child(el, childName), "w:val");
}

export function intAttr(el: Element | null | undefined, name: string): number | null {
  const v = attr(el, name);
  if (v === null || v.trim() === "") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** OOXML on/off value (absent value = on). */
export function onOff(v: string | null): boolean {
  if (v === null) return true;
  const s = v.toLowerCase();
  return !(s === "0" || s === "false" || s === "off" || s === "none");
}

/** Toggle property present as a child: undefined when absent. */
export function toggle(el: Element | null | undefined, childName: string): boolean | undefined {
  const c = child(el, childName);
  return c ? onOff(attr(c, "w:val")) : undefined;
}

/** Concatenated text of all descendant text nodes (for small subtrees). */
export function textOf(el: Element | null | undefined): string {
  return el?.textContent ?? "";
}

/** Prefixes we understand inside mc:Choice[@Requires]. */
const SUPPORTED_REQUIRES = new Set(["wps", "wpg", "w14", "w15", "w16", "wp14", "a14", "m", "v", "o"]);

/**
 * Children to process for an mc:AlternateContent: the first mc:Choice whose
 * requirements we support, else mc:Fallback.
 */
export function alternateContent(el: Element): Element[] {
  for (const c of kids(el)) {
    if (tag(c) === "mc:Choice") {
      const req = (attr(c, "Requires") ?? "").split(/\s+/).filter(Boolean);
      if (req.every((r) => SUPPORTED_REQUIRES.has(r))) return kids(c);
    }
  }
  return kids(child(el, "mc:Fallback"));
}

export interface ParsedXml {
  doc: Document;
  root: Element;
}

/** Parse XML; null when it isn't well-formed. */
export function parseXml(text: string): ParsedXml | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "application/xml");
  } catch {
    return null;
  }
  const root = doc.documentElement;
  if (!root || root.localName === "parsererror" || root.getElementsByTagName("parsererror").length > 0) {
    return null;
  }
  return { doc, root };
}

/**
 * The OPC package: zip loading under size limits, content types,
 * relationships and part reading.
 *
 * Limits are enforced three times: the compressed input size, the sum of
 * the uncompressed sizes the zip *declares*, and the bytes actually
 * inflated while reading parts (a zip bomb can lie about its sizes).
 */

import JSZip from "jszip";
import { DEFAULT_IMPORT_LIMITS, type ImportLimits } from "./types";
import { attr, kids, parseXml, tag, type ParsedXml } from "./xml";

export class DocxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxImportError";
  }
}

const mb = (n: number) => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;

export interface Relationship {
  id: string;
  type: string;
  /** Resolved part path (internal) or the raw target (external). */
  target: string;
  external: boolean;
}

export type Rels = Map<string, Relationship>;

/** Relationship type suffixes (the part after ".../relationships/"). */
export const REL = {
  officeDocument: "officeDocument",
  styles: "styles",
  numbering: "numbering",
  footnotes: "footnotes",
  endnotes: "endnotes",
  settings: "settings",
  theme: "theme",
  header: "header",
  footer: "footer",
  image: "image",
  hyperlink: "hyperlink",
  comments: "comments",
  coreProperties: "core-properties",
} as const;

/** Last path segment of a relationship type URI. */
export function relKind(type: string): string {
  const i = type.lastIndexOf("/");
  return i < 0 ? type : type.slice(i + 1);
}

/** Resolve a relationship target against the source part's directory. */
export function resolvePartPath(sourcePart: string, target: string): string {
  let t = target.replace(/\\/g, "/");
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep as-is */
  }
  const parts = t.startsWith("/") ? [] : sourcePart.split("/").slice(0, -1);
  for (const seg of t.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function relsPathFor(part: string): string {
  const i = part.lastIndexOf("/");
  const dir = i < 0 ? "" : part.slice(0, i + 1);
  const name = i < 0 ? part : part.slice(i + 1);
  return `${dir}_rels/${name}.rels`;
}

export class DocxPackage {
  private inflated = 0;
  private relsCache = new Map<string, Rels>();
  private textCache = new Map<string, string | null>();
  /** Lower-cased path → actual zip entry name (zip paths are
   *  case-insensitive in OPC, but matching stays EXACT otherwise). */
  private names = new Map<string, string>();
  readonly contentTypes = new Map<string, string>();
  private defaultTypes = new Map<string, string>();

  private constructor(
    private zip: JSZip,
    private limits: ImportLimits,
    private warn: (msg: string) => void,
  ) {
    for (const name of Object.keys(zip.files)) {
      if (!zip.files[name]!.dir) this.names.set(name.replace(/^\//, "").toLowerCase(), name);
    }
  }

  static async open(
    input: ArrayBuffer | Uint8Array,
    limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
    warn: (msg: string) => void = () => {},
  ): Promise<DocxPackage> {
    const size = input.byteLength;
    if (size === 0) throw new DocxImportError("The file is empty.");
    if (size > limits.maxBytes) {
      throw new DocxImportError(`The file is too large (${mb(size)}; the limit is ${mb(limits.maxBytes)}).`);
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(ArrayBuffer.isView(input) ? input : new Uint8Array(input));
    } catch {
      throw new DocxImportError("This file isn't a valid .docx document (it is not a zip archive).");
    }
    let declared = 0;
    for (const f of Object.values(zip.files)) {
      const data = (f as unknown as { _data?: { uncompressedSize?: number } })._data;
      declared += typeof data?.uncompressedSize === "number" ? data.uncompressedSize : 0;
    }
    if (declared > limits.maxUncompressedBytes) {
      throw new DocxImportError(
        `The document is too large when uncompressed (${mb(declared)}; the limit is ${mb(limits.maxUncompressedBytes)}).`,
      );
    }
    const pkg = new DocxPackage(zip, limits, warn);
    await pkg.loadContentTypes();
    return pkg;
  }

  has(part: string): boolean {
    return this.names.has(part.replace(/^\//, "").toLowerCase());
  }

  private entry(part: string): JSZip.JSZipObject | null {
    const name = this.names.get(part.replace(/^\//, "").toLowerCase());
    return name ? (this.zip.files[name] ?? null) : null;
  }

  /** Inflate a part, counting the bytes against the uncompressed limit. */
  async readBytes(part: string): Promise<Uint8Array | null> {
    const file = this.entry(part);
    if (!file) return null;
    const max = this.limits.maxUncompressedBytes;
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      let done = false;
      const stream = (file as unknown as {
        internalStream(type: "uint8array"): {
          on(ev: "data", cb: (chunk: Uint8Array) => void): unknown;
          on(ev: "error", cb: (e: unknown) => void): unknown;
          on(ev: "end", cb: () => void): unknown;
          pause(): unknown;
          resume(): unknown;
        };
      }).internalStream("uint8array");
      stream.on("data", (chunk) => {
        if (done) return;
        this.inflated += chunk.length;
        total += chunk.length;
        if (this.inflated > max) {
          done = true;
          stream.pause();
          reject(
            new DocxImportError(
              `The document is too large when uncompressed (more than ${mb(max)}).`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.on("error", (e) => {
        if (done) return;
        done = true;
        reject(e instanceof Error ? e : new Error(String(e)));
      });
      stream.on("end", () => {
        if (done) return;
        done = true;
        const out = new Uint8Array(total);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        resolve(out);
      });
      stream.resume();
    });
  }

  /** Read a part as text; null when missing or unreadable (warns). Limit
   *  errors propagate. */
  async readText(part: string): Promise<string | null> {
    const key = part.toLowerCase();
    if (this.textCache.has(key)) return this.textCache.get(key)!;
    let text: string | null = null;
    try {
      const bytes = await this.readBytes(part);
      text = bytes ? new TextDecoder("utf-8").decode(bytes) : null;
    } catch (e) {
      if (e instanceof DocxImportError) throw e;
      this.warn(`Part ${part} could not be read and was skipped.`);
      text = null;
    }
    this.textCache.set(key, text);
    return text;
  }

  /** Read + parse an XML part; null (with a warning) when malformed. */
  async readXml(part: string): Promise<ParsedXml | null> {
    const text = await this.readText(part);
    if (text === null) return null;
    const parsed = parseXml(text);
    if (!parsed) this.warn(`Part ${part} is not valid XML and was skipped.`);
    return parsed;
  }

  contentTypeOf(part: string): string | null {
    const p = part.replace(/^\//, "").toLowerCase();
    const o = this.contentTypes.get(p);
    if (o) return o;
    const ext = p.slice(p.lastIndexOf(".") + 1);
    return this.defaultTypes.get(ext) ?? null;
  }

  private async loadContentTypes(): Promise<void> {
    const text = await this.readText("[Content_Types].xml");
    const parsed = text ? parseXml(text) : null;
    if (!parsed) return;
    for (const el of kids(parsed.root)) {
      const t = tag(el);
      const ct = attr(el, "ContentType");
      if (!ct) continue;
      if (t.endsWith("Override")) {
        const name = attr(el, "PartName");
        if (name) this.contentTypes.set(name.replace(/^\//, "").toLowerCase(), ct);
      } else if (t.endsWith("Default")) {
        const ext = attr(el, "Extension");
        if (ext) this.defaultTypes.set(ext.toLowerCase(), ct);
      }
    }
  }

  /** Relationships of a part ("" = the package root). */
  async rels(part: string): Promise<Rels> {
    const cached = this.relsCache.get(part);
    if (cached) return cached;
    const rels: Rels = new Map();
    const relsPath = part ? relsPathFor(part) : "_rels/.rels";
    const text = this.has(relsPath) ? await this.readText(relsPath) : null;
    const parsed = text ? parseXml(text) : null;
    if (text && !parsed) this.warn(`Relationships of ${part || "the package"} are not valid XML.`);
    if (parsed) {
      for (const el of kids(parsed.root)) {
        if (!tag(el).endsWith("Relationship")) continue;
        const id = attr(el, "Id");
        const type = attr(el, "Type") ?? "";
        const target = attr(el, "Target") ?? "";
        if (!id) continue;
        const external = (attr(el, "TargetMode") ?? "").toLowerCase() === "external";
        rels.set(id, {
          id,
          type,
          external,
          target: external ? target : resolvePartPath(part || "x", target),
        });
      }
    }
    this.relsCache.set(part, rels);
    return rels;
  }
}

/** First internal relationship of a kind. */
export function relOfKind(rels: Rels, kind: string): Relationship | null {
  for (const r of rels.values()) {
    if (!r.external && relKind(r.type) === kind) return r;
  }
  return null;
}

/**
 * DOCX → editor importer (Phase 5).
 *
 *   importDocxFile(file) → { blocks, defaultLayout, pageSetup, styles,
 *                            title?, warnings }
 *
 * Fatal problems (not a zip, no word/document.xml, no body, size limits)
 * throw a DocxImportError with a user-facing message; everything else is
 * imported as well as possible and reported in `warnings`. The result is
 * passed through the load-time sanitizer before it is returned.
 */

import { sanitizeEditorData } from "../../sanitizeData";
import { Warnings } from "./context";
import { convertDocument } from "./document";
import { DocxImportError, DocxPackage } from "./package";
import { DEFAULT_IMPORT_LIMITS, type ImportedDocument, type ImportLimits } from "./types";

export { DocxImportError } from "./package";
export { ommlToLatex } from "./math";
export { DEFAULT_IMPORT_LIMITS } from "./types";
export type { ImportedDocument, ImportLimits } from "./types";

async function readInput(input: File | Blob | ArrayBuffer | Uint8Array, maxBytes: number): Promise<ArrayBuffer | Uint8Array> {
  // Duck-typed: ArrayBuffers from another realm (workers, jsdom) fail
  // `instanceof`.
  const isBlob = typeof (input as Blob).size === "number" && typeof (input as Blob).slice === "function" && !ArrayBuffer.isView(input);
  if (!isBlob) {
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return input as ArrayBuffer;
  }
  input = input as Blob;
  if (input.size > maxBytes) {
    const mb = (n: number) => `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
    throw new DocxImportError(`The file is too large (${mb(input.size)}; the limit is ${mb(maxBytes)}).`);
  }
  if (typeof input.arrayBuffer === "function") return input.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new DocxImportError("The file could not be read."));
    reader.readAsArrayBuffer(input);
  });
}

export async function importDocxFile(
  input: File | ArrayBuffer,
  limits: Partial<ImportLimits> = DEFAULT_IMPORT_LIMITS,
): Promise<ImportedDocument> {
  const lim: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...limits };
  const warnings = new Warnings();
  const bytes = await readInput(input, lim.maxBytes);
  const pkg = await DocxPackage.open(bytes, lim, (m) => warnings.add(m));
  const doc = await convertDocument(pkg, warnings);
  const clean = sanitizeEditorData({ blocks: doc.blocks, pageSetup: doc.pageSetup });
  return {
    ...doc,
    blocks: clean.blocks,
    pageSetup: clean.pageSetup,
    warnings: warnings.list(),
  };
}

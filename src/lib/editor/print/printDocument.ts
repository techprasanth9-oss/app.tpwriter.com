import { apiUrl } from "~/lib/api/client";
import { buildPrintLayout, PRINT_ROOT_CLASS, type PrintPageGeometry } from "./printLayout";

/** Wait for web fonts and every image under `root` to be loaded and
 *  decoded (bounded, so a broken image can't hang printing). */
export async function waitForPrintAssets(root: ParentNode, timeoutMs = 15_000): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  const images = Array.from(root.querySelectorAll("img"));
  const work = Promise.all([
    fonts?.ready.catch(() => undefined),
    ...images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        });
      }
      await img.decode?.().catch(() => undefined);
    }),
  ]);
  await Promise.race([work, delay(timeoutMs)]);
}

/**
 * Resolve once `signature()` has not changed for `quietMs` (polled every
 * `intervalMs`), or after `timeoutMs` regardless. Returns whether the
 * layout actually settled.
 */
export async function waitForStableLayout(
  signature: () => string,
  { quietMs = 500, intervalMs = 100, timeoutMs = 20_000 }: { quietMs?: number; intervalMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  let last = signature();
  let since = Date.now();
  while (Date.now() - start < timeoutMs) {
    await delay(intervalMs);
    const next = signature();
    if (next !== last) {
      last = next;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return true;
    }
  }
  return false;
}

/** Everything that changes when the paginator moves something. */
export function layoutSignature(documentEl: HTMLElement | null): string {
  if (!documentEl) return "";
  const redactor = documentEl.querySelector<HTMLElement>(".codex-editor__redactor");
  const sheets = Array.from(documentEl.querySelectorAll<HTMLElement>(".tp-sheet"))
    .map((s) => `${s.style.top}/${s.style.width}/${s.style.height}`)
    .join(",");
  const pushes = Array.from(document.querySelectorAll<HTMLStyleElement>("style[data-tp-pagination]"))
    .map((s) => s.textContent?.length ?? 0)
    .join(",");
  const blocks = redactor ? redactor.children.length : 0;
  return `${blocks}|${redactor?.offsetHeight ?? 0}|${sheets}|${pushes}`;
}

let activeCleanup: (() => void) | null = null;

/**
 * Browser print: build the print DOM from the live document into a hidden
 * root, print it, and remove it again after `afterprint`.
 */
export async function printDocument(documentEl: HTMLElement, pages: PrintPageGeometry[]): Promise<void> {
  activeCleanup?.();
  const { root } = buildPrintLayout(documentEl, pages);
  root.classList.add(`${PRINT_ROOT_CLASS}--offscreen`);
  document.body.appendChild(root);
  const html = document.documentElement;
  html.classList.add("tp-printing");

  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    html.classList.remove("tp-printing");
    root.remove();
    if (activeCleanup === cleanup) activeCleanup = null;
  };
  activeCleanup = cleanup;
  window.addEventListener("afterprint", cleanup);

  try {
    await waitForPrintAssets(root);
    window.print();
  } catch (err) {
    cleanup();
    throw err;
  }
}

export class PdfNotConfiguredError extends Error {
  constructor() {
    super("Server-side PDF export isn't configured.");
    this.name = "PdfNotConfiguredError";
  }
}

/** Whether the API can render PDFs (it answers 501 when it can't). */
export async function isServerPdfAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/pdf/status"), { credentials: "include", signal });
    return res.ok;
  } catch {
    return false;
  }
}

/** Ask the API to render the document to PDF; resolves with the file. */
export async function fetchServerPdf(documentId: string): Promise<Blob> {
  const res = await fetch(apiUrl(`/documents/${encodeURIComponent(documentId)}/pdf`), {
    method: "POST",
    credentials: "include",
  });
  if (res.status === 501) throw new PdfNotConfiguredError();
  if (!res.ok) {
    let code = res.statusText;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      /* not JSON */
    }
    throw new Error(`PDF export failed (${res.status} ${code})`);
  }
  return res.blob();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

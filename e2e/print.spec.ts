import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { createDocument, openDocument, sentence } from "./helpers";

const para = (id: string, text: string) => ({ id, type: "paragraph", data: { text } });
const filler = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => para(`${prefix}${i}`, `${prefix} line ${i + 1} with enough words to look like a real paragraph.`));

const LONG_TEXT = Array.from({ length: 34 }, (_, i) => sentence(i + 1)).join(" ");
const field = (kind: string) => `<span class="tp-field" data-field="${kind}" contenteditable="false">0</span>`;

/** Portrait pages with a paragraph split over pages 1–2, then a landscape
 *  section; header + "Page n of N" footer on every page. */
async function seedMixedDocument(request: APIRequestContext): Promise<string> {
  const id = await createDocument(request, "Print test", [
    ...filler("a", 14),
    para("long", LONG_TEXT),
    ...filler("c", 4),
    { id: "sb", type: "sectionBreak", data: { layout: { orientation: "landscape" } } },
    ...filler("b", 6),
  ]);
  const res = await request.patch(`/api/documents/${id}`, {
    data: {
      pageSetup: {
        headers: { default: [para("h1", "Acme print header")], first: [], even: [] },
        footers: { default: [para("f1", `Page ${field("page")} of ${field("pages")}`)], first: [], even: [] },
        watermark: { text: "DRAFT", color: "#94a3b8", opacity: 0.2 },
      },
    },
  });
  expect(res.ok()).toBeTruthy();
  return id;
}

async function editorSheets(page: Page) {
  return page.locator(".tp-sheet").evaluateAll((els) =>
    els.map((e) => ({ w: (e as HTMLElement).offsetWidth, h: (e as HTMLElement).offsetHeight })),
  );
}

async function openPrintRoute(page: Page, id: string) {
  await page.goto(`/documents/${id}/print`);
  await page.waitForFunction(() => window.__TP_PRINT_READY__ === true || !!window.__TP_PRINT_ERROR__, null, {
    timeout: 45_000,
  });
  expect(await page.evaluate(() => window.__TP_PRINT_ERROR__ ?? null)).toBeNull();
}

/** Page count and media boxes (pt) of a PDF produced by Chromium. */
function inspectPdf(pdf: Buffer) {
  const text = pdf.toString("latin1");
  const counts = [...text.matchAll(/\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  const boxes = [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({
    w: Number(m[1]),
    h: Number(m[2]),
  }));
  return { header: text.slice(0, 5), count: Math.max(0, ...counts), boxes };
}

test("print route: one container per editor page, split text once, chrome, PDF page count", async ({ page, request }) => {
  const id = await seedMixedDocument(request);
  await openDocument(page, id);
  const sheets = await editorSheets(page);
  expect(sheets.length).toBeGreaterThanOrEqual(3);
  expect(sheets.some((s) => s.w > s.h)).toBe(true); // landscape section
  // The long paragraph really is split across pages in the editor.
  const longPages = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.ce-block[data-id="long"]')!;
    return el.querySelectorAll(".tp-split").length;
  });
  expect(longPages).toBeGreaterThan(0);

  await openPrintRoute(page, id);
  const printPages = await page.locator(".tp-print-page").evaluateAll((els) =>
    els.map((e) => ({ w: (e as HTMLElement).offsetWidth, h: (e as HTMLElement).offsetHeight, name: (e as HTMLElement).dataset.printPage })),
  );
  expect(printPages.map(({ w, h }) => ({ w, h }))).toEqual(sheets);
  expect(printPages.find((p) => p.w > p.h)?.name).toBe("tp-page-1123x794");

  // No editor UI in the print DOM.
  await expect(page.locator(".tp-print-root [contenteditable]")).toHaveCount(0);
  await expect(page.locator(".tp-print-root .ce-toolbar")).toHaveCount(0);
  await expect(page.locator(".codex-editor__redactor .ce-block:not(.tp-print-root *)")).toHaveCount(0);

  // The split paragraph: on two pages, and every word is visible exactly
  // once across them (the clipped parts are hidden, nothing is lost).
  const split = await page.evaluate(() => {
    const words: string[] = [];
    const pagesWithBlock: number[] = [];
    document.querySelectorAll<HTMLElement>(".tp-print-page").forEach((pageEl, p) => {
      const block = pageEl.querySelector('.ce-block[data-id="long"]');
      if (!block) return;
      pagesWithBlock.push(p);
      const clip = pageEl.getBoundingClientRect();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent ?? "";
        for (const m of t.matchAll(/\S+/g)) {
          range.setStart(n, m.index!);
          range.setEnd(n, m.index! + m[0].length);
          const r = range.getBoundingClientRect();
          const cy = (r.top + r.bottom) / 2;
          if (cy > clip.top && cy < clip.bottom) words.push(m[0]);
        }
      }
    });
    return { pagesWithBlock, text: words.join(" ") };
  });
  expect(split.pagesWithBlock.length).toBe(2);
  expect(split.text).toBe(LONG_TEXT);

  // Headers / footers with page numbers on every page; watermark too.
  const n = sheets.length;
  for (let i = 0; i < n; i++) {
    const pageEl = page.locator(".tp-print-page").nth(i);
    await expect(pageEl.locator(".tp-hf--header")).toContainText("Acme print header");
    await expect(pageEl.locator(".tp-hf--footer")).toHaveText(`Page ${i + 1} of ${n}`);
    await expect(pageEl.locator(".tp-watermark")).toHaveText("DRAFT");
  }

  // Printing the route gives one PDF page per editor page, sized per page.
  const pdf = inspectPdf(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(pdf.header).toBe("%PDF-");
  expect(pdf.count).toBe(n);
  expect(pdf.boxes).toHaveLength(n);
  pdf.boxes.forEach((box, i) => {
    expect(box.w).toBeCloseTo(sheets[i]!.w * 0.75, 0);
    expect(box.h).toBeCloseTo(sheets[i]!.h * 0.75, 0);
  });
});

test("Print… builds the print DOM, calls window.print and cleans up", async ({ page, request }) => {
  const id = await seedMixedDocument(request);
  await openDocument(page, id);
  const sheets = await editorSheets(page);
  await page.evaluate(() => {
    const w = window as unknown as { __printed?: number; print: () => void };
    w.print = () => {
      w.__printed = document.querySelectorAll("body > .tp-print-root .tp-print-page").length;
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Print…/ }).click();
  await page.waitForFunction(() => (window as unknown as { __printed?: number }).__printed !== undefined);
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(sheets.length);
  await expect(page.locator(".tp-print-root")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains("tp-printing"))).toBe(false);
});

test("Download PDF renders on the server", async ({ page, request }) => {
  const status = await request.get("/api/pdf/status");
  test.skip(status.status() === 501, "API has no APP_URL configured");
  const id = await seedMixedDocument(request);
  await openDocument(page, id);
  const n = (await editorSheets(page)).length;

  await page.getByRole("button", { name: "File" }).click();
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("menuitem", { name: /Download as PDF/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Print test.pdf");
  const pdf = inspectPdf(fs.readFileSync((await download.path())!));
  expect(pdf.header).toBe("%PDF-");
  expect(pdf.count).toBe(n);
});

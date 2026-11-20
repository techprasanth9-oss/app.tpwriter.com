import { expect, test } from "@playwright/test";
import fs from "node:fs";
import JSZip from "jszip";
import { caretToEnd, createDocument, openDocument, reloadDocument, settle, textOutsidePages } from "./helpers";

const para = (id: string, text: string) => ({ id, type: "paragraph", data: { text } });
const filler = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => para(`${prefix}${i}`, `${prefix} line ${i + 1} with enough words to look like a real paragraph.`));

async function waitPageSetupSaved(page: import("@playwright/test").Page) {
  // Page setup saves after a short debounce.
  await page.waitForTimeout(1200);
}

test("header and footer with page numbers appear on every page and persist", async ({ page, request }) => {
  const id = await createDocument(request, "Report", filler("p", 70));
  await openDocument(page, id);
  const sheets = await page.locator(".tp-sheet").count();
  expect(sheets).toBeGreaterThanOrEqual(3);

  await page.getByTestId("header-0").dblclick();
  await expect(page.getByRole("tab", { name: "Header & Footer" })).toBeVisible();
  await page.getByTestId("header-0").locator('[contenteditable="true"]').first().click();
  await page.keyboard.type("Acme Corp — Quarterly report");
  await page.keyboard.press("Escape");

  await page.getByTestId("footer-0").dblclick();
  await page.getByTestId("footer-0").locator('[contenteditable="true"]').first().click();
  await page.keyboard.type("Page ");
  await page.getByRole("button", { name: "Page number" }).click();
  await page.keyboard.type(" of ");
  await page.getByRole("button", { name: "Page count" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tab", { name: "Header & Footer" })).toHaveCount(0);

  await expect(page.getByTestId("header-1")).toContainText("Acme Corp");
  await expect(page.getByTestId("footer-1")).toContainText(`Page 2 of ${sheets}`);
  await expect(page.getByTestId(`footer-${sheets - 1}`)).toContainText(`Page ${sheets} of ${sheets}`);
  await waitPageSetupSaved(page);

  await reloadDocument(page);
  await expect(page.getByTestId("header-2")).toContainText("Acme Corp");
  await expect(page.getByTestId("footer-0")).toContainText(`Page 1 of ${sheets}`);

  // Different first page: page 1 gets its own (empty) header.
  await page.getByTestId("header-0").dblclick();
  await page.getByLabel("Different first page").check();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("header-0")).not.toContainText("Acme Corp");
  await expect(page.getByTestId("header-1")).toContainText("Acme Corp");
});

test("a landscape section between portrait pages", async ({ page, request }) => {
  const id = await createDocument(request, "Sections", [
    ...filler("a", 5),
    { id: "sb", type: "sectionBreak", data: { layout: { orientation: "landscape" } } },
    ...filler("b", 5),
    { id: "sb2", type: "sectionBreak", data: { layout: { orientation: "portrait" } } },
    ...filler("c", 3),
  ]);
  await openDocument(page, id);
  const dims = await page.locator(".tp-sheet").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).offsetWidth > (e as HTMLElement).offsetHeight ? "landscape" : "portrait"),
  );
  expect(dims).toEqual(["portrait", "landscape", "portrait"]);
  expect((await textOutsidePages(page)).bad).toEqual([]);
  // Section 2's text spans the wider page.
  const widths = await page.evaluate(() => {
    const w = (sel: string) => document.querySelector<HTMLElement>(`.ce-block[data-id="${sel}"]`)!.getBoundingClientRect().width;
    return { portrait: w("a0"), landscape: w("b0") };
  });
  expect(widths.landscape).toBeGreaterThan(widths.portrait + 200);

  // Changing the layout inside section 2 changes only that section.
  await caretToEnd(page, "b line 2");
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.locator(".rb-field", { hasText: "Size" }).locator("select").selectOption("A5");
  await settle(page, 800);
  // Section 2 becomes A5 landscape (794 × 559); sections 1 and 3 stay A4 portrait.
  const sizes = await page.locator(".tp-sheet").evaluateAll((els) =>
    els.map((e) => [(e as HTMLElement).offsetWidth, (e as HTMLElement).offsetHeight]),
  );
  expect(sizes).toEqual([[794, 1123], [794, 559], [794, 1123]]);
});

test("section break from the ribbon starts landscape pages", async ({ page, request }) => {
  const id = await createDocument(request, "Breaks", filler("p", 3));
  await openDocument(page, id);
  await caretToEnd(page, "p line 3");
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByRole("button", { name: "Breaks" }).click();
  await page.getByRole("menuitem", { name: /landscape pages/ }).click();
  await settle(page);
  await expect(page.locator(".tp-section-break")).toHaveCount(1);
  const last = page.locator(".tp-sheet").last();
  const box = await last.boundingBox();
  expect(box!.width).toBeGreaterThan(box!.height);
});

test("table of contents lists headings with their page numbers", async ({ page, request }) => {
  const id = await createDocument(request, "TOC", [
    { id: "toc", type: "toc", data: { maxLevel: 2, title: "Contents" } },
    { id: "h1", type: "header", data: { text: "Introduction", level: 1 } },
    ...filler("i", 40),
    { id: "h2", type: "header", data: { text: "Details", level: 2 } },
    ...filler("d", 40),
    { id: "h3", type: "header", data: { text: "Deep detail", level: 3 } },
  ]);
  await openDocument(page, id);
  const entries = page.locator(".tp-toc__entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Introduction");
  await expect(entries.nth(0).locator(".tp-toc__page")).toHaveText("1");
  const detailsPage = Number(await entries.nth(1).locator(".tp-toc__page").textContent());
  const actual = await page.evaluate(() => {
    const h = document.querySelector<HTMLElement>('.ce-block[data-id="h2"]')!.getBoundingClientRect().top;
    const sheets = [...document.querySelectorAll(".tp-sheet")].map((s) => s.getBoundingClientRect());
    return sheets.findIndex((s) => h >= s.top && h < s.bottom) + 1;
  });
  expect(detailsPage).toBe(actual);
  expect(detailsPage).toBeGreaterThan(1);
});

test("footnotes are numbered, sit on their page and persist", async ({ page, request }) => {
  const id = await createDocument(request, "Notes", [para("a", "First claim here."), para("b", "Second claim here.")]);
  await openDocument(page, id);
  await page.getByRole("tab", { name: "References" }).click();

  await caretToEnd(page, "Second claim here.");
  await page.getByRole("button", { name: "Insert footnote" }).click();
  await settle(page, 600);
  await page.keyboard.type("Source for the second claim.");
  await caretToEnd(page, "First claim here.");
  await page.getByRole("button", { name: "Insert footnote" }).click();
  await settle(page, 600);
  await page.keyboard.type("Source for the first claim.");
  await settle(page, 1500);

  // Numbered in document order, not insertion order.
  await expect(page.locator(".tp-fn-ref")).toHaveText(["1", "2"]);
  const notes = page.locator(".tp-footnotes:not(.tp-footnotes--measure) .tp-fn");
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toContainText("1Source for the first claim.");
  await expect(notes.nth(1)).toContainText("2Source for the second claim.");

  await reloadDocument(page);
  await expect(page.locator(".tp-footnotes:not(.tp-footnotes--measure) .tp-fn").nth(0)).toContainText("Source for the first claim.");
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("watermark, page colour and border apply to every page", async ({ page, request }) => {
  const id = await createDocument(request, "Decor", filler("p", 60));
  await openDocument(page, id);
  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByRole("button", { name: "Watermark" }).click();
  await page.getByRole("menuitemradio", { name: "DRAFT" }).click();
  await page.getByRole("button", { name: "Page borders" }).click();
  await page.getByRole("menuitemradio", { name: "Double" }).click();
  const sheets = await page.locator(".tp-sheet").count();
  await expect(page.locator(".tp-watermark")).toHaveCount(sheets);
  await expect(page.locator(".tp-sheet-border")).toHaveCount(sheets);
  await waitPageSetupSaved(page);
  await reloadDocument(page);
  await expect(page.locator(".tp-watermark").first()).toHaveText("DRAFT");
});

test("DOCX export carries headers, footnotes and sections", async ({ page, request }) => {
  const id = await createDocument(request, "Export", [
    { id: "a", type: "paragraph", data: { text: 'Claim<sup class="tp-fn-ref" data-fn-id="f1" contenteditable="false">1</sup>.' } },
    { id: "sb", type: "sectionBreak", data: { layout: { orientation: "landscape" } } },
    para("b", "Wide section"),
  ]);
  await request.patch(`/api/documents/${id}`, {
    data: {
      pageSetup: {
        headers: { default: [para("h", 'Acme <span class="tp-field" data-field="page" contenteditable="false">#</span>')], first: [], even: [] },
        footnotes: { f1: "The source." },
      },
    },
  });
  await openDocument(page, id);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File" }).click();
  await page.getByRole("menuitem", { name: /Download as Word/ }).click();
  const file = await (await download).path();
  const zip = await JSZip.loadAsync(fs.readFileSync(file!));
  const names = Object.keys(zip.files);
  const headerXml = await zip.file(names.find((n) => /word\/header\d*\.xml/.test(n))!)!.async("string");
  expect(headerXml).toContain("Acme");
  expect(headerXml).toMatch(/PAGE/);
  expect(await zip.file("word/footnotes.xml")!.async("string")).toContain("The source.");
  expect(await zip.file("word/document.xml")!.async("string")).toContain('w:orient="landscape"');
});

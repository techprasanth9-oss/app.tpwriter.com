import { expect, test } from "@playwright/test";
import fs from "node:fs";
import JSZip from "jszip";
import { createDocument, openDocument, reloadDocument, settle, waitSaved } from "./helpers";

const chart = {
  type: "bar",
  title: "Sales",
  labels: ["Q1", "Q2", "Q3"],
  series: [
    { name: "North", values: [3, 5, 4] },
    { name: "South", values: [2, 6, 7] },
  ],
};

test("equation renders with KaTeX and edits inline", async ({ page, request }) => {
  const id = await createDocument(request, "Equation", [
    { id: "eq", type: "equation", data: { latex: "x \\lt \\frac{a}{b}", display: true } },
  ]);
  await openDocument(page, id);
  const preview = page.locator('.ce-block[data-id="eq"] .tp-equation__preview');
  await expect(preview.locator(".katex")).toBeVisible();
  await expect(preview).toHaveAttribute("role", "img");

  await preview.click();
  const input = page.locator(".tp-equation__input");
  await expect(input).toBeFocused();
  await input.fill("E = mc^2");
  await expect(page.locator(".tp-equation__live .katex")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".tp-equation__editor")).toHaveCount(0);
  await expect(preview).toHaveAttribute("aria-label", "E = mc^2");

  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator('.ce-block[data-id="eq"] .tp-equation__preview')).toHaveAttribute("aria-label", "E = mc^2");
});

test("invalid LaTeX shows an error instead of breaking the editor", async ({ page, request }) => {
  const id = await createDocument(request, "Bad equation", [
    { id: "eq", type: "equation", data: { latex: "\\frac{a}{", display: true } },
  ]);
  await openDocument(page, id);
  await expect(page.locator('.ce-block[data-id="eq"] .katex-error')).toBeVisible();
});

test("text box keeps Enter as a line break and changes preset", async ({ page, request }) => {
  const id = await createDocument(request, "Text box", [
    { id: "tb", type: "textBox", data: { text: "First", preset: "note", width: 100, align: "center" } },
  ]);
  await openDocument(page, id);
  const content = page.locator('.ce-block[data-id="tb"] .tp-textbox__content');
  await content.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second");
  await settle(page);
  await expect(page.locator(".ce-block")).toHaveCount(1);
  await expect(content).toContainText("Second");
  expect(await content.innerHTML()).toContain("<br>");

  await waitSaved(page);
  await reloadDocument(page);
  expect(await page.locator('.ce-block[data-id="tb"] .tp-textbox__content').innerHTML()).toMatch(/First<br>Second/);
});

test("chart edits through the data grid and persists", async ({ page, request }) => {
  const id = await createDocument(request, "Chart", [{ id: "ch", type: "chart", data: chart }]);
  await openDocument(page, id);
  const block = page.locator('.ce-block[data-id="ch"]');
  await expect(block.locator(".tp-chart__bar")).toHaveCount(6);
  await expect(block.locator("svg")).toHaveAttribute("aria-label", /Bar chart: Sales/);

  await block.hover();
  await block.getByRole("button", { name: "Edit data" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit chart data" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "+ Row" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(block.locator(".tp-chart__bar")).toHaveCount(8);

  await block.hover();
  await block.getByRole("button", { name: "Edit data" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tp-chart-dialog")).toHaveCount(0);

  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator('.ce-block[data-id="ch"] .tp-chart__bar')).toHaveCount(8);
});

test("DOCX export carries equation, text box and chart image", async ({ page, request }) => {
  const id = await createDocument(request, "Objects export", [
    { id: "eq", type: "equation", data: { latex: "a^2+b^2=c^2", display: true } },
    { id: "tb", type: "textBox", data: { text: "Boxed <b>text</b>", preset: "info", width: 75, align: "center" } },
    { id: "ch", type: "chart", data: chart },
  ]);
  await openDocument(page, id);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export DOCX" }).click();
  const file = await (await download).path();
  const zip = await JSZip.loadAsync(fs.readFileSync(file!));
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(xml).toContain("<m:oMath>");
  expect(xml).toContain("a^2+b^2=c^2");
  expect(xml).toContain('w:fill="DDF4FF"');
  expect(xml).toContain("Boxed ");
  // A real browser rasterises the chart to a PNG.
  expect(Object.keys(zip.files).some((n) => /^word\/media\/.+\.png$/.test(n))).toBe(true);
  expect(xml).toContain(">Sales</w:t>");
});

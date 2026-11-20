import { expect, test } from "@playwright/test";
import { createDocument, openDocument, reloadDocument, settle, textOutsidePages, typeLines, waitSaved } from "./helpers";

const line = (i: number) => `Line ${i}: the quick brown fox jumps over the lazy dog.`;

test("typing flows onto new pages and survives a reload", async ({ page, request }) => {
  const id = await createDocument(request, "Flow");
  await openDocument(page, id);
  await page.locator(".ce-paragraph").first().click();
  await typeLines(page, Array.from({ length: 70 }, (_, i) => line(i + 1)));
  await settle(page);

  const layout = await textOutsidePages(page);
  expect(layout.sheets).toBeGreaterThanOrEqual(3);
  expect(layout.bad).toEqual([]);
  await expect(page.locator(".thumb")).toHaveCount(layout.sheets);
  await waitSaved(page);

  await reloadDocument(page);
  const texts = await page.locator(".ce-paragraph").allTextContents();
  expect(texts).toHaveLength(70);
  expect(texts[69]).toBe(line(70));
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("ribbon formatting persists and the ribbon reflects it", async ({ page, request }) => {
  const id = await createDocument(request, "Format", [
    { id: "p1", type: "paragraph", data: { text: "First" } },
    { id: "p2", type: "paragraph", data: { text: "Second" } },
  ]);
  await openDocument(page, id);

  await page.locator(".ce-paragraph").nth(1).click();
  await page.getByRole("button", { name: /^Center/ }).click();
  await expect(page.getByRole("button", { name: /^Center/ })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".ce-paragraph").first().click();
  await page.getByRole("listbox", { name: "Paragraph style" }).getByRole("option", { name: /Heading 1/ }).click();
  await expect(page.locator('.ce-header[data-level="1"]')).toHaveText("First");
  await waitSaved(page);

  await reloadDocument(page);
  await expect(page.locator('.ce-header[data-level="1"]')).toHaveText("First");
  const align = await page
    .locator(".ce-block", { hasText: "Second" })
    .locator(".tp-format")
    .evaluate((el) => (el as HTMLElement).style.textAlign);
  expect(align).toBe("center");
});

test("undo and redo", async ({ page, request }) => {
  const id = await createDocument(request, "History", [
    { id: "p1", type: "paragraph", data: { text: "Hello" } },
  ]);
  await openDocument(page, id);
  await page.locator(".ce-paragraph").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" world");
  await settle(page, 700);

  await page.keyboard.press("Control+z");
  await expect(page.locator(".ce-paragraph")).toHaveText("Hello");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".ce-paragraph")).toHaveText("Hello world");
});

test("Ctrl+Enter inserts a page break after the caret's paragraph", async ({ page, request }) => {
  const id = await createDocument(request, "Breaks", [
    { id: "a", type: "paragraph", data: { text: "One" } },
    { id: "b", type: "paragraph", data: { text: "Two" } },
    { id: "c", type: "paragraph", data: { text: "Three" } },
  ]);
  await openDocument(page, id);
  await page.locator(".ce-paragraph", { hasText: "Two" }).click();
  await page.keyboard.press("Control+Enter");
  await settle(page);

  const order = await page
    .locator(".codex-editor__redactor > .ce-block")
    .evaluateAll((bs) => bs.map((b) => (b.querySelector(".tp-page-break") ? "BREAK" : b.textContent)));
  expect(order).toEqual(["One", "Two", "BREAK", "", "Three"]);
  await expect(page.locator(".tp-sheet")).toHaveCount(2);
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("a second tab catches up live instead of overwriting", async ({ page, context, request }) => {
  const id = await createDocument(request, "Conflict", [
    { id: "a", type: "paragraph", data: { text: "Shared" } },
  ]);
  await openDocument(page, id);
  const other = await context.newPage();
  await openDocument(other, id);

  await other.locator(".ce-paragraph").click();
  await other.keyboard.press("End");
  await other.keyboard.type(" (tab 2)");
  await waitSaved(other);

  // Tab 1 receives tab 2's edit without a reload, then builds on it.
  await expect(page.locator(".ce-paragraph")).toHaveText("Shared (tab 2)", { timeout: 15_000 });
  await page.locator(".ce-paragraph").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (tab 1)");
  await waitSaved(page);
  await expect(page.locator(".doc-conflict[role=alert]")).toHaveCount(0);
  await expect(other.locator(".ce-paragraph")).toHaveText("Shared (tab 2) (tab 1)", { timeout: 15_000 });
  const doc = (await (await request.get(`/api/documents/${id}`)).json()) as { blocks: { data: { text: string } }[] };
  expect(doc.blocks[0]!.data.text).toBe("Shared (tab 2) (tab 1)");
});

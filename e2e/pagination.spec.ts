import { expect, test } from "@playwright/test";
import { caretToEnd, createDocument, openDocument, sentence, settle, textOutsidePages, waitSaved } from "./helpers";

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `f${i}`, type: "paragraph", data: { text: `Filler line ${i + 1}` } }));

const longParagraph = (id: string, sentences: number) => ({
  id,
  type: "paragraph",
  data: { text: Array.from({ length: sentences }, (_, i) => sentence(i + 1)).join(" ") },
});

test("a long paragraph splits across pages at a line boundary", async ({ page, request }) => {
  const id = await createDocument(request, "Split paragraph", [...filler(18), longParagraph("long", 40)]);
  await openDocument(page, id);

  const layout = await textOutsidePages(page);
  expect(layout.sheets).toBeGreaterThanOrEqual(2);
  expect(layout.bad).toEqual([]);
  // Split, not moved: the paragraph starts on page 1 right after the filler.
  await expect(page.locator(".ce-block", { hasText: "Sentence 1 of" }).locator(".tp-split")).not.toHaveCount(0);

  // The split marker is layout only — never part of the saved text.
  await caretToEnd(page, "Sentence 40 of");
  await page.keyboard.type(" The end.");
  await waitSaved(page);
  const saved = await (await request.get(`/api/documents/${id}`)).json();
  const text: string = saved.blocks.find((b: { id: string }) => b.id === "long").data.text;
  expect(text.endsWith("The end.")).toBe(true);
  expect(text).not.toContain("tp-split");
});

test("a paragraph taller than a page splits over several pages", async ({ page, request }) => {
  const id = await createDocument(request, "Huge paragraph", [longParagraph("huge", 160)]);
  await openDocument(page, id);
  const layout = await textOutsidePages(page);
  expect(layout.sheets).toBeGreaterThanOrEqual(3);
  expect(layout.bad).toEqual([]);
});

test("editing above a split re-flows it", async ({ page, request }) => {
  const id = await createDocument(request, "Reflow", [...filler(18), longParagraph("long", 40)]);
  await openDocument(page, id);
  await page.locator(".ce-paragraph", { hasText: "Filler line 1" }).first().click();
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
    await page.keyboard.type(`Inserted ${i}`);
  }
  await settle(page);
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("a long table splits between rows", async ({ page, request }) => {
  const rows = Array.from({ length: 45 }, (_, r) => [`R${r + 1} A`, `R${r + 1} B`, `R${r + 1} C`]);
  const id = await createDocument(request, "Split table", [
    ...filler(8),
    { id: "t", type: "table", data: { withHeading: false, content: rows } },
    { id: "after", type: "paragraph", data: { text: "After the table" } },
  ]);
  await openDocument(page, id);

  const layout = await textOutsidePages(page);
  expect(layout.sheets).toBeGreaterThanOrEqual(2);
  expect(layout.bad).toEqual([]);
  // Rows after the break are shifted; nothing is written into the cells.
  expect(await page.locator("table tr[style*='top']").count()).toBeGreaterThan(0);
  await expect(page.locator("table td", { hasText: "R45 C" })).toBeVisible();
});

test("a long list splits between items", async ({ page, request }) => {
  const items = Array.from({ length: 60 }, (_, i) => ({ content: `Item ${i + 1}`, meta: {}, items: [] }));
  const id = await createDocument(request, "Split list", [
    ...filler(10),
    { id: "l", type: "list", data: { style: "ordered", items, meta: {} } },
  ]);
  await openDocument(page, id);
  const layout = await textOutsidePages(page);
  expect(layout.sheets).toBeGreaterThanOrEqual(2);
  expect(layout.bad).toEqual([]);
  await expect(page.locator(".ce-block", { hasText: "Item 1" }).locator(".tp-split")).not.toHaveCount(0);
});

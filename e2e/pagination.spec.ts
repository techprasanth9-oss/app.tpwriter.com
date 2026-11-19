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

test("table header rows repeat at the top of continuation pages", async ({ page, request }) => {
  const rows = [["Name", "Region", "Total"], ...Array.from({ length: 60 }, (_, r) => [`Item ${r + 1}`, "EU", String(r * 10)])];
  const id = await createDocument(request, "Repeat header", [
    ...filler(6),
    { id: "t", type: "table", data: { withHeading: true, headerRows: 1, repeatHeader: true, content: rows } },
  ]);
  await openDocument(page, id);
  const ghosts = page.locator(".tp-table-ghost");
  const sheets = await page.locator(".tp-sheet").count();
  expect(sheets).toBeGreaterThanOrEqual(3);
  await expect(ghosts).toHaveCount(sheets - 1);
  // Each copy sits at the top of the next page's text area, above the rows.
  const placement = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll(".tp-sheet")].map((s) => s.getBoundingClientRect());
    return [...document.querySelectorAll(".tp-table-ghost")].map((g, i) => {
      const r = g.getBoundingClientRect();
      return { offsetFromSheetTop: Math.round(r.top - sheets[i + 1]!.top), text: g.textContent };
    });
  });
  for (const p of placement) {
    expect(p.text).toContain("NameRegionTotal");
    expect(Math.abs(p.offsetFromSheetTop - 96)).toBeLessThan(3);
  }
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("a table never breaks inside a vertically merged cell", async ({ page, request }) => {
  const content = Array.from({ length: 40 }, (_, r) => [`R${r + 1}`, `V${r + 1}`]);
  const cells = Array.from({ length: 40 }, () => [{}, {}]) as Array<Array<Record<string, unknown>>>;
  // Rows 14–21 share one merged cell in column 2: it straddles where a
  // naive split would fall.
  cells[13]![1] = { rowSpan: 8 };
  for (let r = 14; r < 21; r++) content[r] = [`R${r + 1}`];
  const id = await createDocument(request, "Merged split", [
    ...filler(20),
    { id: "t", type: "table", data: { content, styles: { cells } } },
  ]);
  await openDocument(page, id);
  const merged = await page.evaluate(() => {
    const cell = [...document.querySelectorAll<HTMLTableCellElement>("table td")].find((c) => c.rowSpan === 8)!;
    const r = cell.getBoundingClientRect();
    const sheets = [...document.querySelectorAll(".tp-sheet")].map((s) => s.getBoundingClientRect());
    return sheets.some((s) => r.top >= s.top && r.bottom <= s.bottom);
  });
  expect(merged).toBe(true);
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("text wraps beside an image floated left", async ({ page, request }) => {
  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const id = await createDocument(request, "Wrap", [
    {
      id: "img",
      type: "image",
      data: {
        file: { url: png },
        dimensions: { width: "200px", height: "150px" },
        tunes: { imageTune: { wrapText: "square", float: "left" } },
      },
    },
    { id: "p1", type: "paragraph", data: { text: "Text beside the image. ".repeat(12) } },
  ]);
  await openDocument(page, id);
  const geometry = await page.evaluate(() => {
    const img = document.querySelector('.ce-block[data-id="img"]')!.getBoundingClientRect();
    const para = document.querySelector('.ce-block[data-id="p1"]')!.getBoundingClientRect();
    return { imgRight: img.right, paraLeft: para.left, imgTop: img.top, paraTop: para.top };
  });
  expect(geometry.paraLeft).toBeGreaterThanOrEqual(geometry.imgRight);
  expect(Math.abs(geometry.paraTop - geometry.imgTop)).toBeLessThan(20);
});

test("columns hold real blocks (headings, lists), not stubs", async ({ page, request }) => {
  const id = await createDocument(request, "Columns", [
    {
      id: "c",
      type: "column",
      data: {
        numberOfColumns: 2,
        cols: [
          { blocks: [{ id: "h", type: "header", data: { text: "Left heading", level: 2 } }] },
          { blocks: [{ id: "l", type: "list", data: { style: "unordered", items: [{ content: "Point", meta: {}, items: [] }], meta: {} } }] },
        ],
      },
    },
  ]);
  await openDocument(page, id);
  await expect(page.locator(".custom-columns-tool .ce-header")).toHaveText("Left heading");
  await expect(page.locator(".custom-columns-tool .cdx-list")).toContainText("Point");
  await expect(page.locator(".custom-columns-tool .ce-stub")).toHaveCount(0);
});

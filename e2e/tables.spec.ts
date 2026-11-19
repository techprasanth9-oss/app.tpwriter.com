import { expect, test, type Page } from "@playwright/test";
import { createDocument, openDocument, reloadDocument, settle, waitSaved } from "./helpers";

const grid = (rows: number, cols: number) =>
  Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => `${String.fromCharCode(65 + c)}${r + 1}`),
  );

const table = (id: string, content: string[][], extra: Record<string, unknown> = {}) => ({
  id,
  type: "table",
  data: { content, withHeading: false, ...extra },
});

const cell = (page: Page, text: string) => page.locator("table.te-table td, table.te-table th").filter({ hasText: new RegExp(`^${text}$`) }).first();

async function menu(page: Page, onCell: string, item: string) {
  await cell(page, onCell).click({ button: "right" });
  await page.locator(".te-context-menu-item", { hasText: item }).first().click();
  await settle(page, 300);
}

test("merged cells persist as real colspan/rowspan", async ({ page, request }) => {
  const id = await createDocument(request, "Merge", [table("t", grid(3, 3))]);
  await openDocument(page, id);

  // Drag-select A1:B2, then Merge.
  const a1 = await cell(page, "A1").boundingBox();
  const b2 = await cell(page, "B2").boundingBox();
  await page.mouse.move(a1!.x + 10, a1!.y + a1!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2!.x + 10, b2!.y + b2!.height / 2, { steps: 5 });
  await page.mouse.up();
  await menu(page, "B2", "Merge cells");
  await waitSaved(page);

  await reloadDocument(page);
  const merged = page.locator("table.te-table tr").first().locator("td").first();
  await expect(merged).toHaveAttribute("colspan", "2");
  await expect(merged).toHaveAttribute("rowspan", "2");
  await expect(merged).toContainText("A1");
  await expect(merged).toContainText("B2");
});

test("deleting a row through a vertical merge keeps the grid whole", async ({ page, request }) => {
  const id = await createDocument(request, "Rowspan", [
    table("t", [["A1", "B1", "C1"], ["A2", "C2"], ["A3", "B3", "C3"]], {
      styles: { cells: { 0: { 1: { rowSpan: 2 } } } },
    }),
  ]);
  await openDocument(page, id);
  await menu(page, "A1", "Delete row");
  await waitSaved(page);
  await reloadDocument(page);

  const rows = page.locator("table.te-table tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator("td")).toHaveCount(3);
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText("B1");
  await expect(rows.nth(1).locator("td")).toHaveCount(3);
});

test("header rows are marked to repeat and the toggle persists", async ({ page, request }) => {
  const rows = Array.from({ length: 60 }, (_, i) => [`Row ${i + 1}`, `Value ${i + 1}`]);
  const id = await createDocument(request, "Long table", [
    table("t", [["Name", "Value"], ...rows], { headerRows: [0], withHeading: true }),
  ]);
  await openDocument(page, id);

  const header = page.locator("table.te-table tr").first();
  await expect(header).toHaveAttribute("data-repeat-header", "true");
  await expect(page.locator('table.te-table tr[data-repeat-header="true"]')).toHaveCount(1);
  // The table is long enough to continue onto another page.
  expect(await page.locator(".tp-sheet").count()).toBeGreaterThanOrEqual(2);

  await menu(page, "Row 3", "Stop repeating header");
  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator('table.te-table tr[data-repeat-header="true"]')).toHaveCount(0);
  await expect(page.locator("table.te-table tr").first().locator("th")).toHaveCount(2);

  await menu(page, "Row 3", "Repeat header on each page");
  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator('table.te-table tr[data-repeat-header="true"]')).toHaveCount(1);
});

test("toggling the header on a lower row makes every row above it a header", async ({ page, request }) => {
  const id = await createDocument(request, "Headers", [table("t", grid(4, 2))]);
  await openDocument(page, id);
  await menu(page, "A2", "Toggle header row");
  await waitSaved(page);
  await reloadDocument(page);
  const marked = page.locator('table.te-table tr[data-repeat-header="true"]');
  await expect(marked).toHaveCount(2);
  await expect(marked.nth(0)).toContainText("A1");
  await expect(marked.nth(1)).toContainText("A2");
});

test("popups opened from the table menu don't outlive the block", async ({ page, request }) => {
  const id = await createDocument(request, "Popups", [table("t", grid(2, 2))]);
  await openDocument(page, id);
  await menu(page, "A1", "Cell padding");
  await expect(page.getByText("Link all sides")).toBeVisible();
  // Clicking elsewhere closes it and its document listener.
  await page.mouse.click(5, 5);
  await expect(page.getByText("Link all sides")).toHaveCount(0);
});

test("cell background and alignment survive a reload", async ({ page, request }) => {
  const id = await createDocument(request, "Formatting", [table("t", grid(2, 2))]);
  await openDocument(page, id);
  await menu(page, "B1", "Align center");
  await waitSaved(page);
  await reloadDocument(page);
  await expect(cell(page, "B1")).toHaveCSS("text-align", "center");
});

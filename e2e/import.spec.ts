import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { createDocument, openDocument, settle, textOutsidePages } from "./helpers";

const fixture = (name: string) => path.resolve("fixtures/docx", name);

async function importFile(page: Page, file: string) {
  page.once("dialog", (d) => void d.accept());
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import DOCX" }).click();
  await (await chooser).setFiles(file);
}

test("importing a real report brings over sections, headers, TOC, footnotes and images", async ({ page, request }) => {
  const id = await createDocument(request, "Import target", [{ id: "x", type: "paragraph", data: { text: "Old content" } }]);
  await openDocument(page, id);
  await importFile(page, fixture("14-report.docx"));

  await expect(page.locator(".ce-paragraph", { hasText: "Old content" })).toHaveCount(0, { timeout: 20_000 });
  await settle(page, 1500);
  await expect(page.locator(".tp-toc__entry").first()).toBeVisible();
  await expect(page.locator(".tp-fn-ref").first()).toBeVisible();
  await expect(page.locator(".tp-footnotes:not(.tp-footnotes--measure) .tp-fn").first()).toBeVisible();
  const orientations = await page.locator(".tp-sheet").evaluateAll((els) =>
    els.map((e) => ((e as HTMLElement).offsetWidth > (e as HTMLElement).offsetHeight ? "L" : "P")).join(""),
  );
  expect(orientations).toContain("L");
  expect(orientations.startsWith("P")).toBe(true);
  await expect(page.getByTestId("footer-1")).toContainText(/\d/);
  expect((await textOutsidePages(page)).bad).toEqual([]);

  // Embedded images were uploaded, and everything was saved.
  await expect(page.locator(".doc-save-status")).toHaveText(/Saved/, { timeout: 20_000 });
  await page.waitForTimeout(1200);
  const saved = await (await request.get(`/api/documents/${id}`)).text();
  expect(saved).not.toContain("data:image/");
  expect(saved).toContain("/uploads/");
  expect(saved).toContain("sectionBreak");
});

test("imported tables keep merges and repeating header rows", async ({ page, request }) => {
  const id = await createDocument(request, "Tables import");
  await openDocument(page, id);
  await importFile(page, fixture("05-tables.docx"));
  await expect(page.locator("table td[rowspan], table th[rowspan]").first()).toBeVisible({ timeout: 20_000 });
  await settle(page, 1500);
  await expect(page.locator("table td[colspan], table th[colspan]").first()).toBeVisible();
  await expect(page.locator(".tp-table-ghost").first()).toBeAttached();
  expect((await textOutsidePages(page)).bad).toEqual([]);
});

test("import notes are shown and can be dismissed", async ({ page, request }) => {
  const id = await createDocument(request, "Warnings import");
  await openDocument(page, id);
  await importFile(page, fixture("11-breaks.docx"));
  const notes = page.locator(".tp-import-warnings");
  await expect(notes).toBeVisible({ timeout: 20_000 });
  await notes.locator("summary").click();
  await expect(notes).toContainText(/continuous/i);
  await notes.getByRole("button", { name: "Dismiss" }).click();
  await expect(notes).toHaveCount(0);
});

test("a file that isn't a DOCX is refused and the document is untouched", async ({ page, request }) => {
  const id = await createDocument(request, "Bad import", [{ id: "x", type: "paragraph", data: { text: "Keep me" } }]);
  await openDocument(page, id);
  let message = "";
  page.once("dialog", (d) => {
    message = d.message();
    void d.dismiss();
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import DOCX" }).click();
  await (await chooser).setFiles({ name: "fake.docx", mimeType: "application/octet-stream", buffer: Buffer.from("not a zip at all") });
  await expect.poll(() => message).toMatch(/Couldn't import/);
  await expect(page.locator(".ce-paragraph")).toHaveText("Keep me");
});

import { expect, test, type Page } from "@playwright/test";
import { caretToEnd, createDocument, openDocument, reloadDocument, waitSaved } from "./helpers";

/**
 * Version history (Phase 6).
 *
 * Integration assumption: a button named "Version history" (header/File
 * menu) opens `VersionHistoryPanel` with the editor's current blocks.
 */

const dialog = (page: Page) => page.getByRole("dialog", { name: "Version history" });
const versionItem = (page: Page, text: string | RegExp) =>
  page.getByRole("navigation", { name: "Versions" }).getByRole("button", { name: text });

async function openHistory(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Version history" }).click();
  await expect(dialog(page)).toBeVisible();
}

async function nameCurrentVersion(page: Page, label: string): Promise<void> {
  await openHistory(page);
  await page.getByRole("button", { name: "Name current version" }).click();
  await page.getByLabel("Name the current version").fill(label);
  await dialog(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(versionItem(page, new RegExp(label))).toBeVisible();
}

test("name a version, preview it and compare with the current document", async ({ page, request }) => {
  const id = await createDocument(request, "History compare", [
    { id: "p1", type: "paragraph", data: { text: "The plan ships on Friday." } },
    { id: "p2", type: "paragraph", data: { text: "This paragraph will be removed." } },
  ]);
  await openDocument(page, id);
  await nameCurrentVersion(page, "First draft");
  await expect(
    page.getByRole("navigation", { name: "Versions" }).getByRole("heading", { name: "Named versions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close version history" }).click();

  // Edit: change a word, delete a paragraph, add one.
  await page.locator(".ce-paragraph", { hasText: "Friday" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("The plan ships on Monday.");
  await page.locator(".ce-paragraph", { hasText: "removed" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await caretToEnd(page, "Monday");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A brand new paragraph.");
  await waitSaved(page);

  await openHistory(page);
  // Current version preview first.
  await expect(page.locator(".tp-history-paper")).toContainText("A brand new paragraph.");
  await versionItem(page, /First draft/).click();
  await expect(page.locator(".tp-history-paper")).toContainText("The plan ships on Friday.");
  await expect(page.locator(".tp-history-paper")).toContainText("This paragraph will be removed.");

  await page.getByLabel("Compare with current").check();
  await expect(page.locator(".tp-diff-del")).toHaveText("Friday");
  await expect(page.locator(".tp-diff-ins")).toHaveText("Monday");
  await expect(page.locator(".tp-diff-removed")).toContainText("This paragraph will be removed.");
  await expect(page.locator(".tp-diff-added")).toContainText("A brand new paragraph.");
  await expect(page.locator(".tp-history-stats")).toContainText("1 added");

  await page.getByLabel("Changes only").check();
  await expect(page.locator(".tp-diff-block")).toHaveCount(3);

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
});

test("restore an earlier version after confirming", async ({ page, request }) => {
  const id = await createDocument(request, "History restore", [
    { id: "p1", type: "paragraph", data: { text: "Original wording." } },
  ]);
  await openDocument(page, id);
  await nameCurrentVersion(page, "Original");
  await page.getByRole("button", { name: "Close version history" }).click();

  await page.locator(".ce-paragraph").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Rewritten wording.");
  await waitSaved(page);

  await openHistory(page);
  await versionItem(page, /Original/).click();
  await page.getByRole("button", { name: "Restore this version" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Restore this version?" });
  await expect(confirm).toBeVisible();
  // Cancel keeps everything as is.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore", exact: true }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".ce-paragraph").first()).toHaveText("Original wording.");
  await reloadDocument(page);
  await expect(page.locator(".ce-paragraph").first()).toHaveText("Original wording.");

  // The pre-restore state was kept as an automatic version.
  await openHistory(page);
  await expect(page.getByRole("navigation", { name: "Versions" }).getByRole("heading", { name: "Today" })).toBeVisible();
});

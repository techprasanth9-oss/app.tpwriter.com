import { expect, test } from "@playwright/test";
import {
  caretToEnd,
  createDocument,
  openDocument,
  reloadDocument,
  selectText,
  settle,
  styleOf,
  waitSaved,
} from "./helpers";

const para = (id: string, text: string) => ({ id, type: "paragraph", data: { text } });
const mod = process.platform === "darwin" ? "Meta" : "Control";

test("font, size and colour apply to the selection and persist", async ({ page, request }) => {
  const id = await createDocument(request, "Fonts", [para("a", "The quick brown fox jumps")]);
  await openDocument(page, id);

  await selectText(page, "quick brown");
  await page.getByRole("combobox", { name: "Font", exact: true }).selectOption("Georgia");
  await selectText(page, "quick brown");
  const size = page.getByLabel("Font size");
  await size.fill("18");
  await size.press("Enter");
  await selectText(page, "brown");
  await page.getByRole("button", { name: "Text colour options" }).click();
  await page.getByRole("button", { name: "#ff0000" }).click();
  await waitSaved(page);

  await reloadDocument(page);
  expect(await styleOf(page, "quick", "font-family")).toContain("Georgia");
  expect(await styleOf(page, "quick", "font-size")).toBe("18pt");
  expect(await styleOf(page, "brown", "color")).toBe("rgb(255, 0, 0)");
  expect(await styleOf(page, "fox", "font-size")).toBe("");

  // The ribbon reflects the caret's formatting.
  await selectText(page, "quick");
  await expect(page.getByLabel("Font size")).toHaveValue("18");
  await expect(page.getByRole("combobox", { name: "Font", exact: true })).toHaveValue("Georgia");
});

test("font size with the caret inside a word applies to the word", async ({ page, request }) => {
  const id = await createDocument(request, "Word", [para("a", "alpha beta gamma")]);
  await openDocument(page, id);
  await selectText(page, "et"); // inside "beta"
  await page.evaluate(() => document.getSelection()!.collapseToStart());
  await page.getByRole("button", { name: /^Grow font/ }).click();
  expect(await styleOf(page, "beta", "font-size")).toBe("14pt");
  expect(await styleOf(page, "alpha", "font-size")).toBe("");
});

test("clear formatting and change case", async ({ page, request }) => {
  const id = await createDocument(request, "Clear", [para("a", '<b>bold</b> and <span style="color: red;">red</span> text')]);
  await openDocument(page, id);
  await selectText(page, "bold and red");
  await page.getByRole("button", { name: /^Clear formatting/ }).click();
  await expect(page.locator(".ce-paragraph")).toHaveJSProperty("innerHTML", "bold and red text");

  await selectText(page, "bold and red");
  await page.getByRole("button", { name: "Change case" }).click();
  await page.getByRole("menuitem", { name: "UPPERCASE" }).click();
  await expect(page.locator(".ce-paragraph")).toHaveText("BOLD AND RED text");
});

test("insert, edit and remove a link", async ({ page, request }) => {
  const id = await createDocument(request, "Links", [para("a", "Visit our site today")]);
  await openDocument(page, id);
  await selectText(page, "our site");
  await page.keyboard.press(`${mod}+k`);
  await page.getByLabel("Address").fill("example.com/docs");
  await page.getByLabel("Address").press("Enter");

  const link = page.locator(".ce-paragraph a");
  await expect(link).toHaveAttribute("href", "https://example.com/docs");
  await expect(link).toHaveAttribute("target", "_blank");
  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator(".ce-paragraph a")).toHaveText("our site");

  // Caret in the link → bubble with remove.
  await selectText(page, "site");
  await page.evaluate(() => document.getSelection()!.collapseToStart());
  await expect(page.locator(".tp-link-bubble")).toContainText("https://example.com/docs");
  await page.locator(".tp-link-bubble").getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".ce-paragraph a")).toHaveCount(0);
  await expect(page.locator(".ce-paragraph")).toHaveText("Visit our site today");

  // javascript: links are refused.
  await selectText(page, "today");
  await page.keyboard.press(`${mod}+k`);
  await page.getByLabel("Address").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("alert").or(page.locator(".layout-error"))).toBeVisible();
});

test("multi-level and checklist lists persist", async ({ page, request }) => {
  const id = await createDocument(request, "Lists", [para("a", "First")]);
  await openDocument(page, id);
  await caretToEnd(page, "First");
  await page.getByRole("button", { name: "Numbered list" }).click();
  await caretToEnd(page, "First");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  await page.keyboard.type("Nested");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  await page.keyboard.type("Back out");
  await page.keyboard.press("Shift+Tab");

  await page.getByRole("button", { name: "Numbering format" }).click();
  await page.getByRole("menuitem", { name: "I. II. III.", exact: true }).click();
  await waitSaved(page);

  await reloadDocument(page);
  const top = page.locator(".cdx-list").first();
  await expect(top).toHaveCSS("list-style-type", "upper-roman");
  await expect(top.locator(".cdx-list--nested")).toContainText("Nested");
  await expect(top.locator(":scope > li")).toHaveCount(2);

  await caretToEnd(page, "Back out");
  await page.getByRole("button", { name: "Checklist" }).click();
  await settle(page);
  const box = page.locator(".cdx-list-item__checkbox").first();
  await box.check();
  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator(".cdx-list-item__checkbox").first()).toBeChecked();
});

test("find and replace across the document", async ({ page, request }) => {
  const id = await createDocument(request, "Find", [
    para("a", "The fox and the <b>fox</b>"),
    para("b", "Another Fox here"),
  ]);
  await openDocument(page, id);
  await page.locator(".ce-paragraph").first().click();
  await page.keyboard.press(`${mod}+h`);
  const dialog = page.getByRole("dialog", { name: /find/i });
  await dialog.getByLabel(/^Find/).fill("fox");
  await expect(dialog).toContainText("of 3");
  await dialog.getByLabel(/^Replace with|^Replace$/).first().fill("cat");
  await dialog.getByRole("button", { name: /Replace all/i }).click();
  await expect(page.locator(".ce-paragraph").first()).toHaveText("The cat and the cat");
  await expect(page.locator(".ce-paragraph").nth(1)).toHaveText("Another cat here");
  await expect(page.locator(".ce-paragraph b")).toHaveText("cat");
  await waitSaved(page);

  // One undo step reverts the whole replace-all.
  await page.locator(".ce-paragraph").first().click();
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator(".ce-paragraph").nth(1)).toHaveText("Another Fox here");
});

test("format painter copies character formatting", async ({ page, request }) => {
  const id = await createDocument(request, "Painter", [
    para("a", '<span style="font-size: 20pt; color: rgb(0, 0, 255);"><b>source</b></span> plain target'),
  ]);
  await openDocument(page, id);
  await selectText(page, "source");
  await page.getByRole("button", { name: /^Format painter/ }).click();
  await expect(page.getByRole("button", { name: /^Format painter/ })).toHaveAttribute("aria-pressed", "true");
  await selectText(page, "target");
  await page.mouse.move(10, 10);
  await page.locator(".ce-paragraph").dispatchEvent("mouseup");
  await settle(page, 200);
  expect(await styleOf(page, "target", "font-size")).toBe("20pt");
  expect(await styleOf(page, "target", "color")).toBe("rgb(0, 0, 255)");
  await expect(page.locator(".ce-paragraph b", { hasText: "target" })).toHaveCount(1);
  expect(await styleOf(page, "plain", "font-size")).toBe("");
});

test("keyboard shortcuts: align and heading", async ({ page, request }) => {
  const id = await createDocument(request, "Keys", [para("a", "Title text"), para("b", "Body")]);
  await openDocument(page, id);
  await caretToEnd(page, "Body");
  await page.keyboard.press(`${mod}+e`);
  await expect(page.locator(".ce-block", { hasText: "Body" }).locator(".tp-format")).toHaveCSS("text-align", "center");
  await caretToEnd(page, "Title text");
  await page.keyboard.press(`${mod}+Alt+Digit1`);
  await expect(page.locator('.ce-header[data-level="1"]')).toHaveText("Title text");
});

test("word count in the status bar", async ({ page, request }) => {
  const id = await createDocument(request, "Count", [para("a", "one two three"), para("b", "four five")]);
  await openDocument(page, id);
  await expect(page.locator(".tp-statusbar")).toContainText("5 words");
  await caretToEnd(page, "four five");
  await page.keyboard.type(" six");
  await expect(page.locator(".tp-statusbar")).toContainText("6 words");
});

test("modifying a named style restyles the document and persists", async ({ page, request }) => {
  const id = await createDocument(request, "Styles", [para("a", "Body text")]);
  await openDocument(page, id);
  await expect(page.locator(".ce-paragraph")).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "Modify styles…" }).click();
  const dialog = page.getByRole("dialog", { name: "Modify styles" });
  await dialog.getByLabel("Size (px)").fill("20");
  await dialog.getByRole("button", { name: "Save styles" }).click();
  await expect(page.locator(".ce-paragraph")).toHaveCSS("font-size", "20px");
  await reloadDocument(page);
  await expect(page.locator(".ce-paragraph")).toHaveCSS("font-size", "20px");
});

import { expect, test, type Page } from "@playwright/test";
import { createDocument, openDocument, reloadDocument, settle, waitSaved } from "./helpers";

// 1×1 PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;
const pngBuffer = () => Buffer.from(PNG_B64, "base64");

const para = (id: string, text: string) => ({ id, type: "paragraph", data: { text } });
const imageBlock = (id: string, data: Record<string, unknown> = {}) => ({
  id,
  type: "image",
  data: { file: { url: PNG }, dimensions: { width: "200px", height: "100px" }, ...data },
});

async function openSettings(page: Page, index = 0) {
  await page.locator(".tp-image").nth(index).click({ button: "right" });
  const panel = page.locator("[data-image-settings-panel]");
  await expect(panel).toBeVisible();
  return panel;
}

async function closeSettings(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-image-settings-panel]")).toHaveCount(0);
}

test("wrap setting drives the root class contract and persists", async ({ page, request }) => {
  const id = await createDocument(request, "Image wrap", [
    para("p1", "Before the picture."),
    imageBlock("img"),
    para("p2", "Text that should flow next to a floated picture. ".repeat(6)),
  ]);
  await openDocument(page, id);
  const root = page.locator(".tp-image").first();
  await expect(root).toHaveClass(/tp-image--top-bottom/);

  const panel = await openSettings(page);
  await panel.getByRole("button", { name: "Square", exact: true }).click();
  await expect(root).toHaveClass(/tp-image--float-left/);
  expect(await root.evaluate((el) => el.style.getPropertyValue("--tp-image-width"))).toBe("200px");
  await panel.locator('button[title="Align right"]').click();
  await expect(root).toHaveClass(/tp-image--float-right/);
  await expect(root).not.toHaveClass(/tp-image--float-left|tp-image--top-bottom|tp-image--inline/);
  await closeSettings(page);

  // The editor stylesheet floats the whole block (not the tool).
  const blockFloat = await page
    .locator(".ce-block", { has: page.locator(".tp-image--float-right") })
    .evaluate((el) => getComputedStyle(el).float);
  expect(blockFloat).toBe("right");

  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator(".tp-image").first()).toHaveClass(/tp-image--float-right/);
});

test("settings survive a reload", async ({ page, request }) => {
  const id = await createDocument(request, "Image settings", [imageBlock("img")]);
  await openDocument(page, id);
  const panel = await openSettings(page);

  await panel.getByRole("button", { name: "🔓" }).click();
  const width = panel.locator("span", { hasText: "Width (px)" }).locator("..").locator("input");
  await width.fill("300");
  await width.press("Tab");
  await panel.getByRole("button", { name: "Circle" }).click();
  await panel.getByRole("button", { name: "Soft", exact: true }).click();
  await panel.getByPlaceholder("Describe the image for screen readers").fill("Red dots");
  await panel.locator("summary", { hasText: "Transform" }).click();
  await panel.locator('button[title="Rotate left"]').click();
  await closeSettings(page);

  const img = page.locator(".tp-image img").first();
  await expect(img).toHaveAttribute("alt", "Red dots");
  await waitSaved(page);
  await reloadDocument(page);

  const reloaded = page.locator(".tp-image img").first();
  await expect(reloaded).toHaveAttribute("alt", "Red dots");
  expect(await reloaded.evaluate((el) => [el.style.width, el.style.height])).toEqual(["300px", "150px"]);
  expect(await reloaded.evaluate((el) => el.style.transform)).toContain("rotate(270deg)");
  expect(
    await page.locator(".tp-image .image-container").first().evaluate((el) => el.style.borderRadius),
  ).toBe("50%");
});

test("dropped files are uploaded, not embedded as base64", async ({ page, request }) => {
  let uploads = 0;
  await page.route("**/uploads", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    uploads += 1;
    await route.fulfill({
      json: { url: "/uploads/e2e-red.png", filename: "red.png", size: 70, mime: "image/png" },
    });
  });
  await page.route("**/uploads/e2e-red.png", (route) =>
    route.fulfill({ body: pngBuffer(), contentType: "image/png" }),
  );

  const id = await createDocument(request, "Image upload", [
    para("p1", "Intro"),
    { id: "img", type: "image", data: {} },
  ]);
  await openDocument(page, id);
  const zone = page.locator("[data-image-dropzone]").first();
  await expect(zone).toBeVisible();

  const dataTransfer = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "red.png", { type: "image/png" }));
    return dt;
  }, PNG_B64);
  await zone.dispatchEvent("drop", { dataTransfer });

  const img = page.locator(".tp-image img").first();
  await expect(img).toHaveAttribute("src", /\/uploads\/e2e-red\.png$/);
  expect(uploads).toBe(1);
  await expect(page.locator("[data-image-notice]")).toHaveCount(0);

  await waitSaved(page);
  await reloadDocument(page);
  await expect(page.locator(".tp-image img").first()).toHaveAttribute("src", /\/uploads\/e2e-red\.png$/);
});

test("a failed upload falls back to an embedded image and says so", async ({ page, request }) => {
  await page.route("**/uploads", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 500, json: { error: "boom" } }) : route.fallback(),
  );
  const id = await createDocument(request, "Image fallback", [{ id: "img", type: "image", data: {} }]);
  await openDocument(page, id);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file" }).click();
  await (await chooser).setFiles({ name: "red.png", mimeType: "image/png", buffer: pngBuffer() });

  await expect(page.locator(".tp-image img").first()).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator('[data-image-notice="warning"]')).toContainText("Upload failed");
});

test("only one settings panel exists and it closes cleanly", async ({ page, request }) => {
  const id = await createDocument(request, "Two images", [imageBlock("a"), imageBlock("b")]);
  await openDocument(page, id);
  await openSettings(page, 0);
  await page.keyboard.press("Escape");
  await openSettings(page, 1);
  await expect(page.locator("[data-image-settings-panel]")).toHaveCount(1);
  await closeSettings(page);
  await settle(page, 100);
  await expect(page.locator("body > input[type=file]")).toHaveCount(0);
});

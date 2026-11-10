import { expect, test } from "@playwright/test";
import { createDocument, openDocument, reloadDocument, waitSaved } from "./helpers";

test("edits made offline survive closing the tab and can be restored", async ({ context, page, request }) => {
  const id = await createDocument(request, "Offline", [
    { id: "a", type: "paragraph", data: { text: "Online text" } },
  ]);
  await openDocument(page, id);

  await context.setOffline(true);
  await page.locator(".ce-paragraph").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" plus offline edits");
  await expect(page.locator(".doc-save-status")).toHaveText(/Offline/, { timeout: 15_000 });
  await page.close(); // the tab is gone before the network came back

  await context.setOffline(false);
  const reopened = await context.newPage();
  await openDocument(reopened, id);
  await expect(reopened.locator(".ce-paragraph")).toHaveText("Online text");
  await expect(reopened.getByRole("button", { name: "Restore my changes" })).toBeVisible();

  await reopened.getByRole("button", { name: "Restore my changes" }).click();
  await expect(reopened.locator(".ce-paragraph")).toHaveText("Online text plus offline edits");
  await waitSaved(reopened);

  await reloadDocument(reopened);
  await expect(reopened.locator(".ce-paragraph")).toHaveText("Online text plus offline edits");
  await expect(reopened.getByRole("button", { name: "Restore my changes" })).toHaveCount(0);
});

test("discarding a draft keeps the server version", async ({ context, page, request }) => {
  const id = await createDocument(request, "Discard", [
    { id: "a", type: "paragraph", data: { text: "Keep me" } },
  ]);
  await openDocument(page, id);
  await context.setOffline(true);
  await page.locator(".ce-paragraph").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" throwaway");
  await expect(page.locator(".doc-save-status")).toHaveText(/Offline/, { timeout: 15_000 });
  await page.close();
  await context.setOffline(false);

  const reopened = await context.newPage();
  await openDocument(reopened, id);
  await reopened.getByRole("button", { name: "Discard" }).click();
  await expect(reopened.getByRole("button", { name: "Restore my changes" })).toHaveCount(0);
  await reloadDocument(reopened);
  await expect(reopened.locator(".ce-paragraph")).toHaveText("Keep me");
  await expect(reopened.getByRole("button", { name: "Restore my changes" })).toHaveCount(0);
});

import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createDocument, openDocument, reloadDocument, selectText, settle, waitSaved } from "./helpers";

/**
 * Comments, mentions and notifications (Phase 6).
 *
 * Integration assumptions (DocumentEditor wiring):
 *   - Ctrl/⌘+Alt+M starts a comment on the selection (`beginComment`);
 *   - a header button named "Comments" toggles the panel;
 *   - `NotificationsBell` sits in the document header;
 *   - `/documents/$id?thread=…` opens the panel on that thread.
 */

const COMMENT_KEY = "ControlOrMeta+Alt+m";

const panel = (page: Page) => page.getByRole("complementary", { name: "Comments" });
const thread = (page: Page, text: string) => panel(page).locator("article.tp-thread", { hasText: text });

async function addComment(page: Page, quote: string, body: string): Promise<void> {
  await selectText(page, quote);
  await page.keyboard.press(COMMENT_KEY);
  const box = panel(page).getByRole("combobox", { name: "New comment" });
  await expect(box).toBeFocused();
  await box.fill(body);
  await box.press("ControlOrMeta+Enter");
  await expect(thread(page, body)).toBeVisible();
  // Saved (temp ids are swapped for server ids).
  await expect(thread(page, body)).not.toHaveAttribute("data-thread-id", /^tmp-/);
}

/** Thread ids painted by the CSS highlight registry (tp-comment + active). */
async function highlightedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const name of ["tp-comment", "tp-comment-active"]) {
      const h = CSS.highlights.get(name) as unknown as Set<Range> | undefined;
      h?.forEach((r) => out.push(r.toString()));
    }
    return out.sort();
  });
}

/** Viewport box of the first occurrence of `text` in the document. */
async function textBox(page: Page, text: string): Promise<{ x: number; y: number; top: number }> {
  return page.evaluate((needle) => {
    const root = document.querySelector(".codex-editor__redactor")!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const at = n.data.indexOf(needle);
      if (at < 0) continue;
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + needle.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top };
    }
    throw new Error(`text not found: ${needle}`);
  }, text);
}

function users(): { primary: string; second: string } {
  return JSON.parse(fs.readFileSync("e2e/.auth/users.json", "utf8"));
}

test("comment on a selection, reply, resolve and reopen", async ({ page, request }) => {
  const id = await createDocument(request, "Comments basic", [
    { id: "p1", type: "paragraph", data: { text: "The quick brown fox jumps over the lazy dog." } },
    { id: "p2", type: "paragraph", data: { text: "A second paragraph with more words." } },
  ]);
  await openDocument(page, id);

  await addComment(page, "brown fox", "Is it really brown?");
  expect(await highlightedTexts(page)).toEqual(["brown fox"]);

  // Reply on the active thread.
  const t = thread(page, "Is it really brown?");
  const reply = t.getByRole("combobox", { name: "Reply" });
  await reply.click();
  await reply.fill("Yes, checked the photo.");
  await reply.press("ControlOrMeta+Enter");
  await expect(t).toContainText("Yes, checked the photo.");

  // Survives a reload.
  await reloadDocument(page);
  await page.getByRole("button", { name: "Comments" }).click();
  await expect(thread(page, "Is it really brown?")).toContainText("1 reply");

  // Clicking the highlighted text activates the thread.
  const box = await textBox(page, "brown fox");
  await page.mouse.click(box.x, box.y);
  await expect(thread(page, "Is it really brown?")).toHaveClass(/is-active/);

  // Resolve hides it (and its highlight); "Show resolved" brings it back.
  await thread(page, "Is it really brown?").getByRole("button", { name: "Resolve thread" }).click();
  await expect(thread(page, "Is it really brown?")).toHaveCount(0);
  expect(await highlightedTexts(page)).toEqual([]);
  await panel(page).getByLabel(/Show resolved/).check();
  await expect(thread(page, "Is it really brown?")).toContainText("Resolved");
  await thread(page, "Is it really brown?").click();
  await thread(page, "Is it really brown?").getByRole("button", { name: "Reopen thread" }).click();
  await panel(page).getByLabel(/Show resolved/).uncheck();
  await expect(thread(page, "Is it really brown?")).toBeVisible();
});

test("Escape cancels a new comment; empty selections do nothing", async ({ page, request }) => {
  const id = await createDocument(request, "Comments cancel", [
    { id: "p1", type: "paragraph", data: { text: "Nothing to see here." } },
  ]);
  await openDocument(page, id);
  await selectText(page, "Nothing");
  await page.keyboard.press(COMMENT_KEY);
  const box = panel(page).getByRole("combobox", { name: "New comment" });
  await box.fill("draft");
  await box.press("Escape");
  await expect(box).toHaveCount(0);

  await page.locator(".ce-paragraph").first().click();
  await page.keyboard.press(COMMENT_KEY);
  await expect(page.getByRole("combobox", { name: "New comment" })).toHaveCount(0);
});

test("anchors follow edits and orphan when the text is deleted", async ({ page, request }) => {
  const id = await createDocument(request, "Comments anchoring", [
    { id: "p1", type: "paragraph", data: { text: "Alpha beta gamma delta." } },
    { id: "p2", type: "paragraph", data: { text: "Remove me entirely please." } },
  ]);
  await openDocument(page, id);
  await addComment(page, "gamma", "Greek letter");
  await addComment(page, "entirely", "Doomed");

  // Type before the anchor: it still highlights "gamma".
  await page.locator(".ce-paragraph", { hasText: "Alpha" }).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("Intro: ");
  await settle(page, 800);
  expect(await highlightedTexts(page)).toContain("gamma");

  // Delete the second paragraph's text: its thread is orphaned.
  await page.locator(".ce-paragraph", { hasText: "Remove me" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Different words now.");
  await settle(page, 800);
  await expect(panel(page).locator(".tp-comments-orphans summary")).toHaveText("1 comment on deleted text");
  await waitSaved(page);
});

test("cards line up with their anchors on wide screens", async ({ page, request }) => {
  const id = await createDocument(
    request,
    "Comments layout",
    Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      type: "paragraph",
      data: { text: `Paragraph number ${i} with enough text to be a real line.` },
    })),
  );
  await openDocument(page, id);
  await addComment(page, "Paragraph number 1 ", "First note");
  await addComment(page, "Paragraph number 9 ", "Second note");
  const gap = async (quote: string, body: string) => {
    const anchorTop = (await textBox(page, quote)).top;
    const cardTop = (await thread(page, body).boundingBox())!.y;
    return Math.abs(cardTop - anchorTop);
  };
  expect(await gap("Paragraph number 1 ", "First note")).toBeLessThan(40);
  expect(await gap("Paragraph number 9 ", "Second note")).toBeLessThan(40);
  // Cards scroll with the document.
  await page.locator(".doc-scroll").evaluate((el) => (el.scrollTop += 150));
  await settle(page, 200);
  expect(await gap("Paragraph number 9 ", "Second note")).toBeLessThan(40);
});

test("narrow screens use an overlay drawer", async ({ page, request }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const id = await createDocument(request, "Comments narrow", [
    { id: "p1", type: "paragraph", data: { text: "Small screen comment target." } },
  ]);
  await openDocument(page, id);
  await addComment(page, "comment target", "Drawer note");
  await expect(panel(page)).toHaveClass(/is-drawer/);
  await expect(thread(page, "Drawer note").locator(".tp-thread-quote")).toHaveText("comment target");
  await panel(page).getByRole("button", { name: "Close comments" }).click();
  await expect(panel(page)).toHaveCount(0);
});

test("commenters @mention people; the bell notifies and opens the thread", async ({ page, request, browser }) => {
  const { primary, second } = users();
  const id = await createDocument(request, "Mentions doc", [
    { id: "p1", type: "paragraph", data: { text: "Budget numbers for next quarter." } },
  ]);
  const shared = await request.put(`/api/documents/${id}/shares`, { data: { email: second, role: "commenter" } });
  expect(shared.ok()).toBeTruthy();

  // Second user comments and mentions the owner.
  const ctx = await browser.newContext({ storageState: "e2e/.auth/user2.json" });
  const other = await ctx.newPage();
  await openDocument(other, id);
  await selectText(other, "Budget numbers");
  await other.keyboard.press(COMMENT_KEY);
  const box = panel(other).getByRole("combobox", { name: "New comment" });
  const ownerHandle = primary.split("@")[0]!;
  await box.pressSequentially(`Please check @${ownerHandle.slice(0, 8)}`);
  await expect(panel(other).getByRole("option").first()).toContainText(ownerHandle);
  await box.press("Enter");
  await box.pressSequentially("today");
  await box.press("ControlOrMeta+Enter");
  const posted = thread(other, "Please check");
  await expect(posted.locator(".tp-mention-chip")).toHaveText(`@${ownerHandle}`);
  await expect(posted).not.toHaveAttribute("data-thread-id", /^tmp-/);
  const threadId = await posted.getAttribute("data-thread-id");
  await ctx.close();

  // Owner gets a notification.
  await page.goto("/");
  const bell = page.getByRole("button", { name: /Notifications/ });
  await expect(bell).toHaveAccessibleName(/1 unread/, { timeout: 40_000 });
  await bell.click();
  const item = page.getByRole("dialog", { name: "Mentions" }).getByRole("link").first();
  await expect(item).toContainText("Mentions doc");
  await expect(item).toContainText("Please check");
  await item.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${id}\\?thread=${threadId}`));
  await expect(panel(page).locator(`[data-thread-id="${threadId}"]`)).toHaveClass(/is-active/);
  await expect(page.getByRole("button", { name: /Notifications/ })).toHaveAccessibleName("Notifications");
});

test("viewers can read comments but not write", async ({ page, request, browser }) => {
  const { second } = users();
  const id = await createDocument(request, "Viewer doc", [
    { id: "p1", type: "paragraph", data: { text: "Read only words here." } },
  ]);
  await openDocument(page, id);
  await addComment(page, "only words", "Owner note");
  await request.put(`/api/documents/${id}/shares`, { data: { email: second, role: "viewer" } });

  const ctx = await browser.newContext({ storageState: "e2e/.auth/user2.json" });
  const viewer = await ctx.newPage();
  await openDocument(viewer, id);
  await viewer.getByRole("button", { name: "Comments" }).click();
  await thread(viewer, "Owner note").click();
  await expect(thread(viewer, "Owner note").getByRole("button", { name: "Resolve thread" })).toHaveCount(0);
  await expect(panel(viewer).getByRole("combobox")).toHaveCount(0);
  await selectText(viewer, "Read only");
  await viewer.keyboard.press(COMMENT_KEY);
  await expect(viewer.getByRole("combobox", { name: "New comment" })).toHaveCount(0);
  await ctx.close();
});

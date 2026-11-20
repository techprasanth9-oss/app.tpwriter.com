import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import { caretToEnd, createDocument, openDocument, settle, waitSaved } from "./helpers";

const users = () => JSON.parse(fs.readFileSync("e2e/.auth/users.json", "utf8")) as { primary: string; second: string };

/** A page signed in as the second test user. */
async function secondUser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: "e2e/.auth/user2.json" });
  return context.newPage();
}

const blocks = [
  { id: "p1", type: "paragraph", data: { text: "First paragraph." } },
  { id: "p2", type: "paragraph", data: { text: "Second paragraph." } },
  { id: "p3", type: "paragraph", data: { text: "Third paragraph." } },
];

test("two editors in different paragraphs see each other's changes live", async ({ page, request, browser }) => {
  const id = await createDocument(request, "Co-editing", blocks);
  const share = await request.put(`/api/documents/${id}/shares`, { data: { email: users().second, role: "editor" } });
  expect(share.ok()).toBeTruthy();

  const other = await secondUser(browser);
  await openDocument(page, id);
  await openDocument(other, id);

  // Presence: each sees the other.
  await expect(page.getByTestId("presence-avatar")).toHaveCount(1, { timeout: 15_000 });
  await expect(other.getByTestId("presence-avatar")).toHaveCount(1, { timeout: 15_000 });

  await caretToEnd(page, "First paragraph.");
  await page.keyboard.type(" Edited by A.");
  await caretToEnd(other, "Third paragraph.");
  await other.keyboard.type(" Edited by B.");
  await waitSaved(page);
  await waitSaved(other);

  // Both edits arrive on both sides without a reload — and no conflict.
  for (const p of [page, other]) {
    await expect(p.locator(".tp-document")).toContainText("First paragraph. Edited by A.", { timeout: 15_000 });
    await expect(p.locator(".tp-document")).toContainText("Third paragraph. Edited by B.", { timeout: 15_000 });
    await expect(p.locator(".doc-conflict[role=alert]")).toHaveCount(0);
  }

  // And the server has both.
  await settle(page, 1500);
  const doc = (await (await request.get(`/api/documents/${id}`)).json()) as { blocks: { data: { text: string } }[] };
  expect(doc.blocks.map((b) => b.data.text)).toEqual([
    "First paragraph. Edited by A.",
    "Second paragraph.",
    "Third paragraph. Edited by B.",
  ]);

  // Undo on A only undoes A's own edit, not B's.
  await caretToEnd(page, "First paragraph.");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".tp-document")).toContainText("Third paragraph. Edited by B.");
  await expect(page.locator(".tp-document")).not.toContainText("Edited by A.");
  await other.context().close();
});

test("a viewer can read but not edit, and sees updates", async ({ page, request, browser }) => {
  const id = await createDocument(request, "Read only", blocks);
  await request.put(`/api/documents/${id}/shares`, { data: { email: users().second, role: "viewer" } });

  const viewer = await secondUser(browser);
  await openDocument(viewer, id);
  await expect(viewer.locator(".doc-access-badge")).toHaveText("View only");
  await expect(viewer.locator(".rb")).toHaveCount(0);
  await expect(viewer.locator(".ce-paragraph[contenteditable=true]")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Import DOCX" })).toHaveCount(0);

  // Owner edits; the viewer's page catches up.
  await openDocument(page, id);
  await caretToEnd(page, "Second paragraph.");
  await page.keyboard.type(" Updated.");
  await waitSaved(page);
  await expect(viewer.locator(".tp-document")).toContainText("Second paragraph. Updated.", { timeout: 15_000 });

  // The server refuses a viewer's write.
  const write = await viewer.request.put(`/api/documents/${id}/content`, {
    data: { baseRevision: 0, upserts: [], deletes: ["p1"], order: ["p2", "p3"] },
  });
  expect(write.status()).toBeGreaterThanOrEqual(400);
  await viewer.context().close();
});

test("sharing dialog: invite by email and share link", async ({ page, request, browser }) => {
  const id = await createDocument(request, "Shared via link", blocks);
  await openDocument(page, id);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /Share/ });

  // Someone without an account yet becomes a pending invite.
  await dialog.getByLabel("Email address").fill("not-signed-up-yet@example.com");
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog).toContainText("Invited — gets access on sign-up");

  // Link sharing: comment access.
  // Controlled by the server's answer, so click and wait rather than check().
  await dialog.getByLabel("Anyone signed in with the link").click();
  await expect(dialog.getByLabel("Anyone signed in with the link")).toBeChecked();
  await dialog.getByLabel("Role for people with the link").selectOption("commenter");
  const link = await dialog.getByLabel("Share link", { exact: true }).inputValue();
  expect(link).toContain(`/documents/${id}?share=`);

  // The second user isn't a member, but the link opens it, comment-only.
  const other = await secondUser(browser);
  await other.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(other.locator(".doc-access-badge")).toHaveText("Comment only");
  await expect(other.locator(".tp-document")).toContainText("Second paragraph.");

  // Turning the link off locks them out again.
  await dialog.getByLabel("Anyone signed in with the link").click();
  await expect(dialog.getByLabel("Anyone signed in with the link")).not.toBeChecked();
  await expect(dialog.getByLabel("Share link", { exact: true })).toHaveCount(0);
  const res = await other.request.get(`/api/documents/${id}`, {
    headers: { "x-share-token": new URL(link).searchParams.get("share")! },
  });
  expect(res.status()).toBe(404);

  // It shows up in the second user's list only while they have access.
  await other.goto("/");
  // (Other tests share documents with this user too — check this one.)
  await expect(other.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(other.getByText("Shared via link")).toHaveCount(0);
  await other.context().close();
});

test("documents shared with you are listed separately", async ({ request, browser }) => {
  const title = `Team plan ${Date.now()}`;
  const id = await createDocument(request, title, blocks);
  await request.put(`/api/documents/${id}/shares`, { data: { email: users().second, role: "commenter" } });
  const other = await secondUser(browser);
  await other.goto("/");
  const shared = other.locator(".docs-list", { has: other.getByRole("heading", { name: "Shared with you" }) });
  await expect(shared.getByText(title)).toBeVisible();
  await expect(shared.locator(".doc-card", { hasText: title })).toContainText("can comment");
  await expect(shared.getByRole("button", { name: `Delete ${title}` })).toHaveCount(0);
  await other.context().close();
});

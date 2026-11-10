import { expect, type APIRequestContext, type Page } from "@playwright/test";

export interface SeedBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  tunes?: Record<string, unknown>;
}

/** Create a document through the API (same session as the browser). */
export async function createDocument(
  request: APIRequestContext,
  title: string,
  blocks: SeedBlock[] = [],
): Promise<string> {
  const created = await request.post("/api/documents", { data: { title } });
  expect(created.ok()).toBeTruthy();
  const doc = (await created.json()) as { id: string; revision: number };
  if (blocks.length > 0) {
    const saved = await request.put(`/api/documents/${doc.id}/content`, {
      data: { baseRevision: doc.revision, upserts: blocks, deletes: [], order: blocks.map((b) => b.id) },
    });
    expect(saved.ok()).toBeTruthy();
  }
  return doc.id;
}

export async function openDocument(page: Page, id: string): Promise<void> {
  await page.goto(`/documents/${id}`);
  await editorReady(page);
}

export async function reloadDocument(page: Page): Promise<void> {
  await page.reload();
  await editorReady(page);
}

async function editorReady(page: Page): Promise<void> {
  // Dev StrictMode mounts the editor twice; wait for the discarded one to go.
  await expect(page.locator(".codex-editor")).toHaveCount(1);
  await page.locator(".ce-block").first().waitFor();
  await settle(page);
}

/** Let the paginator and EditorJS finish their async passes. */
export async function settle(page: Page, ms = 500): Promise<void> {
  await page.waitForTimeout(ms);
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator(".doc-save-status")).toHaveText(/Saved/, { timeout: 15_000 });
}

/** Type lines as separate paragraphs. EditorJS moves the caret to the new
 *  block asynchronously, so pause briefly after Enter like a person would. */
export async function typeLines(page: Page, lines: string[]): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i]!);
    if (i < lines.length - 1) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(40);
    }
  }
}

export const sentence = (i: number) =>
  `Sentence ${i} of a long paragraph that keeps going so it wraps over many lines.`;

/**
 * Every rendered line of text must sit inside some sheet's writable area
 * (between its top and bottom margins). Returns the offending lines.
 */
export async function textOutsidePages(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector(".tp-document")!;
    const flow = document.querySelector<HTMLElement>(".tp-flow")!;
    const origin = doc.getBoundingClientRect().top;
    const margin = parseFloat(flow.style.paddingTop); // symmetric default margins
    const sheets = [...document.querySelectorAll(".tp-sheet")].map((s) => {
      const r = s.getBoundingClientRect();
      return { top: r.top - origin + margin - 1, bottom: r.bottom - origin - margin + 1 };
    });
    const redactor = document.querySelector(".codex-editor__redactor")!;
    const walker = document.createTreeWalker(redactor, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const bad: Array<{ text: string; top: number; bottom: number }> = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      if ((n.parentElement as HTMLElement).closest(".tp-page-break")) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        const top = r.top - origin;
        const bottom = r.bottom - origin;
        if (!sheets.some((s) => top >= s.top && bottom <= s.bottom)) {
          bad.push({ text: n.textContent.slice(0, 30), top: Math.round(top), bottom: Math.round(bottom) });
        }
      }
    }
    return { sheets: sheets.length, bad: bad.slice(0, 5), badCount: bad.length };
  });
}

/** Put the caret at the very end of a block's editable text. ("End" only
 *  goes to the end of the visual line.) */
export async function caretToEnd(page: Page, text: string): Promise<void> {
  const editable = page.locator("[contenteditable=true]", { hasText: text }).last();
  await editable.click();
  await editable.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

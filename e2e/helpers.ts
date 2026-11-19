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
  // (Column blocks contain nested editors; count only top-level ones.)
  await expect(page.locator(".codex-editor:not(.custom-columns-tool .codex-editor)")).toHaveCount(1);
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

/** Type lines as separate paragraphs. EditorJS creates the new block and
 *  moves the caret asynchronously; wait for the block (and caret) before
 *  typing on, as a person naturally would. */
export async function typeLines(page: Page, lines: string[]): Promise<void> {
  for (let i = 0; i < lines.length; i++) {
    await page.keyboard.type(lines[i]!);
    if (i < lines.length - 1) {
      // Playwright types with 0ms gaps; EditorJS can drop an Enter that
      // lands in the same instant as the last keystroke. People don't type
      // that fast, so leave a human-sized gap.
      await page.waitForTimeout(30);
      const before = await page.locator(".ce-block").count();
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        (n) => {
          if (document.querySelectorAll(".ce-block").length <= n) return false;
          // Focus has moved into the new, empty paragraph.
          const active = document.activeElement as HTMLElement | null;
          return !!active?.isContentEditable && !active.textContent;
        },
        before,
        { timeout: 5_000 },
      );
      // EditorJS finishes placing the caret just after focus moves; nobody
      // starts the next line within a few ms of pressing Enter.
      await page.waitForTimeout(60);
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
      // Raised / lowered glyphs (footnote numbers, x²) legitimately poke a
      // pixel or two past their line box.
      if ((n.parentElement as HTMLElement).closest("sup, sub")) continue;
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

/** Select the first occurrence of `text` in the document (like a drag).
 *  The text may span formatting (`<b>bold</b> and`), not editables. */
export async function selectText(page: Page, text: string): Promise<void> {
  const ok = await page.evaluate((needle) => {
    const editables = document.querySelectorAll<HTMLElement>('.codex-editor__redactor [contenteditable="true"]');
    for (const editable of Array.from(editables)) {
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      const full = nodes.map((n) => n.data).join("");
      const at = full.indexOf(needle);
      if (at < 0) continue;
      const locate = (pos: number, end: boolean): [Text, number] => {
        let acc = 0;
        for (const n of nodes) {
          if (pos < acc + n.length || (end && pos === acc + n.length)) return [n, pos - acc];
          acc += n.length;
        }
        const last = nodes[nodes.length - 1]!;
        return [last, last.length];
      };
      editable.focus();
      const r = document.createRange();
      r.setStart(...locate(at, false));
      r.setEnd(...locate(at + needle.length, true));
      const sel = document.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }
    return false;
  }, text);
  if (!ok) throw new Error(`text not found: ${text}`);
  await page.waitForTimeout(50); // let selectionchange listeners run
}

/** Inline style of the element wrapping `text` (nearest ancestor with one). */
export async function styleOf(page: Page, text: string, prop: string): Promise<string> {
  return page.evaluate(
    ([needle, p]) => {
      const root = document.querySelector(".codex-editor__redactor")!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent!.includes(needle)) continue;
        for (let el = n.parentElement; el && !el.isContentEditable === false; el = el.parentElement) {
          const v = el.style.getPropertyValue(p);
          if (v) return v;
          if (el.getAttribute("contenteditable") === "true") break;
        }
        return "";
      }
      return "missing";
    },
    [text, prop] as const,
  );
}

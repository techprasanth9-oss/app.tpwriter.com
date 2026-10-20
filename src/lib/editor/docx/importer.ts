/**
 * DOCX → EditorJS blocks via mammoth. Mammoth converts to clean HTML
 * (handling numbering / nested lists / embedded images / tables / runs); a
 * small DOM walker maps the HTML to the EditorJS block types we support.
 */

import mammoth from "mammoth";

export interface EditorBlock {
  type: string;
  data: Record<string, unknown>;
}

export interface EditorOutput {
  time?: number;
  blocks: EditorBlock[];
  version?: string;
}

export async function importDocx(input: File | ArrayBuffer): Promise<EditorOutput> {
  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  const { value: html } = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const data = await image.read("base64");
        return { src: `data:${image.contentType};base64,${data}` };
      }),
    },
  );

  const blocks = htmlToBlocks(html);
  return { time: Date.now(), blocks, version: "2.30.7" };
}

function htmlToBlocks(html: string): EditorBlock[] {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    "text/html",
  );
  const blocks: EditorBlock[] = [];
  for (const node of Array.from(doc.body.children)) {
    convertNode(node as HTMLElement, blocks);
  }
  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", data: { text: "" } });
  }
  return blocks;
}

function convertNode(el: HTMLElement, out: EditorBlock[]): void {
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      out.push({
        type: "header",
        data: { text: cleanInline(el), level: Number(tag.slice(1)) },
      });
      return;
    }
    case "p": {
      const img = el.querySelector("img");
      if (img && el.children.length === 1 && !el.textContent?.trim()) {
        pushImage(img, out);
        return;
      }
      const text = cleanInline(el);
      if (text) out.push({ type: "paragraph", data: { text } });
      return;
    }
    case "ul":
    case "ol": {
      out.push({
        type: "list",
        data: {
          style: tag === "ol" ? "ordered" : "unordered",
          items: buildListItems(el),
        },
      });
      return;
    }
    case "table": {
      out.push({
        type: "table",
        data: {
          withHeadings: !!el.querySelector("thead"),
          content: buildTableRows(el),
        },
      });
      return;
    }
    case "hr": {
      out.push({ type: "delimiter", data: {} });
      return;
    }
    case "img": {
      pushImage(el as HTMLImageElement, out);
      return;
    }
    case "blockquote": {
      const text = cleanInline(el);
      if (text) out.push({ type: "paragraph", data: { text } });
      return;
    }
    default: {
      for (const child of Array.from(el.children)) {
        convertNode(child as HTMLElement, out);
      }
      if (el.children.length === 0) {
        const text = cleanInline(el);
        if (text) out.push({ type: "paragraph", data: { text } });
      }
    }
  }
}

function pushImage(img: HTMLImageElement, out: EditorBlock[]): void {
  const url = img.getAttribute("src") || "";
  if (!url) return;
  out.push({
    type: "image",
    data: {
      file: { url },
      caption: img.getAttribute("alt") || "",
      withBorder: false,
      withBackground: false,
      stretched: false,
    },
  });
}

function buildListItems(
  listEl: HTMLElement,
): Array<{ content: string; items: unknown[] }> {
  const items: Array<{ content: string; items: unknown[] }> = [];
  for (const li of Array.from(listEl.children)) {
    if (li.tagName.toLowerCase() !== "li") continue;
    const nested = li.querySelector(":scope > ul, :scope > ol");
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(":scope > ul, :scope > ol").forEach((n) => n.remove());
    items.push({
      content: cleanInline(clone),
      items: nested ? buildListItems(nested as HTMLElement) : [],
    });
  }
  return items;
}

function buildTableRows(tableEl: HTMLElement): string[][] {
  const rows: string[][] = [];
  for (const tr of Array.from(tableEl.querySelectorAll("tr"))) {
    const cells: string[] = [];
    for (const cell of Array.from(tr.children)) {
      const t = cell.tagName.toLowerCase();
      if (t !== "td" && t !== "th") continue;
      cells.push(cleanInline(cell as HTMLElement));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function cleanInline(el: HTMLElement): string {
  const tmp = el.cloneNode(true) as HTMLElement;
  // Unwrap block-level descendants to inline text.
  tmp.querySelectorAll("p, div, section, article").forEach((block) => {
    const parent = block.parentNode;
    if (!parent) return;
    while (block.firstChild) parent.insertBefore(block.firstChild, block);
    parent.removeChild(block);
  });
  // Strip style/class from everything except links.
  tmp.querySelectorAll("*").forEach((node) => {
    const e = node as HTMLElement;
    const tag = e.tagName.toLowerCase();
    for (const attr of Array.from(e.attributes)) {
      if (tag === "a" && (attr.name === "href" || attr.name === "target")) continue;
      if (attr.name === "class" || attr.name === "style") e.removeAttribute(attr.name);
    }
  });
  return tmp.innerHTML.trim();
}

/**
 * Character formatting on DOM ranges inside contenteditable blocks: font
 * family / size, text and highlight colour, clear formatting, change case.
 *
 * `document.execCommand` can't do these well (`fontSize` emits
 * `<font size="1-7">`, `fontName` emits `<font face>`), so this works on
 * the range directly:
 *   1. `isolate` splits text nodes and inline ancestors at the range edges
 *      so the selection becomes whole children of the editable;
 *   2. those children are wrapped in / restyled as `<span style>`;
 *   3. `tidy` unwraps empty spans and merges identical neighbours, so
 *      repeated formatting doesn't pile up nested spans.
 *
 * Atoms (`contenteditable="false"`, e.g. variable chips) are never split.
 */

export type StyleProp = "font-family" | "font-size" | "color" | "background-color";

/** Inline CSS properties a `<span style>` may keep (paste, load, export). */
export const ALLOWED_INLINE_STYLES = new Set([
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "color",
  "background-color",
  "text-decoration",
  "text-decoration-line",
  "vertical-align",
  "letter-spacing",
]);

const SAFE_VALUE = /^[#\w\s"',.%()+-]{1,200}$/;

/**
 * Keep only allow-listed properties with plain values — drops Word's
 * `mso-*` noise, positioning, `url()`, `expression()` and anything else.
 */
export function filterInlineStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!ALLOWED_INLINE_STYLES.has(prop) || !value || !SAFE_VALUE.test(value)) continue;
    if (/url\(|expression\(|javascript:/i.test(value)) continue;
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

// ── Fonts & sizes offered in the UI ──────────────────────────────────────

export interface FontOption {
  label: string;
  /** CSS font-family stack written into the document. */
  css: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "Inter", css: "Inter, sans-serif" },
  { label: "Arial", css: "Arial, Helvetica, sans-serif" },
  { label: "Calibri", css: "Calibri, Carlito, sans-serif" },
  { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { label: "Georgia", css: "Georgia, serif" },
  { label: "Lora", css: "Lora, Georgia, serif" },
  { label: "Times New Roman", css: '"Times New Roman", Times, serif' },
  { label: "Garamond", css: "Garamond, serif" },
  { label: "Courier New", css: '"Courier New", Courier, monospace' },
];

/** Point sizes, as in Word. 12pt = 16px. */
export const FONT_SIZES_PT = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/** Next size up/down the list from a current size in pt. */
export function stepFontSize(currentPt: number, direction: 1 | -1): number {
  if (direction > 0) return FONT_SIZES_PT.find((s) => s > currentPt + 0.01) ?? FONT_SIZES_PT[FONT_SIZES_PT.length - 1]!;
  return [...FONT_SIZES_PT].reverse().find((s) => s < currentPt - 0.01) ?? FONT_SIZES_PT[0]!;
}

/** Match a computed font-family to one of FONT_OPTIONS by its first family. */
export function fontLabelFor(computedFamily: string): string | null {
  const first = computedFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "").toLowerCase();
  return FONT_OPTIONS.find((f) => f.label.toLowerCase() === first)?.label ?? null;
}

// ── Range plumbing ───────────────────────────────────────────────────────

const isText = (n: Node): n is Text => n.nodeType === Node.TEXT_NODE;
const isElement = (n: Node): n is HTMLElement => n.nodeType === Node.ELEMENT_NODE;
const indexOf = (n: Node) => Array.prototype.indexOf.call(n.parentNode!.childNodes, n) as number;

export function isAtom(node: Node): boolean {
  return isElement(node) && node.getAttribute("contenteditable") === "false";
}

/** The contenteditable element that owns `node`. */
export function editableRoot(node: Node | null): HTMLElement | null {
  const el = node && (isElement(node) ? node : node.parentElement);
  return el?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
}

function atomAncestor(node: Node, root: Node): HTMLElement | null {
  for (let n: Node | null = node; n && n !== root; n = n.parentNode) {
    if (isAtom(n)) return n as HTMLElement;
  }
  return null;
}

/**
 * Split text and ancestors at (container, offset) up to `root`; returns the
 * child of `root` that starts at the boundary (null = at the end).
 */
function splitTo(root: Node, container: Node, offset: number): Node | null {
  let node: Node = container;
  let off = offset;
  if (isText(node)) {
    if (off <= 0) {
      off = indexOf(node);
    } else if (off >= node.length) {
      off = indexOf(node) + 1;
    } else {
      const tail = node.splitText(off);
      off = indexOf(tail);
    }
    node = node.parentNode!;
  }
  while (node !== root) {
    const parent = node.parentNode!;
    if (off <= 0) {
      off = indexOf(node);
    } else if (off >= node.childNodes.length) {
      off = indexOf(node) + 1;
    } else {
      const clone = node.cloneNode(false);
      while (node.childNodes.length > off) clone.appendChild(node.childNodes[off]!);
      parent.insertBefore(clone, node.nextSibling);
      off = indexOf(node) + 1;
    }
    node = parent;
  }
  return root.childNodes[off] ?? null;
}

/**
 * Make the range cover whole children of `root`; returns those children
 * and leaves `range` spanning exactly them.
 */
export function isolate(root: HTMLElement, range: Range): Node[] {
  // Never split an atom — widen the range to include it.
  const startAtom = atomAncestor(range.startContainer, root);
  if (startAtom) range.setStartBefore(startAtom);
  const endAtom = atomAncestor(range.endContainer, root);
  if (endAtom) range.setEndAfter(endAtom);

  // End first: splitting there never moves the start position.
  const after = splitTo(root, range.endContainer, range.endOffset);
  const first = splitTo(root, range.startContainer, range.startOffset);
  const nodes: Node[] = [];
  for (let n = first; n && n !== after; n = n.nextSibling) nodes.push(n);
  if (nodes.length > 0) {
    range.setStartBefore(nodes[0]!);
    range.setEndAfter(nodes[nodes.length - 1]!);
  }
  return nodes;
}

/** Ranges to format for the current selection: one per editable it touches.
 *  EditorJS's block selection (whole blocks highlighted) formats those
 *  blocks entirely. */
export function selectionRanges(container: HTMLElement): Range[] {
  const blockSelected = Array.from(container.querySelectorAll<HTMLElement>(".ce-block--selected"));
  if (blockSelected.length > 0) {
    return blockSelected.flatMap((block) =>
      Array.from(block.querySelectorAll<HTMLElement>('[contenteditable="true"]')).map((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r;
      }),
    );
  }
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return [];
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return [];

  const startRoot = editableRoot(range.startContainer);
  if (startRoot && startRoot === editableRoot(range.endContainer)) return [range.cloneRange()];

  // Spans several editables: clip the range to each one it intersects.
  return Array.from(container.querySelectorAll<HTMLElement>('[contenteditable="true"]'))
    .filter((el) => range.intersectsNode(el) && !el.parentElement?.closest('[contenteditable="true"]'))
    .map((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      if (el.contains(range.startContainer)) r.setStart(range.startContainer, range.startOffset);
      if (el.contains(range.endContainer)) r.setEnd(range.endContainer, range.endOffset);
      return r;
    });
}

/** Expand a collapsed range to the word around it (Word applies character
 *  formatting to the whole word when the caret is inside one). */
export function expandToWord(range: Range): boolean {
  const node = range.startContainer;
  if (!isText(node)) return false;
  const text = node.data;
  const word = /[\p{L}\p{N}_'’-]/u;
  let start = range.startOffset;
  let end = range.startOffset;
  while (start > 0 && word.test(text[start - 1]!)) start--;
  while (end < text.length && word.test(text[end]!)) end++;
  // Only when the caret is strictly inside the word.
  if (start === end || start === range.startOffset || end === range.startOffset) return false;
  range.setStart(node, start);
  range.setEnd(node, end);
  return true;
}

// ── Operations ───────────────────────────────────────────────────────────

const FORMATTING_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "SUP", "SUB", "FONT", "SPAN", "MARK", "CODE"]);

/** A plain styling span (not a chip / placeholder / other tool markup). */
function isStyleSpan(el: Element): boolean {
  return el.tagName === "SPAN" && !el.hasAttribute("class") && !isAtom(el) &&
    Array.from(el.attributes).every((a) => a.name === "style");
}

function unwrap(el: Element): void {
  const parent = el.parentNode!;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function removeProp(el: HTMLElement, prop: StyleProp): void {
  el.style.removeProperty(prop);
  if (el.getAttribute("style") === "") el.removeAttribute("style");
}

/**
 * Set (or with `value === null`, remove) one inline style on the range.
 * Returns the range of the formatted content (to restore the selection).
 */
export function applyInlineStyle(range: Range, prop: StyleProp, value: string | null): Range | null {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root || range.collapsed) return null;
  const nodes = isolate(root, range);
  if (nodes.length === 0) return null;

  const touched: Node[] = [];
  for (const node of nodes) {
    if (isText(node)) {
      if (!node.data) continue;
      if (value === null) {
        touched.push(node);
        continue;
      }
      const span = document.createElement("span");
      span.style.setProperty(prop, value);
      node.replaceWith(span);
      span.appendChild(node);
      touched.push(span);
      continue;
    }
    if (!isElement(node)) continue;
    // Inner overrides would win over the new value — drop them.
    node.querySelectorAll<HTMLElement>("[style]").forEach((d) => removeProp(d, prop));
    if (isStyleSpan(node) || (isAtom(node) && node.tagName === "SPAN")) {
      if (value === null) removeProp(node, prop);
      else node.style.setProperty(prop, value);
      touched.push(node);
    } else if (value === null) {
      if (node.style) removeProp(node, prop);
      touched.push(node);
    } else {
      const span = document.createElement("span");
      span.style.setProperty(prop, value);
      node.replaceWith(span);
      span.appendChild(node);
      touched.push(span);
    }
  }
  return tidyAndSelect(root, touched);
}

/** Strip character formatting from the range (links and atoms survive). */
export function clearFormatting(range: Range): Range | null {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root || range.collapsed) return null;
  const nodes = isolate(root, range);
  const touched: Node[] = [];
  for (const node of nodes) {
    if (!isElement(node)) {
      touched.push(node);
      continue;
    }
    if (isAtom(node)) {
      touched.push(node);
      continue;
    }
    // Deepest first so unwrapping never detaches a node we still visit.
    const inner = Array.from(node.querySelectorAll<HTMLElement>("*")).reverse();
    for (const el of inner) {
      if (el.closest('[contenteditable="false"]')) continue;
      if (FORMATTING_TAGS.has(el.tagName) && (el.tagName !== "SPAN" || isStyleSpan(el))) unwrap(el);
      else el.removeAttribute("style");
    }
    if (FORMATTING_TAGS.has(node.tagName) && (node.tagName !== "SPAN" || isStyleSpan(node))) {
      const children = Array.from(node.childNodes);
      unwrap(node);
      touched.push(...children);
    } else {
      node.removeAttribute("style");
      touched.push(node);
    }
  }
  return tidyAndSelect(root, touched);
}

export type CaseMode = "upper" | "lower" | "title" | "sentence" | "toggle";

/** Change letter case of the text in the range, keeping all markup. */
export function changeCase(range: Range, mode: CaseMode): Range | null {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root || range.collapsed) return null;
  const nodes = isolate(root, range);
  const texts: Text[] = [];
  for (const node of nodes) {
    if (isText(node)) texts.push(node);
    else if (isElement(node) && !isAtom(node)) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!atomAncestor(t, node)) texts.push(t as Text);
      }
    }
  }
  let atSentenceStart = true;
  let atWordStart = true;
  for (const t of texts) {
    let out = "";
    for (const ch of t.data) {
      const letter = /\p{L}/u.test(ch);
      let next = ch;
      if (mode === "upper") next = ch.toUpperCase();
      else if (mode === "lower") next = ch.toLowerCase();
      else if (mode === "toggle") next = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
      else if (mode === "title") next = letter && atWordStart ? ch.toUpperCase() : ch.toLowerCase();
      else if (mode === "sentence") next = letter && atSentenceStart ? ch.toUpperCase() : ch.toLowerCase();
      if (letter) {
        atWordStart = false;
        atSentenceStart = false;
      } else {
        if (/\s/.test(ch)) atWordStart = true;
        if (/[.!?]/.test(ch)) atSentenceStart = true;
      }
      out += next;
    }
    if (out !== t.data) t.data = out;
  }
  return tidyAndSelect(root, nodes);
}

function edgeText(node: Node, last: boolean): Node {
  if (isText(node) || isAtom(node)) return node;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let found: Node | null = null;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    found = t;
    if (!last) break;
  }
  return found ?? node;
}

/** Unwrap empty style spans and merge identical neighbouring spans, then
 *  return a range over the formatted content. Anchored on text nodes,
 *  which tidying moves but never removes. */
function tidyAndSelect(root: HTMLElement, touched: Node[]): Range | null {
  const live = touched.filter((n) => root.contains(n));
  if (live.length === 0) {
    tidy(root);
    return null;
  }
  const start = edgeText(live[0]!, false);
  const end = edgeText(live[live.length - 1]!, true);
  tidy(root);
  const range = document.createRange();
  if (isText(start)) range.setStart(start, 0);
  else range.setStartBefore(start);
  if (isText(end)) range.setEnd(end, end.length);
  else range.setEndAfter(end);
  return range;
}

export function tidy(root: HTMLElement): void {
  root.querySelectorAll("span").forEach((span) => {
    if (isStyleSpan(span) && !span.getAttribute("style")) unwrap(span);
  });
  const mergeIn = (parent: Node) => {
    let child = parent.firstChild;
    while (child) {
      const next = child.nextSibling;
      if (
        next &&
        isElement(child) &&
        isElement(next) &&
        isStyleSpan(child) &&
        isStyleSpan(next) &&
        child.getAttribute("style") === next.getAttribute("style")
      ) {
        while (next.firstChild) child.appendChild(next.firstChild);
        next.remove();
        continue; // re-check child against its new next sibling
      }
      if (isElement(child) && !isAtom(child)) mergeIn(child);
      child = next;
    }
  };
  mergeIn(root);
  // No normalize(): merging adjacent text nodes would detach the nodes the
  // returned range is anchored on, and split text nodes are harmless.
}

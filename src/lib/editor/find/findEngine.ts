/**
 * Find & Replace engine for the single Editor.js document.
 *
 * Framework-free: works on the live DOM. Text is searched per editable
 * element (`[contenteditable]` that isn't "false"); a match may span several
 * text nodes inside one editable (e.g. `he<b>llo</b>`) but never crosses an
 * editable boundary, a `contenteditable="false"` atom (chips, page breaks,
 * checkboxes) or a `<br>`.
 */

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

/** Inserted into the flattened text where a match must not cross. */
const BARRIER = "\n";
/** Word characters for whole-word matching: Unicode letters, marks, digits, `_`. */
const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}_]";

interface Segment {
  node: Text;
  start: number;
  end: number;
}

function editableState(el: Element): "true" | "false" | null {
  const v = el.getAttribute("contenteditable");
  if (v === null) return null;
  return v.toLowerCase() === "false" ? "false" : "true";
}

/** Nearest element with a contenteditable attribute, starting at `node`. */
function nearestEditableHost(node: Node | null): Element | null {
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node?.parentElement ?? null);
  while (el) {
    if (el.hasAttribute("contenteditable")) return el;
    el = el.parentElement;
  }
  return null;
}

/** The editable element that owns `node` (null when inside an atom or outside editables). */
export function owningEditable(node: Node | null): HTMLElement | null {
  const host = nearestEditableHost(node);
  return host && editableState(host) === "true" ? (host as HTMLElement) : null;
}

function editablesIn(root: HTMLElement): HTMLElement[] {
  const list: HTMLElement[] = [];
  if (editableState(root) === "true") list.push(root);
  root
    .querySelectorAll<HTMLElement>('[contenteditable]:not([contenteditable="false"])')
    .forEach((el) => list.push(el));
  return list;
}

/** Flatten an editable's own text (excluding atoms and nested editables). */
function flatten(editable: HTMLElement): { text: string; segments: Segment[] } {
  let text = "";
  const segments: Segment[] = [];
  const walk = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        if (data.length) {
          segments.push({ node: child as Text, start: text.length, end: text.length + data.length });
          text += data;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        const tag = el.tagName;
        if (tag === "BR" || tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") {
          text += BARRIER;
        } else if (editableState(el) !== null) {
          // Atom (contenteditable=false) or a nested editable searched on its own.
          text += BARRIER;
        } else {
          walk(el);
        }
      }
    }
  };
  walk(editable);
  return { text, segments };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function buildPattern(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null;
  let src = escapeRegExp(query);
  if (opts.wholeWord) src = `(?<!${WORD_CHAR})${src}(?!${WORD_CHAR})`;
  return new RegExp(src, opts.matchCase ? "gu" : "giu");
}

function locate(segments: Segment[], offset: number, isEnd: boolean): { node: Text; offset: number } | null {
  for (const s of segments) {
    if (isEnd ? offset > s.start && offset <= s.end : offset >= s.start && offset < s.end) {
      return { node: s.node, offset: offset - s.start };
    }
  }
  return null;
}

/** All matches of `query` in the editable text under `root`, in document order. */
export function findMatches(root: HTMLElement, query: string, opts: FindOptions): Range[] {
  const re = buildPattern(query, opts);
  if (!re) return [];
  const doc = root.ownerDocument;
  const ranges: Range[] = [];
  for (const editable of editablesIn(root)) {
    const { text, segments } = flatten(editable);
    if (!segments.length) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (!m[0].length) continue;
      const from = locate(segments, m.index!, false);
      const to = locate(segments, m.index! + m[0].length, true);
      if (!from || !to) continue;
      const r = doc.createRange();
      r.setStart(from.node, from.offset);
      r.setEnd(to.node, to.offset);
      ranges.push(r);
    }
  }
  return ranges;
}

/** Whether `text` (a range's current contents) still equals the query under `opts`. */
export function matchesQuery(text: string, query: string, opts: FindOptions): boolean {
  if (!query) return false;
  return opts.matchCase ? text === query : text.toLowerCase() === query.toLowerCase();
}

function dispatchInput(target: HTMLElement | null) {
  if (!target) return;
  const view = target.ownerDocument.defaultView;
  const Ctor = view && typeof view.InputEvent === "function" ? view.InputEvent : null;
  const ev = Ctor
    ? new Ctor("input", { bubbles: true, inputType: "insertReplacementText" })
    : new Event("input", { bubbles: true });
  target.dispatchEvent(ev);
}

/** Remove now-empty inline wrappers between `node` and `stop` (exclusive). */
function pruneEmpty(node: Node | null, stop: Node | null) {
  let cur = node;
  while (cur && cur !== stop && cur.parentNode) {
    const parent: Node = cur.parentNode;
    const empty =
      cur.nodeType === Node.TEXT_NODE
        ? (cur as Text).data.length === 0
        : cur.nodeType === Node.ELEMENT_NODE && !cur.hasChildNodes();
    if (!empty) break;
    parent.removeChild(cur);
    cur = parent;
  }
}

function replaceRange(range: Range, replacement: string): Range {
  const doc = range.startContainer.ownerDocument ?? document;
  let startNode: Text;
  let startOffset: number;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    startNode = range.startContainer as Text;
    startOffset = range.startOffset;
  } else {
    // Defensive: element-anchored range — put a fresh text node at the start.
    startNode = doc.createTextNode("");
    range.insertNode(startNode);
    range.setStartAfter(startNode);
    startOffset = 0;
  }
  const endNode = range.endContainer;
  const endOffset = range.endOffset;
  const common = range.commonAncestorContainer;

  if (endNode === startNode) {
    startNode.replaceData(startOffset, endOffset - startOffset, replacement);
  } else {
    // Insert into the start node (keeps its formatting), then delete the rest.
    startNode.insertData(startOffset, replacement);
    const tail = doc.createRange();
    tail.setStart(startNode, startOffset + replacement.length);
    tail.setEnd(endNode, endOffset);
    tail.deleteContents();
    // deleteContents leaves partially-selected wrappers (e.g. an empty <b>).
    if (endNode !== common) pruneEmpty(endNode, common);
  }

  const out = doc.createRange();
  out.setStart(startNode, startOffset);
  out.setEnd(startNode, startOffset + replacement.length);
  return out;
}

/**
 * Replace the text of `range` with `replacement`, keeping the formatting where
 * the match starts. Returns a range around the inserted text and fires a
 * bubbling `input` event on the owning editable.
 */
export function replaceMatch(range: Range, replacement: string): Range {
  const editable = owningEditable(range.startContainer);
  const out = replaceRange(range, replacement);
  dispatchInput(editable);
  return out;
}

/** Replace every match under `root`; returns the number of replacements. */
export function replaceAll(root: HTMLElement, query: string, replacement: string, opts: FindOptions): number {
  const matches = findMatches(root, query, opts);
  const touched = new Set<HTMLElement>();
  for (let i = matches.length - 1; i >= 0; i--) {
    const editable = owningEditable(matches[i].startContainer);
    replaceRange(matches[i], replacement);
    if (editable) touched.add(editable);
  }
  touched.forEach(dispatchInput);
  return matches.length;
}

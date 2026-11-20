/**
 * Plain-text model of one Editor.js block for comment anchoring.
 *
 * A block's text is the concatenation of its text hosts (paragraph body,
 * list items, table cells, captions…) in document order, separated by
 * `HOST_BREAK`. Atoms inside a host (`contenteditable="false"`: fields,
 * footnote refs) count as one `ATOM` character so their (per-page) text
 * never becomes part of a quote. Paginator output (`data-mutation-free`,
 * `.tp-split`, `.tp-table-ghost`) and nested blocks are skipped.
 *
 * Text hosts are the `contenteditable="true"` elements; when a block has
 * none (EditorJS `readOnly` renders hosts as `contenteditable="false"`) its
 * outermost `contenteditable` elements are used instead, so anchors resolve
 * the same way for viewers.
 */

export const HOST_BREAK = "\n";
export const ATOM = "￼";

export interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export interface BlockText {
  block: HTMLElement;
  id: string;
  text: string;
  segments: TextSegment[];
}

const BLOCK_SELECTOR = ".ce-block[data-id]";

function isLayoutOnly(el: Element): boolean {
  return (
    el.hasAttribute("data-mutation-free") ||
    el.classList.contains("tp-split") ||
    el.classList.contains("tp-table-ghost")
  );
}

function ceState(el: Element): "true" | "false" | null {
  const v = el.getAttribute("contenteditable");
  if (v === null) return null;
  return v.toLowerCase() === "false" ? "false" : "true";
}

function isNestedBlock(el: Element, block: Element): boolean {
  return el !== block && el.matches(BLOCK_SELECTOR);
}

/** Whether the block has any real editable host (edit mode). */
function hasEditableHost(block: HTMLElement): boolean {
  const all = block.querySelectorAll('[contenteditable]:not([contenteditable="false"])');
  for (const el of Array.from(all)) {
    if (!layoutAncestor(el, block) && closestBlock(el) === block) return true;
  }
  return false;
}

function layoutAncestor(node: Node, stop: Element): boolean {
  for (let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement; el && el !== stop; el = el.parentElement) {
    if (isLayoutOnly(el)) return true;
  }
  return false;
}

/** The innermost block element containing `node`. */
export function closestBlock(node: Node | null): HTMLElement | null {
  const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
  return (el?.closest(BLOCK_SELECTOR) as HTMLElement | null) ?? null;
}

/** All blocks under `root` (including nested ones), in document order. */
export function allBlocks(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
}

export function findBlock(root: ParentNode, id: string): HTMLElement | null {
  for (const b of allBlocks(root)) if (b.dataset.id === id) return b;
  return null;
}

export function blockText(block: HTMLElement): BlockText {
  const editMode = hasEditableHost(block);
  let text = "";
  const segments: TextSegment[] = [];

  const isHost = (el: Element) => {
    const s = ceState(el);
    return editMode ? s === "true" : s !== null;
  };

  const walkHost = (parent: Node) => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        if (data.length) {
          segments.push({ node: child as Text, start: text.length, end: text.length + data.length });
          text += data;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as Element;
        if (isLayoutOnly(el) || isNestedBlock(el, block)) continue;
        const tag = el.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") continue;
        if (tag === "BR") text += HOST_BREAK;
        else if (ceState(el) === "false") text += ATOM;
        else if (ceState(el) === "true") startHost(el);
        else walkHost(el);
      }
    }
  };

  const startHost = (el: Element) => {
    if (text.length && !text.endsWith(HOST_BREAK)) text += HOST_BREAK;
    walkHost(el);
  };

  const walkOutside = (parent: Element) => {
    for (let child = parent.firstElementChild; child; child = child.nextElementSibling) {
      if (isLayoutOnly(child) || isNestedBlock(child, block)) continue;
      if (isHost(child)) startHost(child);
      else if (ceState(child) === "false") continue; // widget chrome in edit mode
      else walkOutside(child);
    }
  };

  walkOutside(block);
  return { block, id: block.dataset.id ?? "", text, segments };
}

/** DOM position for a text offset (start positions prefer the next node). */
export function positionAt(
  segments: TextSegment[],
  offset: number,
  isEnd: boolean,
): { node: Text; offset: number } | null {
  for (const s of segments) {
    if (isEnd ? offset > s.start && offset <= s.end : offset >= s.start && offset < s.end) {
      return { node: s.node, offset: offset - s.start };
    }
  }
  // Boundary sits on a break/atom: snap to the nearest real text.
  if (isEnd) {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].end <= offset) return { node: segments[i].node, offset: segments[i].node.length };
    }
  } else {
    for (const s of segments) if (s.start >= offset) return { node: s.node, offset: 0 };
  }
  return null;
}

export function rangeFor(bt: BlockText, start: number, end: number): Range | null {
  if (end <= start) return null;
  const from = positionAt(bt.segments, start, false);
  const to = positionAt(bt.segments, end, true);
  if (!from || !to) return null;
  const r = bt.block.ownerDocument.createRange();
  r.setStart(from.node, from.offset);
  r.setEnd(to.node, to.offset);
  if (r.collapsed) return null;
  return r;
}

/** Text offset of a DOM boundary point within the block's text. */
export function offsetOf(bt: BlockText, node: Node, offset: number): number {
  for (const s of bt.segments) {
    if (s.node === node) return s.start + Math.min(offset, s.end - s.start);
  }
  const doc = bt.block.ownerDocument;
  const point = doc.createRange();
  try {
    point.setStart(node, offset);
  } catch {
    return 0;
  }
  point.collapse(true);
  for (const s of bt.segments) {
    // First text segment at or after the boundary.
    if (point.comparePoint(s.node, 0) >= 0) return s.start;
  }
  return bt.text.length;
}

/** Whether `node` lies in a text host of its block (not chrome, not an atom). */
export function inTextHost(node: Node, block: HTMLElement): boolean {
  if (layoutAncestor(node, block)) return false;
  const editMode = hasEditableHost(block);
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  let host: Element | null = null;
  for (; el && el !== block; el = el.parentElement) {
    const s = ceState(el);
    if (s !== null) host = el; // keep climbing: we want the outermost
  }
  if (!host) return false;
  return editMode ? ceState(host) === "true" || hasTrueAncestorBelow(node, block) : true;
}

function hasTrueAncestorBelow(node: Node, block: Element): boolean {
  for (let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement; el && el !== block; el = el.parentElement) {
    if (ceState(el) === "true") return true;
  }
  return false;
}

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommentThread } from "~/lib/api/collab";
import { DRAFT_KEY, HL_COMMENT, HL_COMMENT_ACTIVE, useCommentHighlights, type CommentHighlights } from "./useCommentHighlights";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const thread = (id: string, blockId: string, quote: string, resolved = false): CommentThread => ({
  id,
  anchor: { blockId, quote, prefix: "", suffix: "" },
  resolved,
  resolvedBy: null,
  comments: [],
  createdAt: "2026-01-01T00:00:00Z",
});

class FakeHighlight {
  ranges: Range[];
  priority = 0;
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let doc: HTMLElement;
let host: HTMLElement;
let reactRoot: Root;
let result: CommentHighlights;
const registry = new Map<string, FakeHighlight>();
const g = globalThis as unknown as { CSS?: unknown; Highlight?: unknown };
const saved = { CSS: g.CSS, Highlight: g.Highlight };

function Probe(props: {
  threads: CommentThread[];
  active: string | null;
  version: number;
  onActivate?: (id: string | null) => void;
  draft?: CommentThread["anchor"] | null;
}) {
  result = useCommentHighlights(doc, props.threads, props.active, props.version, {
    onActivate: props.onActivate,
    draftAnchor: props.draft ?? null,
    debounceMs: 0,
  });
  return null;
}

function render(props: Parameters<typeof Probe>[0]) {
  act(() => reactRoot.render(createElement(Probe, props)));
}

beforeEach(() => {
  g.CSS = { highlights: registry };
  g.Highlight = FakeHighlight;
  registry.clear();
  document.body.innerHTML = "";
  doc = document.createElement("div");
  doc.innerHTML = `
    <div class="ce-block" data-id="b1"><div contenteditable="true">Alpha beta gamma</div></div>
    <div class="ce-block" data-id="b2"><div contenteditable="true">Delta epsilon</div></div>`;
  document.body.appendChild(doc);
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  g.CSS = saved.CSS;
  g.Highlight = saved.Highlight;
  vi.restoreAllMocks();
});

describe("useCommentHighlights", () => {
  it("orders located threads and reports orphans", () => {
    render({
      threads: [thread("t2", "b2", "epsilon"), thread("t1", "b1", "beta"), thread("t3", "gone", "nowhere text")],
      active: null,
      version: 0,
    });
    expect(result.order).toEqual(["t1", "t2"]);
    expect(result.orphaned).toEqual(["t3"]);
    expect(result.ranges.get("t1")!.toString()).toBe("beta");
  });

  it("paints open threads and the active one separately", () => {
    render({
      threads: [thread("t1", "b1", "beta"), thread("t2", "b2", "epsilon"), thread("t3", "b1", "gamma", true)],
      active: "t2",
      version: 0,
      draft: { blockId: "b1", quote: "Alpha", prefix: "", suffix: "" },
    });
    expect(registry.get(HL_COMMENT)!.ranges.map((r) => r.toString())).toEqual(["beta"]);
    const active = registry.get(HL_COMMENT_ACTIVE)!;
    expect(active.ranges.map((r) => r.toString()).sort()).toEqual(["Alpha", "epsilon"]);
    expect(active.priority).toBe(1);
    expect(result.ranges.has(DRAFT_KEY)).toBe(true);
  });

  it("re-anchors after edits when the version changes", async () => {
    const threads = [thread("t1", "b1", "beta")];
    render({ threads, active: null, version: 0 });
    expect(result.orphaned).toEqual([]);
    doc.querySelector('[data-id="b1"] [contenteditable]')!.textContent = "Alpha gamma";
    render({ threads, active: null, version: 1 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(result.orphaned).toEqual(["t1"]);
    expect(registry.has(HL_COMMENT)).toBe(false);
  });

  it("activates the thread under a click", () => {
    const onActivate = vi.fn();
    // jsdom has no layout: give every range a box from its text offset.
    const proto = Range.prototype as { getClientRects?: () => unknown };
    const had = Object.prototype.hasOwnProperty.call(proto, "getClientRects");
    const original = proto.getClientRects;
    proto.getClientRects = function (this: Range) {
      const left = this.startOffset * 10;
      return [{ left, right: left + this.toString().length * 10, top: 0, bottom: 20, width: 0, height: 20 }];
    };
    onTestFinished(() => {
      if (had) proto.getClientRects = original;
      else delete proto.getClientRects;
    });
    render({ threads: [thread("t1", "b1", "beta"), thread("t2", "b1", "Alpha beta")], active: null, version: 0, onActivate });
    const target = doc.querySelector('[data-id="b1"] [contenteditable]')!;
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 65, clientY: 10 }));
    // Both cover x=65; the shorter (more specific) wins.
    expect(onActivate).toHaveBeenLastCalledWith("t1");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5, clientY: 10 }));
    expect(onActivate).toHaveBeenLastCalledWith("t2");
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 500, clientY: 10 }));
    expect(onActivate).toHaveBeenLastCalledWith(null);
  });

  it("clears its highlights on unmount", () => {
    render({ threads: [thread("t1", "b1", "beta")], active: "t1", version: 0 });
    expect(registry.size).toBeGreaterThan(0);
    act(() => reactRoot.unmount());
    expect(registry.size).toBe(0);
    reactRoot = createRoot(host);
  });
});

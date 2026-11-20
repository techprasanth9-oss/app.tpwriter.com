import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentThread, PublicUser, Role } from "~/lib/api/collab";
import * as collab from "~/lib/api/collab";
import { CommentsPanel } from "./CommentsPanel";
import { useCommentsUi, type CommentsUi } from "./useComments";

vi.mock("~/lib/api/collab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api/collab")>();
  return {
    ...actual,
    listComments: vi.fn(),
    createThread: vi.fn(),
    replyToThread: vi.fn(),
    setThreadResolved: vi.fn(),
    editComment: vi.fn(),
    deleteComment: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.mocked(collab);
const me: PublicUser = { id: "me", email: "me@x.io", displayName: "Me Myself" };
const other: PublicUser = { id: "o", email: "o@x.io", displayName: "Olive Other" };

const t1 = (): CommentThread => ({
  id: "t1",
  anchor: { blockId: "b1", quote: "brown fox", prefix: "The quick ", suffix: " jumps" },
  resolved: false,
  resolvedBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  comments: [
    { id: "c1", author: other, body: "Is this right @[Me Myself](me)?", mentions: ["me"], createdAt: "2026-01-01T00:00:00Z", editedAt: null },
  ],
});

let docRoot: HTMLElement;
let host: HTMLElement;
let reactRoot: Root;
let qc: QueryClient;
let ui: CommentsUi;

function Harness(props: { role: Role; commentsVersion?: number }) {
  ui = useCommentsUi(true);
  return createElement(CommentsPanel, {
    documentId: "d1",
    role: props.role,
    currentUser: me,
    members: [me, other],
    root: docRoot,
    scrollContainer: null,
    version: 0,
    commentsVersion: props.commentsVersion ?? 0,
    ui,
  });
}

function render(role: Role, commentsVersion = 0) {
  act(() =>
    reactRoot.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { role, commentsVersion }))),
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const buttons = () => Array.from(host.querySelectorAll("button"));
const button = (label: string) =>
  buttons().find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label) ?? null;

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.setSelectionRange(value.length, value.length);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(el: Element, k: string, mods: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
  });
}

function selectInDoc(text: string) {
  const el = docRoot.querySelector<HTMLElement>("[contenteditable=true]")!;
  const node = el.firstChild as Text;
  const at = node.data.indexOf(text);
  const r = document.createRange();
  r.setStart(node, at);
  r.setEnd(node, at + text.length);
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(r);
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  docRoot = document.createElement("div");
  docRoot.innerHTML = `<div class="ce-block" data-id="b1"><div contenteditable="true">The quick brown fox jumps over the lazy dog.</div></div>`;
  document.body.appendChild(docRoot);
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.listComments.mockResolvedValue([t1()]);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  qc.clear();
});

describe("CommentsPanel", () => {
  it("is a labelled region listing threads with mention chips", async () => {
    render("viewer");
    await flush();
    const aside = $("aside")!;
    expect(aside.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(aside.getAttribute("aria-labelledby")!)!.textContent).toBe("Comments");
    expect($(".tp-thread")!.textContent).toContain("Olive Other");
    expect($(".tp-mention-chip")!.textContent).toBe("@Me Myself");
  });

  it("keeps viewers read-only", async () => {
    render("viewer");
    await flush();
    act(() => $(".tp-thread")!.click());
    expect($(".tp-thread.is-active")).not.toBeNull();
    expect(button("Resolve thread")).toBeNull();
    expect($("textarea")).toBeNull();
    selectInDoc("lazy dog");
    act(() => {
      ui.beginComment(docRoot);
    });
    expect($(".tp-thread--draft")).toBeNull();
  });

  it("posts a new thread optimistically and swaps in the saved one", async () => {
    let resolveCreate!: (t: CommentThread) => void;
    api.createThread.mockImplementation(() => new Promise((r) => (resolveCreate = r)));
    render("commenter");
    await flush();

    selectInDoc("lazy dog");
    let ok = false;
    act(() => {
      ok = ui.beginComment(docRoot);
    });
    expect(ok).toBe(true);
    const box = $<HTMLTextAreaElement>(".tp-thread--draft textarea")!;
    expect(box).not.toBeNull();
    type(box, "Needs a source");
    key(box, "Enter", { ctrlKey: true });
    await flush();

    expect(api.createThread).toHaveBeenCalledWith(
      "d1",
      { blockId: "b1", quote: "lazy dog", prefix: " quick brown fox jumps over the ", suffix: "." },
      "Needs a source",
    );
    expect($(".tp-thread--draft")).toBeNull();
    const pending = $(".tp-thread.is-pending")!;
    expect(pending.textContent).toContain("Needs a source");
    expect(ui.activeThreadId).toMatch(/^tmp-/);

    const saved: CommentThread = {
      id: "t2",
      anchor: { blockId: "b1", quote: "lazy dog", prefix: "", suffix: "" },
      resolved: false,
      resolvedBy: null,
      createdAt: "2026-01-02T00:00:00Z",
      comments: [{ id: "c2", author: me, body: "Needs a source", mentions: [], createdAt: "2026-01-02T00:00:00Z", editedAt: null }],
    };
    await act(async () => resolveCreate(saved));
    await flush();
    expect($(".tp-thread.is-pending")).toBeNull();
    expect($('[data-thread-id="t2"]')).not.toBeNull();
    expect(ui.activeThreadId).toBe("t2");
  });

  it("rolls back a failed new thread and shows an error", async () => {
    api.createThread.mockRejectedValue(new Error("offline"));
    render("commenter");
    await flush();
    selectInDoc("lazy dog");
    act(() => {
      ui.beginComment(docRoot);
    });
    const box = $<HTMLTextAreaElement>(".tp-thread--draft textarea")!;
    type(box, "Lost comment");
    key(box, "Enter", { metaKey: true });
    await flush();
    expect(host.textContent).not.toContain("Lost comment");
    expect($('[role="alert"]')!.textContent).toContain("offline");
    expect(ui.activeThreadId).toBeNull();
  });

  it("Escape cancels the composer", async () => {
    render("commenter");
    await flush();
    selectInDoc("lazy dog");
    act(() => {
      ui.beginComment(docRoot);
    });
    key($("textarea")!, "Escape");
    expect($(".tp-thread--draft")).toBeNull();
    expect(ui.draft).toBeNull();
  });

  it("resolves optimistically and rolls back on error", async () => {
    let reject!: (e: Error) => void;
    api.setThreadResolved.mockImplementation(() => new Promise((_, r) => (reject = r)));
    render("commenter");
    await flush();
    act(() => $(".tp-thread")!.click());
    act(() => button("Resolve thread")!.click());
    await flush();
    // Hidden while "Show resolved" is off.
    expect($('[data-thread-id="t1"]')).toBeNull();
    await act(async () => reject(new Error("nope")));
    await flush();
    expect($('[data-thread-id="t1"]')).not.toBeNull();
    expect($('[role="alert"]')!.textContent).toContain("Couldn't resolve");
  });

  it("replies with an @mention picked from the picker", async () => {
    api.replyToThread.mockImplementation(async (_d, _t, body) => ({
      ...t1(),
      comments: [...t1().comments, { id: "c9", author: me, body, mentions: ["o"], createdAt: "2026-01-03T00:00:00Z", editedAt: null }],
    }));
    render("commenter");
    await flush();
    act(() => $(".tp-thread")!.click());
    const box = $<HTMLTextAreaElement>(".tp-thread-reply textarea")!;
    act(() => box.focus());
    type(box, "Thanks @oli");
    const option = $('[role="option"]')!;
    expect(option.textContent).toContain("Olive Other");
    expect(box.getAttribute("aria-expanded")).toBe("true");
    key(box, "Enter");
    expect(box.value).toBe("Thanks @Olive Other ");
    key(box, "Enter", { ctrlKey: true });
    await flush();
    expect(api.replyToThread).toHaveBeenCalledWith("d1", "t1", "Thanks @[Olive Other](o)");
    expect(host.querySelectorAll(".tp-mention-chip").length).toBe(2);
  });

  it("lets authors edit and delete only their own comments", async () => {
    api.listComments.mockResolvedValue([
      {
        ...t1(),
        comments: [
          ...t1().comments,
          { id: "mine", author: me, body: "my reply", mentions: [], createdAt: "2026-01-01T01:00:00Z", editedAt: null },
        ],
      },
    ]);
    api.deleteComment.mockResolvedValue(undefined);
    render("commenter");
    await flush();
    act(() => $(".tp-thread")!.click());
    expect(button("Edit comment")).toBeNull(); // someone else's first comment
    expect(button("Edit reply")).not.toBeNull();
    act(() => button("Delete reply")!.click());
    act(() => button("Delete")!.click());
    await flush();
    expect(api.deleteComment).toHaveBeenCalledWith("d1", "t1", "mine");
  });

  it("refetches when commentsVersion changes and lists orphans", async () => {
    render("viewer", 0);
    await flush();
    expect(api.listComments).toHaveBeenCalledTimes(1);
    api.listComments.mockResolvedValue([
      t1(),
      { ...t1(), id: "t9", anchor: { blockId: "zz", quote: "deleted words", prefix: "", suffix: "" } },
    ]);
    render("viewer", 1);
    await flush();
    expect(api.listComments).toHaveBeenCalledTimes(2);
    expect($(".tp-comments-orphans summary")!.textContent).toBe("1 comment on deleted text");
    expect($(".tp-comments-orphans .tp-thread-quote")!.textContent).toBe("deleted words");
  });
});

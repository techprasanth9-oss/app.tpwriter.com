import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role, VersionContent, VersionSummary } from "~/lib/api/collab";
import * as collab from "~/lib/api/collab";
import type { EditorBlock } from "~/lib/api/documents";
import { DEFAULT_LAYOUT } from "~/lib/editor/pagination/paper";
import { groupVersions, VersionHistoryPanel } from "./VersionHistoryPanel";

vi.mock("~/lib/api/collab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api/collab")>();
  return {
    ...actual,
    listVersions: vi.fn(),
    getVersion: vi.fn(),
    createNamedVersion: vi.fn(),
    restoreVersion: vi.fn(),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.mocked(collab);

const user = { id: "u1", email: "ann@x.io", displayName: "Ann" };
const today = new Date();
const iso = (daysAgo: number, h = 10) => {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};
const versions: VersionSummary[] = [
  { id: "v3", revision: 30, label: null, auto: true, createdAt: iso(0, 11), createdBy: user },
  { id: "v2", revision: 20, label: "Draft for review", auto: false, createdAt: iso(1), createdBy: user },
  { id: "v1", revision: 10, label: null, auto: true, createdAt: iso(3), createdBy: null },
];
const p = (id: string, text: string): EditorBlock => ({ id, type: "paragraph", data: { text } });
const content = (v: VersionSummary, blocks: EditorBlock[]): VersionContent => ({
  ...v,
  title: "Doc",
  blocks,
  defaultLayout: DEFAULT_LAYOUT,
  pageSetup: {},
  styles: {},
});

let host: HTMLElement;
let reactRoot: Root;
let qc: QueryClient;
const onClose = vi.fn();
const onRestored = vi.fn();
const onFlush = vi.fn();

function render(role: Role, current: EditorBlock[] = [p("a", "Hello brave world"), p("c", "Inserted sentence")]) {
  act(() =>
    reactRoot.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(VersionHistoryPanel, {
          documentId: "d1",
          role,
          open: true,
          onClose,
          currentBlocks: current,
          currentRevision: 31,
          onFlush,
          onRestored,
        }),
      ),
    ),
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const $ = (sel: string) => host.querySelector<HTMLElement>(sel);
const byText = (sel: string, text: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(sel)).find((e) => e.textContent?.includes(text)) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.listVersions.mockResolvedValue(versions);
  api.getVersion.mockImplementation(async (_d, id) =>
    content(versions.find((v) => v.id === id)!, [p("a", "Hello world"), p("b", "Removed paragraph")]),
  );
});

afterEach(() => {
  act(() => reactRoot.unmount());
  qc.clear();
});

describe("groupVersions", () => {
  it("puts named versions first, then automatic ones by day", () => {
    const g = groupVersions(versions, today);
    expect(g.map((x) => x.label)).toEqual(["Named versions", "Today", expect.any(String)]);
    expect(g[0].versions.map((v) => v.id)).toEqual(["v2"]);
    expect(g[1].versions.map((v) => v.id)).toEqual(["v3"]);
    expect(g[2].versions.map((v) => v.id)).toEqual(["v1"]);
  });
});

describe("VersionHistoryPanel", () => {
  it("is a modal dialog showing the current version first", async () => {
    render("editor");
    await flush();
    const dlg = $('[role="dialog"]')!;
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect($(".tp-history-title")!.textContent).toBe("Current version");
    expect($(".tp-history-paper")!.textContent).toContain("Hello brave world");
    expect(byText(".tp-history-item", "Draft for review")).not.toBeNull();
    expect(byText(".tp-history-item", "Revision 30")).not.toBeNull();
  });

  it("previews a version and compares it with the current document", async () => {
    render("editor");
    await flush();
    act(() => byText(".tp-history-item", "Draft for review")!.click());
    await flush();
    expect(api.getVersion).toHaveBeenCalledWith("d1", "v2");
    expect($(".tp-history-paper")!.textContent).toContain("Removed paragraph");

    const toggle = byText("label", "Compare with current")!.querySelector("input")!;
    act(() => toggle.click());
    expect($(".tp-diff-ins")!.textContent).toBe("brave ");
    expect($(".tp-diff-removed")!.textContent).toContain("Removed paragraph");
    expect($(".tp-diff-added")!.textContent).toContain("Inserted sentence");
    expect($(".tp-history-stats")!.textContent).toContain("1 added");
  });

  it("restores after confirmation", async () => {
    api.restoreVersion.mockResolvedValue({ revision: 32 });
    render("owner");
    await flush();
    act(() => byText(".tp-history-item", "Draft for review")!.click());
    await flush();
    act(() => byText("button", "Restore this version")!.click());
    const confirm = $('[role="alertdialog"]')!;
    expect(confirm.textContent).toContain("Draft for review");
    act(() => byText('[role="alertdialog"] button', "Restore")!.click());
    await flush();
    expect(onFlush).toHaveBeenCalled();
    expect(api.restoreVersion).toHaveBeenCalledWith("d1", "v2");
    expect(onRestored).toHaveBeenCalledWith(32);
    expect(onClose).toHaveBeenCalled();
  });

  it("names the current version", async () => {
    const v4: VersionSummary = {
      id: "v4",
      revision: 31,
      label: "Final",
      auto: false,
      createdAt: new Date().toISOString(),
      createdBy: user,
    };
    api.createNamedVersion.mockImplementation(async () => {
      api.listVersions.mockResolvedValue([v4, ...versions]);
      return v4;
    });
    render("editor");
    await flush();
    act(() => byText("button", "Name current version")!.click());
    const input = $(".tp-history-input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "Final");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => byText("button", "Save")!.click());
    await flush();
    expect(onFlush).toHaveBeenCalled();
    expect(api.createNamedVersion).toHaveBeenCalledWith("d1", "Final");
    expect(byText(".tp-history-item", "Final")).not.toBeNull();
  });

  it("Escape closes", async () => {
    render("editor");
    await flush();
    act(() => {
      $('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not load history for commenters", async () => {
    render("commenter");
    await flush();
    expect(api.listVersions).not.toHaveBeenCalled();
    expect(host.textContent).toContain("available to people who can edit");
    expect(byText("button", "Name current version")).toBeNull();
  });
});

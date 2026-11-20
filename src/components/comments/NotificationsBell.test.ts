import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentionNotification } from "~/lib/api/collab";
import * as collab from "~/lib/api/collab";
import { NotificationsBell, notificationHref } from "./NotificationsBell";

vi.mock("~/lib/api/collab", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/api/collab")>();
  return { ...actual, listNotifications: vi.fn(), markNotificationsRead: vi.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.mocked(collab);

const n = (id: string, read: boolean): MentionNotification => ({
  id,
  documentId: "doc1",
  documentTitle: "Quarterly plan",
  threadId: `th-${id}`,
  from: { id: "u2", email: "bob@x.io", displayName: "Bob" },
  excerpt: "Can you check this @[Ann](u1)?",
  read,
  createdAt: new Date().toISOString(),
});

let host: HTMLElement;
let reactRoot: Root;
let qc: QueryClient;
const onNavigate = vi.fn();

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.listNotifications.mockResolvedValue([n("a", false), n("b", true), n("c", false)]);
  api.markNotificationsRead.mockResolvedValue(undefined);
  act(() =>
    reactRoot.render(createElement(QueryClientProvider, { client: qc }, createElement(NotificationsBell, { onNavigate }))),
  );
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  qc.clear();
});

describe("NotificationsBell", () => {
  it("shows the unread count and lists mentions", async () => {
    await flush();
    const btn = host.querySelector<HTMLButtonElement>(".tp-bell-button")!;
    expect(btn.getAttribute("aria-label")).toBe("Notifications, 2 unread mentions");
    expect(host.querySelector(".tp-bell-badge")!.textContent).toBe("2");
    act(() => btn.click());
    await flush();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const items = host.querySelectorAll(".tp-bell-item");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Quarterly plan");
    expect(items[0].textContent).toContain("Can you check this @Ann?");
    expect(items[0].getAttribute("href")).toBe("/documents/doc1?thread=th-a");
  });

  it("navigates and marks a mention read", async () => {
    await flush();
    act(() => host.querySelector<HTMLButtonElement>(".tp-bell-button")!.click());
    await flush();
    act(() => host.querySelector<HTMLAnchorElement>(".tp-bell-item")!.click());
    await flush();
    expect(api.markNotificationsRead).toHaveBeenCalledWith(["a"]);
    expect(onNavigate).toHaveBeenCalledWith("doc1", "th-a", expect.objectContaining({ id: "a" }));
    expect(host.querySelector(".tp-bell-badge")!.textContent).toBe("1");
    expect(host.querySelector(".tp-bell-popover")).toBeNull();
  });

  it("marks all as read", async () => {
    await flush();
    act(() => host.querySelector<HTMLButtonElement>(".tp-bell-button")!.click());
    await flush();
    const all = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Mark all as read")!;
    act(() => all.click());
    await flush();
    expect(api.markNotificationsRead).toHaveBeenCalledWith(["a", "c"]);
    expect(host.querySelector(".tp-bell-badge")).toBeNull();
  });

  it("builds thread links", () => {
    expect(notificationHref({ documentId: "a b", threadId: "t/1" })).toBe("/documents/a%20b?thread=t%2F1");
  });
});

import { describe, expect, it } from "vitest";
import type { CommentThread, PublicUser } from "~/lib/api/collab";
import { layoutCards } from "./layout";
import {
  activeMentionQuery,
  bodyToDraft,
  bodyToPlain,
  draftToBody,
  filterMembers,
  initials,
  insertMention,
  mentionedIds,
  mentionToken,
  parseBody,
} from "./mentions";
import {
  addReply,
  addThread,
  draftComment,
  draftThread,
  isTemp,
  removeComment,
  replaceThread,
  setResolved,
  updateComment,
} from "./threadCache";
import { dayLabel, relativeTime } from "./time";

const ann: PublicUser = { id: "u1", email: "ann@x.io", displayName: "Ann Lee" };
const bob: PublicUser = { id: "u2", email: "bob@x.io", displayName: null };
const anchor = { blockId: "b1", quote: "q", prefix: "", suffix: "" };

describe("mentions", () => {
  it("parses tokens into parts and ids", () => {
    const body = "Hi @[Ann Lee](u1), see @[bob](u2) and @[Ann Lee](u1)";
    expect(parseBody(body)).toEqual([
      { type: "text", text: "Hi " },
      { type: "mention", name: "Ann Lee", userId: "u1" },
      { type: "text", text: ", see " },
      { type: "mention", name: "bob", userId: "u2" },
      { type: "text", text: " and " },
      { type: "mention", name: "Ann Lee", userId: "u1" },
    ]);
    expect(mentionedIds(body)).toEqual(["u1", "u2"]);
    expect(bodyToPlain(body)).toBe("Hi @Ann Lee, see @bob and @Ann Lee");
  });

  it("leaves malformed tokens as text", () => {
    expect(parseBody("@[x](bad id) @[](u1)")).toEqual([{ type: "text", text: "@[x](bad id) @[](u1)" }]);
  });

  it("round-trips through the composer form", () => {
    const body = "Ping @[Ann Lee](u1) about it";
    const draft = bodyToDraft(body);
    expect(draft.text).toBe("Ping @Ann Lee about it");
    expect(draftToBody(draft.text, draft.mentions)).toBe(body);
  });

  it("only converts picked mentions that are still intact", () => {
    const m = [{ name: "Ann", userId: "u1" }];
    expect(draftToBody("@Ann and @Annabel and @Bob", m)).toBe("@[Ann](u1) and @Annabel and @Bob");
    expect(draftToBody("email ann@x.io", m)).toBe("email ann@x.io");
  });

  it("detects the @query at the caret", () => {
    expect(activeMentionQuery("hello @an", 9)).toEqual({ start: 6, query: "an" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("mail a@b", 8)).toBeNull();
    expect(activeMentionQuery("@ann done", 9)).toBeNull();
  });

  it("filters and ranks members", () => {
    const cy: PublicUser = { id: "u3", email: "cy@x.io", displayName: "Lee Cy" };
    expect(filterMembers([ann, bob, cy], "lee").map((u) => u.id)).toEqual(["u3", "u1"]);
    expect(filterMembers([ann, bob, cy], "bo").map((u) => u.id)).toEqual(["u2"]);
    expect(filterMembers([ann, bob], "").length).toBe(2);
  });

  it("inserts the picked member", () => {
    const r = insertMention("Hey @an!", 4, 7, ann);
    expect(r.text).toBe("Hey @Ann Lee !");
    expect(r.caret).toBe(13);
    expect(r.mention).toEqual({ name: "Ann Lee", userId: "u1" });
    expect(mentionToken({ ...ann, displayName: "A [b] (c)" })).toBe("@[A b c](u1)");
  });

  it("makes initials", () => {
    expect(initials(ann)).toBe("AL");
    expect(initials(bob)).toBe("BO");
  });
});

describe("threadCache", () => {
  const base = (): CommentThread[] => [
    { id: "t1", anchor, resolved: false, resolvedBy: null, createdAt: "2026-01-01T00:00:00Z", comments: [draftComment(ann, "first")] },
  ];

  it("adds and swaps a temp thread", () => {
    const temp = draftThread(ann, anchor, "hello @[bob](u2)");
    expect(isTemp(temp.id)).toBe(true);
    expect(temp.comments[0].mentions).toEqual(["u2"]);
    const withTemp = addThread(base(), temp);
    expect(withTemp).toHaveLength(2);
    const saved = { ...temp, id: "t2" };
    const swapped = replaceThread(withTemp, temp.id, saved);
    expect(swapped.map((t) => t.id)).toEqual(["t1", "t2"]);
    // A refetch already brought t2 in: no duplicate.
    expect(replaceThread([...withTemp, saved], temp.id, saved).map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("replies, resolves, edits and deletes", () => {
    let l = addReply(base(), "t1", draftComment(bob, "reply"));
    expect(l[0].comments).toHaveLength(2);
    l = setResolved(l, "t1", true, bob);
    expect(l[0].resolved && l[0].resolvedBy?.id).toBe("u2");
    l = setResolved(l, "t1", false, bob);
    expect(l[0].resolvedBy).toBeNull();
    const replyId = l[0].comments[1].id;
    l = updateComment(l, "t1", replyId, "changed");
    expect(l[0].comments[1].body).toBe("changed");
    expect(l[0].comments[1].editedAt).not.toBeNull();
    l = removeComment(l, "t1", replyId);
    expect(l[0].comments).toHaveLength(1);
    expect(removeComment(l, "t1", l[0].comments[0].id)).toEqual([]);
  });
});

describe("layoutCards", () => {
  it("keeps cards at their anchors when there is room", () => {
    const m = layoutCards(
      [
        { id: "a", top: 0, height: 50 },
        { id: "b", top: 200, height: 50 },
      ],
      null,
    );
    expect([m.get("a"), m.get("b")]).toEqual([0, 200]);
  });

  it("pushes overlapping cards down", () => {
    const m = layoutCards(
      [
        { id: "a", top: 100, height: 80 },
        { id: "b", top: 120, height: 80 },
        { id: "c", top: 130, height: 40 },
      ],
      null,
      10,
    );
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual([100, 190, 280]);
  });

  it("puts the active card at its anchor and pushes earlier ones up", () => {
    const m = layoutCards(
      [
        { id: "a", top: 100, height: 80 },
        { id: "b", top: 120, height: 80 },
      ],
      "b",
      10,
    );
    expect(m.get("b")).toBe(120);
    expect(m.get("a")).toBe(30);
  });

  it("never places cards above the top", () => {
    const m = layoutCards(
      [
        { id: "a", top: 0, height: 80 },
        { id: "b", top: 10, height: 80 },
      ],
      "b",
      10,
    );
    expect(m.get("a")).toBe(0);
    expect(m.get("b")).toBe(90);
  });
});

describe("time", () => {
  const now = new Date("2026-11-20T15:00:00");
  it("formats relative times", () => {
    expect(relativeTime(new Date("2026-11-20T14:59:40").toISOString(), now)).toBe("just now");
    expect(relativeTime(new Date("2026-11-20T14:50:00").toISOString(), now)).toBe("10 min ago");
    expect(relativeTime(new Date("2026-11-20T12:00:00").toISOString(), now)).toBe("3 h ago");
    expect(relativeTime(new Date("2026-11-19T09:00:00").toISOString(), now)).toMatch(/^Yesterday/);
    expect(relativeTime("garbage", now)).toBe("");
  });
  it("labels days", () => {
    expect(dayLabel(new Date("2026-11-20T01:00:00").toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date("2026-11-19T23:00:00").toISOString(), now)).toBe("Yesterday");
  });
});

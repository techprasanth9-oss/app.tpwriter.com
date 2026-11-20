/**
 * Mentions in comment bodies are stored as `@[Display Name](userId)`.
 * The composer shows them as plain `@Display Name` and remembers which
 * ones were picked, converting back on send.
 */
import type { PublicUser } from "~/lib/api/collab";

export type BodyPart = { type: "text"; text: string } | { type: "mention"; name: string; userId: string };

const MENTION_RE = /@\[([^\]\n]{1,100})\]\(([A-Za-z0-9_-]{1,64})\)/g;

export function userName(u: Pick<PublicUser, "displayName" | "email">): string {
  return (u.displayName?.trim() || u.email.split("@")[0] || u.email).trim();
}

/** Display name made safe for the token syntax. */
export function mentionLabel(u: Pick<PublicUser, "displayName" | "email">): string {
  return userName(u).replace(/[[\]()\n]/g, "").trim() || "user";
}

export function mentionToken(u: PublicUser): string {
  return `@[${mentionLabel(u)}](${u.id})`;
}

export function parseBody(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    if (m.index! > last) parts.push({ type: "text", text: body.slice(last, m.index) });
    parts.push({ type: "mention", name: m[1], userId: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < body.length) parts.push({ type: "text", text: body.slice(last) });
  return parts;
}

export function mentionedIds(body: string): string[] {
  const ids: string[] = [];
  for (const p of parseBody(body)) if (p.type === "mention" && !ids.includes(p.userId)) ids.push(p.userId);
  return ids;
}

/** Plain text with mentions as `@Name` (excerpts, editing). */
export function bodyToPlain(body: string): string {
  return parseBody(body)
    .map((p) => (p.type === "text" ? p.text : `@${p.name}`))
    .join("");
}

export interface PickedMention {
  name: string;
  userId: string;
}

/** Stored body → what the composer shows plus the mentions it contains. */
export function bodyToDraft(body: string): { text: string; mentions: PickedMention[] } {
  const mentions: PickedMention[] = [];
  for (const p of parseBody(body)) {
    if (p.type === "mention" && !mentions.some((m) => m.userId === p.userId && m.name === p.name)) {
      mentions.push({ name: p.name, userId: p.userId });
    }
  }
  return { text: bodyToPlain(body), mentions };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Composer text → stored body. Picked mentions still present as `@Name`
 *  (not followed by another word character) become tokens. */
export function draftToBody(text: string, mentions: PickedMention[]): string {
  // Longest names first so "@Ann Lee" wins over "@Ann".
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  if (!sorted.length) return text;
  const re = new RegExp(`@(${sorted.map((m) => escapeRe(m.name)).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  return text.replace(re, (whole, name: string) => {
    const m = sorted.find((x) => x.name === name);
    return m ? `@[${m.name}](${m.userId})` : whole;
  });
}

/** The `@query` being typed at the caret, if any. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([^\s@[\]()]{0,30})$/u.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

export function filterMembers(members: PublicUser[], query: string, limit = 8): PublicUser[] {
  const q = query.toLowerCase();
  const scored = members
    .map((u) => {
      const name = userName(u).toLowerCase();
      const email = u.email.toLowerCase();
      const words = name.split(/\s+/);
      const score = !q
        ? 1
        : name.startsWith(q)
          ? 3
          : words.some((w) => w.startsWith(q))
            ? 2
            : email.startsWith(q) || name.includes(q)
              ? 1
              : 0;
      return { u, score };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || userName(a.u).localeCompare(userName(b.u)));
  return scored.slice(0, limit).map((x) => x.u);
}

/** Replace the `@query` at [start, caret) with `@Name `. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  user: PublicUser,
): { text: string; caret: number; mention: PickedMention } {
  const name = mentionLabel(user);
  const insert = `@${name} `;
  return {
    text: text.slice(0, start) + insert + text.slice(caret),
    caret: start + insert.length,
    mention: { name, userId: user.id },
  };
}

export function initials(u: Pick<PublicUser, "displayName" | "email">): string {
  const parts = userName(u).split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return s.toUpperCase();
}

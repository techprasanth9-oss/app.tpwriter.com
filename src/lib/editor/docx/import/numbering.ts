/**
 * numbering.xml: abstractNum levels, num instances and lvlOverride /
 * startOverride, plus Word's counter semantics (num instances without an
 * override continue the abstract list's counters).
 */

import { attr, child, childrenNamed, intAttr, kids, tag, val } from "./xml";

export type CounterType = "numeric" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

export interface LevelDef {
  numFmt: string;
  start: number;
  lvlText: string;
}

interface NumDef {
  abstractId: string;
  /** ilvl → startOverride */
  overrides: Map<number, number>;
  /** ilvl → full replacement level */
  levelOverrides: Map<number, LevelDef>;
}

export interface ListKind {
  style: "ordered" | "unordered";
  counterType: CounterType;
  /** numFmt we could not represent exactly. */
  approximated?: string;
}

const FMT: Record<string, CounterType> = {
  decimal: "numeric",
  lowerLetter: "lower-alpha",
  upperLetter: "upper-alpha",
  lowerRoman: "lower-roman",
  upperRoman: "upper-roman",
};

function parseLevel(lvl: Element): LevelDef {
  return {
    numFmt: val(lvl, "w:numFmt") ?? "decimal",
    start: intAttr(child(lvl, "w:start"), "w:val") ?? 1,
    lvlText: val(lvl, "w:lvlText") ?? "",
  };
}

export class Numbering {
  private abstracts = new Map<string, Map<number, LevelDef>>();
  private nums = new Map<string, NumDef>();
  private counters = new Map<string, number[]>();

  constructor(root: Element | null) {
    if (!root) return;
    for (const el of kids(root)) {
      const t = tag(el);
      if (t === "w:abstractNum") {
        const id = attr(el, "w:abstractNumId");
        if (id === null) continue;
        const levels = new Map<number, LevelDef>();
        for (const lvl of childrenNamed(el, "w:lvl")) {
          const ilvl = intAttr(lvl, "w:ilvl");
          if (ilvl !== null) levels.set(ilvl, parseLevel(lvl));
        }
        this.abstracts.set(id, levels);
      } else if (t === "w:num") {
        const id = attr(el, "w:numId");
        const abstractId = val(el, "w:abstractNumId");
        if (id === null || abstractId === null) continue;
        const overrides = new Map<number, number>();
        const levelOverrides = new Map<number, LevelDef>();
        for (const o of childrenNamed(el, "w:lvlOverride")) {
          const ilvl = intAttr(o, "w:ilvl");
          if (ilvl === null) continue;
          const so = intAttr(child(o, "w:startOverride"), "w:val");
          if (so !== null) overrides.set(ilvl, so);
          const lvl = child(o, "w:lvl");
          if (lvl) levelOverrides.set(ilvl, parseLevel(lvl));
        }
        this.nums.set(id, { abstractId, overrides, levelOverrides });
      }
    }
  }

  /** numId "0" (or unknown) means "no numbering". */
  has(numId: string | undefined): boolean {
    return !!numId && numId !== "0" && this.nums.has(numId);
  }

  level(numId: string, ilvl: number): LevelDef | null {
    const num = this.nums.get(numId);
    if (!num) return null;
    return num.levelOverrides.get(ilvl) ?? this.abstracts.get(num.abstractId)?.get(ilvl) ?? null;
  }

  abstractOf(numId: string): string | null {
    return this.nums.get(numId)?.abstractId ?? null;
  }

  kind(numId: string, ilvl = 0): ListKind {
    const lvl = this.level(numId, ilvl);
    const fmt = lvl?.numFmt ?? "bullet";
    if (fmt === "bullet" || fmt === "none") return { style: "unordered", counterType: "numeric" };
    const ct = FMT[fmt];
    return ct
      ? { style: "ordered", counterType: ct }
      : { style: "ordered", counterType: "numeric", approximated: fmt };
  }

  /** Advance Word's counter for a list item; returns its number. */
  next(numId: string, ilvl: number): number {
    const num = this.nums.get(numId);
    if (!num) return 1;
    const key = num.overrides.size > 0 ? `num:${numId}` : `abs:${num.abstractId}`;
    let c = this.counters.get(key);
    if (!c) {
      c = [];
      this.counters.set(key, c);
    }
    const start = num.overrides.get(ilvl) ?? this.level(numId, ilvl)?.start ?? 1;
    const value = c[ilvl] === undefined ? start : c[ilvl]! + 1;
    c[ilvl] = value;
    c.length = ilvl + 1; // deeper levels restart
    return value;
  }
}

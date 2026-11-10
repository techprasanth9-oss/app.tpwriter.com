import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

// 1000px pages, 100px margins → 800px writable, sheets 1020px apart.
const geo = { pageHeight: 1000, marginTop: 100, marginBottom: 100, gap: 20 };

describe("paginate", () => {
  it("keeps everything on one page when it fits", () => {
    const r = paginate([{ height: 400 }, { height: 400 }], geo);
    expect(r).toEqual({ pushes: [0, 0], pageOf: [0, 0], pageCount: 1 });
  });

  it("pushes a block that doesn't fit to the top of the next page", () => {
    const r = paginate([{ height: 500 }, { height: 400 }], geo);
    // block 2 would end at 100+500+400=1000 > 900 → starts at 1020+100=1120
    expect(r.pageOf).toEqual([0, 1]);
    expect(r.pushes).toEqual([0, 1120 - 600]);
    expect(r.pageCount).toBe(2);
  });

  it("starts a new page after a page break", () => {
    const r = paginate([{ height: 50 }, { height: 10 }, { height: 50, breakBefore: true }], geo);
    expect(r.pageOf).toEqual([0, 0, 1]);
    expect(r.pushes[2]).toBe(1120 - 160);
  });

  it("adds an empty page when the document ends with a page break", () => {
    expect(paginate([{ height: 50 }, { height: 10 }], geo, true).pageCount).toBe(2);
  });

  it("lets a block taller than a page start at a page top and spill", () => {
    const r = paginate([{ height: 100 }, { height: 1500 }, { height: 50 }], geo);
    expect(r.pageOf).toEqual([0, 1, 2]);
    // tall block: 1120 → 2620, which is inside page 2's writable area
    // (2140–2940), so the next block follows it directly.
    expect(r.pushes[2]).toBe(0);
    expect(r.pageCount).toBe(3);
  });

  it("an empty document is one page", () => {
    expect(paginate([], geo).pageCount).toBe(1);
  });
});

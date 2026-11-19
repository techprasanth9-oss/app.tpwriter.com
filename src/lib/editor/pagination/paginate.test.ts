import { describe, expect, it } from "vitest";
import { paginate } from "./paginate";

// 1000px pages, 100px margins → 800px writable, sheets 1020px apart.
const geo = { pageHeight: 1000, marginTop: 100, marginBottom: 100, gap: 20 };

describe("paginate", () => {
  it("keeps everything on one page when it fits", () => {
    const r = paginate([{ height: 400 }, { height: 400 }], geo);
    expect(r).toMatchObject({ pushes: [0, 0], splits: [[], []], pageOf: [0, 0], pageCount: 1 });
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

  // A 20-line paragraph, 20px per line → breaks every 20px.
  const lines = (n: number, lineHeight = 20) =>
    Array.from({ length: n - 1 }, (_, i) => (i + 1) * lineHeight);

  it("splits a paragraph across a page boundary at a line break", () => {
    // Writing starts at y=100; after 700px, 100px are left → 5 lines fit.
    const r = paginate([{ height: 700 }, { height: 400, getBreaks: () => lines(20), keepTogether: 2 }], geo);
    expect(r.pushes).toEqual([0, 0]);
    expect(r.pageOf).toEqual([0, 0]);
    expect(r.splits[1]).toEqual([{ at: 100, index: 4, gap: 1120 - 900 }]);
    expect(r.pageCount).toBe(2);
  });

  it("splits a block across several pages", () => {
    const r = paginate([{ height: 2000, getBreaks: () => lines(100) }], geo);
    expect(r.splits[0]!.map((s) => s.at)).toEqual([800, 1600]);
    expect(r.pageCount).toBe(3);
  });

  it("moves the whole paragraph when fewer than keepTogether lines fit (orphan control)", () => {
    // 20px left → one line would fit, but two are required.
    const r = paginate([{ height: 780 }, { height: 100, getBreaks: () => lines(5), keepTogether: 2 }], geo);
    expect(r.splits[1]).toEqual([]);
    expect(r.pageOf).toEqual([0, 1]);
    expect(r.pushes[1]).toBe(1120 - 880);
  });

  it("keeps two lines on the next page too (widow control)", () => {
    // 5 lines, 80px left: 4 lines would fit but would leave 1 alone.
    const r = paginate([{ height: 720 }, { height: 100, getBreaks: () => lines(5), keepTogether: 2 }], geo);
    expect(r.splits[1]).toEqual([{ at: 60, index: 2, gap: 1120 - 880 }]);
  });

  it("only measures breaks for blocks that don't fit", () => {
    let calls = 0;
    paginate([{ height: 100, getBreaks: () => (calls++, lines(5)) }], geo);
    expect(calls).toBe(0);
  });

  it("splits a table between rows", () => {
    // rows of 60px; 500px left → 8 rows fit.
    const rows = Array.from({ length: 14 }, (_, i) => (i + 1) * 60);
    const r = paginate([{ height: 300 }, { height: 900, getBreaks: () => rows }], geo);
    expect(r.splits[1]).toEqual([{ at: 480, index: 7, gap: 1120 - 880 }]);
  });

  describe("sections", () => {
    const portrait = { pageWidth: 800, pageHeight: 1000, marginTop: 100, marginBottom: 100, marginLeft: 100, marginRight: 100 };
    const landscape = { pageWidth: 1000, pageHeight: 800, marginTop: 50, marginBottom: 50, marginLeft: 50, marginRight: 50 };
    const opts = { sections: [portrait, landscape], gap: 20 };

    it("starts a section on a new page with its own geometry", () => {
      const r = paginate([{ height: 100 }, { height: 10 }, { height: 100, sectionStart: 1 }, { height: 100 }], opts);
      expect(r.sectionOf).toEqual([0, 0, 1, 1]);
      expect(r.pageOf).toEqual([0, 0, 1, 1]);
      expect(r.pages.map((p) => [p.top, p.pageHeight, p.section, p.pageInSection])).toEqual([
        [0, 1000, 0, 0],
        [1020, 800, 1, 0],
      ]);
      // Section 1's content starts at its own top margin.
      expect(r.pushes[2]).toBe(1020 + 50 - 210);
    });

    it("uses the section's height when overflowing within it", () => {
      // landscape writable height = 700
      const r = paginate([{ height: 10, sectionStart: 1 }, { height: 650 }, { height: 100 }], opts);
      expect(r.pageOf).toEqual([0, 0, 1]);
      expect(r.pages.map((p) => [p.section, p.pageInSection])).toEqual([
        [1, 0],
        [1, 1],
      ]);
    });

    it("adds a trailing page in the new section after a final section break", () => {
      const r = paginate([{ height: 10 }], { ...opts, trailingBreak: true, trailingSection: 1 });
      expect(r.pages.map((p) => p.section)).toEqual([0, 1]);
    });
  });

  describe("footnotes", () => {
    it("assigns notes to the page their reference lands on", () => {
      const r = paginate(
        [
          { height: 700, footnotes: [{ id: "a", at: 10 }] },
          { height: 400, getBreaks: () => lines(20), footnotes: [{ id: "b", at: 20 }, { id: "c", at: 300 }] },
        ],
        geo,
      );
      expect(r.pages.map((p) => p.footnoteIds)).toEqual([["a", "b"], ["c"]]);
    });

    it("reserved footnote space shrinks the page", () => {
      const plain = paginate([{ height: 700 }, { height: 80 }], geo);
      expect(plain.pageOf).toEqual([0, 0]);
      const reserved = paginate([{ height: 700 }, { height: 80 }], {
        sections: [{ pageWidth: 0, pageHeight: 1000, marginTop: 100, marginBottom: 100, marginLeft: 0, marginRight: 0 }],
        gap: 20,
        reserve: (p) => (p === 0 ? 80 : 0),
      });
      expect(reserved.pageOf).toEqual([0, 1]);
    });
  });
});


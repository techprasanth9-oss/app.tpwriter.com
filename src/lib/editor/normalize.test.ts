import { describe, expect, it } from "vitest";
import { normalizeBlock } from "./normalize";

describe("normalizeBlock", () => {
  it("moves paragraph data alignment/indent into tunes.format", () => {
    expect(
      normalizeBlock({ id: "a", type: "paragraph", data: { text: "x", alignment: "center", indentLevel: 2 } }),
    ).toEqual({ id: "a", type: "paragraph", data: { text: "x" }, tunes: { format: { alignment: "center", indent: 2 } } });
  });

  it("reads the old Alignment / Indent tunes and nested data.tunes", () => {
    expect(
      normalizeBlock({
        type: "header",
        data: { text: "h", level: 2 },
        tunes: { alignment: { alignment: "right" }, indent: { indentLevel: 1 } },
      }).tunes,
    ).toEqual({ format: { alignment: "right", indent: 1 } });
    expect(
      normalizeBlock({ type: "paragraph", data: { text: "p", tunes: { indentTune: { indentLevel: 3 } } } }),
    ).toEqual({ type: "paragraph", data: { text: "p" }, tunes: { format: { indent: 3 } } });
  });

  it("lets an explicit format tune win over legacy values", () => {
    expect(
      normalizeBlock({
        type: "paragraph",
        data: { text: "x", alignment: "center" },
        tunes: { format: { alignment: "justify" } },
      }).tunes,
    ).toEqual({ format: { alignment: "justify" } });
  });

  it("drops junk values instead of passing them to CSS", () => {
    expect(
      normalizeBlock({ type: "paragraph", data: { text: "x", alignment: "red;background:url(x)" } }),
    ).toEqual({ type: "paragraph", data: { text: "x" } });
  });

  it("leaves non-text blocks alone and retires delimiter", () => {
    const table = { type: "table", data: { content: [] }, tunes: { alignment: { alignment: "center" } } };
    expect(normalizeBlock(table)).toBe(table);
    expect(normalizeBlock({ id: "d", type: "delimiter", data: {} })).toEqual({ id: "d", type: "horizontalLine", data: {} });
  });
});

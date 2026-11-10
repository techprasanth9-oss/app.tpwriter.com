import { describe, expect, it, vi } from "vitest";
import { applyFormat, cleanFormat } from "./paragraphFormat";
import { FORMAT_EVENT, ParagraphFormatTune } from "../tools/ParagraphFormatTune";

describe("cleanFormat", () => {
  it("keeps valid values and drops the rest", () => {
    expect(
      cleanFormat({ alignment: "center", indent: 2, lineHeight: 1.5, spaceAfter: 12, styleId: "title" }),
    ).toEqual({ alignment: "center", indent: 2, lineHeight: 1.5, spaceAfter: 12, styleId: "title" });
    expect(
      cleanFormat({ alignment: "middle", indent: 99, lineHeight: "2", spaceBefore: -1, styleId: "x;y" }),
    ).toEqual({});
  });
});

describe("applyFormat", () => {
  it("styles the wrapper and swaps the style class", () => {
    const el = document.createElement("div");
    el.className = "tp-format tp-style-title";
    applyFormat(el, { alignment: "right", indent: 1, styleId: "quote", spaceBefore: 0 });
    expect(el.style.textAlign).toBe("right");
    expect(el.style.paddingLeft).toBe("40px");
    expect(el.classList.contains("tp-style-quote")).toBe(true);
    expect(el.classList.contains("tp-style-title")).toBe(false);
    expect(el.classList.contains("tp-has-space-before")).toBe(true);
    applyFormat(el, {});
    expect(el.style.textAlign).toBe("");
    expect(el.classList.contains("tp-style-quote")).toBe(false);
  });
});

describe("ParagraphFormatTune", () => {
  it("applies saved data, updates in place on FORMAT_EVENT, and reports the change", () => {
    const block = { dispatchChange: vi.fn() };
    const tune = new ParagraphFormatTune({ api: {} as never, data: { alignment: "center" }, block: block as never });
    const content = document.createElement("div");
    const wrapper = tune.wrap(content);
    expect(wrapper.firstChild).toBe(content);
    expect(wrapper.style.textAlign).toBe("center");

    wrapper.dispatchEvent(new CustomEvent(FORMAT_EVENT, { detail: { alignment: "justify", indent: 2 } }));
    expect(tune.save()).toEqual({ alignment: "justify", indent: 2 });
    expect(wrapper.style.textAlign).toBe("justify");
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);

    // undefined clears a key
    wrapper.dispatchEvent(new CustomEvent(FORMAT_EVENT, { detail: { indent: undefined } }));
    expect(tune.save()).toEqual({ alignment: "justify" });
  });
});

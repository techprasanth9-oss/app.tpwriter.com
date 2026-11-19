import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeEditorData } from "../sanitizeData";
import { __setKatexForTests, EquationTool, KATEX_OPTIONS, loadKatex, type Katex } from "./EquationTool";
import { cleanEquationData, cleanLatex } from "./objectData";

/** jsdom can't lay KaTeX out; a stand-in that records calls and fails on
 *  an unknown command the way KaTeX does with throwOnError: false. */
function fakeKatex() {
  const render = vi.fn((tex: string, el: HTMLElement, opts: Record<string, unknown>) => {
    if (tex.includes("\\bogus")) {
      const span = document.createElement("span");
      span.className = "katex-error";
      span.title = "ParseError: Undefined control sequence: \\bogus";
      span.style.color = String(opts.errorColor);
      span.textContent = tex;
      el.appendChild(span);
      return;
    }
    if (tex.includes("\\crash")) throw new Error("boom");
    const span = document.createElement("span");
    span.className = opts.displayMode ? "katex-display" : "katex";
    span.textContent = `rendered:${tex}`;
    el.appendChild(span);
  });
  return { render } as unknown as Katex & { render: typeof render };
}

function mount(data: unknown, readOnly = false) {
  const block = { id: "e1", dispatchChange: vi.fn() };
  const tool = new (EquationTool as any)({ data, api: {}, config: {}, readOnly, block }) as EquationTool;
  const el = tool.render();
  document.body.replaceChildren(el);
  return { tool, el, block };
}

let katex: ReturnType<typeof fakeKatex>;
beforeEach(() => {
  katex = fakeKatex();
  __setKatexForTests(katex);
});
afterEach(() => {
  __setKatexForTests(null);
  vi.useRealTimers();
});

describe("equation data", () => {
  it("round-trips", () => {
    const { tool } = mount({ latex: "E = mc^2", display: false });
    expect(tool.save()).toEqual({ latex: "E = mc^2", display: false });
  });

  it("cleans bad data", () => {
    expect(cleanEquationData(null)).toEqual({ latex: "", display: true });
    expect(cleanEquationData({ latex: 5, display: "yes" })).toEqual({ latex: "", display: true });
    expect(cleanEquationData({ latex: "x".repeat(10_000) }).latex).toHaveLength(4000);
  });

  it("stores < and > as \\lt / \\gt so the load sanitizer can't eat them", () => {
    expect(cleanLatex("a<b>c")).toBe("a\\lt b\\gt c");
    expect(cleanLatex("x &lt; y")).toBe("x \\lt  y");
    const { tool } = mount({ latex: "x<y", display: true });
    const saved = tool.save();
    expect(saved.latex).not.toContain("<");
    expect(sanitizeEditorData(saved)).toEqual(saved);
  });

  it("tells EditorJS not to HTML-clean the fields", () => {
    expect((EquationTool as any).sanitize).toEqual({ latex: true, display: true });
  });
});

describe("equation rendering", () => {
  it("renders with KaTeX into an accessible, mutation-free preview", () => {
    const { el } = mount({ latex: "\\frac{a}{b}", display: true });
    const preview = el.querySelector<HTMLElement>(".tp-equation__preview")!;
    expect(preview.getAttribute("role")).toBe("img");
    expect(preview.getAttribute("aria-label")).toBe("\\frac{a}{b}");
    expect(preview.dataset.mutationFree).toBe("true");
    expect(el.contentEditable).toBe("false");
    expect(preview.textContent).toBe("rendered:\\frac{a}{b}");
    expect(el.classList.contains("tp-equation--display")).toBe(true);
    const opts = katex.render.mock.calls[0]![2];
    expect(opts).toMatchObject({ ...KATEX_OPTIONS, displayMode: true, trust: false, throwOnError: false });
  });

  it("shows a placeholder when empty", () => {
    const { el } = mount({});
    expect(el.querySelector(".tp-equation__placeholder")!.textContent).toMatch(/add an equation/i);
    expect(katex.render).not.toHaveBeenCalled();
  });

  it("shows invalid LaTeX as a red error, not a crash", () => {
    const { el } = mount({ latex: "\\bogus{x}" });
    const preview = el.querySelector(".tp-equation__preview")!;
    expect(preview.querySelector(".katex-error")).not.toBeNull();
    expect(preview.classList.contains("tp-equation__preview--invalid")).toBe(true);

    const crashed = mount({ latex: "\\crash" });
    expect(crashed.el.querySelector(".tp-equation__error")!.textContent).toBe("boom");
  });

  it("shows the source while KaTeX lazy-loads, then the real rendering", async () => {
    __setKatexForTests(null);
    const { el } = mount({ latex: "a+b" });
    expect(el.querySelector(".tp-equation__pending")!.textContent).toBe("a+b");
    await loadKatex();
    await Promise.resolve();
    expect(el.querySelector(".tp-equation__pending")).toBeNull();
    expect(el.querySelector(".katex")).not.toBeNull();
  });
});

describe("equation editing", () => {
  it("opens an inline editor on click, previews live and commits on Done", () => {
    const { tool, el, block } = mount({ latex: "x", display: true });
    el.querySelector<HTMLElement>(".tp-equation__preview")!.click();
    expect(tool.isEditing).toBe(true);
    const textarea = el.querySelector<HTMLTextAreaElement>(".tp-equation__input")!;
    expect(textarea.value).toBe("x");
    expect(el.querySelector<HTMLElement>(".tp-equation__editor")!.dataset.mutationFree).toBe("true");
    textarea.value = "x^2";
    textarea.dispatchEvent(new Event("input"));
    expect(el.querySelector(".tp-equation__live")!.textContent).toBe("rendered:x^2");
    el.querySelector<HTMLButtonElement>(".tp-equation__done")!.click();
    expect(tool.isEditing).toBe(false);
    expect(el.querySelector(".tp-equation__editor")).toBeNull();
    expect(tool.save().latex).toBe("x^2");
    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
    expect(el.querySelector(".tp-equation__preview")!.getAttribute("aria-label")).toBe("x^2");
  });

  it("opens with Enter on the focused preview and closes with Esc", () => {
    const { tool, el, block } = mount({ latex: "y" });
    const preview = el.querySelector<HTMLElement>(".tp-equation__preview")!;
    expect(preview.tabIndex).toBe(0);
    preview.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(tool.isEditing).toBe(true);
    const textarea = el.querySelector<HTMLTextAreaElement>(".tp-equation__input")!;
    const outer = vi.fn();
    document.body.addEventListener("keydown", outer);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    expect(outer).not.toHaveBeenCalled(); // EditorJS never sees editor keys
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.body.removeEventListener("keydown", outer);
    expect(tool.isEditing).toBe(false);
    expect(block.dispatchChange).not.toHaveBeenCalled(); // unchanged
  });

  it("closes when focus leaves the editor", () => {
    vi.useFakeTimers();
    const { tool, el } = mount({ latex: "z" });
    el.querySelector<HTMLElement>(".tp-equation__preview")!.click();
    const textarea = el.querySelector<HTMLTextAreaElement>(".tp-equation__input")!;
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    vi.runAllTimers();
    expect(tool.isEditing).toBe(false);
  });

  it("is not editable read-only", () => {
    const { tool, el } = mount({ latex: "q" }, true);
    el.querySelector<HTMLElement>(".tp-equation__preview")!.click();
    expect(tool.isEditing).toBe(false);
  });

  it("switches display mode from the settings menu", () => {
    const { tool, el, block } = mount({ latex: "q", display: true });
    const items = tool.renderSettings() as Array<{ onActivate: () => void; isActive: boolean }>;
    expect(items[0]!.isActive).toBe(true);
    items[1]!.onActivate();
    expect(tool.save().display).toBe(false);
    expect(el.classList.contains("tp-equation--inline")).toBe(true);
    expect(block.dispatchChange).toHaveBeenCalled();
  });
});

describe("equation paste", () => {
  it("matches $$…$$ and \\[…\\] text", () => {
    const re = (EquationTool as any).pasteConfig.patterns.equation as RegExp;
    expect(re.test("$$a^2 + b^2 = c^2$$")).toBe(true);
    expect(re.test("  \\[x\\]  ")).toBe(true);
    expect(re.test("costs $5 and $6")).toBe(false);
  });

  it("creates an equation from the pasted text", () => {
    const { tool } = mount({});
    tool.onPaste({ type: "pattern", detail: { key: "equation", data: "$$ x<1 $$" } } as any);
    expect(tool.save()).toEqual({ latex: "x\\lt 1", display: true });
  });
});

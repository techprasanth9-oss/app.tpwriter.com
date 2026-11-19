import { describe, expect, it, vi } from "vitest";
import { BLOCK_INLINE_TAGS } from "../sanitizers";
import { sanitizeEditorData } from "../sanitizeData";
import { cleanTextBoxData } from "./objectData";
import { insertLineBreak, TextBoxTool } from "./TextBoxTool";

function mount(data: unknown, readOnly = false) {
  const block = { id: "t1", dispatchChange: vi.fn() };
  const tool = new (TextBoxTool as any)({ data, api: {}, config: {}, readOnly, block }) as TextBoxTool;
  const el = tool.render();
  document.body.replaceChildren(el);
  return { tool, el, block, content: el.querySelector<HTMLElement>(".tp-textbox__content")! };
}

function caretAt(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe("text box data", () => {
  it("round-trips", () => {
    const data = { text: "Hello <b>bold</b><br>line 2", preset: "warning", width: 75, align: "right" };
    const { tool } = mount(data);
    expect(tool.save()).toEqual(data);
    expect(sanitizeEditorData(data)).toEqual(data);
  });

  it("cleans invalid data to safe defaults", () => {
    expect(cleanTextBoxData(null)).toEqual({ text: "", preset: "note", width: 100, align: "center" });
    expect(cleanTextBoxData({ text: 3, preset: "red", width: 10, align: "justify" })).toEqual({
      text: "",
      preset: "note",
      width: 50,
      align: "center",
    });
    expect(cleanTextBoxData({ width: 400 }).width).toBe(100);
    expect(cleanTextBoxData({ width: NaN }).width).toBe(100);
    expect(cleanTextBoxData({ width: 62.4 }).width).toBe(62);
  });

  it("drops the lone <br> an emptied box leaves", () => {
    const { tool, content } = mount({ text: "x" });
    content.innerHTML = "<br>";
    expect(tool.save().text).toBe("");
  });
});

describe("text box tool", () => {
  it("keeps Enter inside the block and sanitizes text as inline HTML", () => {
    expect((TextBoxTool as any).enableLineBreaks).toBe(true);
    expect((TextBoxTool as any).sanitize.text).toBe(BLOCK_INLINE_TAGS);
  });

  it("renders preset, width and alignment as classes / percentage only", () => {
    const { el, content } = mount({ text: "<i>hi</i>", preset: "info", width: 50, align: "left" });
    expect(el.className).toBe("tp-textbox tp-textbox--info tp-textbox--align-left");
    expect(el.style.width).toBe("50%");
    expect(el.getAttribute("role")).toBe("note");
    expect(content.contentEditable).toBe("true");
    expect(content.innerHTML).toBe("<i>hi</i>");
  });

  it("is not editable read-only", () => {
    const { content } = mount({ text: "x" }, true);
    expect(content.getAttribute("contenteditable")).toBeNull();
  });

  it("updates from the settings menu and notifies", () => {
    const { tool, el, block } = mount({ text: "x" });
    const items = tool.renderSettings() as Array<{ title: string; onActivate: () => void; isActive?: boolean }>;
    expect(items.map((i) => i.title)).toEqual([
      "Note",
      "Info",
      "Warning",
      "Plain",
      "Width 50%",
      "Width 75%",
      "Width 100%",
      "Align left",
      "Align center",
      "Align right",
    ]);
    items.find((i) => i.title === "Warning")!.onActivate();
    items.find((i) => i.title === "Width 75%")!.onActivate();
    items.find((i) => i.title === "Align right")!.onActivate();
    expect(tool.save()).toEqual({ text: "x", preset: "warning", width: 75, align: "right" });
    expect(el.style.width).toBe("75%");
    expect(block.dispatchChange).toHaveBeenCalledTimes(3);
  });

  it("Enter inserts a <br> instead of a new block", () => {
    const { content } = mount({ text: "abcd" });
    caretAt(content.firstChild!, 2);
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    content.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(content.innerHTML).toBe("ab<br>cd");
  });

  it("a break at the end adds a trailing <br> so the new line shows", () => {
    const { tool, content } = mount({ text: "ab" });
    caretAt(content.firstChild!, 2);
    insertLineBreak(content);
    expect(content.innerHTML).toBe("ab<br><br>");
    expect(tool.save().text).toBe("ab<br><br>");
  });
});

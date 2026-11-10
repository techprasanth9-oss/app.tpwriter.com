/**
 * render(data) → save() must give back what was loaded. A mismatch here is
 * silent data loss: the setting looks applied, then resets on reload.
 */
import { describe, expect, it } from "vitest";
import { ParagraphTool } from "./ParagraphTool";
import { HorizontalLineTool } from "./HorizontalLineTool";
import { ListTool } from "./ListTool";
import TableTool from "./TableTool";

// Minimal EditorJS API stand-in: any method call is a no-op.
const api: any = new Proxy(
  {},
  {
    get: () =>
      new Proxy(() => undefined, {
        get: () => () => undefined,
      }),
  },
);

function make<T>(Tool: any, data: unknown): T {
  return new Tool({ data, api, config: {}, readOnly: false, block: { id: "b1" } });
}

describe("tool round-trips", () => {
  it("paragraph saves its text only — formatting lives in the format tune", () => {
    const tool = new (ParagraphTool as any)({
      data: { text: "Hello <b>world</b>" },
      api,
      config: { preserveBlank: true },
      readOnly: false,
    });
    tool.render();
    expect(tool.save()).toEqual({ text: "Hello <b>world</b>" });
  });

  it("paragraph keeps blank lines when preserveBlank is set", () => {
    const tool = new (ParagraphTool as any)({ data: { text: "" }, api, config: { preserveBlank: true }, readOnly: false });
    tool.render();
    expect(tool.save()).toEqual({ text: "" });
  });

  it("horizontal line keeps its indent", () => {
    const tool = make<HorizontalLineTool>(HorizontalLineTool, { indentLevel: 3 });
    tool.render();
    expect(tool.save().indentLevel).toBe(3);
  });

  it("list keeps nested items and inline markup", () => {
    const data = {
      style: "ordered",
      items: [
        { content: 'One <a href="https://e.com">link</a>', meta: {}, items: [{ content: "1a", meta: {}, items: [] }] },
        { content: "Two", meta: {}, items: [] },
      ],
      meta: { counterType: "numeric" },
    };
    const tool = make<ListTool>(ListTool, data);
    const el = tool.render();
    expect(tool.save(el).items).toEqual(data.items);
  });

  it("list sanitize config keeps links and line breaks", () => {
    const rules = (ListTool as any).sanitize.items;
    expect(rules.br).toBe(true);
    expect(typeof rules.a).toBe("function");
  });

  it("table saves a formula, not its computed value", () => {
    const data = { withHeading: false, content: [["1", "2"], ["=SUM(A1:B1)", ""]] };
    const tool = make<any>(TableTool, data);
    tool.render();
    expect(tool.save().content[1][0]).toBe("=SUM(A1:B1)");
  });

  it("table cells are sanitized with an allow-list, not `true`", () => {
    expect((TableTool as any).sanitize.content).not.toBe(true);
  });
});

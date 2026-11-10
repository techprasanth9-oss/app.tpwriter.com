import { describe, expect, it } from "vitest";
import { resolveStyles, stylesToCss } from "./namedStyles";

describe("named styles", () => {
  it("generates scoped rules for paragraphs, headings and paragraph styles", () => {
    const css = stylesToCss(resolveStyles({}), ".doc");
    expect(css).toContain('.doc .ce-header[data-level="1"]{');
    expect(css).toContain(".doc .tp-style-title .ce-paragraph{");
    expect(css).toContain("font-size:16px");
  });

  it("applies stored overrides on top of the defaults", () => {
    const styles = resolveStyles({ heading1: { fontSize: 44 } });
    expect(styles.heading1.fontSize).toBe(44);
    expect(styles.heading1.label).toBe("Heading 1");
  });

  it("drops values that could break out of the stylesheet", () => {
    const css = stylesToCss(
      resolveStyles({
        normal: { fontFamily: "x}body{display:none", color: "red;}*{x:y", fontSize: "12px}" },
      }),
      ".doc",
    );
    expect(css).not.toMatch(/display:none|x:y|font-size:12px/);
  });
});

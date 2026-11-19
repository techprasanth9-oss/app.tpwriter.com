import { describe, expect, it } from "vitest";
import { sanitizeAnchor, sanitizeImage } from "./sanitizers";

function el(html: string): Element {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstElementChild!;
}

describe("EditorJS sanitize rules", () => {
  it("keeps href only for allowed schemes", () => {
    expect(sanitizeAnchor(el('<a href="https://x.com">x</a>'))).toHaveProperty("href", true);
    expect(sanitizeAnchor(el('<a href="javascript:alert(1)">x</a>'))).not.toHaveProperty("href");
  });

  it("drops images with unsafe sources", () => {
    expect(sanitizeImage(el('<img src="/api/uploads/a.png">'))).toMatchObject({ src: true });
    expect(sanitizeImage(el('<img src="javascript:alert(1)">'))).toBe(false);
  });
});

describe("span sanitizing", () => {
  it("keeps typography and drops mso/positioning styles on plain spans", async () => {
    const { sanitizeSpan } = await import("./sanitizers");
    const span = el('<span style="mso-fareast-font-family:Calibri;font-size:14pt;position:fixed;color:#333">x</span>');
    sanitizeSpan(span);
    expect(span.getAttribute("style")).toBe("font-size: 14pt; color: #333");
    const chip = el('<span class="variable-chip" style="display:inline-block">X</span>');
    sanitizeSpan(chip);
    expect(chip.getAttribute("style")).toBe("display:inline-block");
  });

  it("load-time sanitizer filters span styles too", async () => {
    const { sanitizeHtml } = await import("./sanitizeData");
    expect(sanitizeHtml('<span style="font-size:12pt;mso-ansi-language:EN-US;top:0">t</span>')).toBe(
      '<span style="font-size: 12pt">t</span>',
    );
  });
});

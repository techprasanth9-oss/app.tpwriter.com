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

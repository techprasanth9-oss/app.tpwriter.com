import { describe, expect, it } from "vitest";
import { isSafeImageUrl, isSafeLinkUrl } from "./safeUrl";

describe("isSafeLinkUrl", () => {
  it.each([
    "https://example.com/a?b=1&c=2",
    "http://example.com",
    "mailto:a@b.co",
    "tel:+15551234",
    "#section-2",
    "/documents/1",
    "relative/path",
  ])("allows %s", (url) => expect(isSafeLinkUrl(url)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    " \tjavascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/x",
    "",
    null,
    undefined,
  ])("rejects %s", (url) => expect(isSafeLinkUrl(url)).toBe(false));
});

describe("isSafeImageUrl", () => {
  it.each([
    "https://cdn.example.com/a.png",
    "/api/uploads/abc.png",
    "blob:https://app.example.com/uuid",
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQ",
  ])("allows %s", (url) => expect(isSafeImageUrl(url)).toBe(true));

  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:text/html;base64,PHNjcmlwdD4=",
    "",
  ])("rejects %s", (url) => expect(isSafeImageUrl(url)).toBe(false));
});

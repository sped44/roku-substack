import { describe, expect, it } from "vitest";
import { escapeHtml, layout } from "./html.js";

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});

describe("layout", () => {
  it("wraps title and body", () => {
    const html = layout("Hello <x>", "<p>body</p>");
    expect(html).toContain("<title>Hello &lt;x&gt;</title>");
    expect(html).toContain("<p>body</p>");
    expect(html).toContain("<h1>Hello &lt;x&gt;</h1>");
  });
});

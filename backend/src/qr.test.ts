import { describe, expect, it } from "vitest";
import { renderPairQrPng } from "./qr.js";

describe("renderPairQrPng", () => {
  it("returns a PNG buffer", async () => {
    const png = await renderPairQrPng("https://companion.example/login?code=ABC123");
    expect(png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
    expect(png.length).toBeGreaterThan(100);
  });
});

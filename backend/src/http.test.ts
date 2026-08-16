import { describe, expect, it } from "vitest";
import { deviceTokenFrom, normalizePairCode, pairLoginUrl, pairQrUrl, publicBaseUrl } from "./http.js";

function mockReq(partial: {
  host?: string;
  protocol?: string;
  authorization?: string;
  query?: Record<string, string>;
}) {
  return {
    protocol: partial.protocol ?? "http",
    get: (name: string) => (name.toLowerCase() === "host" ? partial.host : undefined),
    header: (name: string) =>
      name.toLowerCase() === "authorization" ? partial.authorization : undefined,
    query: partial.query ?? {},
  };
}

describe("publicBaseUrl", () => {
  it("prefers PUBLIC_BASE_URL env", () => {
    const req = mockReq({ host: "ignored.example", protocol: "http" });
    expect(
      publicBaseUrl(req, "http://localhost:8080", "https://app.example.com/"),
    ).toBe("https://app.example.com");
  });

  it("uses request host when env is unset", () => {
    const req = mockReq({ host: "192.168.1.10:8080", protocol: "http" });
    expect(publicBaseUrl(req, "http://localhost:8080")).toBe(
      "http://192.168.1.10:8080",
    );
  });

  it("uses https when the request protocol is https", () => {
    const req = mockReq({ host: "example.com", protocol: "https" });
    expect(publicBaseUrl(req, "http://localhost:8080")).toBe("https://example.com");
  });

  it("falls back to configured base URL", () => {
    const req = mockReq({});
    expect(publicBaseUrl(req, "http://localhost:8080/")).toBe(
      "http://localhost:8080",
    );
  });
});

describe("deviceTokenFrom", () => {
  it("reads Bearer authorization", () => {
    const req = mockReq({ authorization: "Bearer abc123" });
    expect(deviceTokenFrom(req)).toBe("abc123");
  });

  it("reads token query param", () => {
    const req = mockReq({ query: { token: "from-query" } });
    expect(deviceTokenFrom(req)).toBe("from-query");
  });

  it("reads deviceToken query param", () => {
    const req = mockReq({ query: { deviceToken: "alt" } });
    expect(deviceTokenFrom(req)).toBe("alt");
  });

  it("returns null when missing", () => {
    expect(deviceTokenFrom(mockReq({}))).toBeNull();
  });
});

describe("normalizePairCode", () => {
  it("uppercases and strips separators", () => {
    expect(normalizePairCode("ab-c1 23")).toBe("ABC123");
  });
});

describe("pair URLs", () => {
  it("builds login and QR URLs from the public base", () => {
    expect(pairLoginUrl("https://app.example.com/", "ab-c123")).toBe(
      "https://app.example.com/login?code=ABC123",
    );
    expect(pairQrUrl("https://app.example.com", "abc123")).toBe(
      "https://app.example.com/api/pair/qr.png?code=ABC123",
    );
  });
});

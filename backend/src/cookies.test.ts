import { describe, expect, it } from "vitest";
import {
  cookieHeader,
  decrypt,
  decryptCookies,
  encrypt,
  encryptCookies,
  parseCookiePaste,
  parseSetCookieHeaders,
} from "./cookies.js";

const SECRET = "test-secret";

describe("encrypt/decrypt", () => {
  it("round-trips plaintext", () => {
    const payload = encrypt("hello", SECRET);
    expect(decrypt(payload, SECRET)).toBe("hello");
  });

  it("rejects short payloads", () => {
    expect(() => decrypt(Buffer.from("short").toString("base64"), SECRET)).toThrow(
      /too short/,
    );
  });

  it("rejects tampered payloads", () => {
    const payload = Buffer.from(encrypt("hello", SECRET), "base64");
    payload[30] = payload[30]! ^ 0xff;
    expect(() => decrypt(payload.toString("base64"), SECRET)).toThrow();
  });
});

describe("cookie envelopes", () => {
  it("round-trips session cookies", () => {
    const cookies = { connectSid: "s%3Aabc", substackSid: "s%3Adef" };
    const decoded = decryptCookies(encryptCookies(cookies, SECRET), SECRET);
    expect(decoded).toEqual(cookies);
  });

  it("falls back to substackSid when connectSid is missing after decrypt", () => {
    const payload = encrypt(JSON.stringify({ substackSid: "only" }), SECRET);
    expect(decryptCookies(payload, SECRET)).toEqual({
      connectSid: "only",
      substackSid: "only",
    });
  });

  it("rejects empty decrypted cookies", () => {
    const payload = encrypt(JSON.stringify({}), SECRET);
    expect(() => decryptCookies(payload, SECRET)).toThrow(/empty/);
  });
});

describe("cookieHeader", () => {
  it("joins present cookies", () => {
    expect(cookieHeader({ connectSid: "a", substackSid: "b" })).toBe(
      "connect.sid=a; substack.sid=b",
    );
    expect(cookieHeader({ connectSid: "a" })).toBe("connect.sid=a");
    expect(cookieHeader({ connectSid: "", substackSid: "b" })).toBe(
      "substack.sid=b",
    );
  });
});

describe("parseSetCookieHeaders", () => {
  it("extracts both cookies", () => {
    expect(
      parseSetCookieHeaders([
        "connect.sid=s%3Aaaa; Path=/; HttpOnly",
        "substack.sid=s%3Abbb; Path=/",
      ]),
    ).toEqual({ connectSid: "s%3Aaaa", substackSid: "s%3Abbb" });
  });

  it("uses substack.sid when connect.sid is missing", () => {
    expect(parseSetCookieHeaders(["substack.sid=legacy"])).toEqual({
      connectSid: "legacy",
      substackSid: "legacy",
    });
  });

  it("throws when neither cookie is present", () => {
    expect(() => parseSetCookieHeaders(["other=1"])).toThrow(/No session cookie/);
  });
});

describe("parseCookiePaste", () => {
  it("parses a raw sid", () => {
    expect(parseCookiePaste(" s%3Araw ")).toEqual({ connectSid: "s%3Araw" });
  });

  it("parses a cookie header string", () => {
    expect(
      parseCookiePaste("connect.sid=aaa; substack.sid=bbb"),
    ).toEqual({ connectSid: "aaa", substackSid: "bbb" });
  });

  it("parses JSON with camel or snake keys", () => {
    expect(
      parseCookiePaste(JSON.stringify({ connect_sid: "a", substack_sid: "b" })),
    ).toEqual({ connectSid: "a", substackSid: "b" });
    expect(parseCookiePaste(JSON.stringify({ connectSid: "c" }))).toEqual({
      connectSid: "c",
    });
  });

  it("rejects empty and empty JSON", () => {
    expect(() => parseCookiePaste("  ")).toThrow(/empty/);
    expect(() => parseCookiePaste("{}")).toThrow(/missing connect.sid/);
  });
});

import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const REQUIRED = {
  SESSION_SIGNING_KEY: "session-key",
  COOKIE_ENCRYPTION_KEY: "cookie-key",
};

describe("loadConfig", () => {
  it("loads required values and defaults", () => {
    const cfg = loadConfig({ ...REQUIRED });
    expect(cfg.port).toBe(8080);
    expect(cfg.baseUrl).toBe("http://localhost:8080");
    expect(cfg.projectId).toBe("roku-502821");
    expect(cfg.firestoreDatabaseId).toBe("roku-substack");
    expect(cfg.cacheTtlMs).toBe(15 * 60_000);
    expect(cfg.substackRequestDelayMs).toBe(250);
    expect(cfg.archiveLimit).toBe(15);
  });

  it("honors PORT, BASE_URL, and numeric overrides", () => {
    const cfg = loadConfig({
      ...REQUIRED,
      PORT: "9090",
      BASE_URL: "https://example.com/",
      GCP_PROJECT_ID: "my-project",
      FIRESTORE_DATABASE_ID: "custom-db",
      CACHE_TTL_MS: "1000",
      SUBSTACK_REQUEST_DELAY_MS: "0",
      ARCHIVE_LIMIT: "3",
    });
    expect(cfg.port).toBe(9090);
    expect(cfg.baseUrl).toBe("https://example.com");
    expect(cfg.projectId).toBe("my-project");
    expect(cfg.firestoreDatabaseId).toBe("custom-db");
    expect(cfg.cacheTtlMs).toBe(1000);
    expect(cfg.substackRequestDelayMs).toBe(0);
    expect(cfg.archiveLimit).toBe(3);
  });

  it("rejects missing secrets", () => {
    expect(() => loadConfig({})).toThrow(/SESSION_SIGNING_KEY/);
  });

  it("rejects REPLACE_ME placeholders", () => {
    expect(() =>
      loadConfig({
        ...REQUIRED,
        COOKIE_ENCRYPTION_KEY: "REPLACE_ME",
      }),
    ).toThrow(/COOKIE_ENCRYPTION_KEY/);
  });

  it("rejects invalid integers", () => {
    expect(() =>
      loadConfig({ ...REQUIRED, CACHE_TTL_MS: "nope" }),
    ).toThrow(/CACHE_TTL_MS/);
  });
});

import { describe, expect, it, vi } from "vitest";

const { FirestoreMock } = vi.hoisted(() => ({
  FirestoreMock: vi.fn(function FirestoreMock(
    this: { projectId?: string; databaseId?: string },
    opts?: { projectId: string; databaseId?: string },
  ) {
    this.projectId = opts?.projectId;
    this.databaseId = opts?.databaseId;
    return this;
  }),
}));

vi.mock("@google-cloud/firestore", async () => {
  const actual = await vi.importActual<typeof import("@google-cloud/firestore")>(
    "@google-cloud/firestore",
  );
  return { ...actual, Firestore: FirestoreMock };
});

import { Timestamp } from "@google-cloud/firestore";
import { Store, generatePairCode, userCookies } from "./store.js";
import type { SessionCookies } from "./cookies.js";
import { createMemoryDb } from "./memoryDb.js";

describe("generatePairCode", () => {
  it("returns a 6-character Crockford-like code", () => {
    const code = generatePairCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it("does not include ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairCode();
      expect(code).not.toMatch(/[01IO]/);
    }
  });
});

describe("userCookies", () => {
  it("decrypts via the provided function", () => {
    const cookies: SessionCookies = { connectSid: "x" };
    expect(
      userCookies(
        {
          encryptedCookies: "enc",
          updatedAt: Timestamp.now(),
        },
        (payload) => {
          expect(payload).toBe("enc");
          return cookies;
        },
      ),
    ).toEqual(cookies);
  });
});

describe("Store", () => {
  it("upserts user and reads them back", async () => {
    const store = new Store(createMemoryDb() as never);
    await store.upsertUser("user-1", { email: "a@example.com", name: "Ada" }, "enc");
    const user = await store.getUser("user-1");
    expect(user).toMatchObject({
      email: "a@example.com",
      name: "Ada",
      encryptedCookies: "enc",
    });
    expect(user?.updatedAt).toBeInstanceOf(Timestamp);
  });

  it("omits missing profile fields instead of writing undefined", async () => {
    const store = new Store(createMemoryDb() as never);
    await store.upsertUser("user-2", {}, "enc");
    const user = await store.getUser("user-2");
    expect(user).toMatchObject({ encryptedCookies: "enc" });
    expect(user).not.toHaveProperty("email");
    expect(user).not.toHaveProperty("name");
  });

  it("returns null for unknown users", async () => {
    const store = new Store(createMemoryDb() as never);
    await expect(store.getUser("nobody")).resolves.toBeNull();
  });

  it("starts a pending pairing", async () => {
    const store = new Store(createMemoryDb() as never);
    const before = Date.now();
    const { code, expiresAt } = await store.startPairing(5);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000 - 50);
    const pairing = await store.getPairing(code);
    expect(pairing?.status).toBe("pending");
  });

  it("expires pending pairings past expiresAt", async () => {
    const db = createMemoryDb();
    db.docs.set("pairings/ABC123", {
      code: "ABC123",
      status: "pending",
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
      expiresAt: Timestamp.fromMillis(Date.now() - 1_000),
    });
    const store = new Store(db as never);
    const result = await store.getPairing("abc123");
    expect(result?.status).toBe("expired");
    expect(db.docs.get("pairings/ABC123")).toMatchObject({ status: "expired" });
  });

  it("returns null for unknown pairing codes", async () => {
    const store = new Store(createMemoryDb() as never);
    await expect(store.getPairing("ZZZZZZ")).resolves.toBeNull();
  });

  it("claims a pairing and creates a device", async () => {
    const store = new Store(createMemoryDb() as never);
    const { code } = await store.startPairing();
    const { deviceToken } = await store.claimPairing(code.toLowerCase(), "user-1");
    expect(deviceToken).toMatch(/^[a-f0-9]{48}$/);
    const pairing = await store.getPairing(code);
    expect(pairing).toMatchObject({ status: "linked", userId: "user-1", deviceToken });
    const device = await store.getDevice(deviceToken);
    expect(device).toMatchObject({ userId: "user-1" });
  });

  it("rejects claim for unknown, expired, and already-linked codes", async () => {
    const db = createMemoryDb();
    const store = new Store(db as never);
    await expect(store.claimPairing("MISSING", "user-1")).rejects.toThrow(
      /Unknown pairing code/,
    );
    db.docs.set("pairings/EXPIRED", {
      code: "EXPIRED",
      status: "pending",
      createdAt: Timestamp.fromMillis(Date.now() - 60_000),
      expiresAt: Timestamp.fromMillis(Date.now() - 1_000),
    });
    await expect(store.claimPairing("EXPIRED", "user-1")).rejects.toThrow(/expired/i);
    db.docs.set("pairings/LINKED", {
      code: "LINKED",
      status: "linked",
      userId: "other",
      deviceToken: "tok",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    await expect(store.claimPairing("LINKED", "user-1")).rejects.toThrow(/already used/i);
  });

  it("rejects claim when status is expired even if expiresAt is future", async () => {
    const db = createMemoryDb();
    db.docs.set("pairings/STALE", {
      code: "STALE",
      status: "expired",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    const store = new Store(db as never);
    await expect(store.claimPairing("STALE", "user-1")).rejects.toThrow(/expired/i);
  });

  it("returns null for unknown devices", async () => {
    const store = new Store(createMemoryDb() as never);
    await expect(store.getDevice("missing")).resolves.toBeNull();
  });

  it("stores cache until TTL expires", async () => {
    const store = new Store(createMemoryDb() as never);
    const now = 1_000_000;
    await store.setCache("home:1", { ok: true }, 1000, now);
    await expect(store.getCache("home:1", now + 500)).resolves.toEqual({ ok: true });
    await expect(store.getCache("home:1", now + 1001)).resolves.toBeNull();
    await expect(store.getCache("missing", now)).resolves.toBeNull();
  });

  it("constructs Firestore from a project id string", () => {
    FirestoreMock.mockClear();
    new Store("roku-test", "roku-substack");
    expect(FirestoreMock).toHaveBeenCalledWith({
      projectId: "roku-test",
      databaseId: "roku-substack",
      ignoreUndefinedProperties: true,
    });
  });
});

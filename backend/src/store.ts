import crypto from "node:crypto";
import { Firestore, Timestamp } from "@google-cloud/firestore";
import { normalizePairCode } from "./http.js";
import type { SessionCookies } from "./cookies.js";

export type UserRecord = {
  email?: string;
  name?: string;
  encryptedCookies: string;
  updatedAt: Timestamp;
};

export type PairingRecord = {
  code: string;
  status: "pending" | "linked" | "expired";
  userId?: string;
  deviceToken?: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

export type DeviceRecord = {
  userId: string;
  createdAt: Timestamp;
};

export type CacheRecord = {
  payload: unknown;
  expiresAt: Timestamp;
};

export class Store {
  private db: Firestore;

  constructor(
    projectIdOrDb: string | Firestore,
    databaseId = "roku-substack",
  ) {
    this.db =
      typeof projectIdOrDb === "string"
        ? new Firestore({
            projectId: projectIdOrDb,
            databaseId,
            ignoreUndefinedProperties: true,
          })
        : projectIdOrDb;
  }

  async upsertUser(
    userId: string,
    profile: { email?: string; name?: string },
    encryptedCookies: string,
  ): Promise<void> {
    const record: UserRecord = {
      encryptedCookies,
      updatedAt: Timestamp.now(),
    };
    if (profile.email) {
      record.email = profile.email;
    }
    if (profile.name) {
      record.name = profile.name;
    }
    await this.db.collection("users").doc(userId).set(record, { merge: true });
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const snap = await this.db.collection("users").doc(userId).get();
    return snap.exists ? (snap.data() as UserRecord) : null;
  }

  async startPairing(ttlMinutes = 10): Promise<{ code: string; expiresAt: Date }> {
    const code = generatePairCode();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const record: PairingRecord = {
      code,
      status: "pending",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromDate(expiresAt),
    };
    await this.db.collection("pairings").doc(code).set(record);
    return { code, expiresAt };
  }

  async getPairing(code: string): Promise<PairingRecord | null> {
    const snap = await this.db.collection("pairings").doc(normalizePairCode(code)).get();
    if (!snap.exists) {
      return null;
    }
    const record = snap.data() as PairingRecord;
    if (
      record.status === "pending" &&
      record.expiresAt.toMillis() < Date.now()
    ) {
      await snap.ref.set({ status: "expired" }, { merge: true });
      return { ...record, status: "expired" };
    }
    return record;
  }

  async claimPairing(
    code: string,
    userId: string,
  ): Promise<{ deviceToken: string }> {
    const normalized = normalizePairCode(code);
    const ref = this.db.collection("pairings").doc(normalized);
    const deviceToken = crypto.randomBytes(24).toString("hex");

    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new Error("Unknown pairing code");
      }
      const record = snap.data() as PairingRecord;
      if (record.status === "expired" || record.expiresAt.toMillis() < Date.now()) {
        throw new Error("Pairing code expired");
      }
      if (record.status === "linked") {
        throw new Error("Pairing code already used");
      }
      tx.set(
        ref,
        {
          status: "linked",
          userId,
          deviceToken,
        },
        { merge: true },
      );
      tx.set(this.db.collection("devices").doc(deviceToken), {
        userId,
        createdAt: Timestamp.now(),
      } satisfies DeviceRecord);
    });

    return { deviceToken };
  }

  async getDevice(deviceToken: string): Promise<DeviceRecord | null> {
    const snap = await this.db.collection("devices").doc(deviceToken).get();
    return snap.exists ? (snap.data() as DeviceRecord) : null;
  }

  async getCache<T>(key: string, now = Date.now()): Promise<T | null> {
    const snap = await this.db.collection("cache").doc(key).get();
    if (!snap.exists) {
      return null;
    }
    const record = snap.data() as CacheRecord;
    if (record.expiresAt.toMillis() < now) {
      return null;
    }
    return record.payload as T;
  }

  async setCache(key: string, payload: unknown, ttlMs: number, now = Date.now()): Promise<void> {
    const record: CacheRecord = {
      payload,
      expiresAt: Timestamp.fromMillis(now + ttlMs),
    };
    await this.db.collection("cache").doc(key).set(record);
  }
}

export function generatePairCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i]! % alphabet.length];
  }
  return code;
}

export function userCookies(
  user: UserRecord,
  decrypt: (payload: string) => SessionCookies,
): SessionCookies {
  return decrypt(user.encryptedCookies);
}

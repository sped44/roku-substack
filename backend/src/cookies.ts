import crypto from "node:crypto";

export type SessionCookies = {
  connectSid: string;
  substackSid?: string;
};

export function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(payload: string, secret: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 29) {
    throw new Error("Encrypted payload is too short");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function encryptCookies(cookies: SessionCookies, secret: string): string {
  return encrypt(JSON.stringify(cookies), secret);
}

export function decryptCookies(payload: string, secret: string): SessionCookies {
  const parsed = JSON.parse(decrypt(payload, secret)) as Partial<SessionCookies>;
  if (!parsed.connectSid && !parsed.substackSid) {
    throw new Error("Decrypted cookies are empty");
  }
  return {
    connectSid: parsed.connectSid || parsed.substackSid || "",
    substackSid: parsed.substackSid,
  };
}

export function cookieHeader(cookies: SessionCookies): string {
  const parts: string[] = [];
  if (cookies.connectSid) {
    parts.push(`connect.sid=${cookies.connectSid}`);
  }
  if (cookies.substackSid) {
    parts.push(`substack.sid=${cookies.substackSid}`);
  }
  return parts.join("; ");
}

export function parseSetCookieHeaders(headers: string[]): SessionCookies {
  let connectSid = "";
  let substackSid = "";
  for (const header of headers) {
    const match = /^(connect\.sid|substack\.sid)=([^;]+)/i.exec(header.trim());
    if (!match) {
      continue;
    }
    const name = match[1]!.toLowerCase();
    const value = match[2]!;
    if (name === "connect.sid") {
      connectSid = value;
    } else {
      substackSid = value;
    }
  }
  if (!connectSid && !substackSid) {
    throw new Error("No session cookie in response");
  }
  return {
    connectSid: connectSid || substackSid,
    substackSid: substackSid || undefined,
  };
}

/** Accept a raw sid, Cookie header, or JSON blob from the paste form. */
export function parseCookiePaste(raw: string): SessionCookies {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Cookie value is empty");
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Partial<SessionCookies> & {
      connect_sid?: string;
      substack_sid?: string;
    };
    const connectSid = parsed.connectSid || parsed.connect_sid || "";
    const substackSid = parsed.substackSid || parsed.substack_sid;
    if (!connectSid && !substackSid) {
      throw new Error("JSON cookie paste is missing connect.sid");
    }
    return { connectSid: connectSid || substackSid || "", substackSid };
  }
  if (trimmed.includes("=")) {
    const headers = trimmed.split(";").map((part) => part.trim());
    return parseSetCookieHeaders(headers);
  }
  return { connectSid: trimmed };
}

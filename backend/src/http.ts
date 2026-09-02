/** Minimal request shape for building public origins (avoids Express `get` overloads). */
export type HostRequest = {
  protocol: string;
  get: (name: string) => string | undefined;
};

export type AuthRequest = {
  header: (name: string) => string | undefined;
  query: Record<string, unknown>;
};

/** Public origin for companion URLs returned to clients. */
export function publicBaseUrl(
  req: HostRequest,
  fallbackBaseUrl: string,
  envPublicBaseUrl?: string,
): string {
  const fromEnv = envPublicBaseUrl?.trim().replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }
  const host = req.get("host");
  if (host) {
    const proto = req.protocol === "https" ? "https" : "http";
    return `${proto}://${host}`;
  }
  return fallbackBaseUrl.replace(/\/$/, "");
}

export function deviceTokenFrom(req: AuthRequest): string | null {
  const header = req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const q = req.query.token ?? req.query.deviceToken;
  return q ? String(q) : null;
}

export function normalizePairCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function pairLoginUrl(base: string, code: string): string {
  const normalized = normalizePairCode(code);
  return `${base.replace(/\/$/, "")}/login?code=${encodeURIComponent(normalized)}`;
}

export function pairQrUrl(base: string, code: string): string {
  const normalized = normalizePairCode(code);
  return `${base.replace(/\/$/, "")}/api/pair/qr.png?code=${encodeURIComponent(normalized)}`;
}

export function truthyQueryParam(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => truthyQueryParam(item));
  }
  if (value && typeof value === "object") {
    return false;
  }
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

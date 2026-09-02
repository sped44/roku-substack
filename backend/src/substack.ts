import { cookieHeader, parseSetCookieHeaders, type SessionCookies } from "./cookies.js";

export const SUBSTACK_ORIGIN = "https://substack.com";
export const SUBSTACK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
export const ARCHIVE_PAGE_SIZE = 50;

export function archiveUrl(host: string, offset = 0): string {
  const params = new URLSearchParams({
    sort: "new",
    limit: String(ARCHIVE_PAGE_SIZE),
    offset: String(offset),
  });
  return `https://${host}/api/v1/archive?${params.toString()}`;
}

export type SubstackProfile = {
  id: string;
  email?: string;
  name?: string;
};

export type Publication = {
  id: string;
  name: string;
  subdomain: string;
  host: string;
  logoUrl?: string;
  authorName?: string;
};

export type RawPost = {
  id?: number | string;
  title?: string;
  subtitle?: string;
  slug?: string;
  type?: string;
  audience?: string;
  post_date?: string;
  published_at?: string;
  cover_image?: string;
  podcast_url?: string;
  video_upload_id?: string;
  videoUpload?: { id?: string };
  canonical_url?: string;
  publication_id?: number | string;
};

export type SubstackClient = {
  requestEmailLogin(email: string): Promise<void>;
  completeEmailOtp(email: string, code: string): Promise<SessionCookies>;
  fetchProfile(cookies: SessionCookies): Promise<SubstackProfile>;
  fetchSubscriptions(cookies: SessionCookies): Promise<Publication[]>;
  fetchArchive(host: string, cookies: SessionCookies): Promise<RawPost[]>;
  resolveVideoSrc(host: string, uploadId: string, cookies: SessionCookies): Promise<string>;
};

type FetchLike = typeof fetch;

export class HttpSubstackClient implements SubstackClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async requestEmailLogin(email: string): Promise<void> {
    const res = await this.fetchImpl(`${SUBSTACK_ORIGIN}/api/v1/email-login`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        email,
        redirect: "/",
        can_create_user: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`email-login failed: ${res.status} ${await res.text()}`);
    }
  }

  async completeEmailOtp(email: string, code: string): Promise<SessionCookies> {
    const res = await this.fetchImpl(
      `${SUBSTACK_ORIGIN}/api/v1/email-otp-login/complete`,
      {
        method: "POST",
        headers: jsonHeaders({
          Origin: SUBSTACK_ORIGIN,
          Referer: `${SUBSTACK_ORIGIN}/`,
        }),
        body: JSON.stringify({
          code,
          email,
          redirect: "https://substack.com/",
        }),
        redirect: "manual",
      },
    );
    const text = await res.text();
    if (!res.ok && res.status !== 302 && res.status !== 303) {
      throw new Error(`email-otp-login failed: ${res.status} ${text}`);
    }
    if (looksLikeChallenge(text)) {
      throw new Error(
        "email-otp-login failed: Substack requested a CAPTCHA. Use cookie paste.",
      );
    }
    return cookiesFromResponse(res);
  }

  async fetchProfile(cookies: SessionCookies): Promise<SubstackProfile> {
    const res = await this.authedGet(
      `${SUBSTACK_ORIGIN}/api/v1/user/profile/self`,
      cookies,
    );
    const json = (await res.json()) as {
      id?: number | string;
      email?: string;
      name?: string;
    };
    if (json.id === undefined || json.id === null) {
      throw new Error("profile/self missing id");
    }
    return {
      id: String(json.id),
      email: json.email,
      name: json.name,
    };
  }

  async fetchSubscriptions(cookies: SessionCookies): Promise<Publication[]> {
    const res = await this.authedGet(
      `${SUBSTACK_ORIGIN}/api/v1/subscriptions?tvOnly=false`,
      cookies,
    );
    return normalizeSubscriptions(await res.json());
  }

  async fetchArchive(host: string, cookies: SessionCookies): Promise<RawPost[]> {
    const firstRes = await this.authedGet(archiveUrl(host, 0), cookies);
    const first = normalizeArchive(await firstRes.json());
    if (first.length < ARCHIVE_PAGE_SIZE) {
      return first;
    }
    const secondRes = await this.authedGet(archiveUrl(host, ARCHIVE_PAGE_SIZE), cookies);
    return first.concat(normalizeArchive(await secondRes.json()));
  }

  async resolveVideoSrc(
    host: string,
    uploadId: string,
    cookies: SessionCookies,
  ): Promise<string> {
    const res = await this.fetchImpl(
      `https://${host}/api/v1/video/upload/${encodeURIComponent(uploadId)}/src?type=hls`,
      {
        headers: authHeaders(cookies),
        redirect: "follow",
      },
    );
    if (!res.ok) {
      throw new Error(videoSrcFailureMessage(res.status, await res.text()));
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const json = (await res.json()) as { url?: string; src?: string };
      const url = json.url || json.src;
      if (!url) {
        throw new Error("video src JSON missing url");
      }
      return url;
    }
    return res.url;
  }

  private async authedGet(url: string, cookies: SessionCookies): Promise<Response> {
    const res = await this.fetchImpl(url, { headers: authHeaders(cookies) });
    if (!res.ok) {
      throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  }
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": SUBSTACK_USER_AGENT,
    ...extra,
  };
}

export function looksLikeChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("cf-challenge") ||
    /"error"\s*:\s*"(captcha|challenge)/i.test(trimmed)
  );
}

function authHeaders(cookies: SessionCookies): Record<string, string> {
  return {
    Cookie: cookieHeader(cookies),
    Accept: "application/json",
    "User-Agent": SUBSTACK_USER_AGENT,
  };
}

export function cookiesFromResponse(res: Response): SessionCookies {
  const headers: string[] = [];
  const getSetCookie = (
    res.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === "function") {
    headers.push(...getSetCookie.call(res.headers));
  }
  if (headers.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) {
      headers.push(single);
    }
  }
  return parseSetCookieHeaders(headers);
}

export function publicationHost(pub: {
  subdomain?: string;
  custom_domain?: string;
  hostname?: string;
}): string {
  if (pub.custom_domain) {
    return pub.custom_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  if (pub.hostname) {
    return pub.hostname.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  const subdomain = pub.subdomain?.trim();
  if (!subdomain) {
    throw new Error("Publication missing subdomain");
  }
  return `${subdomain}.substack.com`;
}

export function normalizeSubscriptions(json: unknown): Publication[] {
  if (Array.isArray(json)) {
    return json.flatMap((item) => publicationFromUnknown(item)).filter(isPublication);
  }
  if (!json || typeof json !== "object") {
    return [];
  }
  const obj = json as {
    publications?: unknown[];
    subscriptions?: unknown[];
  };
  const fromPubs = (obj.publications ?? []).flatMap((item) =>
    publicationFromUnknown(item),
  );
  if (fromPubs.length > 0) {
    return fromPubs.filter(isPublication);
  }
  return (obj.subscriptions ?? [])
    .flatMap((item) => publicationFromUnknown(item))
    .filter(isPublication);
}

export function jsonErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error.trim() : "";
  } catch {
    return "";
  }
}

export function isPaidSubscriberOnlyMessage(text: string): boolean {
  return /paid subscribers? only/i.test(text);
}

export function videoSrcFailureMessage(status: number, body: string): string {
  const remote = jsonErrorMessage(body);
  if (isPaidSubscriberOnlyMessage(remote) || isPaidSubscriberOnlyMessage(body)) {
    return "This video is for paid subscribers only";
  }
  return `video src failed: ${status}`;
}

export function normalizeArchive(json: unknown): RawPost[] {
  if (Array.isArray(json)) {
    return json as RawPost[];
  }
  if (!json || typeof json !== "object") {
    return [];
  }
  const obj = json as { posts?: unknown; archive?: unknown };
  if (Array.isArray(obj.posts)) {
    return obj.posts as RawPost[];
  }
  if (Array.isArray(obj.archive)) {
    return obj.archive as RawPost[];
  }
  return [];
}

function publicationFromUnknown(item: unknown): Publication[] {
  if (!item || typeof item !== "object") {
    return [];
  }
  const rec = item as Record<string, unknown>;
  const nested = rec.publication;
  if (nested && typeof nested === "object") {
    return publicationFromUnknown(nested);
  }
  const id = rec.id;
  const name = rec.name;
  const subdomain = rec.subdomain;
  if (id === undefined || typeof name !== "string" || typeof subdomain !== "string") {
    return [];
  }
  try {
    return [
      {
        id: String(id),
        name,
        subdomain,
        host: publicationHost({
          subdomain,
          custom_domain: optionalString(rec.custom_domain),
          hostname: optionalString(rec.hostname),
        }),
        logoUrl: optionalString(rec.logo_url) ?? optionalString(rec.logoUrl),
        authorName: optionalString(rec.author_name) ?? optionalString(rec.authorName),
      },
    ];
  } catch {
    return [];
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isPublication(value: Publication | undefined): value is Publication {
  return Boolean(value);
}

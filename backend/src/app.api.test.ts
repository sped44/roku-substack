import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { encryptCookies } from "./cookies.js";
import { Store } from "./store.js";
import { createMemoryDb } from "./memoryDb.js";
import type { SubstackClient } from "./substack.js";
import type { CatalogItem } from "./catalog.js";

const cfg = loadConfig({
  SESSION_SIGNING_KEY: "session-key",
  COOKIE_ENCRYPTION_KEY: "cookie-key",
  CACHE_TTL_MS: "60000",
  SUBSTACK_REQUEST_DELAY_MS: "0",
  ARCHIVE_LIMIT: "10",
});

function fakeClient(overrides: Partial<SubstackClient> = {}): SubstackClient {
  return {
    requestEmailLogin: vi.fn(async () => undefined),
    completeEmailOtp: vi.fn(async () => ({ connectSid: "sid" })),
    fetchProfile: vi.fn(async () => ({
      id: "user-1",
      email: "a@example.com",
      name: "Ada",
    })),
    fetchSubscriptions: vi.fn(async () => [
      {
        id: "10",
        name: "Atlas",
        subdomain: "atlas",
        host: "atlas.substack.com",
        logoUrl: "https://img/logo",
        authorName: "Ada",
      },
    ]),
    fetchArchive: vi.fn(async () => [
      {
        id: 1,
        title: "Video post",
        video_upload_id: "up1",
        cover_image: "https://img/v",
        post_date: "2026-02-01",
      },
      {
        id: 2,
        title: "Audio post",
        podcast_url: "https://cdn.example/a.mp3",
        post_date: "2026-03-01",
      },
      { id: 3, title: "Text only" },
    ]),
    resolveVideoSrc: vi.fn(async () => "https://cdn.example/v.m3u8"),
    ...overrides,
  };
}

async function listen(store: Store, client: SubstackClient) {
  const app = createApp({
    cfg,
    store,
    substack: client,
    sleepFn: async () => undefined,
    publicBaseUrlEnv: "https://companion.example",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function jarFrom(res: Response): string {
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  return raw
    .filter(Boolean)
    .map((header) => header.split(";")[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

async function json(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, body, headers: res.headers };
}

describe("companion API", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (closers.length) {
      await closers.pop()!();
    }
  });

  async function boot(client: SubstackClient = fakeClient()) {
    const store = new Store(createMemoryDb() as never);
    const harness = await listen(store, client);
    closers.push(harness.close);
    return { store, client, ...harness };
  }

  it("serves healthz and home HTML", async () => {
    const { url } = await boot();
    const health = await json(`${url}/healthz`);
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true });
    const home = await fetch(`${url}/`);
    const html = await home.text();
    expect(html).toContain("Sign in with email code");
    expect(html).toContain("Paste session cookie");
  });

  it("runs email OTP login without calling Substack email-login", async () => {
    const client = fakeClient();
    const { url } = await boot(client);
    const loginPage = await fetch(`${url}/login`);
    const loginHtml = await loginPage.text();
    expect(loginHtml).toContain("Continue");
    expect(loginHtml).toContain("substack.com/sign-in");

    const missing = await fetch(`${url}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=",
    });
    expect(missing.status).toBe(400);

    const send = await fetch(`${url}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "email=a%40example.com",
    });
    expect(send.status).toBe(302);
    expect(client.requestEmailLogin).not.toHaveBeenCalled();
    const cookie = jarFrom(send);

    const otpPage = await fetch(`${url}/login/otp`, { headers: { cookie } });
    const otpHtml = await otpPage.text();
    expect(otpHtml).toContain("a@example.com");
    expect(otpHtml).toContain("substack.com/sign-in");

    const emptyOtp = await fetch(`${url}/login/otp`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: "code=",
    });
    expect(emptyOtp.status).toBe(400);

    const otp = await fetch(`${url}/login/otp`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "code=123456",
    });
    expect(otp.status).toBe(302);
    expect(otp.headers.get("location")).toBe("/link");
    expect(client.completeEmailOtp).toHaveBeenCalled();
  });

  it("auto-claims a TV pairing from /login?code= after OTP", async () => {
    const client = fakeClient();
    const { url } = await boot(client);
    const start = await json(`${url}/api/pair/start`, { method: "POST" });
    const code = (start.body as { code: string }).code;

    const unknownLogin = await fetch(`${url}/login?code=ZZZZZZ`);
    expect(unknownLogin.status).toBe(400);

    const scan = await fetch(`${url}/login?code=${code}`);
    expect(scan.status).toBe(200);
    let cookie = jarFrom(scan);

    const send = await fetch(`${url}/login`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "email=a%40example.com",
    });
    cookie = jarFrom(send) || cookie;

    const otp = await fetch(`${url}/login/otp`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "code=123456",
    });
    expect(otp.status).toBe(302);
    expect(otp.headers.get("location")).toBe("/linked");
    cookie = jarFrom(otp) || cookie;

    const linkedPage = await fetch(`${url}/linked`, { headers: { cookie } });
    expect(await linkedPage.text()).toContain("TV linked");

    const status = await json(`${url}/api/pair/status?code=${code}`);
    expect(status.body).toMatchObject({ status: "linked" });
  });

  it("auto-claims from cookie paste when a pair code is pending", async () => {
    const { url } = await boot();
    const start = await json(`${url}/api/pair/start`, { method: "POST" });
    const code = (start.body as { code: string }).code;
    const scan = await fetch(`${url}/login?code=${code}`);
    const cookie = jarFrom(scan);
    const save = await fetch(`${url}/cookie`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "cookie=connect.sid%3Dabc",
    });
    expect(save.status).toBe(302);
    expect(save.headers.get("location")).toBe("/linked");
  });

  it("claims immediately when already signed in and scanning a QR code", async () => {
    const { url } = await boot();
    const login = await fetch(`${url}/cookie`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "cookie=connect.sid%3Dabc",
    });
    const cookie = jarFrom(login);
    const start = await json(`${url}/api/pair/start`, { method: "POST" });
    const code = (start.body as { code: string }).code;
    const scan = await fetch(`${url}/login?code=${code}`, {
      headers: { cookie },
      redirect: "manual",
    });
    expect(scan.status).toBe(302);
    expect(scan.headers.get("location")).toBe("/linked");
  });

  it("redirects OTP pages without pending email", async () => {
    const { url } = await boot();
    const page = await fetch(`${url}/login/otp`, { redirect: "manual" });
    expect(page.status).toBe(302);
    const post = await fetch(`${url}/login/otp`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "code=1",
    });
    expect(post.status).toBe(302);
  });

  it("accepts cookie paste and shows link page", async () => {
    const { url } = await boot();
    const form = await fetch(`${url}/cookie`);
    expect(await form.text()).toContain("connect.sid");
    const save = await fetch(`${url}/cookie`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "cookie=connect.sid%3Dabc",
    });
    expect(save.status).toBe(302);
    const sessionCookie = jarFrom(save);
    const link = await fetch(`${url}/link`, { headers: { cookie: sessionCookie } });
    expect(await link.text()).toContain("Link Roku");
    const loggedHome = await fetch(`${url}/`, { headers: { cookie: sessionCookie } });
    expect(await loggedHome.text()).toContain("signed in");
    const loginWhenIn = await fetch(`${url}/login`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    expect(loginWhenIn.status).toBe(302);
    const cookieWhenIn = await fetch(`${url}/cookie`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    expect(cookieWhenIn.status).toBe(302);
    const logout = await fetch(`${url}/logout`, {
      headers: { cookie: sessionCookie },
      redirect: "manual",
    });
    expect(logout.status).toBe(302);
  });

  it("pairs a device and serves home, posts, and play URLs", async () => {
    const client = fakeClient();
    const { url } = await boot(client);

    const start = await json(`${url}/api/pair/start`, { method: "POST" });
    expect(start.status).toBe(200);
    const started = start.body as {
      code: string;
      claimUrl: string;
      qrUrl: string;
    };
    const code = started.code;
    expect(started.claimUrl).toBe(`https://companion.example/login?code=${code}`);
    expect(started.qrUrl).toBe(
      `https://companion.example/api/pair/qr.png?code=${code}`,
    );

    const qr = await fetch(started.qrUrl.replace("https://companion.example", url));
    expect(qr.status).toBe(200);
    expect(qr.headers.get("content-type")).toMatch(/image\/png/);
    const qrBytes = Buffer.from(await qr.arrayBuffer());
    expect(qrBytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(
      true,
    );

    const missingQr = await fetch(`${url}/api/pair/qr.png`);
    expect(missingQr.status).toBe(400);
    const unknownQr = await fetch(`${url}/api/pair/qr.png?code=ZZZZZZ`);
    expect(unknownQr.status).toBe(404);

    const pending = await json(`${url}/api/pair/status?code=${code}`);
    expect((pending.body as { status: string }).status).toBe("pending");

    const missingCode = await json(`${url}/api/pair/status`);
    expect(missingCode.status).toBe(400);
    const unknown = await json(`${url}/api/pair/status?code=ZZZZZZ`);
    expect(unknown.status).toBe(404);

    const unauthClaim = await json(`${url}/api/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(unauthClaim.status).toBe(401);

    const login = await fetch(`${url}/cookie`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "cookie=connect.sid%3Dabc",
    });
    const sessionCookie = jarFrom(login);

    const emptyClaim = await json(`${url}/api/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ code: "" }),
    });
    expect(emptyClaim.status).toBe(400);

    const claim = await json(`${url}/api/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ code: code.toLowerCase() }),
    });
    expect(claim.status).toBe(200);
    const deviceToken = (claim.body as { deviceToken: string }).deviceToken;

    const linked = await json(`${url}/api/pair/status?code=${code}`);
    expect(linked.body).toMatchObject({ status: "linked", deviceToken });

    const noToken = await json(`${url}/api/home`);
    expect(noToken.status).toBe(401);
    const noTokenPosts = await json(`${url}/api/publications/10/posts`);
    expect(noTokenPosts.status).toBe(401);
    const noTokenPlay = await json(`${url}/api/posts/${encodeURIComponent("10:1")}/play`);
    expect(noTokenPlay.status).toBe(401);
    const badToken = await json(`${url}/api/home`, {
      headers: { Authorization: "Bearer deadbeef" },
    });
    expect(badToken.status).toBe(401);

    const home = await json(`${url}/api/home`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(home.status).toBe(200);
    const payload = home.body as {
      recentVideo: CatalogItem[];
      recentAudio: CatalogItem[];
      subscriptions: CatalogItem[];
    };
    expect(payload.recentVideo[0]?.title).toBe("Video post");
    expect(payload.recentAudio[0]?.title).toBe("Audio post");
    expect(payload.subscriptions[0]?.title).toBe("Atlas");

    const homeAgain = await json(`${url}/api/home`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(homeAgain.status).toBe(200);
    expect(client.fetchSubscriptions).toHaveBeenCalledTimes(1);

    const posts = await json(`${url}/api/publications/10/posts`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(posts.status).toBe(200);
    expect((posts.body as { posts: CatalogItem[] }).posts).toHaveLength(2);
    expect((posts.body as { posts: CatalogItem[] }).posts.every((item) => item.playable)).toBe(true);

    const missingPub = await json(`${url}/api/publications/999/posts`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(missingPub.status).toBe(404);

    const videoPlay = await json(`${url}/api/posts/${encodeURIComponent("10:1")}/play`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(videoPlay.body).toMatchObject({
      streamFormat: "hls",
      url: "https://cdn.example/v.m3u8",
    });

    const audioPlay = await json(`${url}/api/posts/${encodeURIComponent("10:2")}/play?token=${deviceToken}`);
    expect(audioPlay.body).toMatchObject({
      streamFormat: "mp3",
      url: "https://cdn.example/a.mp3",
    });

    const badId = await json(`${url}/api/posts/nocolon/play`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(badId.status).toBe(400);

    const unknownPost = await json(`${url}/api/posts/${encodeURIComponent("10:999")}/play`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(unknownPost.status).toBe(404);

    const unknownPubPlay = await json(
      `${url}/api/posts/${encodeURIComponent("99:1")}/play`,
      { headers: { Authorization: `Bearer ${deviceToken}` } },
    );
    expect(unknownPubPlay.status).toBe(404);
  });

  it("searches cached posts and maps paid-subscriber play errors", async () => {
    const client = fakeClient({
      resolveVideoSrc: vi.fn(async () => {
        throw new Error("This video is for paid subscribers only");
      }),
    });
    const { url, store } = await boot(client);
    await store.upsertUser(
      "user-1",
      { email: "a@example.com" },
      encryptCookies({ connectSid: "sid" }, cfg.cookieEncryptionKey),
    );
    const { code } = await store.startPairing();
    const { deviceToken } = await store.claimPairing(code, "user-1");
    const auth = { Authorization: `Bearer ${deviceToken}` };

    const missing = await json(`${url}/api/search`, { headers: auth });
    expect(missing.status).toBe(400);
    const unauth = await json(`${url}/api/search?q=video`);
    expect(unauth.status).toBe(401);

    const found = await json(`${url}/api/search?q=video`, { headers: auth });
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({
      query: "video",
      results: [{ title: "Video post", playable: true }],
    });

    const none = await json(`${url}/api/search?q=zzzz`, { headers: auth });
    expect(none.body).toMatchObject({ query: "zzzz", results: [] });

    const paid = await json(`${url}/api/posts/${encodeURIComponent("10:1")}/play`, {
      headers: auth,
    });
    expect(paid.status).toBe(403);
    expect(paid.body).toEqual({ error: "This video is for paid subscribers only" });
  });

  it("returns 502 when Substack catalog calls fail", async () => {
    const client = fakeClient({
      fetchSubscriptions: vi.fn(async () => {
        throw new Error("substack down");
      }),
    });
    const { url, store } = await boot(client);
    await store.upsertUser(
      "user-1",
      { email: "a@example.com" },
      encryptCookies({ connectSid: "sid" }, cfg.cookieEncryptionKey),
    );
    const { code } = await store.startPairing();
    const { deviceToken } = await store.claimPairing(code, "user-1");
    const home = await json(`${url}/api/home`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    expect(home.status).toBe(502);
    expect(home.body).toMatchObject({ error: "substack down" });
  });

  it("renders HTML errors for failed OTP complete", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient({
      completeEmailOtp: vi.fn(async () => {
        throw new Error("captcha");
      }),
    });
    const { url } = await boot(client);
    const send = await fetch(`${url}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "email=a%40example.com",
    });
    const cookie = jarFrom(send);
    const res = await fetch(`${url}/login/otp`, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
      },
      body: "code=000000",
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("captcha");
    expect(html).toContain("cookie paste");

    const jsonErr = await json(`${url}/login/otp`, {
      method: "POST",
      headers: {
        cookie,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "code=000000",
    });
    expect(jsonErr.status).toBe(500);
    expect(jsonErr.body).toMatchObject({ error: "captcha" });
    errorSpy.mockRestore();
  });

  it("requires login to view /link", async () => {
    const { url } = await boot();
    const res = await fetch(`${url}/link`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});

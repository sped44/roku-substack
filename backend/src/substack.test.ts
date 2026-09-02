import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVE_PAGE_SIZE,
  HttpSubstackClient,
  archiveUrl,
  cookiesFromResponse,
  normalizeArchive,
  normalizeSubscriptions,
  publicationHost,
} from "./substack.js";

describe("archiveUrl", () => {
  it("requests newest posts with a page size of 50", () => {
    expect(archiveUrl("a.substack.com")).toBe(
      "https://a.substack.com/api/v1/archive?sort=new&limit=50&offset=0",
    );
    expect(archiveUrl("a.substack.com", ARCHIVE_PAGE_SIZE)).toBe(
      "https://a.substack.com/api/v1/archive?sort=new&limit=50&offset=50",
    );
  });
});

describe("publicationHost", () => {
  it("prefers custom_domain then hostname then subdomain", () => {
    expect(publicationHost({ custom_domain: "https://news.example.com/" })).toBe(
      "news.example.com",
    );
    expect(publicationHost({ hostname: "host.example" })).toBe("host.example");
    expect(publicationHost({ subdomain: "atlas" })).toBe("atlas.substack.com");
  });

  it("throws without a host", () => {
    expect(() => publicationHost({})).toThrow(/missing subdomain/);
  });
});

describe("normalizeSubscriptions", () => {
  it("reads publications array", () => {
    expect(
      normalizeSubscriptions({
        publications: [
          { id: 1, name: "Atlas", subdomain: "atlas", logo_url: "https://img/a" },
        ],
      }),
    ).toEqual([
      {
        id: "1",
        name: "Atlas",
        subdomain: "atlas",
        host: "atlas.substack.com",
        logoUrl: "https://img/a",
        authorName: undefined,
      },
    ]);
  });

  it("reads nested subscription.publication", () => {
    expect(
      normalizeSubscriptions({
        subscriptions: [
          { publication: { id: 2, name: "Nest", subdomain: "nest", author_name: "Ada" } },
        ],
      })[0]?.authorName,
    ).toBe("Ada");
  });

  it("reads a top-level array and skips junk", () => {
    expect(
      normalizeSubscriptions([
        { id: 3, name: "Ok", subdomain: "ok" },
        { nope: true },
        null,
      ]),
    ).toHaveLength(1);
  });

  it("skips publications whose host cannot be derived", () => {
    expect(
      normalizeSubscriptions([{ id: 9, name: "Bad", subdomain: "   " }]),
    ).toEqual([]);
  });

  it("returns empty for unknown shapes", () => {
    expect(normalizeSubscriptions(null)).toEqual([]);
    expect(normalizeSubscriptions("x")).toEqual([]);
    expect(normalizeSubscriptions({})).toEqual([]);
  });
});

describe("normalizeArchive", () => {
  it("accepts array, posts, archive, and junk", () => {
    expect(normalizeArchive([{ id: 1 }])).toEqual([{ id: 1 }]);
    expect(normalizeArchive({ posts: [{ id: 2 }] })).toEqual([{ id: 2 }]);
    expect(normalizeArchive({ archive: [{ id: 3 }] })).toEqual([{ id: 3 }]);
    expect(normalizeArchive(null)).toEqual([]);
    expect(normalizeArchive({})).toEqual([]);
  });
});

describe("cookiesFromResponse", () => {
  it("uses getSetCookie when it returns cookies", () => {
    const res = {
      headers: {
        getSetCookie: () => ["connect.sid=abc; Path=/"],
        get: () => null,
      },
    } as unknown as Response;
    expect(cookiesFromResponse(res).connectSid).toBe("abc");
  });

  it("falls back to a single set-cookie header", () => {
    const res = {
      headers: {
        getSetCookie: () => [],
        get: (name: string) =>
          name.toLowerCase() === "set-cookie" ? "connect.sid=xyz; Path=/" : null,
      },
    } as unknown as Response;
    expect(cookiesFromResponse(res).connectSid).toBe("xyz");
  });
});

describe("HttpSubstackClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requestEmailLogin posts JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const client = new HttpSubstackClient(fetchMock);
    await client.requestEmailLogin("a@example.com");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/email-login");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      email: "a@example.com",
    });
  });

  it("throws when email-login fails", async () => {
    const client = new HttpSubstackClient(
      vi.fn(async () => new Response("nope", { status: 400 })),
    );
    await expect(client.requestEmailLogin("a@example.com")).rejects.toThrow(
      /email-login failed/,
    );
  });

  it("completeEmailOtp captures cookies on 200 and 302", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { "set-cookie": "connect.sid=tok; Path=/" },
        }),
    );
    const client = new HttpSubstackClient(fetchMock);
    await expect(client.completeEmailOtp("a@example.com", "123456")).resolves.toEqual({
      connectSid: "tok",
      substackSid: undefined,
    });
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
      Origin: "https://substack.com",
      Referer: "https://substack.com/",
    });
  });

  it("throws when otp complete fails", async () => {
    const client = new HttpSubstackClient(
      vi.fn(async () => new Response("bad", { status: 401 })),
    );
    await expect(client.completeEmailOtp("a@example.com", "000")).rejects.toThrow(
      /email-otp-login failed/,
    );
  });

  it("throws when otp complete returns a captcha body", async () => {
    const client = new HttpSubstackClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "captcha" }), { status: 200 }),
      ),
    );
    await expect(client.completeEmailOtp("a@example.com", "000")).rejects.toThrow(
      /CAPTCHA/,
    );
  });

  it("fetchProfile maps id", async () => {
    const client = new HttpSubstackClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 9, email: "a@x", name: "Ada" }), {
            status: 200,
          }),
      ),
    );
    await expect(
      client.fetchProfile({ connectSid: "c" }),
    ).resolves.toEqual({ id: "9", email: "a@x", name: "Ada" });
  });

  it("throws when profile id is missing or request fails", async () => {
    const missing = new HttpSubstackClient(
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(missing.fetchProfile({ connectSid: "c" })).rejects.toThrow(/missing id/);
    const fail = new HttpSubstackClient(
      vi.fn(async () => new Response("no", { status: 403 })),
    );
    await expect(fail.fetchProfile({ connectSid: "c" })).rejects.toThrow(/failed: 403/);
  });

  it("fetchSubscriptions and fetchArchive", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ publications: [{ id: 1, name: "A", subdomain: "a" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 2, title: "Post" }]), { status: 200 }),
      );
    const client = new HttpSubstackClient(fetchMock);
    const pubs = await client.fetchSubscriptions({ connectSid: "c" });
    expect(pubs[0]?.host).toBe("a.substack.com");
    const posts = await client.fetchArchive("a.substack.com", { connectSid: "c" });
    expect(posts[0]?.id).toBe(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(archiveUrl("a.substack.com", 0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches a second archive page only when the first is full", async () => {
    const fullPage = Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, i) => ({ id: i + 1 }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(fullPage), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 51, title: "Next" }]), { status: 200 }),
      );
    const client = new HttpSubstackClient(fetchMock);
    const posts = await client.fetchArchive("a.substack.com", { connectSid: "c" });
    expect(posts).toHaveLength(ARCHIVE_PAGE_SIZE + 1);
    expect(posts[ARCHIVE_PAGE_SIZE]?.id).toBe(51);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(archiveUrl("a.substack.com", 0));
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      archiveUrl("a.substack.com", ARCHIVE_PAGE_SIZE),
    );
  });

  it("skips the second archive page when the first is short", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify(Array.from({ length: ARCHIVE_PAGE_SIZE - 1 }, (_, i) => ({ id: i }))),
          { status: 200 },
        ),
    );
    const client = new HttpSubstackClient(fetchMock);
    const posts = await client.fetchArchive("a.substack.com", { connectSid: "c" });
    expect(posts).toHaveLength(ARCHIVE_PAGE_SIZE - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolveVideoSrc reads JSON url or final response URL", async () => {
    const jsonClient = new HttpSubstackClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ url: "https://cdn.example/a.m3u8" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      jsonClient.resolveVideoSrc("a.substack.com", "up1", { connectSid: "c" }),
    ).resolves.toBe("https://cdn.example/a.m3u8");

    const srcClient = new HttpSubstackClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ src: "https://cdn.example/b.m3u8" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      srcClient.resolveVideoSrc("a.substack.com", "up1", { connectSid: "c" }),
    ).resolves.toBe("https://cdn.example/b.m3u8");

    const emptyJson = new HttpSubstackClient(
      vi.fn(
        async () =>
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      emptyJson.resolveVideoSrc("a.substack.com", "up1", { connectSid: "c" }),
    ).rejects.toThrow(/missing url/);

    const redirect = new HttpSubstackClient(
      vi.fn(async () => {
        const res = new Response("m3u8", {
          status: 200,
          headers: { "content-type": "application/vnd.apple.mpegurl" },
        });
        Object.defineProperty(res, "url", {
          value: "https://cdn.example/final.m3u8",
        });
        return res;
      }),
    );
    await expect(
      redirect.resolveVideoSrc("a.substack.com", "up1", { connectSid: "c" }),
    ).resolves.toBe("https://cdn.example/final.m3u8");

    const fail = new HttpSubstackClient(
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    await expect(
      fail.resolveVideoSrc("a.substack.com", "up1", { connectSid: "c" }),
    ).rejects.toThrow(/video src failed: 404/);

    const paid = new HttpSubstackClient(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Video is for paid subscribers only",
              type: "permission",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      paid.resolveVideoSrc("a.substack.com", "up1", { connectSid: "c" }),
    ).rejects.toThrow(/This video is for paid subscribers only/);
  });
});

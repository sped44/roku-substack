import { describe, expect, it, vi } from "vitest";
import {
  buildHomeFeed,
  isPaidGatedAudience,
  isPlayablePost,
  mapPost,
  mapPublication,
  parsePlayId,
  playHttpError,
  playId,
  resolvePlay,
  searchCatalog,
  sleep,
  sortByDateDesc,
  videoUploadIdOf,
  type CatalogItem,
} from "./catalog.js";
import type { Publication, RawPost, SubstackClient } from "./substack.js";

const pub: Publication = {
  id: "10",
  name: "Atlas",
  subdomain: "atlas",
  host: "atlas.substack.com",
  logoUrl: "https://img/logo",
  authorName: "Ada",
};

describe("play ids", () => {
  it("formats and parses", () => {
    expect(playId("10", 99)).toBe("10:99");
    expect(parsePlayId("10:99")).toEqual({ publicationId: "10", postId: "99" });
  });

  it("rejects malformed ids", () => {
    expect(() => parsePlayId("nocolon")).toThrow(/Invalid play id/);
    expect(() => parsePlayId(":1")).toThrow(/Invalid play id/);
    expect(() => parsePlayId("1:")).toThrow(/Invalid play id/);
  });
});

describe("post mapping", () => {
  it("detects video vs audio vs unplayable", () => {
    expect(videoUploadIdOf({ video_upload_id: "v1" })).toBe("v1");
    expect(videoUploadIdOf({ videoUpload: { id: "v2" } })).toBe("v2");
    expect(isPlayablePost({ podcast_url: "https://a.mp3" })).toBe(true);
    expect(isPlayablePost({ title: "text" })).toBe(false);
    const video = mapPost(
      {
        id: 1,
        title: "Vid",
        subtitle: "s",
        cover_image: "https://img",
        video_upload_id: "up",
        post_date: "2026-01-02",
      },
      pub,
    );
    expect(video).toMatchObject({
      kind: "video",
      playable: true,
      paidOnly: false,
      videoUploadId: "up",
      publicationName: "Atlas",
    });
    const paid = mapPost(
      { id: 9, title: "Members", video_upload_id: "up", audience: "only_paid" },
      pub,
    );
    expect(paid.paidOnly).toBe(true);
    expect(isPaidGatedAudience("founding")).toBe(true);
    expect(isPaidGatedAudience("everyone")).toBe(false);
    expect(isPaidGatedAudience("only_subscribers")).toBe(false);
    const audio = mapPost({ id: 2, podcast_url: "https://a.mp3", title: "Pod" }, pub);
    expect(audio.kind).toBe("audio");
    expect(audio.playable).toBe(true);
    const text = mapPost({ slug: "hello" }, pub);
    expect(text.playable).toBe(false);
    expect(text.title).toBe("Untitled");
    expect(text.id).toBe("10:hello");
  });

  it("maps publications", () => {
    expect(mapPublication(pub)).toMatchObject({
      kind: "publication",
      title: "Atlas",
      subtitle: "Ada",
      playable: false,
    });
  });

  it("sorts by date descending and treats missing as 0", () => {
    const items = sortByDateDesc([
      { ...mapPublication(pub), id: "a", postDate: "2026-01-01" },
      { ...mapPublication(pub), id: "b", postDate: "2026-06-01" },
      { ...mapPublication(pub), id: "c" },
    ]);
    expect(items.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
});

describe("sleep", () => {
  it("returns immediately for non-positive delays", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-1)).resolves.toBeUndefined();
  });

  it("waits for positive delays", async () => {
    vi.useFakeTimers();
    const pending = sleep(25);
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("buildHomeFeed", () => {
  it("filters playable rows, skips YouTube-only posts, and delays between pubs", async () => {
    const pubs: Publication[] = [
      pub,
      { id: "11", name: "Beta", subdomain: "beta", host: "beta.substack.com" },
    ];
    const client: SubstackClient = {
      requestEmailLogin: vi.fn(),
      completeEmailOtp: vi.fn(),
      fetchProfile: vi.fn(),
      fetchSubscriptions: vi.fn(),
      fetchArchive: vi.fn(async (host: string) => {
        if (host.startsWith("atlas")) {
          return [
            { id: 1, title: "V", video_upload_id: "up", post_date: "2026-02-01" },
            { id: 2, title: "A", podcast_url: "https://a.mp3", post_date: "2026-03-01" },
            { id: 3, title: "YouTube only" },
          ] as RawPost[];
        }
        return [
          { id: 4, title: "Old V", videoUpload: { id: "u2" }, post_date: "2026-01-01" },
        ];
      }),
      resolveVideoSrc: vi.fn(),
    };
    const sleeper = vi.fn(async () => undefined);
    const result = await buildHomeFeed({
      publications: pubs,
      client,
      cookies: { connectSid: "c" },
      delayMs: 10,
      archiveLimit: 10,
      sleepFn: sleeper,
    });
    expect(sleeper).toHaveBeenCalledTimes(1);
    expect(result.home.recentVideo.map((i) => i.title)).toEqual(["V", "Old V"]);
    expect(result.home.recentAudio.map((i) => i.title)).toEqual(["A"]);
    expect(result.home.subscriptions).toHaveLength(2);
    expect(result.postsByPlayId["10:3"]?.playable).toBe(false);
  });
});

describe("resolvePlay", () => {
  const client: SubstackClient = {
    requestEmailLogin: vi.fn(),
    completeEmailOtp: vi.fn(),
    fetchProfile: vi.fn(),
    fetchSubscriptions: vi.fn(),
    fetchArchive: vi.fn(),
    resolveVideoSrc: vi.fn(async () => "https://cdn.example/v.m3u8"),
  };

  it("resolves HLS for video and mp3 for audio", async () => {
    const video = mapPost({ id: 1, title: "V", video_upload_id: "up" }, pub);
    await expect(
      resolvePlay({ item: video, client, cookies: { connectSid: "c" } }),
    ).resolves.toEqual({
      url: "https://cdn.example/v.m3u8",
      streamFormat: "hls",
      title: "V",
    });
    const audio = mapPost({ id: 2, title: "A", podcast_url: "https://a.mp3" }, pub);
    await expect(
      resolvePlay({ item: audio, client, cookies: { connectSid: "c" } }),
    ).resolves.toEqual({
      url: "https://a.mp3",
      streamFormat: "mp3",
      title: "A",
    });
  });

  it("rejects unplayable posts and playable items with no URL", async () => {
    const item = mapPost({ id: 3, title: "Nope" }, pub);
    await expect(
      resolvePlay({ item, client, cookies: { connectSid: "c" } }),
    ).rejects.toThrow(/not playable/);
    const broken: CatalogItem = {
      ...item,
      playable: true,
      podcastUrl: undefined,
      videoUploadId: undefined,
    };
    await expect(
      resolvePlay({ item: broken, client, cookies: { connectSid: "c" } }),
    ).rejects.toThrow(/No stream URL/);
  });
});

describe("searchCatalog", () => {
  const video = mapPost(
    { id: 1, title: "Making Sense", subtitle: "Sam Harris", video_upload_id: "up", post_date: "2026-02-01" },
    pub,
  );
  const audio = mapPost(
    { id: 2, title: "Office Hours", podcast_url: "https://a.mp3", post_date: "2026-03-01" },
    pub,
  );
  const text = mapPost({ id: 3, title: "Making Sense transcript" }, pub);
  const posts = { [video.id]: video, [audio.id]: audio, [text.id]: text };

  it("matches title and publication, skips empty query and unplayable by default", () => {
    expect(searchCatalog(posts, "   ")).toEqual([]);
    expect(searchCatalog(posts, "making")).toEqual([video]);
    expect(searchCatalog(posts, "atlas hours")).toEqual([audio]);
    expect(searchCatalog(posts, "transcript")).toEqual([]);
    expect(searchCatalog(posts, "transcript", { playableOnly: false })[0]?.id).toBe(text.id);
  });
});

describe("playHttpError", () => {
  it("maps paid, unplayable, invalid id, and generic failures", () => {
    expect(playHttpError(new Error("This video is for paid subscribers only"))).toEqual({
      status: 403,
      error: "This video is for paid subscribers only",
    });
    expect(playHttpError(new Error("Post is not playable on TV"))).toEqual({
      status: 403,
      error: "This post is not playable on TV",
    });
    expect(playHttpError(new Error("Invalid play id"))).toEqual({
      status: 400,
      error: "Invalid play id",
    });
    expect(playHttpError(new Error("video src failed: 404"))).toEqual({
      status: 502,
      error: "Couldn't load this video",
    });
  });
});

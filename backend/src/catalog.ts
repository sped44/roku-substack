import type { Publication, RawPost, SubstackClient } from "./substack.js";

export type MediaKind = "video" | "audio";

export type CatalogItem = {
  id: string;
  kind: MediaKind | "publication";
  title: string;
  subtitle?: string;
  poster?: string;
  publicationId: string;
  publicationName: string;
  playable: boolean;
  paidOnly: boolean;
  postDate?: string;
  host?: string;
  podcastUrl?: string;
  videoUploadId?: string;
};

export type HomePayload = {
  recentVideo: CatalogItem[];
  recentAudio: CatalogItem[];
  subscriptions: CatalogItem[];
};

export type PlayResult = {
  url: string;
  streamFormat: "hls" | "mp3";
  title: string;
  duration?: number;
};

const HOME_ROW_LIMIT = 20;

export function videoUploadIdOf(post: RawPost): string | undefined {
  const nested = post.videoUpload?.id;
  const top = post.video_upload_id;
  const id = nested || top;
  return id ? String(id) : undefined;
}

export function isPlayablePost(post: RawPost): boolean {
  return Boolean(post.podcast_url || videoUploadIdOf(post));
}

export function isPaidGatedAudience(audience?: string): boolean {
  const value = (audience ?? "").trim().toLowerCase();
  return value === "only_paid" || value === "founding" || value === "only_founding";
}

export function playId(publicationId: string, postId: string | number): string {
  return `${publicationId}:${postId}`;
}

export function parsePlayId(id: string): { publicationId: string; postId: string } {
  const idx = id.indexOf(":");
  if (idx <= 0 || idx === id.length - 1) {
    throw new Error("Invalid play id");
  }
  return { publicationId: id.slice(0, idx), postId: id.slice(idx + 1) };
}

export function mapPost(post: RawPost, pub: Publication): CatalogItem {
  const postId = String(post.id ?? post.slug ?? "");
  const videoUploadId = videoUploadIdOf(post);
  const kind: MediaKind = videoUploadId ? "video" : "audio";
  return {
    id: playId(pub.id, postId || "unknown"),
    kind,
    title: post.title || "Untitled",
    subtitle: post.subtitle,
    poster: post.cover_image,
    publicationId: pub.id,
    publicationName: pub.name,
    playable: isPlayablePost(post),
    paidOnly: isPaidGatedAudience(post.audience),
    postDate: post.post_date || post.published_at,
    host: pub.host,
    podcastUrl: post.podcast_url,
    videoUploadId,
  };
}

export function mapPublication(pub: Publication): CatalogItem {
  return {
    id: pub.id,
    kind: "publication",
    title: pub.name,
    subtitle: pub.authorName,
    poster: pub.logoUrl,
    publicationId: pub.id,
    publicationName: pub.name,
    playable: false,
    paidOnly: false,
    host: pub.host,
  };
}

export function sortByDateDesc(items: CatalogItem[]): CatalogItem[] {
  return [...items].sort((a, b) => {
    const da = a.postDate ? Date.parse(a.postDate) : 0;
    const db = b.postDate ? Date.parse(b.postDate) : 0;
    return db - da;
  });
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function buildHomeFeed(opts: {
  publications: Publication[];
  client: SubstackClient;
  cookies: import("./cookies.js").SessionCookies;
  delayMs: number;
  archiveLimit: number;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<{ home: HomePayload; postsByPlayId: Record<string, CatalogItem> }> {
  const wait = opts.sleepFn ?? sleep;
  const pubs = opts.publications.slice(0, opts.archiveLimit);
  const postsByPlayId: Record<string, CatalogItem> = {};
  const playable: CatalogItem[] = [];

  for (let i = 0; i < pubs.length; i++) {
    const pub = pubs[i]!;
    if (i > 0) {
      await wait(opts.delayMs);
    }
    const raw = await opts.client.fetchArchive(pub.host, opts.cookies);
    for (const post of raw) {
      const item = mapPost(post, pub);
      postsByPlayId[item.id] = item;
      if (item.playable) {
        playable.push(item);
      }
    }
  }

  const ordered = sortByDateDesc(playable);
  return {
    home: {
      recentVideo: ordered.filter((item) => item.kind === "video").slice(0, HOME_ROW_LIMIT),
      recentAudio: ordered.filter((item) => item.kind === "audio").slice(0, HOME_ROW_LIMIT),
      subscriptions: pubs.map(mapPublication),
    },
    postsByPlayId,
  };
}

export async function resolvePlay(opts: {
  item: CatalogItem;
  client: SubstackClient;
  cookies: import("./cookies.js").SessionCookies;
}): Promise<PlayResult> {
  if (!opts.item.playable) {
    throw new Error("Post is not playable on TV");
  }
  if (opts.item.videoUploadId && opts.item.host) {
    const url = await opts.client.resolveVideoSrc(
      opts.item.host,
      opts.item.videoUploadId,
      opts.cookies,
    );
    return { url, streamFormat: "hls", title: opts.item.title };
  }
  if (opts.item.podcastUrl) {
    return {
      url: opts.item.podcastUrl,
      streamFormat: "mp3",
      title: opts.item.title,
    };
  }
  throw new Error("No stream URL for post");
}

const SEARCH_LIMIT = 40;

export function searchCatalog(
  postsByPlayId: Record<string, CatalogItem>,
  query: string,
  opts?: { playableOnly?: boolean; limit?: number },
): CatalogItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const terms = normalized.split(/\s+/).filter(Boolean);
  const playableOnly = opts?.playableOnly ?? true;
  const limit = opts?.limit ?? SEARCH_LIMIT;
  const scored: Array<{ item: CatalogItem; score: number; date: number }> = [];
  for (const item of Object.values(postsByPlayId)) {
    if (playableOnly && !item.playable) {
      continue;
    }
    const hay = `${item.title} ${item.subtitle ?? ""} ${item.publicationName}`.toLowerCase();
    if (!terms.every((term) => hay.includes(term))) {
      continue;
    }
    let score = 0;
    if (item.title.toLowerCase().includes(normalized)) {
      score += 3;
    }
    if (item.publicationName.toLowerCase().includes(normalized)) {
      score += 2;
    }
    if ((item.subtitle ?? "").toLowerCase().includes(normalized)) {
      score += 1;
    }
    scored.push({
      item,
      score,
      date: item.postDate ? Date.parse(item.postDate) : 0,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.date - a.date);
  return scored.slice(0, limit).map((row) => row.item);
}

export function playHttpError(err: unknown): { status: number; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Invalid play id")) {
    return { status: 400, error: "Invalid play id" };
  }
  if (/paid subscribers? only/i.test(message)) {
    return { status: 403, error: "This video is for paid subscribers only" };
  }
  if (/not playable/i.test(message)) {
    return { status: 403, error: "This post is not playable on TV" };
  }
  return { status: 502, error: "Couldn't load this video" };
}

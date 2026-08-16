import cookieSession from "cookie-session";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AppConfig } from "./config.js";
import {
  decryptCookies,
  encryptCookies,
  parseCookiePaste,
  type SessionCookies,
} from "./cookies.js";
import { deviceTokenFrom, normalizePairCode, pairLoginUrl, pairQrUrl, publicBaseUrl } from "./http.js";
import { escapeHtml, layout } from "./html.js";
import { Store } from "./store.js";
import type { SubstackClient } from "./substack.js";
import { renderPairQrPng } from "./qr.js";
import {
  buildHomeFeed,
  mapPost,
  parsePlayId,
  playHttpError,
  resolvePlay,
  searchCatalog,
  type CatalogItem,
  type HomePayload,
} from "./catalog.js";

export type BrowserSession = {
  userId?: string;
  pendingEmail?: string;
  pendingPairCode?: string;
};

export type AppDeps = {
  cfg: AppConfig;
  store: Store;
  substack: SubstackClient;
  sleepFn?: (ms: number) => Promise<void>;
  publicBaseUrlEnv?: string;
};

type CachedHome = {
  home: HomePayload;
  postsByPlayId: Record<string, CatalogItem>;
};

export function createApp(deps: AppDeps): express.Express {
  const { cfg, store, substack } = deps;
  const app = express();

  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    cookieSession({
      name: "roku_substack",
      keys: [cfg.sessionSigningKey],
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
      httpOnly: true,
      secure: cfg.baseUrl.startsWith("https://"),
    }),
  );

  function readSession(req: Request): BrowserSession {
    return (req.session ?? {}) as BrowserSession;
  }

  function writeSession(req: Request, data: BrowserSession): void {
    req.session = data as NonNullable<typeof req.session>;
  }

  function requestPublicBase(req: Request): string {
    return publicBaseUrl(req, cfg.baseUrl, deps.publicBaseUrlEnv ?? process.env.PUBLIC_BASE_URL);
  }

  async function cookiesForUser(userId: string): Promise<SessionCookies> {
    const user = await store.getUser(userId);
    if (!user) {
      throw new Error("Unknown user");
    }
    return decryptCookies(user.encryptedCookies, cfg.cookieEncryptionKey);
  }

  async function persistLogin(
    req: Request,
    cookies: SessionCookies,
  ): Promise<{ userId: string; email?: string; name?: string }> {
    const profile = await substack.fetchProfile(cookies);
    await store.upsertUser(
      profile.id,
      { email: profile.email, name: profile.name },
      encryptCookies(cookies, cfg.cookieEncryptionKey),
    );
    const previous = readSession(req);
    writeSession(req, {
      userId: profile.id,
      pendingPairCode: previous.pendingPairCode,
    });
    return { userId: profile.id, email: profile.email, name: profile.name };
  }

  async function redirectAfterAuth(req: Request, res: Response): Promise<void> {
    const session = readSession(req);
    if (session.userId && session.pendingPairCode) {
      try {
        await store.claimPairing(session.pendingPairCode, session.userId);
        writeSession(req, { userId: session.userId });
        res.redirect("/linked");
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res
          .status(400)
          .type("html")
          .send(
            layout(
              "Link failed",
              `<p class="err">${escapeHtml(message)}</p><p><a href="/link">Enter the TV code manually</a></p>`,
            ),
          );
        return;
      }
    }
    res.redirect("/link");
  }

  function cookieFallbackNote(): string {
    return `<p class="muted">If verify fails, use <a href="/cookie">cookie paste</a> instead.</p>`;
  }

  async function requireDevice(req: Request, res: Response): Promise<{ userId: string } | null> {
    const deviceToken = deviceTokenFrom(req);
    if (!deviceToken) {
      res.status(401).json({ error: "device token required" });
      return null;
    }
    const device = await store.getDevice(deviceToken);
    if (!device) {
      res.status(401).json({ error: "invalid device token" });
      return null;
    }
    return { userId: device.userId };
  }

  async function loadHome(userId: string, force = false): Promise<CachedHome> {
    const cacheKey = `home:v2:${userId}`;
    if (!force) {
      const cached = await store.getCache<CachedHome>(cacheKey);
      if (cached) {
        return cached;
      }
    }
    const cookies = await cookiesForUser(userId);
    const publications = await substack.fetchSubscriptions(cookies);
    const built = await buildHomeFeed({
      publications,
      client: substack,
      cookies,
      delayMs: cfg.substackRequestDelayMs,
      archiveLimit: cfg.archiveLimit,
      sleepFn: deps.sleepFn,
    });
    await store.setCache(cacheKey, built, cfg.cacheTtlMs);
    return built;
  }

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", (req, res) => {
    const loggedIn = Boolean(readSession(req).userId);
    res.type("html").send(
      layout(
        "Roku Substack companion",
        `
      <p class="muted">Scan the QR code on the Roku, sign in on your phone, then the TV links automatically. Session cookies stay on this server.</p>
      <div class="card">
        <p><strong>Status:</strong> ${loggedIn ? "signed in" : "signed out"}</p>
        ${
          loggedIn
            ? `<p>
                <a class="button" href="/link">Link Roku</a>
                <a class="button secondary" href="/logout">Log out</a>
               </p>`
            : `<p>
                <a class="button" href="/login">Sign in with email code</a>
                <a class="button secondary" href="/cookie">Paste session cookie</a>
               </p>`
        }
      </div>
      <div class="card">
        <p class="muted"><strong>Roku API</strong></p>
        <p><code>POST /api/pair/start</code> → pairing code</p>
        <p><code>GET /api/pair/status?code=XXXXXX</code> → poll until linked + device token</p>
        <p><code>GET /api/home</code> with <code>Authorization: Bearer &lt;deviceToken&gt;</code></p>
      </div>
      `,
      ),
    );
  });

  app.get("/login", async (req, res, next) => {
    try {
      const rawCode = String(req.query.code ?? "").trim();
      if (rawCode) {
        const code = normalizePairCode(rawCode);
        const pairing = await store.getPairing(code);
        if (!pairing || pairing.status !== "pending") {
          res
            .status(400)
            .type("html")
            .send(
              layout(
                "Sign in",
                `<p class="err">This TV code is missing or expired. Open the channel again to get a new QR code.</p>`,
              ),
            );
          return;
        }
        const session = readSession(req);
        writeSession(req, { ...session, pendingPairCode: code });
        if (session.userId) {
          await redirectAfterAuth(req, res);
          return;
        }
      }
      if (readSession(req).userId) {
        res.redirect("/link");
        return;
      }
      res.type("html").send(
        layout(
          "Sign in",
          `
        <p><a class="button secondary" href="/">Home</a></p>
        <div class="card">
          <p>Request a login code on <a href="https://substack.com/sign-in" target="_blank" rel="noopener">substack.com/sign-in</a> (your phone/browser), then enter your email here. Cloud Run cannot send Substack emails.</p>
          <form method="post" action="/login">
            <p><input name="email" type="email" required placeholder="you@example.com" /></p>
            <p><button type="submit">Continue</button></p>
          </form>
          ${cookieFallbackNote()}
        </div>
        `,
        ),
      );
    } catch (err) {
      next(err);
    }
  });

  app.post("/login", async (req, res) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email) {
      res.status(400).send(layout("Sign in", `<p class="err">Email required</p>`));
      return;
    }
    const previous = readSession(req);
    writeSession(req, {
      pendingEmail: email,
      pendingPairCode: previous.pendingPairCode,
    });
    res.redirect("/login/otp");
  });

  app.get("/login/otp", (req, res) => {
    const email = readSession(req).pendingEmail;
    if (!email) {
      res.redirect("/login");
      return;
    }
    res.type("html").send(
      layout(
        "Enter code",
        `
        <p class="muted">For <strong>${escapeHtml(email)}</strong></p>
        <div class="card">
          <ol>
            <li>Open <a href="https://substack.com/sign-in" target="_blank" rel="noopener">substack.com/sign-in</a></li>
            <li>Request a login code for this email</li>
            <li>Enter the 6-digit code below</li>
          </ol>
          <form method="post" action="/login/otp">
            <p><input name="code" inputmode="numeric" maxlength="8" required placeholder="123456" /></p>
            <p><button type="submit">Verify</button></p>
          </form>
          ${cookieFallbackNote()}
        </div>
        `,
      ),
    );
  });

  app.post("/login/otp", async (req, res, next) => {
    try {
      const email = readSession(req).pendingEmail;
      const code = String(req.body?.code ?? "").trim();
      if (!email) {
        res.redirect("/login");
        return;
      }
      if (!code) {
        res.status(400).send(layout("Enter code", `<p class="err">Code required</p>`));
        return;
      }
      const cookies = await substack.completeEmailOtp(email, code);
      await persistLogin(req, cookies);
      await redirectAfterAuth(req, res);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (String(req.headers.accept ?? "").includes("application/json")) {
        next(err);
        return;
      }
      res
        .status(400)
        .type("html")
        .send(
          layout(
            "Sign in failed",
            `<p class="err">${escapeHtml(message)}</p>${cookieFallbackNote()}<p><a href="/login/otp">Try again</a></p>`,
          ),
        );
    }
  });

  app.get("/cookie", (req, res) => {
    if (readSession(req).userId) {
      res.redirect("/link");
      return;
    }
    res.type("html").send(
      layout(
        "Paste session cookie",
        `
        <p><a class="button secondary" href="/">Home</a></p>
        <div class="card">
          <p>From DevTools → Application → Cookies → <code>https://substack.com</code>, copy <code>substack.sid</code> (or <code>connect.sid</code> if present). Include the name, not just the value.</p>
          <form method="post" action="/cookie">
            <p><textarea name="cookie" required placeholder="substack.sid=s%3A..."></textarea></p>
            <p><button type="submit">Save cookie</button></p>
          </form>
        </div>
        `,
      ),
    );
  });

  app.post("/cookie", async (req, res, next) => {
    try {
      const raw = String(req.body?.cookie ?? "");
      const cookies = parseCookiePaste(raw);
      await persistLogin(req, cookies);
      await redirectAfterAuth(req, res);
    } catch (err) {
      next(err);
    }
  });

  app.get("/logout", (req, res) => {
    req.session = null;
    res.redirect("/");
  });

  app.get("/linked", (req, res) => {
    if (!readSession(req).userId) {
      res.redirect("/login");
      return;
    }
    res.type("html").send(
      layout(
        "TV linked",
        `
        <p class="ok">This Roku is linked to your Substack session.</p>
        <p>You can put the phone down. The TV should load your feed in a few seconds.</p>
        <p><a class="button secondary" href="/">Home</a></p>
        `,
      ),
    );
  });

  app.get("/link", (req, res) => {
    if (!readSession(req).userId) {
      res.redirect("/login");
      return;
    }
    const base = requestPublicBase(req);
    res.type("html").send(
      layout(
        "Link Roku",
        `
      <p>
        <a class="button secondary" href="/">Home</a>
        <a class="button secondary" href="/logout">Log out</a>
      </p>
      <div class="card">
        <p>Prefer to type the code? Open the channel and enter the 6-character code here. Scanning the QR on the TV is easier.</p>
        <form id="claim">
          <p><input name="code" maxlength="8" placeholder="ABC123" required /></p>
          <p><button type="submit">Link device</button></p>
          <p id="msg" class="muted"></p>
        </form>
      </div>
      <script>
        document.getElementById('claim').addEventListener('submit', async (e) => {
          e.preventDefault();
          const code = new FormData(e.target).get('code');
          const res = await fetch('/api/pair/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          });
          const data = await res.json();
          const msg = document.getElementById('msg');
          if (!res.ok) {
            msg.className = 'err';
            msg.textContent = data.error || 'Claim failed';
            return;
          }
          msg.className = 'ok';
          msg.textContent = 'Linked. Press Replay on the Roku if it is still waiting.';
        });
      </script>
      <p class="muted">Companion URL: <code>${base}</code></p>
      `,
      ),
    );
  });

  app.post("/api/pair/start", async (req, res) => {
    try {
      const { code, expiresAt } = await store.startPairing();
      const base = requestPublicBase(req);
      res.json({
        code,
        expiresAt: expiresAt.toISOString(),
        pollUrl: `/api/pair/status?code=${encodeURIComponent(code)}`,
        claimUrl: pairLoginUrl(base, code),
        qrUrl: pairQrUrl(base, code),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/pair/qr.png", async (req, res, next) => {
    try {
      const code = normalizePairCode(String(req.query.code ?? ""));
      if (!code) {
        res.status(400).json({ error: "code required" });
        return;
      }
      const pairing = await store.getPairing(code);
      if (!pairing || pairing.status !== "pending") {
        res.status(404).json({ error: "Unknown code" });
        return;
      }
      const png = await renderPairQrPng(pairLoginUrl(requestPublicBase(req), code));
      res.type("png").send(png);
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/pair/status", async (req, res) => {
    try {
      const code = String(req.query.code ?? "");
      if (!code) {
        res.status(400).json({ error: "code required" });
        return;
      }
      const pairing = await store.getPairing(code);
      if (!pairing) {
        res.status(404).json({ error: "Unknown code" });
        return;
      }
      if (pairing.status === "linked" && pairing.deviceToken) {
        res.json({
          status: "linked",
          deviceToken: pairing.deviceToken,
        });
        return;
      }
      res.json({
        status: pairing.status,
        expiresAt: pairing.expiresAt.toDate().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/pair/claim", async (req, res) => {
    try {
      const session = readSession(req);
      if (!session.userId) {
        res.status(401).json({ error: "Not signed in" });
        return;
      }
      const code = String(req.body?.code ?? "");
      if (!code) {
        res.status(400).json({ error: "code required" });
        return;
      }
      const result = await store.claimPairing(code, session.userId);
      res.json({ ok: true, deviceToken: result.deviceToken });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.get("/api/home", async (req, res) => {
    try {
      const device = await requireDevice(req, res);
      if (!device) {
        return;
      }
      const cached = await loadHome(device.userId);
      res.json(cached.home);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  app.get("/api/publications/:id/posts", async (req, res) => {
    try {
      const device = await requireDevice(req, res);
      if (!device) {
        return;
      }
      const pubId = req.params.id;
      const cached = await loadHome(device.userId);
      const pub = cached.home.subscriptions.find((item) => item.publicationId === pubId);
      if (!pub || !pub.host) {
        res.status(404).json({ error: "Unknown publication" });
        return;
      }
      const cookies = await cookiesForUser(device.userId);
      const raw = await substack.fetchArchive(pub.host, cookies);
      const publication = {
        id: pub.publicationId,
        name: pub.publicationName,
        subdomain: pub.host.replace(/\.substack\.com$/, ""),
        host: pub.host,
        logoUrl: pub.poster,
        authorName: pub.subtitle,
      };
      const posts = raw.map((post) => mapPost(post, publication)).filter((item) => item.playable);
      res.json({ publication: pub, posts });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const device = await requireDevice(req, res);
      if (!device) {
        return;
      }
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        res.status(400).json({ error: "query required" });
        return;
      }
      const cached = await loadHome(device.userId);
      res.json({ query: q, results: searchCatalog(cached.postsByPlayId, q) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  });

  app.get("/api/posts/:id/play", async (req, res) => {
    try {
      const device = await requireDevice(req, res);
      if (!device) {
        return;
      }
      const playId = decodeURIComponent(req.params.id);
      parsePlayId(playId);
      const cached = await loadHome(device.userId);
      let item: CatalogItem | undefined = cached.postsByPlayId[playId];
      if (!item) {
        const { publicationId } = parsePlayId(playId);
        const pub = cached.home.subscriptions.find((row) => row.publicationId === publicationId);
        if (!pub?.host) {
          res.status(404).json({ error: "Unknown post" });
          return;
        }
        const cookies = await cookiesForUser(device.userId);
        const raw = await substack.fetchArchive(pub.host, cookies);
        const publication = {
          id: pub.publicationId,
          name: pub.publicationName,
          subdomain: pub.host.replace(/\.substack\.com$/, ""),
          host: pub.host,
        };
        item = raw
          .map((post) => mapPost(post, publication))
          .find((mapped) => mapped.id === playId);
      }
      if (!item) {
        res.status(404).json({ error: "Unknown post" });
        return;
      }
      const cookies = await cookiesForUser(device.userId);
      const play = await resolvePlay({ item, client: substack, cookies });
      res.json(play);
    } catch (err) {
      const mapped = playHttpError(err);
      res.status(mapped.status).json({ error: mapped.error });
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(err);
    if (res.headersSent) {
      return;
    }
    const wantsHtml = String(_req.headers.accept ?? "").includes("text/html");
    if (wantsHtml) {
      res
        .status(500)
        .type("html")
        .send(layout("Error", `<p class="err">${escapeHtml(message)}</p><p><a href="/">Home</a></p>`));
      return;
    }
    res.status(500).json({ error: message });
  });

  return app;
}

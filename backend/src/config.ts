export type AppConfig = {
  port: number;
  baseUrl: string;
  projectId: string;
  firestoreDatabaseId: string;
  sessionSigningKey: string;
  cookieEncryptionKey: string;
  cacheTtlMs: number;
  substackRequestDelayMs: number;
  archiveLimit: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value || value === "REPLACE_ME") {
    throw new Error(
      `Missing or placeholder env ${name}. Set it in .env (local) or Secret Manager (Cloud Run).`,
    );
  }
  return value;
}

function optionalInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid integer env ${name}: ${raw}`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? "8080");
  const baseUrl = (env.BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, "");

  return {
    port,
    baseUrl,
    projectId: env.GCP_PROJECT_ID?.trim() || "roku-502821",
    firestoreDatabaseId: env.FIRESTORE_DATABASE_ID?.trim() || "roku-substack",
    sessionSigningKey: required(env, "SESSION_SIGNING_KEY"),
    cookieEncryptionKey: required(env, "COOKIE_ENCRYPTION_KEY"),
    cacheTtlMs: optionalInt(env, "CACHE_TTL_MS", 15 * 60_000),
    substackRequestDelayMs: optionalInt(env, "SUBSTACK_REQUEST_DELAY_MS", 250),
    archiveLimit: optionalInt(env, "ARCHIVE_LIMIT", 15),
  };
}

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { HttpSubstackClient } from "./substack.js";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
dotenv.config({ path: envPath, override: true });

const cfg = loadConfig();
const store = new Store(cfg.projectId, cfg.firestoreDatabaseId);
const app = createApp({
  cfg,
  store,
  substack: new HttpSubstackClient(),
});

app.listen(cfg.port, "0.0.0.0", () => {
  console.log(
    `Companion API listening on ${cfg.baseUrl} (port ${cfg.port}, bound 0.0.0.0)`,
  );
});

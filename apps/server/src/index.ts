import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { mlRuntimeSummary } from "./ml-heal.ts";
import { seedIfNeeded } from "./seed.ts";
import { createStore } from "./store.ts";

const config = loadConfig();

for (const dir of [config.previewsDir, config.tmpDir]) mkdirSync(dir, { recursive: true });
try {
  mkdirSync(config.libraryRoot, { recursive: true });
} catch {
  console.warn(`Could not create the library folder at ${config.libraryRoot}; uploads will fail until it exists.`);
}
const roots = config.roots.map((root) => {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
});

const db = openDatabase(config.dbPath);
const store = createStore(db);
const seeded = seedIfNeeded(store);
const app = createApp({ config, store, roots });

console.log(`f/8 library: ${config.dbPath}`);
console.log(`ML heal runtime: ${mlRuntimeSummary()}`);
if (seeded) console.log("Seeded the sample library.");
if (existsSync(path.join(config.webDistDir, "index.html"))) {
  console.log(`Serving the app from ${config.webDistDir}`);
} else {
  console.log("Web build not found; API only. Run yarn build, then restart to serve the app.");
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`Listening on http://${info.address}:${info.port}`);
});

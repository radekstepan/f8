import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  host: string;
  port: number;
  packageRoot: string;
  dataDir: string;
  dbPath: string;
  previewsDir: string;
  tmpDir: string;
  libraryRoot: string;
  roots: string[];
  /** Candidate web build directory; the server only serves it when index.html exists. */
  webDistDir: string;
}

export interface LoadConfigOptions {
  /** Home directory override (tests); defaults to os.homedir(). */
  homeDir?: string;
}

function expandHome(value: string, home: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return value;
}

function parsePort(value: string | undefined): number {
  if (!value) return 5193;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 5193;
}

export function loadConfig(env: Record<string, string | undefined> = process.env, opts: LoadConfigOptions = {}): ServerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/config.ts under `node --watch src`, dist/config.js after `tsc`: the
  // package root is one level up either way.
  const packageRoot = path.resolve(here, "..");
  const home = opts.homeDir ?? homedir();
  const dataDir = env["F8_DATA"]
    ? path.resolve(expandHome(env["F8_DATA"], home))
    : path.join(packageRoot, "data");
  const roots = (env["F8_ROOTS"] ?? home)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(expandHome(entry, home)));
  const dbPath = path.join(dataDir, "f8.db");
  const libraryEnv = env["F8_LIBRARY"];
  const libraryRoot = libraryEnv
    ? path.resolve(expandHome(libraryEnv, home))
    : path.join(home, "Pictures", "f8");
  return {
    host: env["F8_HOST"] ?? env["HOST"] ?? "127.0.0.1",
    port: parsePort(env["F8_PORT"] ?? env["PORT"]),
    packageRoot,
    dataDir,
    dbPath,
    previewsDir: path.join(dataDir, "previews"),
    tmpDir: path.join(dataDir, "tmp"),
    libraryRoot,
    roots: roots.length ? roots : [home],
    webDistDir: path.join(packageRoot, "..", "web", "dist"),
  };
}

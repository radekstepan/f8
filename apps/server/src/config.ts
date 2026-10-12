import { existsSync } from "node:fs";
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

/** Pre-rename database filename, kept as a read fallback so upgrades never orphan a catalog. */
export const LEGACY_DB_FILE = "photomator.db";
/** Pre-rename upload folder name under ~/Pictures, kept as a read fallback. */
export const LEGACY_LIBRARY_DIR = "Photomator";

export interface LoadConfigOptions {
  /** Home directory override (tests); defaults to os.homedir(). */
  homeDir?: string;
  /** Existence check override (tests); defaults to fs.existsSync. */
  exists?: (candidate: string) => boolean;
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

/** F8_* is primary; the pre-rename PHOTOMATOR_* names stay as fallback aliases. */
function pick(env: Record<string, string | undefined>, primary: string, legacy: string): string | undefined {
  return env[primary] ?? env[legacy];
}

export function loadConfig(env: Record<string, string | undefined> = process.env, opts: LoadConfigOptions = {}): ServerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/config.ts under `node --watch src`, dist/config.js after `tsc`: the
  // package root is one level up either way.
  const packageRoot = path.resolve(here, "..");
  const home = opts.homeDir ?? homedir();
  const exists = opts.exists ?? existsSync;
  const dataDir = pick(env, "F8_DATA", "PHOTOMATOR_DATA")
    ? path.resolve(expandHome(pick(env, "F8_DATA", "PHOTOMATOR_DATA") as string, home))
    : path.join(packageRoot, "data");
  const roots = (pick(env, "F8_ROOTS", "PHOTOMATOR_ROOTS") ?? home)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(expandHome(entry, home)));
  // Existing installs keep working: when the new catalog is absent but the
  // pre-rename one is present, keep serving it instead of starting empty.
  let dbPath = path.join(dataDir, "f8.db");
  try {
    if (!exists(dbPath) && exists(path.join(dataDir, LEGACY_DB_FILE))) {
      dbPath = path.join(dataDir, LEGACY_DB_FILE);
    }
  } catch {
    // An unreadable data dir must not break config load; openDatabase reports it.
  }
  const libraryEnv = pick(env, "F8_LIBRARY", "PHOTOMATOR_LIBRARY");
  let libraryRoot = libraryEnv
    ? path.resolve(expandHome(libraryEnv, home))
    : path.join(home, "Pictures", "f8");
  if (!libraryEnv) {
    try {
      const legacyRoot = path.join(home, "Pictures", LEGACY_LIBRARY_DIR);
      if (!exists(libraryRoot) && exists(legacyRoot)) libraryRoot = legacyRoot;
    } catch {
      // Fall through to the new default; index.ts reports creation failures.
    }
  }
  return {
    host: pick(env, "F8_HOST", "PHOTOMATOR_HOST") ?? env["HOST"] ?? "127.0.0.1",
    port: parsePort(pick(env, "F8_PORT", "PHOTOMATOR_PORT") ?? env["PORT"]),
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

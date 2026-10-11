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

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function parsePort(value: string | undefined): number {
  if (!value) return 5193;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : 5193;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/config.ts under `node --watch src`, dist/config.js after `tsc`: the
  // package root is one level up either way.
  const packageRoot = path.resolve(here, "..");
  const dataDir = env["PHOTOMATOR_DATA"]
    ? path.resolve(expandHome(env["PHOTOMATOR_DATA"] as string))
    : path.join(packageRoot, "data");
  const roots = (env["PHOTOMATOR_ROOTS"] ?? homedir())
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(expandHome(entry)));
  return {
    host: env["PHOTOMATOR_HOST"] ?? env["HOST"] ?? "127.0.0.1",
    port: parsePort(env["PHOTOMATOR_PORT"] ?? env["PORT"]),
    packageRoot,
    dataDir,
    dbPath: path.join(dataDir, "photomator.db"),
    previewsDir: path.join(dataDir, "previews"),
    tmpDir: path.join(dataDir, "tmp"),
    libraryRoot: env["PHOTOMATOR_LIBRARY"]
      ? path.resolve(expandHome(env["PHOTOMATOR_LIBRARY"] as string))
      : path.join(homedir(), "Pictures", "Photomator"),
    roots: roots.length ? roots : [homedir()],
    webDistDir: path.join(packageRoot, "..", "web", "dist"),
  };
}

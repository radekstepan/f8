import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_DB_FILE, LEGACY_LIBRARY_DIR, loadConfig } from "./config.ts";

const HOME = path.resolve("/tmp/f8-config-test-home");

function missing(): (candidate: string) => boolean {
  return () => false;
}

describe("loadConfig naming", () => {
  it("defaults to f8 catalog and library paths", () => {
    const config = loadConfig({}, { homeDir: HOME, exists: missing() });
    expect(config.dbPath).toBe(path.join(config.dataDir, "f8.db"));
    expect(config.libraryRoot).toBe(path.join(HOME, "Pictures", "f8"));
    // Basenames only: the checkout directory itself may still carry the old name.
    expect(path.basename(config.dbPath)).toBe("f8.db");
    expect(path.basename(config.libraryRoot)).toBe("f8");
  });

  it("prefers F8_* env vars", () => {
    const config = loadConfig(
      {
        F8_DATA: "/tmp/f8-data",
        F8_LIBRARY: "/tmp/f8-lib",
        F8_ROOTS: "/tmp/a:/tmp/b",
        F8_HOST: "0.0.0.0",
        F8_PORT: "5200",
      },
      { homeDir: HOME, exists: missing() },
    );
    expect(config.dataDir).toBe(path.resolve("/tmp/f8-data"));
    expect(config.dbPath).toBe(path.join(path.resolve("/tmp/f8-data"), "f8.db"));
    expect(config.libraryRoot).toBe(path.resolve("/tmp/f8-lib"));
    expect(config.roots).toEqual([path.resolve("/tmp/a"), path.resolve("/tmp/b")]);
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(5200);
  });

  it("keeps PHOTOMATOR_* names as fallback aliases", () => {
    const config = loadConfig(
      {
        PHOTOMATOR_DATA: "/tmp/old-data",
        PHOTOMATOR_LIBRARY: "/tmp/old-lib",
        PHOTOMATOR_ROOTS: "/tmp/r",
        PHOTOMATOR_HOST: "0.0.0.0",
        PHOTOMATOR_PORT: "5201",
      },
      { homeDir: HOME, exists: missing() },
    );
    expect(config.dataDir).toBe(path.resolve("/tmp/old-data"));
    expect(config.libraryRoot).toBe(path.resolve("/tmp/old-lib"));
    expect(config.roots).toEqual([path.resolve("/tmp/r")]);
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(5201);
  });

  it("prefers F8_* over PHOTOMATOR_* when both are set", () => {
    const config = loadConfig(
      { F8_PORT: "5200", PHOTOMATOR_PORT: "5201", F8_DATA: "/tmp/new", PHOTOMATOR_DATA: "/tmp/old" },
      { homeDir: HOME, exists: missing() },
    );
    expect(config.port).toBe(5200);
    expect(config.dataDir).toBe(path.resolve("/tmp/new"));
  });

  it("falls back to the pre-rename catalog when only it exists", () => {
    const dataDir = path.resolve("/tmp/f8-fallback-data");
    const config = loadConfig(
      { F8_DATA: dataDir },
      {
        homeDir: HOME,
        exists: (candidate) => candidate === path.join(dataDir, LEGACY_DB_FILE),
      },
    );
    expect(config.dbPath).toBe(path.join(dataDir, LEGACY_DB_FILE));
  });

  it("falls back to the pre-rename library folder when only it exists", () => {
    const legacyRoot = path.join(HOME, "Pictures", LEGACY_LIBRARY_DIR);
    const config = loadConfig(
      {},
      { homeDir: HOME, exists: (candidate) => candidate === legacyRoot },
    );
    expect(config.libraryRoot).toBe(legacyRoot);
  });

  it("ignores the pre-rename library folder once the new one exists", () => {
    const config = loadConfig(
      {},
      { homeDir: HOME, exists: () => true },
    );
    expect(config.libraryRoot).toBe(path.join(HOME, "Pictures", "f8"));
  });
});

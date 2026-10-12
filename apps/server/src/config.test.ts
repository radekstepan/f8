import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const HOME = path.resolve("/tmp/f8-config-test-home");

describe("loadConfig naming", () => {
  it("defaults to f8 catalog and library paths", () => {
    const config = loadConfig({}, { homeDir: HOME });
    expect(config.dbPath).toBe(path.join(config.dataDir, "f8.db"));
    expect(config.libraryRoot).toBe(path.join(HOME, "Pictures", "f8"));
    // Basenames only: the checkout directory itself may still carry the old name.
    expect(path.basename(config.dbPath)).toBe("f8.db");
    expect(path.basename(config.libraryRoot)).toBe("f8");
  });

  it("defaults host, port, and roots", () => {
    const config = loadConfig({}, { homeDir: HOME });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(5193);
    expect(config.roots).toEqual([HOME]);
    expect(config.previewsDir).toBe(path.join(config.dataDir, "previews"));
    expect(config.tmpDir).toBe(path.join(config.dataDir, "tmp"));
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
      { homeDir: HOME },
    );
    expect(config.dataDir).toBe(path.resolve("/tmp/f8-data"));
    expect(config.dbPath).toBe(path.join(path.resolve("/tmp/f8-data"), "f8.db"));
    expect(config.libraryRoot).toBe(path.resolve("/tmp/f8-lib"));
    expect(config.roots).toEqual([path.resolve("/tmp/a"), path.resolve("/tmp/b")]);
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(5200);
  });

  it("expands ~ in F8_* paths against the home directory", () => {
    const config = loadConfig(
      { F8_DATA: "~/data", F8_LIBRARY: "~/Pictures/custom", F8_ROOTS: "~" },
      { homeDir: HOME },
    );
    expect(config.dataDir).toBe(path.join(HOME, "data"));
    expect(config.dbPath).toBe(path.join(HOME, "data", "f8.db"));
    expect(config.libraryRoot).toBe(path.join(HOME, "Pictures", "custom"));
    expect(config.roots).toEqual([HOME]);
  });

  it("falls back to PORT/HOST for the listener", () => {
    const config = loadConfig({ PORT: "5201", HOST: "0.0.0.0" }, { homeDir: HOME });
    expect(config.port).toBe(5201);
    expect(config.host).toBe("0.0.0.0");
  });
});

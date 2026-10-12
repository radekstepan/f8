import { mkdtempSync, promises as fs, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeJpeg } from "./fixtures.ts";
import { RawDecodeError, decodeRawFullRes } from "./raw-decode.ts";
import type { RawDecodeDeps } from "./raw-decode.ts";

async function tmpContents(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

describe("decodeRawFullRes", () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(path.join(tmpdir(), "photomator-rawdecode-")));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("throws a setup error without spawning when dcraw_emu is missing", async () => {
    const deps: RawDecodeDeps = {
      which: async () => null,
      run: async () => {
        throw new Error("must not spawn");
      },
    };

    const failure = await decodeRawFullRes("/photos/frame.ARW", dir, deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RawDecodeError);
    expect((failure as Error).message).toContain("brew install libraw");
  });

  it("throws a setup error when no JPEG encoder is available", async () => {
    const deps: RawDecodeDeps = {
      which: async (cmd) => (cmd === "dcraw_emu" ? "/bin/dcraw_emu" : null),
      run: async () => {
        throw new Error("must not spawn");
      },
    };

    const failure = await decodeRawFullRes("/photos/frame.ARW", dir, deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RawDecodeError);
    expect((failure as Error).message).toContain("brew install imagemagick");
  });

  it("throws with the decoder detail and leaves no temp files", async () => {
    const deps: RawDecodeDeps = {
      which: async (cmd) => `/bin/${cmd}`,
      run: async () => ({ status: 1, stderr: "unsupported file" }),
    };

    const failure = await decodeRawFullRes("/photos/frame.ARW", dir, deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RawDecodeError);
    expect((failure as Error).message).toContain("unsupported file");
    expect(await tmpContents(dir)).toEqual([]);
  });

  it("decodes to full-res JPEG dimensions and cleans up", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const decoded = makeJpeg(61, 41);
    const deps: RawDecodeDeps = {
      which: async (cmd) => `/bin/${cmd}`,
      run: async (cmd, args) => {
        calls.push({ cmd, args });
        // The decoder writes its TIFF to the -Z path; the encoder writes
        // the JPEG to its last argument.
        if (cmd.endsWith("dcraw_emu")) {
          await fs.writeFile(args[args.indexOf("-Z") + 1] as string, Buffer.from("tiff"));
        } else {
          await fs.writeFile(args[args.length - 1] as string, decoded);
        }
        return { status: 0, stderr: "" };
      },
    };

    const result = await decodeRawFullRes("/photos/frame.ARW", dir, deps);

    expect(result.width).toBe(61);
    expect(result.height).toBe(41);
    expect(Buffer.from(result.bytes)).toEqual(decoded);
    expect(calls[0]?.cmd).toBe("/bin/dcraw_emu");
    expect(calls[1]?.cmd).toBe("/bin/magick");
    expect(await tmpContents(dir)).toEqual([]);
  });

  it("falls back from magick to sips when magick is missing", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const decoded = makeJpeg(9, 7);
    const deps: RawDecodeDeps = {
      which: async (cmd) => (cmd === "magick" || cmd === "convert" ? null : `/bin/${cmd}`),
      run: async (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd.endsWith("dcraw_emu")) {
          await fs.writeFile(args[args.indexOf("-Z") + 1] as string, Buffer.from("tiff"));
        } else {
          await fs.writeFile(args[args.length - 1] as string, decoded);
        }
        return { status: 0, stderr: "" };
      },
    };

    const result = await decodeRawFullRes("/photos/frame.ARW", dir, deps);

    expect(result.width).toBe(9);
    expect(result.height).toBe(7);
    expect(calls[1]?.cmd).toBe("/bin/sips");
    expect(calls[1]?.args.slice(0, 3)).toEqual(["-s", "format", "jpeg"]);
  });

  it("throws when the encoder output is not a JPEG", async () => {
    const deps: RawDecodeDeps = {
      which: async (cmd) => `/bin/${cmd}`,
      run: async (cmd, args) => {
        if (cmd.endsWith("dcraw_emu")) {
          await fs.writeFile(args[args.indexOf("-Z") + 1] as string, Buffer.from("tiff"));
        } else {
          await fs.writeFile(args[args.length - 1] as string, Buffer.from("not a jpeg"));
        }
        return { status: 0, stderr: "" };
      },
    };

    const failure = await decodeRawFullRes("/photos/frame.ARW", dir, deps).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RawDecodeError);
    expect(await tmpContents(dir)).toEqual([]);
  });
});

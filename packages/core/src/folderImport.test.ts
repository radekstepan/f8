import { describe, expect, it } from "vitest";
import {
  collectDroppedFiles,
  groupFilesByFolder,
  topFolderOf,
  type DroppedItem,
} from "./folderImport.js";

function photo(name: string, type = "image/jpeg"): File {
  return new File(["bytes"], name, { type });
}

function entryItem(entry: unknown): DroppedItem {
  return { webkitGetAsEntry: () => entry };
}

function fileEntry(fullPath: string, file: File): unknown {
  return {
    isFile: true,
    isDirectory: false,
    fullPath,
    file: (onSuccess: (found: File) => void) => onSuccess(file),
  };
}

function dirEntry(fullPath: string, batches: unknown[][]): unknown {
  return {
    isFile: false,
    isDirectory: true,
    fullPath,
    createReader: () => {
      let calls = 0;
      return {
        readEntries: (onSuccess: (entries: unknown[]) => void) => {
          onSuccess(batches[calls] ?? []);
          calls += 1;
        },
      };
    },
  };
}

describe("topFolderOf", () => {
  it("reads the first segment of a picker-style relative path", () => {
    expect(topFolderOf("Trips/iceland.jpg")).toBe("Trips");
    expect(topFolderOf("Trips/2024/iceland.jpg")).toBe("Trips");
  });

  it("tolerates entry full paths with a leading slash", () => {
    expect(topFolderOf("/Trips/iceland.jpg")).toBe("Trips");
  });

  it("reads loose files and blanks as null", () => {
    expect(topFolderOf("iceland.jpg")).toBeNull();
    expect(topFolderOf("")).toBeNull();
    expect(topFolderOf(null)).toBeNull();
    expect(topFolderOf(undefined)).toBeNull();
    expect(topFolderOf("Trips/")).toBeNull();
  });

  it("rejects dot segments that would escape the folder", () => {
    expect(topFolderOf("../secret.jpg")).toBeNull();
    expect(topFolderOf("./x.jpg")).toBeNull();
  });
});

describe("groupFilesByFolder", () => {
  it("groups one folder with a humanized album name", () => {
    const a = photo("a.jpg");
    const b = photo("b.jpg");
    const groups = groupFilesByFolder([
      { file: a, relativePath: "2026-europe-trip/a.jpg" },
      { file: b, relativePath: "2026-europe-trip/b.jpg" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.folder).toBe("2026-europe-trip");
    expect(groups[0]?.albumName).toBe("2026 Europe Trip");
    expect(groups[0]?.files).toEqual([a, b]);
  });

  it("files loose files into a group without an album", () => {
    const a = photo("a.jpg");
    const groups = groupFilesByFolder([{ file: a, relativePath: "" }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({ folder: null, albumName: null, files: [a] });
  });

  it("keeps first-seen order across folders and loose files", () => {
    const loose = photo("loose.jpg");
    const a = photo("a.jpg");
    const b = photo("b.jpg");
    const groups = groupFilesByFolder([
      { file: loose, relativePath: "" },
      { file: a, relativePath: "Alpha/a.jpg" },
      { file: b, relativePath: "beta-trip/b.jpg" },
    ]);
    expect(groups.map((group) => group.folder)).toEqual([null, "Alpha", "beta-trip"]);
    expect(groups[2]?.albumName).toBe("Beta Trip");
  });

  it("merges nested paths under their top-level folder", () => {
    const groups = groupFilesByFolder([
      { file: photo("a.jpg"), relativePath: "Trips/2024/a.jpg" },
      { file: photo("b.jpg"), relativePath: "Trips/b.jpg" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.folder).toBe("Trips");
    expect(groups[0]?.files).toHaveLength(2);
  });

  it("keeps case-distinct folders separate for the caller to merge by album name", () => {
    const groups = groupFilesByFolder([
      { file: photo("a.jpg"), relativePath: "Trip/a.jpg" },
      { file: photo("b.jpg"), relativePath: "trip/b.jpg" },
    ]);
    expect(groups.map((group) => group.folder)).toEqual(["Trip", "trip"]);
    expect(groups[0]?.albumName).toBe("Trip");
    expect(groups[1]?.albumName).toBe("Trip");
  });

  it("returns no groups for no files", () => {
    expect(groupFilesByFolder([])).toEqual([]);
  });
});

describe("collectDroppedFiles", () => {
  it("falls back to dataTransfer.files when no items exist", async () => {
    const a = photo("a.jpg");
    await expect(collectDroppedFiles(null, [a])).resolves.toEqual([{ file: a, relativePath: "" }]);
    await expect(collectDroppedFiles([], [a])).resolves.toEqual([{ file: a, relativePath: "" }]);
  });

  it("reads dropped file entries with their full paths", async () => {
    const a = photo("a.jpg");
    const collected = await collectDroppedFiles([entryItem(fileEntry("/Trips/a.jpg", a))], []);
    expect(collected).toEqual([{ file: a, relativePath: "Trips/a.jpg" }]);
  });

  it("traverses dropped folders, draining multi-batch readers", async () => {
    const a = photo("a.jpg");
    const b = photo("b.jpg");
    const nested = dirEntry("/Trips/nested", [[fileEntry("/Trips/nested/b.jpg", b)], []]);
    const root = dirEntry("/Trips", [[fileEntry("/Trips/a.jpg", a)], [nested], []]);
    const collected = await collectDroppedFiles([entryItem(root)], []);
    expect(collected).toEqual([
      { file: a, relativePath: "Trips/a.jpg" },
      { file: b, relativePath: "Trips/nested/b.jpg" },
    ]);
  });

  it("degrades to getAsFile when an item has no entry", async () => {
    const a = photo("a.jpg");
    const collected = await collectDroppedFiles(
      [{ webkitGetAsEntry: () => null, getAsFile: () => a }],
      [],
    );
    expect(collected).toEqual([{ file: a, relativePath: "" }]);
  });

  it("never double-counts entries against the fallback files", async () => {
    const a = photo("a.jpg");
    const collected = await collectDroppedFiles([entryItem(fileEntry("/a.jpg", a))], [a]);
    expect(collected).toEqual([{ file: a, relativePath: "a.jpg" }]);
  });

  it("ignores garbage entries and reads the rest", async () => {
    const a = photo("a.jpg");
    const collected = await collectDroppedFiles(
      [{ webkitGetAsEntry: () => 42, getAsFile: () => a }],
      [],
    );
    expect(collected).toEqual([{ file: a, relativePath: "" }]);
  });

  it("skips unreadable files instead of failing the drop", async () => {
    const good = photo("good.jpg");
    const broken = {
      isFile: true,
      isDirectory: false,
      fullPath: "/broken.jpg",
      file: (_ok: (found: File) => void, onError?: (error: unknown) => void) => onError?.(new Error("locked")),
    };
    const collected = await collectDroppedFiles(
      [entryItem(broken), entryItem(fileEntry("/good.jpg", good))],
      [],
    );
    expect(collected).toEqual([{ file: good, relativePath: "good.jpg" }]);
  });

  it("skips folders whose reader throws", async () => {
    const good = photo("good.jpg");
    const brokenDir = {
      isFile: false,
      isDirectory: true,
      fullPath: "/broken",
      createReader: () => {
        throw new Error("denied");
      },
    };
    const collected = await collectDroppedFiles(
      [entryItem(brokenDir), entryItem(fileEntry("/good.jpg", good))],
      [],
    );
    expect(collected).toEqual([{ file: good, relativePath: "good.jpg" }]);
  });
});

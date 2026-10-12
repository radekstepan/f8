import { describe, expect, it } from "vitest";
import { compareAlbumPhotos, sortAlbumPhotos } from "./albumSort.js";
import type { Photo } from "./types.js";

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "p1",
    name: "DSC00001.ARW",
    title: "Test photo",
    src: "http://localhost/photo.jpg",
    thumbnail: "http://localhost/thumb.jpg",
    albumId: "a1",
    location: "",
    date: "2024-05-01T10:00:00.000Z",
    width: 3000,
    height: 2000,
    camera: "Test camera",
    lens: "Test lens",
    iso: 100,
    aperture: "f/8",
    shutter: "1/250",
    focalLength: "35mm",
    raw: false,
    favorite: false,
    rating: 0,
    importedAt: "2024-06-01T10:00:00.000Z",
    ...overrides,
  };
}

const ids = (photos: Photo[]): string[] => photos.map((photo) => photo.id);

describe("sortAlbumPhotos", () => {
  it("sorts filenames numerically, not lexicographically", () => {
    const photos = [
      makePhoto({ id: "a", name: "DSC10.ARW" }),
      makePhoto({ id: "b", name: "DSC9.ARW" }),
      makePhoto({ id: "c", name: "DSC2.ARW" }),
    ];
    expect(ids(sortAlbumPhotos(photos, "filename", "asc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortAlbumPhotos(photos, "filename", "desc"))).toEqual(["a", "b", "c"]);
  });

  it("sorts by import time, oldest first ascending", () => {
    const photos = [
      makePhoto({ id: "new", importedAt: "2024-06-03T10:00:00.000Z", date: "2024-01-01T10:00:00.000Z" }),
      makePhoto({ id: "old", importedAt: "2024-06-01T10:00:00.000Z", date: "2024-12-01T10:00:00.000Z" }),
    ];
    // Capture dates run opposite on purpose: the imported key must ignore them.
    expect(ids(sortAlbumPhotos(photos, "imported", "asc"))).toEqual(["old", "new"]);
    expect(ids(sortAlbumPhotos(photos, "imported", "desc"))).toEqual(["new", "old"]);
  });

  it("sorts by capture time, oldest first ascending", () => {
    const photos = [
      makePhoto({ id: "new", date: "2024-06-03T10:00:00.000Z", importedAt: "2024-01-01T10:00:00.000Z" }),
      makePhoto({ id: "old", date: "2024-06-01T10:00:00.000Z", importedAt: "2024-12-01T10:00:00.000Z" }),
    ];
    expect(ids(sortAlbumPhotos(photos, "captured", "asc"))).toEqual(["old", "new"]);
    expect(ids(sortAlbumPhotos(photos, "captured", "desc"))).toEqual(["new", "old"]);
  });

  it("falls back to import time when the capture date is missing or garbage", () => {
    const photos = [
      makePhoto({ id: "no-exif", date: "", importedAt: "2024-06-02T10:00:00.000Z" }),
      makePhoto({ id: "garbage", date: "not-a-date", importedAt: "2024-06-03T10:00:00.000Z" }),
      makePhoto({ id: "dated", date: "2024-06-01T10:00:00.000Z", importedAt: "2024-07-01T10:00:00.000Z" }),
    ];
    expect(ids(sortAlbumPhotos(photos, "captured", "asc"))).toEqual(["dated", "no-exif", "garbage"]);
  });

  it("falls back to capture time when the import stamp is missing (demo/legacy records)", () => {
    const photos = [
      makePhoto({ id: "legacy", date: "2024-06-01T10:00:00.000Z", importedAt: undefined }),
      makePhoto({ id: "server", date: "2024-06-02T10:00:00.000Z", importedAt: "2024-06-03T10:00:00.000Z" }),
    ];
    expect(ids(sortAlbumPhotos(photos, "imported", "asc"))).toEqual(["legacy", "server"]);
  });

  it("sinks fully undated photos below dated ones, ordered by filename", () => {
    const photos = [
      makePhoto({ id: "undated-b", name: "b.ARW", date: "", importedAt: null }),
      makePhoto({ id: "dated", name: "a.ARW", date: "2024-06-01T10:00:00.000Z", importedAt: null }),
      makePhoto({ id: "undated-a", name: "a2.ARW", date: "", importedAt: undefined }),
    ];
    expect(ids(sortAlbumPhotos(photos, "captured", "asc"))).toEqual(["dated", "undated-a", "undated-b"]);
  });

  it("breaks timestamp ties by filename, then id, for a deterministic order", () => {
    const stamp = "2024-06-01T10:00:00.000Z";
    const photos = [
      makePhoto({ id: "p2", name: "b.ARW", date: stamp, importedAt: stamp }),
      makePhoto({ id: "p1", name: "a.ARW", date: stamp, importedAt: stamp }),
      makePhoto({ id: "p0", name: "a.ARW", date: stamp, importedAt: stamp }),
    ];
    expect(ids(sortAlbumPhotos(photos, "captured", "asc"))).toEqual(["p0", "p1", "p2"]);
    expect(ids(sortAlbumPhotos(photos, "imported", "desc"))).toEqual(["p2", "p1", "p0"]);
  });

  it("desc is the exact reverse of asc", () => {
    const photos = [
      makePhoto({ id: "a", name: "a.ARW", date: "2024-06-02T10:00:00.000Z", importedAt: "2024-06-01T10:00:00.000Z" }),
      makePhoto({ id: "b", name: "b.ARW", date: "", importedAt: null }),
      makePhoto({ id: "c", name: "c.ARW", date: "2024-06-01T10:00:00.000Z", importedAt: "2024-06-03T10:00:00.000Z" }),
    ];
    for (const key of ["filename", "imported", "captured"] as const) {
      expect(ids(sortAlbumPhotos(photos, key, "desc"))).toEqual(ids(sortAlbumPhotos(photos, key, "asc")).reverse());
    }
  });

  it("does not mutate the input array", () => {
    const photos = [
      makePhoto({ id: "b", name: "b.ARW" }),
      makePhoto({ id: "a", name: "a.ARW" }),
    ];
    sortAlbumPhotos(photos, "filename", "asc");
    expect(ids(photos)).toEqual(["b", "a"]);
  });

  it("compareAlbumPhotos is a total order consistent with the sort", () => {
    const a = makePhoto({ id: "a", name: "a.ARW" });
    const b = makePhoto({ id: "b", name: "b.ARW" });
    expect(compareAlbumPhotos(a, b, "filename")).toBeLessThan(0);
    expect(compareAlbumPhotos(b, a, "filename")).toBeGreaterThan(0);
    expect(compareAlbumPhotos(a, { ...a }, "captured")).toBe(0);
  });
});

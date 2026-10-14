import { describe, expect, it } from "vitest";
import { compareSidebarAlbums, sortSidebarAlbums } from "./sidebarAlbums.js";
import type { Album } from "./types.js";

function makeAlbum(overrides: Partial<Album> = {}): Album {
  return { id: "a1", name: "Road Trip", cover: "", ...overrides };
}

const ids = (albums: Album[]): string[] => albums.map((album) => album.id);

describe("sortSidebarAlbums", () => {
  it("sorts by name within the no-cover group", () => {
    const albums = [
      makeAlbum({ id: "c", name: "Zebra" }),
      makeAlbum({ id: "a", name: "Alpine" }),
      makeAlbum({ id: "b", name: "Harbor" }),
    ];
    expect(ids(sortSidebarAlbums(albums))).toEqual(["a", "b", "c"]);
  });

  it("shows albums with a thumbnail ahead of the ones without", () => {
    const albums = [
      makeAlbum({ id: "plain-a", name: "Aardvark" }),
      makeAlbum({ id: "cover-z", name: "Zulu", cover: "http://localhost/z.jpg" }),
      makeAlbum({ id: "cover-a", name: "Alpha", cover: "http://localhost/a.jpg" }),
      makeAlbum({ id: "plain-b", name: "Bison" }),
    ];
    expect(ids(sortSidebarAlbums(albums))).toEqual([
      "cover-a",
      "cover-z",
      "plain-a",
      "plain-b",
    ]);
  });

  it("treats an empty cover string as no thumbnail", () => {
    const albums = [
      makeAlbum({ id: "empty", name: "Empty", cover: "" }),
      makeAlbum({ id: "covered", name: "Covered", cover: "http://localhost/c.jpg" }),
    ];
    expect(ids(sortSidebarAlbums(albums))).toEqual(["covered", "empty"]);
  });

  it("sorts numeric names numerically, not lexicographically", () => {
    const albums = [
      makeAlbum({ id: "t10", name: "Trip 10" }),
      makeAlbum({ id: "t9", name: "Trip 9" }),
      makeAlbum({ id: "t2", name: "Trip 2" }),
    ];
    expect(ids(sortSidebarAlbums(albums))).toEqual(["t2", "t9", "t10"]);
  });

  it("breaks name ties by id for a deterministic order", () => {
    const albums = [
      makeAlbum({ id: "b", name: "Same" }),
      makeAlbum({ id: "a", name: "Same" }),
    ];
    expect(ids(sortSidebarAlbums(albums))).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const albums = [
      makeAlbum({ id: "b", name: "b" }),
      makeAlbum({ id: "a", name: "a" }),
    ];
    sortSidebarAlbums(albums);
    expect(ids(albums)).toEqual(["b", "a"]);
  });

  it("compareSidebarAlbums is a total order consistent with the sort", () => {
    const covered = makeAlbum({ id: "c", name: "b", cover: "http://localhost/c.jpg" });
    const plain = makeAlbum({ id: "p", name: "a" });
    expect(compareSidebarAlbums(covered, plain)).toBeLessThan(0);
    expect(compareSidebarAlbums(plain, covered)).toBeGreaterThan(0);
    expect(compareSidebarAlbums(plain, { ...plain })).toBe(0);
  });
});

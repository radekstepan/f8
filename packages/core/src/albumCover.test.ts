import { describe, expect, it } from "vitest";
import { pickAlbumCover, type AlbumCoverCandidate } from "./albumCover.js";

function makePhoto(overrides: Partial<AlbumCoverCandidate> = {}): AlbumCoverCandidate {
  return {
    thumbnail: "http://localhost/thumb.jpg",
    src: "http://localhost/photo.jpg",
    favorite: false,
    rating: 0,
    name: "DSC00001.ARW",
    ...overrides,
  };
}

describe("pickAlbumCover", () => {
  it("returns null for an empty album", () => {
    expect(pickAlbumCover([])).toBeNull();
  });

  it("skips missing originals", () => {
    const photos = [
      makePhoto({ name: "a-first.ARW", missing: true }),
      makePhoto({ name: "b-second.ARW", thumbnail: "http://localhost/b.jpg" }),
    ];
    expect(pickAlbumCover(photos)).toBe("http://localhost/b.jpg");
  });

  it("returns null when every photo is missing", () => {
    expect(pickAlbumCover([makePhoto({ missing: true })])).toBeNull();
  });

  it("skips records with no image at all", () => {
    const photos = [
      makePhoto({ name: "a-first.ARW", thumbnail: "", src: "" }),
      makePhoto({ name: "b-second.ARW", thumbnail: "http://localhost/b.jpg" }),
    ];
    expect(pickAlbumCover(photos)).toBe("http://localhost/b.jpg");
  });

  it("prefers a favorite over a higher-rated photo", () => {
    const photos = [
      makePhoto({ name: "a-sharp.ARW", rating: 5, thumbnail: "http://localhost/rated.jpg" }),
      makePhoto({ name: "b-loved.ARW", favorite: true, thumbnail: "http://localhost/loved.jpg" }),
    ];
    expect(pickAlbumCover(photos)).toBe("http://localhost/loved.jpg");
  });

  it("prefers the highest rating when nothing is favorited", () => {
    const photos = [
      makePhoto({ name: "a-low.ARW", rating: 2, thumbnail: "http://localhost/low.jpg" }),
      makePhoto({ name: "b-high.ARW", rating: 4, thumbnail: "http://localhost/high.jpg" }),
    ];
    expect(pickAlbumCover(photos)).toBe("http://localhost/high.jpg");
  });

  it("breaks ties by filename so the pick is deterministic", () => {
    const photos = [
      makePhoto({ name: "b-second.ARW", rating: 3, thumbnail: "http://localhost/b.jpg" }),
      makePhoto({ name: "a-first.ARW", rating: 3, thumbnail: "http://localhost/a.jpg" }),
    ];
    expect(pickAlbumCover(photos)).toBe("http://localhost/a.jpg");
  });

  it("falls back to the full-size src when the thumbnail is empty", () => {
    const photos = [makePhoto({ thumbnail: "", src: "http://localhost/full.jpg" })];
    expect(pickAlbumCover(photos)).toBe("http://localhost/full.jpg");
  });
});

import { describe, expect, it } from "vitest";
import {
  pickAlbumCover,
  rankAlbumCoverCandidates,
  type AlbumCoverCandidate,
} from "./albumCover.js";

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

  it("picks randomly within the top tier in filename order", () => {
    const photos = [
      makePhoto({ name: "c-third.ARW", rating: 3, thumbnail: "http://localhost/c.jpg" }),
      makePhoto({ name: "b-second.ARW", rating: 3, thumbnail: "http://localhost/b.jpg" }),
      makePhoto({ name: "a-first.ARW", rating: 3, thumbnail: "http://localhost/a.jpg" }),
    ];
    expect(pickAlbumCover(photos, { random: () => 0 })).toBe("http://localhost/a.jpg");
    expect(pickAlbumCover(photos, { random: () => 0.5 })).toBe("http://localhost/b.jpg");
    expect(pickAlbumCover(photos, { random: () => 0.999 })).toBe("http://localhost/c.jpg");
  });

  it("never leaves the top tier even at the random extremes", () => {
    const photos = [
      makePhoto({ name: "a-low.ARW", rating: 1, thumbnail: "http://localhost/low.jpg" }),
      makePhoto({ name: "b-high.ARW", rating: 5, thumbnail: "http://localhost/high.jpg" }),
    ];
    expect(pickAlbumCover(photos, { random: () => 0.999 })).toBe("http://localhost/high.jpg");
    expect(pickAlbumCover(photos, { random: () => 0 })).toBe("http://localhost/high.jpg");
  });

  it("excludes the current cover so Generate moves to a different photo", () => {
    const photos = [
      makePhoto({ name: "a-first.ARW", rating: 5, thumbnail: "http://localhost/a.jpg" }),
      makePhoto({ name: "b-second.ARW", rating: 5, thumbnail: "http://localhost/b.jpg" }),
    ];
    expect(
      pickAlbumCover(photos, { exclude: "http://localhost/a.jpg", random: () => 0 }),
    ).toBe("http://localhost/b.jpg");
  });

  it("falls through to the next tier when the cover is the whole top tier", () => {
    const photos = [
      makePhoto({ name: "a-loved.ARW", favorite: true, thumbnail: "http://localhost/loved.jpg" }),
      makePhoto({ name: "b-plain.ARW", thumbnail: "http://localhost/plain.jpg" }),
    ];
    expect(pickAlbumCover(photos, { exclude: "http://localhost/loved.jpg" })).toBe(
      "http://localhost/plain.jpg",
    );
  });

  it("still returns the only photo when it matches the excluded cover", () => {
    const photos = [makePhoto({ thumbnail: "http://localhost/only.jpg" })];
    expect(pickAlbumCover(photos, { exclude: "http://localhost/only.jpg" })).toBe(
      "http://localhost/only.jpg",
    );
  });

  it("ignores an exclude that matches every photo's resolved URL", () => {
    const photos = [
      makePhoto({ name: "a-first.ARW", thumbnail: "", src: "http://localhost/shared.jpg" }),
      makePhoto({ name: "b-second.ARW", thumbnail: "", src: "http://localhost/shared.jpg" }),
    ];
    expect(pickAlbumCover(photos, { exclude: "http://localhost/shared.jpg" })).toBe(
      "http://localhost/shared.jpg",
    );
  });

  it("clamps an out-of-range random source instead of missing the tier", () => {
    const photos = [
      makePhoto({ name: "a-first.ARW", thumbnail: "http://localhost/a.jpg" }),
      makePhoto({ name: "b-second.ARW", thumbnail: "http://localhost/b.jpg" }),
    ];
    expect(pickAlbumCover(photos, { random: () => 1 })).toBe("http://localhost/b.jpg");
    expect(pickAlbumCover(photos, { random: () => -0.5 })).toBe("http://localhost/a.jpg");
  });

  it("falls back to the full-size src when the thumbnail is empty", () => {
    const photos = [makePhoto({ thumbnail: "", src: "http://localhost/full.jpg" })];
    expect(pickAlbumCover(photos)).toBe("http://localhost/full.jpg");
  });
});

describe("rankAlbumCoverCandidates", () => {
  it("orders favorites first, then rating, then filename, skipping unusable", () => {
    const photos = [
      makePhoto({ name: "c-mid.ARW", rating: 3, thumbnail: "http://localhost/c.jpg" }),
      makePhoto({ name: "a-gone.ARW", favorite: true, missing: true }),
      makePhoto({ name: "d-imageless.ARW", favorite: true, thumbnail: "", src: "" }),
      makePhoto({ name: "b-loved.ARW", favorite: true, thumbnail: "http://localhost/b.jpg" }),
      makePhoto({ name: "e-low.ARW", rating: 1, thumbnail: "http://localhost/e.jpg" }),
    ];
    expect(rankAlbumCoverCandidates(photos).map((photo) => photo.thumbnail)).toEqual([
      "http://localhost/b.jpg",
      "http://localhost/c.jpg",
      "http://localhost/e.jpg",
    ]);
  });
});

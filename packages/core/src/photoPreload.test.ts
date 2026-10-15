import { describe, expect, it } from "vitest";
import { PHOTO_PRELOAD_RADIUS, preloadNeighborSrcs } from "./photoPreload.js";

const photos = (srcs: string[]) => srcs.map((src) => ({ src }));

describe("preloadNeighborSrcs", () => {
  it("orders neighbors forward-first, alternating outward", () => {
    const srcs = ["a", "b", "c", "d", "e", "f", "g"].map((name) => `https://img/${name}.jpg`);
    expect(preloadNeighborSrcs(photos(srcs), 3, 3)).toEqual([
      srcs[4],
      srcs[2],
      srcs[5],
      srcs[1],
      srcs[6],
      srcs[0],
    ]);
  });

  it("defaults to the shared preload radius", () => {
    const srcs = ["a", "b", "c", "d", "e"].map((name) => `https://img/${name}.jpg`);
    expect(preloadNeighborSrcs(photos(srcs), 2)).toEqual([srcs[3], srcs[1], srcs[4], srcs[0]]);
    expect(PHOTO_PRELOAD_RADIUS).toBe(2);
  });

  it("wraps around the album ends like the arrow-key handler", () => {
    const srcs = ["a", "b", "c"].map((name) => `https://img/${name}.jpg`);
    // From the last photo, forward wraps to the first.
    expect(preloadNeighborSrcs(photos(srcs), 2, 1)).toEqual([srcs[0], srcs[1]]);
    // From the first photo, back wraps to the last.
    expect(preloadNeighborSrcs(photos(srcs), 0, 1)).toEqual([srcs[1], srcs[2]]);
  });

  it("never includes the current photo, even when the radius overlaps it", () => {
    const srcs = ["a", "b", "c"].map((name) => `https://img/${name}.jpg`);
    expect(preloadNeighborSrcs(photos(srcs), 1, 5)).toEqual([srcs[2], srcs[0]]);
  });

  it("dedupes repeated srcs and skips empty ones", () => {
    const list = photos(["a", "", "a", "b", "c"]);
    expect(preloadNeighborSrcs(list, 4, 3)).toEqual(["a", "b"]);
  });

  it("returns nothing for degenerate inputs", () => {
    expect(preloadNeighborSrcs([], 0)).toEqual([]);
    expect(preloadNeighborSrcs(photos(["a"]), 0)).toEqual([]);
    expect(preloadNeighborSrcs(photos(["a", "b"]), -1)).toEqual([]);
    expect(preloadNeighborSrcs(photos(["a", "b"]), 2)).toEqual([]);
    expect(preloadNeighborSrcs(photos(["a", "b", "c"]), 1, 0)).toEqual([]);
    expect(preloadNeighborSrcs(photos(["a", "b", "c"]), 1, -2)).toEqual([]);
  });
});

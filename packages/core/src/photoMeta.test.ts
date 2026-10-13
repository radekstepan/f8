import { describe, expect, it } from "vitest";
import { applyPhotoMetaPatch, createPendingPhotoMeta } from "./photoMeta.js";
import type { Photo } from "./types.js";

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "p1",
    name: "DSC06308.ARW",
    title: "Alpine morning",
    src: "http://localhost/photo.jpg",
    thumbnail: "http://localhost/thumb.jpg",
    albumId: "a1",
    location: "Dolomites",
    date: "2024-01-01",
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
    ...overrides,
  };
}

describe("applyPhotoMetaPatch", () => {
  it("merges defined keys and leaves the rest untouched", () => {
    const photo = makePhoto({ favorite: false, rating: 2, title: "Before" });
    const next = applyPhotoMetaPatch(photo, { favorite: true, rating: 5 });
    expect(next.favorite).toBe(true);
    expect(next.rating).toBe(5);
    expect(next.title).toBe("Before");
    expect(next.albumId).toBe("a1");
  });

  it("does not mutate the input photo", () => {
    const photo = makePhoto();
    applyPhotoMetaPatch(photo, { favorite: true, title: "After", albumId: "a2" });
    expect(photo.favorite).toBe(false);
    expect(photo.title).toBe("Alpine morning");
    expect(photo.albumId).toBe("a1");
  });

  it("is a no-op returning the same shape when the patch is empty", () => {
    const photo = makePhoto();
    expect(applyPhotoMetaPatch(photo, {})).toBe(photo);
  });
});

describe("createPendingPhotoMeta", () => {
  it("hands out increasing sequence numbers per begin", () => {
    const pending = createPendingPhotoMeta();
    const first = pending.begin("p1", makePhoto(), { favorite: true });
    const second = pending.begin("p1", makePhoto({ favorite: true }), { rating: 4 });
    expect(second).toBeGreaterThan(first);
    expect(pending.pending("p1")).toEqual({ favorite: true, rating: 4 });
  });

  it("keeps a star alive across a stale repair-save response", () => {
    // The repair path PUTs the full photo row on every debounced save; a
    // response reflecting pre-PATCH server state must not wipe the star.
    const pending = createPendingPhotoMeta();
    pending.begin("p1", makePhoto({ favorite: false }), { favorite: true });
    const staleSave = makePhoto({ favorite: false, edited: true });
    const merged = pending.serverPhoto("p1", staleSave);
    expect(merged.favorite).toBe(true);
    expect(merged.edited).toBe(true);
    // The server record itself is never mutated.
    expect(staleSave.favorite).toBe(false);
  });

  it("passes server records through untouched when nothing is pending", () => {
    const pending = createPendingPhotoMeta();
    const photo = makePhoto();
    expect(pending.serverPhoto("p1", photo)).toBe(photo);
    expect(pending.pending("p1")).toBeNull();
  });

  it("tracks photos independently", () => {
    const pending = createPendingPhotoMeta();
    pending.begin("p1", makePhoto(), { favorite: true });
    const other = makePhoto({ id: "p2" });
    expect(pending.serverPhoto("p2", other)).toBe(other);
    expect(pending.pending("p2")).toBeNull();
  });

  it("clears on the latest resolve so the authoritative record lands as-is", () => {
    const pending = createPendingPhotoMeta();
    const seq = pending.begin("p1", makePhoto(), { favorite: true });
    expect(pending.resolve("p1", seq)).toBe(true);
    const authoritative = makePhoto({ favorite: true });
    expect(pending.serverPhoto("p1", authoritative)).toBe(authoritative);
    expect(pending.pending("p1")).toBeNull();
  });

  it("drops a stale resolve without disturbing the newer optimistic state", () => {
    const pending = createPendingPhotoMeta();
    const first = pending.begin("p1", makePhoto({ favorite: false }), { favorite: true });
    const optimistic = applyPhotoMetaPatch(makePhoto({ favorite: false }), { favorite: true });
    const second = pending.begin("p1", optimistic, { favorite: false });
    expect(second).toBeGreaterThan(first);
    // The first PATCH answers after the second toggle: superseded.
    expect(pending.resolve("p1", first)).toBe(false);
    expect(pending.pending("p1")).toEqual({ favorite: false });
    const lateServerPhoto = makePhoto({ favorite: true });
    expect(pending.serverPhoto("p1", lateServerPhoto).favorite).toBe(false);
    expect(pending.resolve("p1", second)).toBe(true);
  });

  it("reject on the latest returns the pre-optimistic values and clears", () => {
    const pending = createPendingPhotoMeta();
    const seq = pending.begin("p1", makePhoto({ favorite: false, rating: 2 }), { favorite: true, rating: 5 });
    expect(pending.reject("p1", seq)).toEqual({ favorite: false, rating: 2 });
    expect(pending.pending("p1")).toBeNull();
  });

  it("keeps the first prev across overlapping toggles so rollback unwinds both", () => {
    const pending = createPendingPhotoMeta();
    const base = makePhoto({ favorite: false });
    const first = pending.begin("p1", base, { favorite: true });
    // Second toggle reads the optimistic state (favorite already true) —
    // prev must stay the pre-optimistic false, not the optimistic true.
    const optimistic = applyPhotoMetaPatch(base, { favorite: true });
    const second = pending.begin("p1", optimistic, { favorite: false });
    expect(pending.reject("p1", second)).toEqual({ favorite: false });
    // And the superseded first failure settles nothing.
    expect(pending.reject("p1", first)).toBeNull();
  });

  it("captures prev for newly touched keys on a follow-up patch", () => {
    const pending = createPendingPhotoMeta();
    const base = makePhoto({ favorite: false, rating: 2 });
    pending.begin("p1", base, { favorite: true });
    const optimistic = applyPhotoMetaPatch(base, { favorite: true });
    const second = pending.begin("p1", optimistic, { rating: 5 });
    expect(pending.reject("p1", second)).toEqual({ favorite: false, rating: 2 });
  });

  it("stale reject leaves the newer optimistic state standing", () => {
    const pending = createPendingPhotoMeta();
    const first = pending.begin("p1", makePhoto(), { favorite: true });
    const optimistic = applyPhotoMetaPatch(makePhoto(), { favorite: true });
    pending.begin("p1", optimistic, { favorite: false });
    expect(pending.reject("p1", first)).toBeNull();
    expect(pending.pending("p1")).toEqual({ favorite: false });
  });

  it("resolve and reject on unknown ids settle nothing", () => {
    const pending = createPendingPhotoMeta();
    expect(pending.resolve("missing", 1)).toBe(false);
    expect(pending.reject("missing", 1)).toBeNull();
  });

  it("star during repair: optimistic, survives the repair save, then reconciles", () => {
    const pending = createPendingPhotoMeta();
    // 1. Repair is running; the user stars. Local state flips at once.
    const base = makePhoto({ favorite: false });
    const starred = applyPhotoMetaPatch(base, { favorite: true });
    const seq = pending.begin("p1", base, { favorite: true });
    expect(starred.favorite).toBe(true);
    // 2. A repair saveEdit PUT answers with pre-PATCH server state.
    const repairSave = makePhoto({ favorite: false, edited: true });
    const merged = pending.serverPhoto("p1", repairSave);
    expect(merged.favorite).toBe(true);
    expect(merged.edited).toBe(true);
    // 3. The PATCH answers; the authoritative record lands as-is.
    expect(pending.resolve("p1", seq)).toBe(true);
    const authoritative = makePhoto({ favorite: true, edited: true });
    expect(pending.serverPhoto("p1", authoritative)).toBe(authoritative);
  });
});

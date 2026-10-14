import { describe, expect, it } from "vitest";
import { resolveBacklinkCollection, shouldShowPhotoBacklink } from "./photoBacklink.js";
import type { Photo } from "./types.js";

describe("shouldShowPhotoBacklink", () => {
  it("shows the backlink on an open photo (editor view)", () => {
    expect(shouldShowPhotoBacklink("editor")).toBe(true);
  });

  it("hides the backlink in the library view — the grid is already home", () => {
    expect(shouldShowPhotoBacklink("library")).toBe(false);
  });
});

describe("resolveBacklinkCollection", () => {
  const photo = (overrides: Partial<Photo> = {}): Photo => ({
    id: "p1",
    name: "DSC00001.ARW",
    title: "Test photo",
    src: "http://localhost/photo.jpg",
    thumbnail: "http://localhost/thumb.jpg",
    albumId: "a1",
    location: "",
    date: "2024-01-01",
    width: 3000,
    height: 2000,
    camera: "",
    lens: "",
    iso: 100,
    aperture: "f/8",
    shutter: "1/250",
    focalLength: "35mm",
    raw: false,
    favorite: false,
    rating: 0,
    ...overrides,
  });

  it("returns null on a photo before the initial inference settles (no 'All Photos' flash)", () => {
    expect(resolveBacklinkCollection("editor", photo(), "all", false)).toBeNull();
  });

  it("returns null on a photo with no photo loaded yet", () => {
    expect(resolveBacklinkCollection("editor", null, "all", true)).toBeNull();
    expect(resolveBacklinkCollection("editor", null, "all", false)).toBeNull();
  });

  it("names the collection once settled when the photo belongs to it", () => {
    expect(resolveBacklinkCollection("editor", photo(), "all", true)).toBe("all");
    expect(resolveBacklinkCollection("editor", photo({ albumId: "a1" }), "a1", true)).toBe("a1");
    expect(resolveBacklinkCollection("editor", photo({ favorite: true }), "favorites", true)).toBe("favorites");
  });

  it("names the photo's album mid-switch, before the inference effect runs", () => {
    // Filmstrip switch across albums: the photo is settled but outside the
    // stale collection — name where the effect is about to land, not the
    // stale name for a frame.
    expect(resolveBacklinkCollection("editor", photo({ albumId: "b2" }), "a1", true)).toBe("b2");
  });

  it("always names the collection in the library grid (static title, never pending)", () => {
    expect(resolveBacklinkCollection("library", null, "a1", false)).toBe("a1");
    expect(resolveBacklinkCollection("library", photo(), "favorites", false)).toBe("favorites");
  });
});

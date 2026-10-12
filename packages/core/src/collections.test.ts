import { describe, expect, it } from "vitest";
import { collectionForPhoto, isBuiltInCollection, isDeletableCollection, isRecentlyEdited, photoInCollection } from "./collections.js";
import type { Photo } from "./types.js";

function photo(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "photo-9",
    name: "coast.jpg",
    title: "Along the Sardinian coast",
    src: "https://example.com/coast.jpg",
    thumbnail: "https://example.com/coast-thumb.jpg",
    albumId: "coast",
    location: "Sardinia",
    date: "2024-06-01",
    width: 6000,
    height: 4000,
    camera: "X-T5",
    lens: "23mm",
    iso: 200,
    aperture: "f/8",
    shutter: "1/250",
    focalLength: "23mm",
    raw: false,
    favorite: false,
    rating: 0,
    ...overrides,
  };
}

const NOW = new Date("2024-06-15T12:00:00.000Z").getTime();
const daysAgo = (days: number): string => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

describe("isRecentlyEdited", () => {
  it("accepts edits from within the last week", () => {
    expect(isRecentlyEdited(photo({ edited: true, editedAt: daysAgo(0) }), NOW)).toBe(true);
    expect(isRecentlyEdited(photo({ edited: true, editedAt: daysAgo(6) }), NOW)).toBe(true);
    expect(isRecentlyEdited(photo({ edited: true, editedAt: daysAgo(7) }), NOW)).toBe(true);
  });

  it("rejects edits older than a week", () => {
    expect(isRecentlyEdited(photo({ edited: true, editedAt: daysAgo(8) }), NOW)).toBe(false);
    expect(isRecentlyEdited(photo({ edited: true, editedAt: daysAgo(30) }), NOW)).toBe(false);
  });

  it("rejects unedited photos even with a timestamp", () => {
    expect(isRecentlyEdited(photo({ edited: false, editedAt: daysAgo(0) }), NOW)).toBe(false);
    expect(isRecentlyEdited(photo({ editedAt: daysAgo(0) }), NOW)).toBe(false);
  });

  it("fails open on a missing or unparseable timestamp", () => {
    expect(isRecentlyEdited(photo({ edited: true }), NOW)).toBe(true);
    expect(isRecentlyEdited(photo({ edited: true, editedAt: null }), NOW)).toBe(true);
    expect(isRecentlyEdited(photo({ edited: true, editedAt: "not-a-date" }), NOW)).toBe(true);
  });
});

describe("photoInCollection", () => {
  it("lists every photo under All Photos", () => {
    expect(photoInCollection(photo(), "all")).toBe(true);
  });

  it("matches albums by albumId", () => {
    expect(photoInCollection(photo(), "coast")).toBe(true);
    expect(photoInCollection(photo(), "dolomites")).toBe(false);
  });

  it("matches Favorites by flag", () => {
    expect(photoInCollection(photo({ favorite: true }), "favorites")).toBe(true);
    expect(photoInCollection(photo(), "favorites")).toBe(false);
  });

  it("matches Recently Edited by edited flag plus recency", () => {
    expect(photoInCollection(photo({ edited: true, editedAt: daysAgo(1) }), "edited", NOW)).toBe(true);
    expect(photoInCollection(photo({ edited: true, editedAt: daysAgo(30) }), "edited", NOW)).toBe(false);
    expect(photoInCollection(photo(), "edited", NOW)).toBe(false);
  });
});

describe("collectionForPhoto", () => {
  it("infers the photo's album", () => {
    expect(collectionForPhoto(photo())).toBe("coast");
    expect(collectionForPhoto(photo({ albumId: "dolomites" }))).toBe("dolomites");
  });
});

describe("built-in collections", () => {
  it("recognizes the three computed collections", () => {
    for (const id of ["all", "favorites", "edited"]) {
      expect(isBuiltInCollection(id)).toBe(true);
      expect(isDeletableCollection(id)).toBe(false);
    }
  });

  it("treats every other id as a deletable user album", () => {
    for (const id of ["coast", "imports", "All", "ALL", ""]) {
      expect(isBuiltInCollection(id)).toBe(false);
      expect(isDeletableCollection(id)).toBe(true);
    }
  });
});

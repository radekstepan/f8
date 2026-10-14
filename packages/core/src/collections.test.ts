import { describe, expect, it } from "vitest";
import { collectionForPhoto, isBuiltInCollection, isDeletableCollection, isRecentlyEdited, photoInCollection, ratingCollectionId, ratingCollectionLabel, ratingForCollection, resolveCollectionClick, savedRatings } from "./collections.js";
import { buildLibraryUrl, parseLibraryUrl } from "./libraryUrl.js";
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

describe("resolveCollectionClick", () => {
  it("deselects a re-clicked user album back to All Photos in the grid", () => {
    expect(resolveCollectionClick("coast", "coast", "library")).toBe("all");
  });

  it("deselects the re-clicked built-ins too — All is the deselected state", () => {
    expect(resolveCollectionClick("favorites", "favorites", "library")).toBe("all");
    expect(resolveCollectionClick("edited", "edited", "library")).toBe("all");
  });

  it("treats re-clicking All Photos as a no-op", () => {
    expect(resolveCollectionClick("all", "all", "library")).toBe("all");
    expect(resolveCollectionClick("all", "all", "editor")).toBe("all");
  });

  it("selects a different collection as clicked", () => {
    expect(resolveCollectionClick("coast", "dolomites", "library")).toBe("dolomites");
    expect(resolveCollectionClick("all", "favorites", "library")).toBe("favorites");
    expect(resolveCollectionClick("coast", "all", "library")).toBe("all");
  });

  it("does not toggle inside a photo: the click navigates to that grid", () => {
    // Editor view highlights the open photo's inferred collection, which
    // the user never picked — clicking it opens its grid, not All Photos.
    expect(resolveCollectionClick("coast", "coast", "editor")).toBe("coast");
    expect(resolveCollectionClick("coast", "dolomites", "editor")).toBe("dolomites");
  });

  it("keeps the toggled state, URL, and grid listing consistent", () => {
    const next = resolveCollectionClick("coast", "coast", "library");
    // The grid URL for the resolved state round-trips to the same
    // collection, and that collection lists every photo.
    expect(parseLibraryUrl(buildLibraryUrl({ view: "library", collectionId: next })).collectionId).toBe("all");
    expect(photoInCollection(photo(), next)).toBe(true);
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

describe("star-rating smart albums", () => {
  it("builds one collection id per rating", () => {
    expect(ratingCollectionId(5)).toBe("rating-5");
    expect(ratingCollectionId(1)).toBe("rating-1");
  });

  it("parses only ratings 1..5 from collection ids", () => {
    expect(ratingForCollection("rating-5")).toBe(5);
    expect(ratingForCollection("rating-1")).toBe(1);
    for (const id of ["all", "favorites", "coast", "rating-0", "rating-6", "rating-x", "rating-", "rating-3x", "Rating-5"]) {
      expect(ratingForCollection(id)).toBeNull();
    }
  });

  it("labels ratings with a singular one-star form", () => {
    expect(ratingCollectionLabel(1)).toBe("1 Star");
    expect(ratingCollectionLabel(5)).toBe("5 Stars");
  });

  it("lists the distinct saved ratings, highest first", () => {
    const photos = [photo({ rating: 3 }), photo({ rating: 5 }), photo({ rating: 3 }), photo({ rating: 0 })];
    expect(savedRatings(photos)).toEqual([5, 3]);
  });

  it("ignores unrated and out-of-range ratings", () => {
    expect(savedRatings([photo({ rating: 0 }), photo({ rating: 0 })])).toEqual([]);
    expect(savedRatings([photo({ rating: 7 }), photo({ rating: -1 }), photo({ rating: 2.5 })])).toEqual([]);
  });

  it("matches photos by exact rating", () => {
    expect(photoInCollection(photo({ rating: 5 }), "rating-5")).toBe(true);
    expect(photoInCollection(photo({ rating: 4 }), "rating-5")).toBe(false);
    expect(photoInCollection(photo({ rating: 0 }), "rating-5")).toBe(false);
  });

  it("treats smart albums as built-in: never deletable", () => {
    for (const id of ["rating-1", "rating-3", "rating-5"]) {
      expect(isBuiltInCollection(id)).toBe(true);
      expect(isDeletableCollection(id)).toBe(false);
    }
  });

  it("falls invalid rating ids through to album matching", () => {
    expect(photoInCollection(photo({ albumId: "rating-0" }), "rating-0")).toBe(true);
    expect(photoInCollection(photo(), "rating-0")).toBe(false);
  });

  it("round-trips a smart album through the grid URL", () => {
    const id = ratingCollectionId(4);
    expect(parseLibraryUrl(buildLibraryUrl({ view: "library", collectionId: id })).collectionId).toBe(id);
    expect(photoInCollection(photo({ rating: 4 }), id)).toBe(true);
  });
});

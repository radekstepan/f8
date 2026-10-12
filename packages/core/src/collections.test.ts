import { describe, expect, it } from "vitest";
import { collectionForPhoto, photoInCollection } from "./collections.js";
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

  it("matches Recently Edited by edited flag", () => {
    expect(photoInCollection(photo({ edited: true }), "edited")).toBe(true);
    expect(photoInCollection(photo(), "edited")).toBe(false);
  });

  it("matches Imports by the imports album", () => {
    expect(photoInCollection(photo({ albumId: "imports" }), "imports")).toBe(true);
    expect(photoInCollection(photo(), "imports")).toBe(false);
  });

  it("matches RAW Photos by flag", () => {
    expect(photoInCollection(photo({ raw: true }), "raw")).toBe(true);
    expect(photoInCollection(photo(), "raw")).toBe(false);
  });

  it("matches Landscapes by landscape geometry", () => {
    expect(photoInCollection(photo(), "landscapes")).toBe(true);
    expect(photoInCollection(photo({ width: 4000, height: 6000 }), "landscapes")).toBe(false);
  });
});

describe("collectionForPhoto", () => {
  it("infers the photo's album", () => {
    expect(collectionForPhoto(photo())).toBe("coast");
    expect(collectionForPhoto(photo({ albumId: "dolomites" }))).toBe("dolomites");
  });
});

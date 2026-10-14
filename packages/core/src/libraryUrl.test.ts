import { describe, expect, it } from "vitest";
import { buildLibraryUrl, parseLibraryUrl } from "./libraryUrl.js";

describe("parseLibraryUrl", () => {
  it("reads the photo and tool from an editor path", () => {
    expect(parseLibraryUrl("/photo/photo-9/crop")).toEqual({
      photoId: "photo-9",
      collectionId: null,
      tool: "crop",
    });
  });

  it("defaults the tool when the segment is omitted", () => {
    expect(parseLibraryUrl("/photo/photo-1")).toEqual({
      photoId: "photo-1",
      collectionId: null,
      tool: null,
    });
  });

  it("reads the album from a library path", () => {
    expect(parseLibraryUrl("/album/coast")).toEqual({
      photoId: null,
      collectionId: "coast",
      tool: null,
    });
  });

  it("ignores an invalid tool segment", () => {
    expect(parseLibraryUrl("/photo/photo-1/heal").tool).toBeNull();
  });

  it("tolerates trailing slashes", () => {
    expect(parseLibraryUrl("/photo/photo-1/crop/").photoId).toBe("photo-1");
    expect(parseLibraryUrl("/album/coast/").collectionId).toBe("coast");
  });

  it("reads nothing from a bare, unknown, or incomplete path", () => {
    expect(parseLibraryUrl("/")).toEqual({ photoId: null, collectionId: null, tool: null });
    expect(parseLibraryUrl("")).toEqual({ photoId: null, collectionId: null, tool: null });
    expect(parseLibraryUrl("/settings")).toEqual({ photoId: null, collectionId: null, tool: null });
    expect(parseLibraryUrl("/photo")).toEqual({ photoId: null, collectionId: null, tool: null });
    expect(parseLibraryUrl("/album")).toEqual({ photoId: null, collectionId: null, tool: null });
  });

  it("ignores extra segments after a valid route", () => {
    expect(parseLibraryUrl("/photo/photo-9/crop/extra").photoId).toBe("photo-9");
    expect(parseLibraryUrl("/album/coast/extra").collectionId).toBe("coast");
  });

  it("decodes percent-encoded ids", () => {
    expect(parseLibraryUrl("/album/my%20album").collectionId).toBe("my album");
    expect(parseLibraryUrl("/photo/photo%201/adjust").photoId).toBe("photo 1");
  });

  it("reads a legacy photo query when the path is bare", () => {
    expect(parseLibraryUrl("/", "?photo=photo-9&tool=crop")).toEqual({
      photoId: "photo-9",
      collectionId: null,
      tool: "crop",
    });
  });

  it("reads a legacy album query when the path is bare", () => {
    expect(parseLibraryUrl("/", "?album=coast")).toEqual({
      photoId: null,
      collectionId: "coast",
      tool: null,
    });
  });

  it("accepts a legacy collection param as an album alias", () => {
    expect(parseLibraryUrl("/", "?collection=favorites").collectionId).toBe("favorites");
  });

  it("prefers album over the legacy collection alias", () => {
    expect(parseLibraryUrl("/", "?album=coast&collection=favorites").collectionId).toBe("coast");
  });

  it("lets the photo win when both photo and album are present", () => {
    const parsed = parseLibraryUrl("/", "?photo=photo-9&album=favorites");
    expect(parsed.photoId).toBe("photo-9");
    expect(parsed.collectionId).toBe("favorites");
  });

  it("ignores an invalid legacy tool", () => {
    expect(parseLibraryUrl("/", "?photo=photo-1&tool=heal").tool).toBeNull();
    expect(parseLibraryUrl("/", "?photo=photo-1").tool).toBeNull();
  });

  it("treats empty legacy values as absent", () => {
    expect(parseLibraryUrl("/", "?photo=&album=&tool=")).toEqual({
      photoId: null,
      collectionId: null,
      tool: null,
    });
  });

  it("lets the path win over legacy query params", () => {
    expect(parseLibraryUrl("/album/coast", "?photo=photo-9")).toEqual({
      photoId: null,
      collectionId: "coast",
      tool: null,
    });
  });

  it("reads nothing from an empty or foreign query", () => {
    expect(parseLibraryUrl("/", "")).toEqual({ photoId: null, collectionId: null, tool: null });
    expect(parseLibraryUrl("/", "?utm_source=x")).toEqual({ photoId: null, collectionId: null, tool: null });
  });
});

describe("buildLibraryUrl", () => {
  it("writes photo and tool for the editor view", () => {
    expect(buildLibraryUrl({ view: "editor", photoId: "photo-9", tool: "crop" })).toBe(
      "/photo/photo-9/crop",
    );
  });

  it("writes only the album for the library view", () => {
    expect(buildLibraryUrl({ view: "library", collectionId: "coast" })).toBe("/album/coast");
  });

  it("round-trips both views through the parser", () => {
    const editor = buildLibraryUrl({ view: "editor", photoId: "photo-2", tool: "repair" });
    expect(parseLibraryUrl(editor)).toEqual({ photoId: "photo-2", collectionId: null, tool: "repair" });
    const library = buildLibraryUrl({ view: "library", collectionId: "favorites" });
    expect(parseLibraryUrl(library)).toEqual({ photoId: null, collectionId: "favorites", tool: null });
  });

  it("encodes collection ids that need it", () => {
    const built = buildLibraryUrl({ view: "library", collectionId: "my album" });
    expect(parseLibraryUrl(built).collectionId).toBe("my album");
  });

  it("normalizes legacy links to the path form through the parser", () => {
    const legacy = parseLibraryUrl("/", "?photo=photo-9&tool=crop");
    expect(legacy.photoId).toBe("photo-9");
    expect(buildLibraryUrl({ view: "editor", photoId: legacy.photoId ?? "", tool: legacy.tool ?? "adjust" })).toBe(
      "/photo/photo-9/crop",
    );
    const grid = parseLibraryUrl("/", "?collection=favorites");
    expect(buildLibraryUrl({ view: "library", collectionId: grid.collectionId ?? "" })).toBe("/album/favorites");
  });
});

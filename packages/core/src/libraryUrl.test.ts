import { describe, expect, it } from "vitest";
import { buildLibraryUrl, parseLibraryUrl } from "./libraryUrl.js";

describe("parseLibraryUrl", () => {
  it("reads the photo and tool from an editor URL", () => {
    expect(parseLibraryUrl("?photo=photo-9&tool=crop")).toEqual({
      photoId: "photo-9",
      collectionId: null,
      tool: "crop",
    });
  });

  it("accepts a query string without the leading question mark", () => {
    expect(parseLibraryUrl("photo=photo-1&tool=repair").photoId).toBe("photo-1");
  });

  it("reads the album from a library URL", () => {
    expect(parseLibraryUrl("?album=coast")).toEqual({
      photoId: null,
      collectionId: "coast",
      tool: null,
    });
  });

  it("accepts a legacy collection param as an album alias", () => {
    expect(parseLibraryUrl("?collection=favorites").collectionId).toBe("favorites");
  });

  it("prefers album over the legacy collection alias", () => {
    expect(parseLibraryUrl("?album=coast&collection=favorites").collectionId).toBe("coast");
  });

  it("lets the photo win when both photo and album are present", () => {
    const parsed = parseLibraryUrl("?photo=photo-9&album=favorites");
    expect(parsed.photoId).toBe("photo-9");
    expect(parsed.collectionId).toBe("favorites");
  });

  it("ignores an invalid tool", () => {
    expect(parseLibraryUrl("?photo=photo-1&tool=heal").tool).toBeNull();
    expect(parseLibraryUrl("?photo=photo-1").tool).toBeNull();
  });

  it("treats empty values as absent", () => {
    expect(parseLibraryUrl("?photo=&album=&tool=")).toEqual({
      photoId: null,
      collectionId: null,
      tool: null,
    });
  });

  it("reads nothing from an empty or foreign query", () => {
    expect(parseLibraryUrl("")).toEqual({ photoId: null, collectionId: null, tool: null });
    expect(parseLibraryUrl("?utm_source=x")).toEqual({ photoId: null, collectionId: null, tool: null });
  });
});

describe("buildLibraryUrl", () => {
  it("writes photo and tool for the editor view", () => {
    expect(buildLibraryUrl({ view: "editor", photoId: "photo-9", tool: "crop" })).toBe(
      "?photo=photo-9&tool=crop",
    );
  });

  it("writes only the album for the library view", () => {
    expect(buildLibraryUrl({ view: "library", collectionId: "coast" })).toBe("?album=coast");
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
});

import { describe, expect, it } from "vitest";
import { humanizeAlbumName } from "./albumNames.js";

describe("humanizeAlbumName", () => {
  it("turns a dashed folder name into a title", () => {
    expect(humanizeAlbumName("2026-europe-trip")).toBe("2026 Europe Trip");
  });

  it("treats underscores and spaces as separators", () => {
    expect(humanizeAlbumName("summer_trip__2024")).toBe("Summer Trip 2024");
    expect(humanizeAlbumName("  spaced   out  ")).toBe("Spaced Out");
    expect(humanizeAlbumName("mixed-separators_and spaces")).toBe("Mixed Separators And Spaces");
  });

  it("keeps already-human names and inner casing intact", () => {
    expect(humanizeAlbumName("My Trip")).toBe("My Trip");
    expect(humanizeAlbumName("IMG_20240101")).toBe("IMG 20240101");
    expect(humanizeAlbumName("McDonald-farm")).toBe("McDonald Farm");
  });

  it("falls back when nothing readable remains", () => {
    expect(humanizeAlbumName("")).toBe("Imported Photos");
    expect(humanizeAlbumName("---")).toBe("Imported Photos");
    expect(humanizeAlbumName("___")).toBe("Imported Photos");
  });

  it("caps the title at the album-name limit", () => {
    const title = humanizeAlbumName(`${"a".repeat(30)}-${"b".repeat(30)}-tail`);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toBe(`A${"a".repeat(29)} B${"b".repeat(28)}`);
  });
});

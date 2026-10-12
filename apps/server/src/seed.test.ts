import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedIfNeeded } from "./seed.ts";
import { createTestContext } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";

describe("seedIfNeeded", () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.close();
  });

  it("seeds the sample library once, every photo on Original", () => {
    expect(seedIfNeeded(ctx.store)).toBe(true);

    const photos = ctx.store.listPhotos();
    expect(photos).toHaveLength(12);
    expect(photos.every((photo) => photo.kind === "url")).toBe(true);
    expect(ctx.store.listAlbums()).toHaveLength(3);

    for (const photo of photos) {
      const edit = ctx.store.getEdit(photo.id);
      expect(edit.edited).toBe(false);
      expect(edit.present.preset).toBe("Original");
    }
    expect(ctx.store.getEdit("photo-1").present.exposure).toBe(0);

    expect(seedIfNeeded(ctx.store)).toBe(false);
    expect(ctx.store.listPhotos()).toHaveLength(12);
  });
});

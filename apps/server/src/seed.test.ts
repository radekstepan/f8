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

  it("seeds the sample library once, with photo-1 already developed", () => {
    expect(seedIfNeeded(ctx.store)).toBe(true);

    const photos = ctx.store.listPhotos();
    expect(photos).toHaveLength(12);
    expect(photos.every((photo) => photo.kind === "url")).toBe(true);
    expect(ctx.store.listAlbums()).toHaveLength(3);

    const first = ctx.store.getEdit("photo-1");
    expect(first.edited).toBe(true);
    expect(first.present.preset).toBe("Natural");
    expect(first.present.exposure).toBe(0.15);

    const second = ctx.store.getEdit("photo-2");
    expect(second.edited).toBe(false);
    expect(second.present.preset).toBe("Original");

    expect(seedIfNeeded(ctx.store)).toBe(false);
    expect(ctx.store.listPhotos()).toHaveLength(12);
  });
});

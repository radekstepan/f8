import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EDIT } from "@f8/core";
import type { ActionStack, LibraryPhoto, LibrarySnapshot } from "@f8/core";
import { createTestContext, makeBmp } from "./fixtures.ts";
import type { TestContext } from "./fixtures.ts";

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const STACK: ActionStack = [
  {
    kind: "enhance",
    mode: "scene",
    pure: true,
    snapshot: { exposure: 0, contrast: 0, preset: "Original" },
    appliedAt: "2026-10-13T00:00:00.000Z",
  },
];

describe("persisted action stack", () => {
  let ctx: TestContext;
  let id: string;

  async function putEdit(body: unknown): Promise<LibraryPhoto> {
    const response = await ctx.app.request(`/api/photos/${id}/edit`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return (await json<{ photo: LibraryPhoto }>(response)).photo;
  }

  async function libraryPhoto(): Promise<LibraryPhoto> {
    const library = await json<LibrarySnapshot>(await ctx.app.request("/api/library"));
    const photo = library.photos.find((entry) => entry.id === id);
    expect(photo).toBeDefined();
    return photo as LibraryPhoto;
  }

  beforeEach(async () => {
    ctx = createTestContext();
    const uploaded = await json<{ photo: LibraryPhoto; deduplicated: boolean }>(
      await ctx.app.request("/api/imports/upload", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": "stack.bmp" },
        body: makeBmp(8, 6),
      }),
    );
    id = uploaded.photo.id;
  });

  afterEach(() => {
    ctx.close();
  });

  it("serves an empty stack for fresh imports", async () => {
    expect((await libraryPhoto()).actions).toEqual([]);
  });

  it("round-trips the stack with the recipe", async () => {
    const saved = await putEdit({ present: { ...DEFAULT_EDIT, exposure: 0.22 }, actions: STACK });
    expect(saved.actions).toEqual(STACK);
    // A reload (fresh GET) sees the same stack, so the enhance keeps its revert.
    expect((await libraryPhoto()).actions).toEqual(STACK);
  });

  it("drops legacy per-category entries on save", async () => {
    // Pre-toggle clients persisted white-balance/lightness/color entries;
    // nothing reads them anymore (section toggles read the recipe), so the
    // sanitizer sheds them while the enhance entry round-trips.
    const saved = await putEdit({
      present: { ...DEFAULT_EDIT, exposure: 0.22 },
      actions: [
        ...STACK,
        {
          kind: "whiteBalance",
          pure: false,
          snapshot: { temperature: 5500, tint: 0, whiteBalanceEnabled: true },
          appliedAt: "2026-10-13T00:01:00.000Z",
        },
      ],
    });
    expect(saved.actions).toEqual(STACK);
    expect((await libraryPhoto()).actions).toEqual(STACK);
  });

  it("preserves the stored stack when the writer omits it", async () => {
    await putEdit({ present: { ...DEFAULT_EDIT, exposure: 0.22 }, actions: STACK });
    // Legacy recipe-only writers (older clients, scripts) must never wipe reverts.
    const saved = await putEdit({ present: { ...DEFAULT_EDIT, exposure: 0.4 } });
    expect(saved.edit.exposure).toBe(0.4);
    expect(saved.actions).toEqual(STACK);
    expect((await libraryPhoto()).actions).toEqual(STACK);
  });

  it("clears the stack when the writer sends an empty one", async () => {
    await putEdit({ present: { ...DEFAULT_EDIT, exposure: 0.22 }, actions: STACK });
    const saved = await putEdit({ present: { ...DEFAULT_EDIT }, actions: [] });
    expect(saved.actions).toEqual([]);
    expect((await libraryPhoto()).actions).toEqual([]);
  });

  it("sanitizes invalid entries instead of rejecting the save", async () => {
    const saved = await putEdit({
      present: { ...DEFAULT_EDIT, exposure: 0.22 },
      actions: [
        ...STACK,
        { kind: "straighten", pure: true, snapshot: { straighten: 0 }, appliedAt: "2026-10-13T00:02:00.000Z" },
        { kind: "color", pure: true, snapshot: null, appliedAt: "2026-10-13T00:03:00.000Z" },
      ],
    });
    expect(saved.actions).toEqual(STACK);
  });

  it("never marks a photo edited for the stack alone", async () => {
    const saved = await putEdit({ present: { ...DEFAULT_EDIT }, actions: STACK });
    expect(saved.edited).toBe(false);
    expect(saved.editedAt).toBeNull();
  });
});

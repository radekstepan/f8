// apps/web/tests/e2e/collection-filters.spec.ts
//
// Locks two behaviors (App.tsx + PhotoStrips.tsx):
//   - collection inference: the open photo decides the collection —
//     reloading on a photo highlights that photo's album in the sidebar
//     and filmstrip, the editor URL never carries a collection (stale
//     legacy query params are ignored and stripped), and sidebar clicks
//     switch the grid to that album's /album/<id> URL (deep-linkable,
//     and Back returns to it).
//   - library edited/favorite chip filters: they narrow the grid and the
//     filmstrip (shared filteredPhotos), combine, clear, and empty-state.
//   - Library sidebar shortcuts: Favorites and Recently Edited turn on the
//     matching chip filters (Recently Edited additionally implies the
//     last-week recency window); there is no Imports entry and no Smart
//     Albums section. Touching any chip inside a shortcut drops back to
//     All Photos with that filter applied.
//
// State is API-seeded (PUT /api/photos/:id/edit) for determinism: every test
// resets all photos to DEFAULT_EDIT, then marks photo-2 edited. Favorites
// stay seed-stable (photo-1/4/10 favorited) and are never mutated here.
// Seed images are stubbed to a local SVG (no network), same as basic.spec.ts.
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_EDIT } from "@f8/core";
import { awaitEditor, stubLibraryImages } from "./helpers";

const EDITED_ID = "photo-2";
const EDITED_TITLE = "The stillness of the mountains";
const COAST_ID = "photo-9";
const COAST_TITLE = "Along the Sardinian coast";
const COAST_FAV_TITLE = "The last light in Tellaro";

async function libraryIds(page: Page): Promise<string[]> {
  const res = await page.request.get("/api/library");
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { photos: { id: string }[] };
  return body.photos.map((photo) => photo.id);
}

/** Reset every photo to unedited, then mark exactly one photo edited. */
async function seedEditedState(page: Page): Promise<void> {
  for (const id of await libraryIds(page)) {
    const put = await page.request.put(`/api/photos/${id}/edit`, {
      data: { present: { ...DEFAULT_EDIT, retouches: [] } },
    });
    expect(put.ok()).toBeTruthy();
  }
  const mark = await page.request.put(`/api/photos/${EDITED_ID}/edit`, {
    data: { present: { ...DEFAULT_EDIT, exposure: 1, retouches: [] } },
  });
  expect(mark.ok()).toBeTruthy();
}

// Album name patterns below must anchor at the start: every album row also
// has an "Album actions for <name>" menu trigger matching a loose substring.
function sidebar(page: Page) {
  return page.getByRole("complementary", { name: "Photo library" });
}

function filmstrip(page: Page) {
  return page.locator("section.filmstrip");
}

function grid(page: Page) {
  return page.locator("section.photo-browser");
}

async function openLibraryOnAll(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: /^All Photos/ }).click();
  await expect(grid(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await stubLibraryImages(page);
  await page.goto("/");
  await seedEditedState(page);
});

test.afterEach(async ({ page }) => {
  // Leave the shared library pristine (no edited photos) for other specs.
  await Promise.all(
    (await libraryIds(page).catch(() => [] as string[])).map((id) =>
      page.request
        .put(`/api/photos/${id}/edit`, {
          data: { present: { ...DEFAULT_EDIT, retouches: [] } },
        })
        .catch(() => undefined),
    ),
  );
});

test("reload on a coast photo highlights Coastal Escape in sidebar and filmstrip", async ({
  page,
}) => {
  await page.goto("/photo/photo-9");
  await awaitEditor(page);

  // The collection is inferred from the photo, never in the editor URL.
  await expect(page).toHaveURL(/\/photo\/photo-9\//);
  await expect(page).not.toHaveURL(/\/album\//);
  await expect(
    sidebar(page).getByRole("button", { name: /^Coastal Escape/ }),
  ).toHaveClass(/is-selected/);
  await expect(
    sidebar(page).getByRole("button", { name: /^Dolomites 2024/ }),
  ).not.toHaveClass(/is-selected/);
  await expect(filmstrip(page).locator("h2")).toHaveText("Coastal Escape");
  await expect(
    filmstrip(page).locator('[data-photo-id="photo-9"]'),
  ).toHaveClass(/is-selected/);

  await page.reload();
  await awaitEditor(page);

  await expect(page).toHaveURL(/\/photo\/photo-9\//);
  await expect(
    sidebar(page).getByRole("button", { name: /^Coastal Escape/ }),
  ).toHaveClass(/is-selected/);
  await expect(filmstrip(page).locator("h2")).toHaveText("Coastal Escape");
  await expect(
    filmstrip(page).locator('[data-photo-id="photo-9"]'),
  ).toHaveClass(/is-selected/);
});

test("legacy query-string link opens the photo and normalizes to a path", async ({
  page,
}) => {
  await page.goto("/?photo=photo-9&collection=favorites");
  await awaitEditor(page);

  // The photo's album wins over the stale param, and the legacy query is
  // rewritten to the canonical path form.
  await expect(
    sidebar(page).getByRole("button", { name: /^Coastal Escape/ }),
  ).toHaveClass(/is-selected/);
  await expect(
    sidebar(page).getByRole("button", { name: /^Favorites/ }),
  ).not.toHaveClass(/is-selected/);
  await expect(page).toHaveURL(/\/photo\/photo-9\//);
  await expect(page).not.toHaveURL(/[?&](photo|album|collection)=/);
  await expect(filmstrip(page).locator("h2")).toHaveText("Coastal Escape");
});

test("sidebar album click switches the grid to that album's URL", async ({
  page,
}) => {
  await page.goto("/photo/photo-1");
  await awaitEditor(page);

  await sidebar(page).getByRole("button", { name: /^Coastal Escape/ }).click();

  // In an album the URL shows the album, not the stale photo.
  await expect(grid(page)).toBeVisible();
  await expect(grid(page).locator("h1")).toHaveText("Coastal Escape");
  await expect(page).toHaveURL(/\/album\/coast/);
  await expect(page).not.toHaveURL(/\/photo\//);
});

test("album URL deep-links the grid and survives reload", async ({
  page,
}) => {
  await page.goto("/album/coast");
  await expect(grid(page)).toBeVisible({ timeout: 20_000 });

  await expect(grid(page).locator("h1")).toHaveText("Coastal Escape");
  await expect(
    sidebar(page).getByRole("button", { name: /^Coastal Escape/ }),
  ).toHaveClass(/is-selected/);

  await page.reload();
  await expect(grid(page)).toBeVisible({ timeout: 20_000 });
  await expect(grid(page).locator("h1")).toHaveText("Coastal Escape");
  await expect(page).toHaveURL(/\/album\/coast/);
});

test("back returns from a photo to the album URL", async ({ page }) => {
  await page.goto("/photo/photo-1");
  await awaitEditor(page);

  await sidebar(page).getByRole("button", { name: /^Coastal Escape/ }).click();
  await expect(grid(page)).toBeVisible();
  await expect(page).toHaveURL(/\/album\/coast/);

  await grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }).click();
  await awaitEditor(page);
  await expect(page).toHaveURL(/\/photo\/photo-9\//);

  await page.goBack();
  await expect(grid(page)).toBeVisible();
  await expect(grid(page).locator("h1")).toHaveText("Coastal Escape");
  await expect(page).toHaveURL(/\/album\/coast/);
  await expect(page).not.toHaveURL(/\/photo\//);
});

test("sidebar Library shortcuts turn on the matching chip filters", async ({
  page,
}) => {
  await page.goto("/");
  await awaitEditor(page);

  // No Imports entry and no Smart Albums section remain.
  await expect(
    sidebar(page).getByRole("button", { name: /^Imports/ }),
  ).toHaveCount(0);
  await expect(
    sidebar(page).getByRole("heading", { name: "Smart Albums" }),
  ).toHaveCount(0);
  await expect(
    sidebar(page).getByRole("button", { name: /Landscapes|RAW Photos/ }),
  ).toHaveCount(0);

  // Favorites turns on the Favorited chip and narrows the grid.
  await sidebar(page).getByRole("button", { name: /^Favorites/ }).click();
  await expect(grid(page)).toBeVisible();
  await expect(grid(page).locator("h1")).toHaveText("Favorites");
  const favGroup = page.getByRole("group", { name: "Favorite status" });
  await expect(
    favGroup.getByRole("button", { name: "Favorited", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(grid(page).locator("p").first()).toContainText("3 photos");
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toHaveCount(0);

  // Recently Edited turns on the Edited chip; the fresh seed edit qualifies.
  await sidebar(page).getByRole("button", { name: /^Recently Edited/ }).click();
  await expect(grid(page).locator("h1")).toHaveText("Recently Edited");
  const editedGroup = page.getByRole("group", { name: "Edited status" });
  await expect(
    editedGroup.getByRole("button", { name: "Edited", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    grid(page).getByRole("button", { name: `Edit ${EDITED_TITLE}` }),
  ).toBeVisible();
  await expect(grid(page).locator("p").first()).toContainText("1 photo");
});

test("chip clicks inside Library shortcuts drop back to All Photos", async ({
  page,
}) => {
  await page.goto("/");
  await awaitEditor(page);

  // Loosening the chip inside Favorites returns to the full library.
  await sidebar(page).getByRole("button", { name: /^Favorites/ }).click();
  await expect(grid(page)).toBeVisible();
  await page
    .getByRole("group", { name: "Favorite status" })
    .getByRole("button", { name: "All", exact: true })
    .click();
  await expect(grid(page).locator("h1")).toHaveText("All Photos");
  await expect(
    sidebar(page).getByRole("button", { name: /^All Photos/ }),
  ).toHaveClass(/is-selected/);
  await expect(grid(page).locator("p").first()).toContainText("12 photos");

  // Switching chips inside Recently Edited keeps the new filter, not the scope.
  await sidebar(page).getByRole("button", { name: /^Recently Edited/ }).click();
  await expect(grid(page).locator("h1")).toHaveText("Recently Edited");
  await page
    .getByRole("group", { name: "Edited status" })
    .getByRole("button", { name: "Unedited", exact: true })
    .click();
  await expect(grid(page).locator("h1")).toHaveText("All Photos");
  await expect(grid(page).locator("p").first()).toContainText("11 photos");

  // Clearing inside a shortcut also returns to the unfiltered library.
  await sidebar(page).getByRole("button", { name: /^Favorites/ }).click();
  await expect(grid(page).locator("h1")).toHaveText("Favorites");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(grid(page).locator("h1")).toHaveText("All Photos");
  await expect(grid(page).locator("p").first()).toContainText("12 photos");
  await expect(
    page
      .getByRole("group", { name: "Favorite status" })
      .getByRole("button", { name: "Favorited", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("edited chips filter the grid and the filmstrip", async ({ page }) => {
  await page.goto("/");
  await awaitEditor(page);
  await openLibraryOnAll(page);

  const editedGroup = page.getByRole("group", { name: "Edited status" });
  await editedGroup.getByRole("button", { name: "Edited", exact: true }).click();

  await expect(
    editedGroup.getByRole("button", { name: "Edited", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    grid(page).getByRole("button", { name: `Edit ${EDITED_TITLE}` }),
  ).toBeVisible();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toHaveCount(0);
  await expect(grid(page).locator("p").first()).toContainText("1 photo");

  await editedGroup
    .getByRole("button", { name: "Unedited", exact: true })
    .click();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${EDITED_TITLE}` }),
  ).toHaveCount(0);
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toBeVisible();

  // Back to Edited, then open the photo: the filmstrip shares the filter.
  await editedGroup.getByRole("button", { name: "Edited", exact: true }).click();
  await grid(page).getByRole("button", { name: `Edit ${EDITED_TITLE}` }).click();
  await awaitEditor(page);
  await expect(filmstrip(page).locator("[data-photo-id]")).toHaveCount(1);
  await expect(
    filmstrip(page).locator(`[data-photo-id="${EDITED_ID}"]`),
  ).toBeVisible();
});

test("favorite chips filter, clear, and empty-state", async ({ page }) => {
  await page.goto("/");
  await awaitEditor(page);
  await sidebar(page).getByRole("button", { name: /^Coastal Escape/ }).click();
  await expect(grid(page)).toBeVisible();

  const favGroup = page.getByRole("group", { name: "Favorite status" });
  await favGroup
    .getByRole("button", { name: "Favorited", exact: true })
    .click();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_FAV_TITLE}` }),
  ).toBeVisible();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toHaveCount(0);

  await favGroup
    .getByRole("button", { name: "Not favorited", exact: true })
    .click();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toBeVisible();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_FAV_TITLE}` }),
  ).toHaveCount(0);

  // Clear restores both photos.
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toBeVisible();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_FAV_TITLE}` }),
  ).toBeVisible();

  // No coast photo is edited: Edited chip empties the album.
  await page
    .getByRole("group", { name: "Edited status" })
    .getByRole("button", { name: "Edited", exact: true })
    .click();
  await expect(grid(page).locator(".empty-library h2")).toHaveText(
    "No photos match these filters",
  );
  await grid(page)
    .getByRole("button", { name: "Clear filters" })
    .click();
  await expect(
    grid(page).getByRole("button", { name: `Edit ${COAST_TITLE}` }),
  ).toBeVisible();
});

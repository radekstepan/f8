import { DEFAULT_EDIT, INITIAL_EDIT, SAMPLE_ALBUMS, SAMPLE_PHOTOS } from "@photomator/core";
import type { Store } from "./store.ts";

// First-run seed: the sample library the browser demo ships with, stored as
// URL-kind photos (no local bytes, never missing) so the app is useful before
// the first import. photo-1 keeps its Natural starting look.
export function seedIfNeeded(store: Store): boolean {
  if (store.getMeta("seeded") === "1") return false;
  const now = new Date().toISOString();
  SAMPLE_ALBUMS.forEach((album, index) => {
    store.insertAlbum({ id: album.id, name: album.name, cover: album.cover, sort: index });
  });
  for (const photo of SAMPLE_PHOTOS) {
    store.insertPhoto({
      id: photo.id,
      hash: null,
      kind: "url",
      path: null,
      url: photo.src,
      thumbnail_url: photo.thumbnail,
      filename: photo.name,
      title: photo.title,
      width: photo.width,
      height: photo.height,
      camera: photo.camera,
      lens: photo.lens,
      iso: photo.iso,
      aperture: photo.aperture,
      shutter: photo.shutter,
      focal_length: photo.focalLength,
      date_taken: photo.date,
      location: photo.location,
      raw: photo.raw ? 1 : 0,
      favorite: photo.favorite ? 1 : 0,
      rating: photo.rating,
      album_id: photo.albumId,
      photographer: photo.photographer ?? null,
      file_size: 0,
      mtime: 0,
      created_at: now,
      updated_at: now,
    });
    // Mirror the demo's first-run state: photo-1 starts with Natural applied.
    store.saveEdit(photo.id, photo.id === "photo-1" ? { ...INITIAL_EDIT } : { ...DEFAULT_EDIT });
  }
  store.setMeta("seeded", "1");
  return true;
}

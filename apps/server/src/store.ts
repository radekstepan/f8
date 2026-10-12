import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_EDIT } from "@photomator/core";
import type { Album, EditState, Preset } from "@photomator/core";

export interface PhotoRow {
  id: string;
  hash: string | null;
  kind: "file" | "url";
  path: string | null;
  url: string | null;
  thumbnail_url: string | null;
  filename: string;
  title: string;
  width: number;
  height: number;
  camera: string;
  lens: string;
  iso: number;
  aperture: string;
  shutter: string;
  focal_length: string;
  date_taken: string;
  location: string;
  raw: number;
  favorite: number;
  rating: number;
  album_id: string;
  photographer: string | null;
  file_size: number;
  mtime: number;
  created_at: string;
  updated_at: string;
}

export interface StoredEdit {
  present: EditState;
  edited: boolean;
  /** ISO timestamp of the last save; null when no recipe was ever stored. */
  updatedAt: string | null;
}

interface AlbumRow {
  id: string;
  name: string;
  cover: string;
}

interface PresetRow {
  id: string;
  name: string;
  values_json: string;
}

const DEFAULT_EDIT_JSON = JSON.stringify(DEFAULT_EDIT);

function parseEdit(presentJson: string | null | undefined, editedFlag: boolean, updatedAt: string | null): StoredEdit {
  if (!presentJson) return { present: { ...DEFAULT_EDIT }, edited: false, updatedAt: null };
  try {
    // Merging over DEFAULT_EDIT tolerates recipes saved by older app versions.
    return { present: { ...DEFAULT_EDIT, ...(JSON.parse(presentJson) as Partial<EditState>) }, edited: editedFlag, updatedAt };
  } catch {
    return { present: { ...DEFAULT_EDIT }, edited: false, updatedAt: null };
  }
}

function toAlbum(row: AlbumRow): Album {
  return { id: row.id, name: row.name, cover: row.cover };
}

function toPreset(row: PresetRow): Preset {
  let values: Preset["values"] = {};
  try {
    values = JSON.parse(row.values_json) as Preset["values"];
  } catch {
    values = {};
  }
  return { id: row.id, name: row.name, category: "My Presets", values };
}

export function createStore(db: DatabaseSync) {
  const now = (): string => new Date().toISOString();

  return {
    listPhotos: (): PhotoRow[] =>
      db.prepare("SELECT * FROM photos ORDER BY rowid").all() as unknown as PhotoRow[],

    getPhoto: (id: string): PhotoRow | undefined =>
      db.prepare("SELECT * FROM photos WHERE id = ?").get(id) as PhotoRow | undefined,

    findByHash: (hash: string): PhotoRow | undefined =>
      db
        .prepare("SELECT * FROM photos WHERE hash = ?")
        .get(hash) as PhotoRow | undefined,

    insertPhoto: (row: PhotoRow): void => {
      db.prepare(
        `INSERT INTO photos (id, hash, kind, path, url, thumbnail_url, filename, title,
          width, height, camera, lens, iso, aperture, shutter, focal_length, date_taken,
          location, raw, favorite, rating, album_id, photographer, file_size, mtime,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id, row.hash, row.kind, row.path, row.url, row.thumbnail_url, row.filename,
        row.title, row.width, row.height, row.camera, row.lens, row.iso, row.aperture,
        row.shutter, row.focal_length, row.date_taken, row.location, row.raw,
        row.favorite, row.rating, row.album_id, row.photographer, row.file_size,
        row.mtime, row.created_at, row.updated_at,
      );
    },

    updatePhotoLocation: (id: string, location: { path: string; fileSize: number; mtime: number }): void => {
      db.prepare("UPDATE photos SET path = ?, file_size = ?, mtime = ?, updated_at = ? WHERE id = ?").run(
        location.path, location.fileSize, location.mtime, now(), id,
      );
    },

    updatePhotoMeta: (
      id: string, patch: { favorite?: boolean; rating?: number; title?: string; albumId?: string },
    ): PhotoRow | undefined => {
      const sets: string[] = [];
      const values: (string | number)[] = [];
      if (patch.favorite !== undefined) {
        sets.push("favorite = ?");
        values.push(patch.favorite ? 1 : 0);
      }
      if (patch.rating !== undefined) {
        sets.push("rating = ?");
        values.push(patch.rating);
      }
      if (patch.title !== undefined) {
        sets.push("title = ?");
        values.push(patch.title);
      }
      if (patch.albumId !== undefined) {
        sets.push("album_id = ?");
        values.push(patch.albumId);
      }
      if (!sets.length) return db.prepare("SELECT * FROM photos WHERE id = ?").get(id) as PhotoRow | undefined;
      sets.push("updated_at = ?");
      values.push(now());
      db.prepare(`UPDATE photos SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
      return db.prepare("SELECT * FROM photos WHERE id = ?").get(id) as PhotoRow | undefined;
    },

    deletePhoto: (id: string): void => {
      db.prepare("DELETE FROM photos WHERE id = ?").run(id);
    },

    getEdit: (photoId: string): StoredEdit => {
      const row = db
        .prepare("SELECT present_json, edited, updated_at FROM photo_edits WHERE photo_id = ?")
        .get(photoId) as { present_json: string; edited: number; updated_at: string } | undefined;
      if (!row) return { present: { ...DEFAULT_EDIT }, edited: false, updatedAt: null };
      return parseEdit(row.present_json, row.edited === 1, row.updated_at);
    },

    saveEdit: (photoId: string, present: EditState): StoredEdit => {
      const canonical = { ...DEFAULT_EDIT, ...present };
      const edited = JSON.stringify(canonical) !== DEFAULT_EDIT_JSON;
      const updatedAt = now();
      db.prepare(
        `INSERT INTO photo_edits (photo_id, present_json, edited, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (photo_id) DO UPDATE SET present_json = excluded.present_json,
           edited = excluded.edited, updated_at = excluded.updated_at`,
      ).run(photoId, JSON.stringify(canonical), edited ? 1 : 0, updatedAt);
      return { present: canonical, edited, updatedAt };
    },

    listAlbums: (): Album[] =>
      (db.prepare("SELECT id, name, cover FROM albums ORDER BY sort, name").all() as unknown as AlbumRow[]).map(toAlbum),

    getAlbum: (id: string): Album | undefined => {
      const row = db.prepare("SELECT id, name, cover FROM albums WHERE id = ?").get(id) as AlbumRow | undefined;
      return row ? toAlbum(row) : undefined;
    },

    insertAlbum: (album: { id: string; name: string; cover: string; sort: number }): void => {
      db.prepare("INSERT INTO albums (id, name, cover, sort) VALUES (?, ?, ?, ?)").run(
        album.id, album.name, album.cover, album.sort,
      );
    },

    updateAlbum: (id: string, patch: { name?: string; cover?: string }): Album | undefined => {
      const sets: string[] = [];
      const values: string[] = [];
      if (patch.name !== undefined) {
        sets.push("name = ?");
        values.push(patch.name);
      }
      if (patch.cover !== undefined) {
        sets.push("cover = ?");
        values.push(patch.cover);
      }
      if (sets.length) db.prepare(`UPDATE albums SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
      const row = db.prepare("SELECT id, name, cover FROM albums WHERE id = ?").get(id) as AlbumRow | undefined;
      return row ? toAlbum(row) : undefined;
    },

    deleteAlbum: (id: string): void => {
      db.prepare("DELETE FROM albums WHERE id = ?").run(id);
    },

    listPresets: (): Preset[] =>
      (db.prepare("SELECT id, name, values_json FROM presets ORDER BY name").all() as unknown as PresetRow[]).map(toPreset),

    insertPreset: (preset: { id: string; name: string; values: Preset["values"] }): void => {
      db.prepare("INSERT INTO presets (id, name, values_json, created_at) VALUES (?, ?, ?, ?)").run(
        preset.id, preset.name, JSON.stringify(preset.values), now(),
      );
    },

    deletePreset: (id: string): void => {
      db.prepare("DELETE FROM presets WHERE id = ?").run(id);
    },

    getMeta: (key: string): string | undefined => {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
      return row?.value;
    },

    setMeta: (key: string, value: string): void => {
      db.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },
  };
}

export type Store = ReturnType<typeof createStore>;

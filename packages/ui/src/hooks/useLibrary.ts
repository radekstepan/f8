import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_EDIT,
  LibraryError,
  MAX_IMPORTS_PER_REQUEST,
  createLibraryClient,
  resolveImportSelection,
} from "@f8/core";
import type {
  Album,
  EditState,
  HistoryState,
  ImportProgress,
  ImportReport,
  LibraryClient,
  LibraryPhoto,
  LibrarySnapshot,
  Photo,
  PhotoPatch,
  Preset,
} from "@f8/core";

export type LibraryStatus = "loading" | "ready" | "offline";

export interface UploadSummary {
  imported: number;
  deduplicated: number;
  failed: number;
  suppressedSidecars: number;
  /** Files beyond the per-batch cap; run the import again for the rest. */
  truncated: number;
  /** Files attempted this batch (capped at MAX_IMPORTS_PER_REQUEST). */
  total: number;
  firstId: string | null;
}

// Imported photos flush into React state this many at a time: one render per
// photo would stutter through hundreds, while one giant flush would leave the
// grid empty until the whole batch lands.
const IMPORT_STATE_FLUSH_EVERY = 10;

// Pre-rename localStorage keys from the browser-only demo. Read once during
// the one-shot server migration, then cleared; kept so upgrades never lose
// migrated edits, favorites, albums, or presets.
const LEGACY_EDITS_KEY = "photomator-demo-edits-v1";
const LEGACY_LIBRARY_KEY = "photomator-demo-library-v1";
const LEGACY_ALBUMS_KEY = "photomator-demo-albums-v1";
const LEGACY_PRESETS_KEY = "photomator-demo-presets-v1";
const DEFAULT_EDIT_JSON = JSON.stringify(DEFAULT_EDIT);

function readLegacy<T>(key: string): T | null {
  try {
    return (JSON.parse(localStorage.getItem(key) || "null") as T | null) ?? null;
  } catch {
    return null;
  }
}

function isDefaultPresent(present: EditState): boolean {
  return JSON.stringify({ ...DEFAULT_EDIT, ...present }) === DEFAULT_EDIT_JSON;
}

// One-shot migration from the pre-server browser demo: carry sample edits,
// favorites, ratings, custom albums, and custom presets into the library,
// then clear the legacy keys. Returns the fresh snapshot when it ran, or
// null when there was nothing to migrate (the normal steady state).
async function migrateLegacyState(client: LibraryClient): Promise<LibrarySnapshot | null> {
  const edits = readLegacy<Record<string, { present?: EditState }>>(LEGACY_EDITS_KEY);
  const presets = readLegacy<Preset[]>(LEGACY_PRESETS_KEY);
  const albums = readLegacy<Album[]>(LEGACY_ALBUMS_KEY);
  const library = readLegacy<Photo[]>(LEGACY_LIBRARY_KEY);
  if (!edits && !presets?.length && !albums?.length && !library?.length) return null;
  let snapshot: LibrarySnapshot;
  try {
    snapshot = await client.getLibrary();
  } catch {
    return null;
  }
  let migrated = false;
  const byId = new Map(snapshot.photos.map((photo) => [photo.id, photo]));
  if (edits) {
    for (const [id, entry] of Object.entries(edits)) {
      const photo = byId.get(id);
      const present = entry?.present;
      if (!photo || photo.edited || !present || isDefaultPresent(present)) continue;
      await client.saveEdit(id, { ...DEFAULT_EDIT, ...present }).catch(() => undefined);
      migrated = true;
    }
  }
  if (presets?.length) {
    for (const preset of presets) {
      if (!preset?.name) continue;
      await client.createPreset(preset.name, preset.values ?? {}).catch(() => undefined);
      migrated = true;
    }
  }
  const albumIdMap = new Map<string, string>();
  if (albums?.length) {
    const existing = new Set(snapshot.albums.map((album) => album.id));
    for (const album of albums) {
      if (!album?.id || !album.name || existing.has(album.id)) continue;
      const created = await client.createAlbum(album.name, album.cover ?? "").catch(() => null);
      if (created) {
        albumIdMap.set(album.id, created.album.id);
        migrated = true;
      }
    }
  }
  if (library?.length) {
    for (const photo of library) {
      const current = photo?.id ? byId.get(photo.id) : undefined;
      if (!current) continue;
      const patch: PhotoPatch = {};
      if (typeof photo.favorite === "boolean" && photo.favorite !== current.favorite) {
        patch.favorite = photo.favorite;
      }
      if (typeof photo.rating === "number" && photo.rating !== current.rating) {
        patch.rating = photo.rating;
      }
      const target = photo.albumId ? albumIdMap.get(photo.albumId) : undefined;
      if (target && current.albumId !== target) patch.albumId = target;
      if (Object.keys(patch).length) {
        await client.updatePhoto(current.id, patch).catch(() => undefined);
        migrated = true;
      }
    }
  }
  for (const key of [LEGACY_EDITS_KEY, LEGACY_LIBRARY_KEY, LEGACY_ALBUMS_KEY, LEGACY_PRESETS_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Legacy keys are best-effort; the library is already authoritative.
    }
  }
  return migrated ? client.getLibrary().catch(() => snapshot) : snapshot;
}

export function useLibrary() {
  const client = useMemo(() => createLibraryClient(), []);
  const [status, setStatus] = useState<LibraryStatus>("loading");
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [customPresets, setCustomPresets] = useState<Preset[]>([]);
  const [editsSeed, setEditsSeed] = useState<Record<string, HistoryState> | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const markOfflineIfDown = useCallback((reason: unknown) => {
    if (reason instanceof LibraryError && reason.status === 0) setStatus("offline");
  }, []);

  const upsertPhotos = useCallback((incoming: LibraryPhoto[]) => {
    if (!incoming.length) return;
    setPhotos((current) => {
      const map = new Map(current.map((photo) => [photo.id, photo]));
      for (const photo of incoming) map.set(photo.id, photo);
      return [...map.values()];
    });
  }, []);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setStatus((current) => (current === "ready" ? current : "loading"));
    setError("");
    try {
      const snapshot = (await migrateLegacyState(client)) ?? (await client.getLibrary());
      if (generation.current !== ticket) return;
      setPhotos(snapshot.photos);
      setAlbums(snapshot.albums);
      setCustomPresets(snapshot.presets);
      setEditsSeed(
        Object.fromEntries(
          snapshot.photos.map((photo) => [photo.id, { past: [], present: photo.edit, future: [] }]),
        ),
      );
      setStatus("ready");
    } catch (reason) {
      if (generation.current !== ticket) return;
      setError(reason instanceof Error ? reason.message : "Could not reach the library server.");
      setStatus("offline");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFiles = useCallback(
    async (
      files: File[],
      albumId: string,
      onProgress?: (progress: ImportProgress) => void,
    ): Promise<UploadSummary> => {
      const { files: selected, suppressedSidecars } = resolveImportSelection(files);
      const batch = selected.slice(0, MAX_IMPORTS_PER_REQUEST);
      const total = batch.length;
      const truncated = selected.length - total;
      let imported = 0;
      let deduplicated = 0;
      let failed = 0;
      let firstId: string | null = null;
      const pending: LibraryPhoto[] = [];
      const flush = (): void => {
        if (!pending.length) return;
        upsertPhotos(pending.splice(0, pending.length));
      };
      onProgress?.({ done: 0, total });
      for (const [index, file] of batch.entries()) {
        try {
          const { photo, deduplicated: dupe } = await client.upload(file, file.name, albumId);
          pending.push(photo);
          if (dupe) deduplicated += 1;
          else imported += 1;
          firstId ??= photo.id;
        } catch (reason) {
          failed += 1;
          markOfflineIfDown(reason);
        }
        // Chunked state flushes plus a yielded frame between files keep the
        // tab responsive and the progress bar painting across hundreds.
        if (pending.length >= IMPORT_STATE_FLUSH_EVERY || index === total - 1) flush();
        onProgress?.({ done: index + 1, total });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      flush();
      return { imported, deduplicated, failed, suppressedSidecars, truncated, total, firstId };
    },
    [client, markOfflineIfDown, upsertPhotos],
  );

  const importPaths = useCallback(
    async (paths: string[], albumId: string): Promise<ImportReport> => {
      try {
        const report = await client.importByPath(paths, albumId);
        upsertPhotos([...report.imported, ...report.relinked, ...report.duplicates]);
        return report;
      } catch (reason) {
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown, upsertPhotos],
  );

  const updatePhoto = useCallback(
    async (id: string, patch: PhotoPatch) => {
      try {
        const { photo } = await client.updatePhoto(id, patch);
        upsertPhotos([photo]);
      } catch (reason) {
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown, upsertPhotos],
  );

  const removePhoto = useCallback(
    async (id: string) => {
      try {
        await client.deletePhoto(id);
        setPhotos((current) => current.filter((photo) => photo.id !== id));
      } catch (reason) {
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown],
  );

  const saveEdit = useCallback(
    (photoId: string, present: EditState) => {
      void client.saveEdit(photoId, present).then(
        ({ photo }) => upsertPhotos([photo]),
        (reason: unknown) => markOfflineIfDown(reason),
      );
    },
    [client, markOfflineIfDown, upsertPhotos],
  );

  const createAlbum = useCallback(
    async (name: string, cover = "") => {
      try {
        const { album } = await client.createAlbum(name, cover);
        setAlbums((current) => [...current, album]);
        return album;
      } catch (reason) {
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown],
  );

  const createPreset = useCallback(
    async (name: string, values: Partial<EditState>) => {
      try {
        const { preset } = await client.createPreset(name, values);
        setCustomPresets((current) => [...current, preset]);
        return preset;
      } catch (reason) {
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown],
  );

  return {
    status,
    photos,
    albums,
    customPresets,
    editsSeed,
    error,
    retry: load,
    uploadFiles,
    importPaths,
    updatePhoto,
    removePhoto,
    saveEdit,
    createAlbum,
    createPreset,
  };
}

export type UseLibrary = ReturnType<typeof useLibrary>;

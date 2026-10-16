import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LibraryError,
  MAX_IMPORTS_PER_REQUEST,
  OFFLINE_PING_INTERVAL_MS,
  applyPhotoMetaPatch,
  createLibraryClient,
  createPendingPhotoMeta,
  noteImageFailure,
  resolveImportSelection,
  sanitizeActionStack,
} from "@f8/core";
import type {
  ActionStack,
  Album,
  EditState,
  ImportProgress,
  ImportReport,
  LibraryPhoto,
  PhotoPatch,
  Preset,
  TasteSeed,
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

// Gate detail when the browser itself reports no network (the ping then only
// confirms it): the server may be fine, so the copy names the connection.
const BROWSER_OFFLINE_MESSAGE =
  "The network connection is down. This page reloads automatically when you're back online.";

export function useLibrary() {
  const client = useMemo(() => createLibraryClient(), []);
  const [status, setStatus] = useState<LibraryStatus>("loading");
  const [photos, setPhotos] = useState<LibraryPhoto[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [customPresets, setCustomPresets] = useState<Preset[]>([]);
  const [editsSeed, setEditsSeed] = useState<TasteSeed | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  // Optimistic star/rating state: meta patches apply locally at click time
  // (even while a repair saturates the server) and the PATCH reconciles.
  // The tracker re-applies pending patches over every incoming server
  // record, so a concurrent repair save cannot clobber the star.
  const [pendingMeta] = useState(createPendingPhotoMeta);
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const statusRef = useRef(status);
  statusRef.current = status;
  // Recent image load-failure timestamps for the offline burst detector.
  const imageFailures = useRef<number[]>([]);
  const verifying = useRef(false);

  const markOfflineIfDown = useCallback((reason: unknown) => {
    if (!(reason instanceof LibraryError) || reason.status !== 0) return;
    setError(reason.message);
    setStatus("offline");
  }, []);

  // Verify a suspected outage with a cheap health ping before flipping the
  // takeover: one corrupt photo (or a localhost server surviving a dropped
  // uplink) must not take down the app. `offlineMessage` overrides the gate
  // detail when the trigger already names the cause (browser offline event).
  const verifyConnection = useCallback(async (offlineMessage?: string) => {
    if (verifying.current) return;
    verifying.current = true;
    try {
      await client.ping();
      imageFailures.current = [];
    } catch (reason) {
      if (reason instanceof LibraryError && reason.status === 0) {
        setError(offlineMessage ?? reason.message);
        setStatus("offline");
      } else {
        imageFailures.current = [];
      }
    } finally {
      verifying.current = false;
    }
  }, [client]);

  const upsertPhotos = useCallback((incoming: LibraryPhoto[]) => {
    if (!incoming.length) return;
    setPhotos((current) => {
      const map = new Map(current.map((photo) => [photo.id, photo]));
      // Pending optimistic meta wins over incoming server state: a repair
      // save answering with pre-PATCH rows must not wipe the star. (Pure
      // overlay — safe under the updater's double-invoke.)
      for (const photo of incoming) map.set(photo.id, pendingMeta.serverPhoto(photo.id, photo));
      return [...map.values()];
    });
  }, [pendingMeta]);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setStatus((current) => (current === "ready" ? current : "loading"));
    setError("");
    try {
      const snapshot = await client.getLibrary();
      if (generation.current !== ticket) return;
      setPhotos(snapshot.photos);
      setAlbums(snapshot.albums);
      setCustomPresets(snapshot.presets);
      setEditsSeed({
        histories: Object.fromEntries(
          snapshot.photos.map((photo) => [photo.id, { past: [], present: photo.edit, future: [] }]),
        ),
        // Recipes and their auto-action stacks seed together: a reload
        // restores every Auto's highlight and revert, not just its values.
        actions: Object.fromEntries(
          snapshot.photos.map((photo) => [photo.id, sanitizeActionStack(photo.actions)]),
        ),
        // Photo labels seed the taste backfill's subject tags, so the
        // first run already learns conditionally (see tasteProfileFromSeed).
        labels: Object.fromEntries(snapshot.photos.map((photo) => [photo.id, photo.labels])),
      });
      setStatus("ready");
    } catch (reason) {
      if (generation.current !== ticket) return;
      setError(reason instanceof Error ? reason.message : "Could not reach the application server.");
      setStatus("offline");
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Background photo refresh: the snapshot loads once, but another tab can
  // persist edits (a preset applied elsewhere, a second window side by
  // side) while this one sits open. Without a refresh this tab's grid and
  // filmstrip would show the old look forever — the persisted recipe is
  // what untouched photos' thumbnails read. Refreshing when the tab
  // regains visibility (tab switch) or focus (side-by-side window click)
  // picks those saves up. Photos only: albums and presets have no
  // reported cross-tab staleness, and leaving them alone keeps the refresh
  // append-safe against in-flight creates. Failures stay silent — the
  // offline machinery owns takeovers, a failed refresh just keeps state.
  const refreshPhotos = useCallback(async () => {
    try {
      const snapshot = await client.getLibrary();
      upsertPhotos(snapshot.photos);
    } catch {
      // Keep current state; the offline pinger takes over when truly down.
    }
  }, [client, upsertPhotos]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const onVisible = () => {
      if (!document.hidden) void refreshPhotos();
    };
    const onFocus = () => void refreshPhotos();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshPhotos]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // The browser's own signal: verify (a localhost server survives a
    // dropped uplink) and reload immediately on the way back up.
    const onOffline = () => void verifyConnection(BROWSER_OFFLINE_MESSAGE);
    const onOnline = () => {
      if (statusRef.current === "offline") void load();
    };
    // Broken thumbnails are the visible symptom of an outage no API call
    // noticed (a quiet album grid makes none): a burst of image errors —
    // capture phase, since error events don't bubble — verifies too, so
    // the grid flips to the offline takeover instead of broken <img>s.
    const onResourceError = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      const burst = noteImageFailure(imageFailures.current, Date.now());
      imageFailures.current = burst.recent;
      if (burst.burst) void verifyConnection();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    window.addEventListener("error", onResourceError, true);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("error", onResourceError, true);
    };
  }, [load, verifyConnection]);

  // While offline, ping until the server answers, then reload the library:
  // the takeover resolves itself without the Try again button. A failed
  // reload keeps the status (and this interval) untouched for the next tick.
  useEffect(() => {
    if (status !== "offline" || typeof window === "undefined") return;
    let stopped = false;
    const timer = window.setInterval(() => {
      void client.ping().then(
        () => { if (!stopped) void load(); },
        () => undefined,
      );
    }, OFFLINE_PING_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [client, load, status]);

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
        // Folder imports file into auto-created albums server-side; merge
        // them so the sidebar and collection routing see the new rows.
        const created = report.albums ?? [];
        if (created.length) {
          setAlbums((current) => {
            const ids = new Set(current.map((album) => album.id));
            const fresh = created.filter((album) => !ids.has(album.id));
            return fresh.length ? [...current, ...fresh] : current;
          });
        }
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
      // Optimistic: the star flips synchronously at click time instead of
      // waiting out the PATCH — the server may be saturated by a running
      // repair for tens of seconds. Rapid toggles read the optimistic
      // state, so each click still inverts what the user sees.
      const current = photosRef.current.find((photo) => photo.id === id);
      const seq = current ? pendingMeta.begin(id, current, patch) : null;
      if (seq !== null) {
        setPhotos((photos) => photos.map((photo) => (photo.id === id ? pendingMeta.serverPhoto(id, photo) : photo)));
      }
      try {
        const { photo } = await client.updatePhoto(id, patch);
        // Only the latest PATCH per photo settles authoritatively; a
        // superseded out-of-order response is dropped so it cannot
        // resurrect a state the user already toggled past.
        if (seq === null || pendingMeta.resolve(id, seq)) {
          upsertPhotos([photo]);
        }
      } catch (reason) {
        // Roll back to the pre-optimistic values — unless a newer toggle
        // superseded this one, in which case its state stands.
        if (seq !== null) {
          const prev = pendingMeta.reject(id, seq);
          if (prev) {
            setPhotos((photos) => photos.map((photo) => (photo.id === id ? applyPhotoMetaPatch(photo, prev) : photo)));
          }
        }
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown, pendingMeta, upsertPhotos],
  );

  const updateLabels = useCallback(
    async (id: string, patch: { add?: string[]; remove?: string[] }) => {
      try {
        const { photo } = await client.updateLabels(id, patch);
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
    (photoId: string, present: EditState, actions: ActionStack) => {
      void client.saveEdit(photoId, present, actions).then(
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

  const updateAlbum = useCallback(
    async (id: string, patch: { name?: string; cover?: string }) => {
      try {
        const { album } = await client.updateAlbum(id, patch);
        setAlbums((current) => current.map((entry) => (entry.id === id ? album : entry)));
        return album;
      } catch (reason) {
        markOfflineIfDown(reason);
        throw reason;
      }
    },
    [client, markOfflineIfDown],
  );

  const removeAlbum = useCallback(
    async (id: string) => {
      try {
        await client.deleteAlbum(id);
        // Photos are untouched server-side (they keep their album id and stay
        // visible in All Photos); only the album row drops out of state.
        setAlbums((current) => current.filter((album) => album.id !== id));
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
    updateLabels,
    removePhoto,
    saveEdit,
    createAlbum,
    updateAlbum,
    removeAlbum,
    createPreset,
  };
}

export type UseLibrary = ReturnType<typeof useLibrary>;

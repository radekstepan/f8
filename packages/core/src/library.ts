import type { Album, EditState, Photo, Preset } from "./types.js";

// A photo record served by the library server: the shared Photo shape plus
// the stored edit recipe and library bookkeeping. `src`/`thumbnail` are
// display URLs (server file endpoints for referenced originals, remote URLs
// for seeded samples); the original bytes are never modified.
export interface LibraryPhoto extends Photo {
  missing: boolean;
  edited: boolean;
  edit: EditState;
  /** SHA-256 of the original bytes; the stable identity across moves and reimports. Null for URL photos. */
  hash: string | null;
  /** Server-local absolute path of a referenced original; null for URL photos. */
  path: string | null;
}

export interface LibrarySnapshot {
  photos: LibraryPhoto[];
  albums: Album[];
  /** Custom presets only; built-ins stay client-side. */
  presets: Preset[];
}

export interface ImportReport {
  imported: LibraryPhoto[];
  relinked: LibraryPhoto[];
  duplicates: LibraryPhoto[];
  skipped: { path: string; reason: string }[];
  /** JPEG sidecars dropped because their RAW twin was imported. */
  suppressedSidecars: number;
  truncated: boolean;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
  importable: boolean;
}

export interface BrowseListing {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

export interface PhotoPatch {
  favorite?: boolean;
  rating?: number;
  title?: string;
  albumId?: string;
}

/**
 * One persisted heal overlay as served by GET heal-overlays: patch metadata
 * plus base64 raw RGBA of the cropped blended patch. The web client converts
 * these to StoredHealPatch (binary) before seeding the preview/export cache.
 */
export interface HealOverlayRecord {
  groupId: number;
  signature: string;
  x0: number;
  y0: number;
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
  method: string;
  quality?: string;
  featherPx?: number;
  geometryKey: string;
  dataB64: string;
  updatedAt: string;
}

export type HealOverlayBody = Omit<HealOverlayRecord, "groupId" | "updatedAt">;

export class LibraryError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LibraryError";
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new LibraryError(0, "The photo library server is not reachable. Start it with yarn dev and try again.");
  }
  if (!response.ok) {
    const body = (await response.json().catch((): null => null)) as { error?: string } | null;
    throw new LibraryError(response.status, body?.error || `Request failed (${response.status}).`);
  }
  return (await response.json()) as T;
}

export interface LibraryClient {
  getLibrary: () => Promise<LibrarySnapshot>;
  upload: (file: Blob, filename: string, albumId?: string) => Promise<{ photo: LibraryPhoto; deduplicated: boolean }>;
  importByPath: (paths: string[], albumId?: string) => Promise<ImportReport>;
  updatePhoto: (id: string, patch: PhotoPatch) => Promise<{ photo: LibraryPhoto }>;
  saveEdit: (id: string, present: EditState) => Promise<{ photo: LibraryPhoto }>;
  listHealOverlays: (id: string) => Promise<{ patches: HealOverlayRecord[] }>;
  saveHealOverlay: (id: string, groupId: number, body: HealOverlayBody) => Promise<{ patch: HealOverlayRecord }>;
  deleteHealOverlay: (id: string, groupId: number) => Promise<{ deleted: boolean }>;
  deletePhoto: (id: string) => Promise<{ deleted: boolean }>;
  createAlbum: (name: string, cover?: string) => Promise<{ album: Album }>;
  updateAlbum: (id: string, patch: { name?: string; cover?: string }) => Promise<{ album: Album }>;
  deleteAlbum: (id: string) => Promise<{ deleted: boolean }>;
  createPreset: (name: string, values: Partial<EditState>) => Promise<{ preset: Preset }>;
  deletePreset: (id: string) => Promise<{ deleted: boolean }>;
  browse: (path?: string) => Promise<BrowseListing>;
}

// Framework-free HTTP client for the library server. `baseUrl` is empty in
// the app (same-origin via the Vite proxy); scripts and tests can point it
// at a running server.
export function createLibraryClient(baseUrl = ""): LibraryClient {
  const url = (path: string): string => `${baseUrl}${path}`;
  const json = (value: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return {
    getLibrary: () => request<LibrarySnapshot>(url("/api/library")),
    upload: (file, filename, albumId) =>
      request<{ photo: LibraryPhoto; deduplicated: boolean }>(url("/api/imports/upload"), {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(filename),
          ...(albumId ? { "X-Album-Id": albumId } : {}),
        },
        body: file,
      }),
    importByPath: (paths, albumId) =>
      request<ImportReport>(url("/api/imports/by-path"), json({ paths, albumId })),
    updatePhoto: (id, patch) =>
      request<{ photo: LibraryPhoto }>(url(`/api/photos/${encodeURIComponent(id)}`), {
        ...json(patch),
        method: "PATCH",
      }),
    saveEdit: (id, present) =>
      request<{ photo: LibraryPhoto }>(url(`/api/photos/${encodeURIComponent(id)}/edit`), {
        ...json({ present }),
        method: "PUT",
      }),
    listHealOverlays: (id) =>
      request<{ patches: HealOverlayRecord[] }>(url(`/api/photos/${encodeURIComponent(id)}/heal-overlays`)),
    saveHealOverlay: (id, groupId, body) =>
      request<{ patch: HealOverlayRecord }>(url(`/api/photos/${encodeURIComponent(id)}/heal-overlays/${groupId}`), {
        ...json(body),
        method: "PUT",
      }),
    deleteHealOverlay: (id, groupId) =>
      request<{ deleted: boolean }>(url(`/api/photos/${encodeURIComponent(id)}/heal-overlays/${groupId}`), {
        method: "DELETE",
      }),
    deletePhoto: (id) =>
      request<{ deleted: boolean }>(url(`/api/photos/${encodeURIComponent(id)}`), { method: "DELETE" }),
    createAlbum: (name, cover = "") =>
      request<{ album: Album }>(url("/api/albums"), json({ name, cover })),
    updateAlbum: (id, patch) =>
      request<{ album: Album }>(url(`/api/albums/${encodeURIComponent(id)}`), { ...json(patch), method: "PATCH" }),
    deleteAlbum: (id) =>
      request<{ deleted: boolean }>(url(`/api/albums/${encodeURIComponent(id)}`), { method: "DELETE" }),
    createPreset: (name, values) =>
      request<{ preset: Preset }>(url("/api/presets"), json({ name, values })),
    deletePreset: (id) =>
      request<{ deleted: boolean }>(url(`/api/presets/${encodeURIComponent(id)}`), { method: "DELETE" }),
    browse: (path) =>
      request<BrowseListing>(url(`/api/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`)),
  };
}

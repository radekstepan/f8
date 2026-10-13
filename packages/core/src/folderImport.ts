import { humanizeAlbumName } from "./albumNames.js";

// A file headed for import with its folder context: `webkitRelativePath`
// ("Trips/iceland.jpg") for folder-picker picks, the FileSystemEntry full
// path for dropped folders, or "" for loose files.
export interface FolderImportFile {
  file: File;
  relativePath: string;
}

export interface FolderImportGroup {
  /** Top-level folder segment, or null for loose files. */
  folder: string | null;
  /** Humanized album name, or null for loose files. */
  albumName: string | null;
  files: File[];
}

// First segment of a picker/drop relative path: "Trips" for
// "Trips/iceland.jpg" (leading slashes from entry full paths are ignored).
// Paths without a folder (loose files, blank input, dot segments) read as
// null so they import without an album.
export function topFolderOf(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  const segments = relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;
  const top = segments[0];
  if (!top || top === "." || top === "..") return null;
  return top;
}

// Group picked/dropped files by top-level folder, preserving first-seen
// order; loose files share one trailing-position group with no album. Each
// folder group carries its humanized album name, matching the server's
// by-path folder imports. Groups key on the exact folder segment, so
// case-distinct folders ("Trip" vs "trip") stay separate here and merge
// later only if the caller files by case-insensitive album name.
export function groupFilesByFolder(files: readonly FolderImportFile[]): FolderImportGroup[] {
  const groups: FolderImportGroup[] = [];
  const byFolder = new Map<string, FolderImportGroup>();
  let loose: FolderImportGroup | null = null;
  for (const { file, relativePath } of files) {
    const folder = topFolderOf(relativePath);
    if (!folder) {
      if (!loose) {
        loose = { folder: null, albumName: null, files: [] };
        groups.push(loose);
      }
      loose.files.push(file);
      continue;
    }
    let group = byFolder.get(folder);
    if (!group) {
      group = { folder, albumName: humanizeAlbumName(folder), files: [] };
      byFolder.set(folder, group);
      groups.push(group);
    }
    group.files.push(file);
  }
  return groups;
}

// Structural slice of a dropped item: DataTransferItem carries no folder
// info itself, so dropped folders are read through webkitGetAsEntry. The
// entry stays unknown (the DOM base type lacks file()/createReader) and is
// narrowed at runtime, so Node tests can drive the traversal with fakes.
export interface DroppedItem {
  webkitGetAsEntry?: (() => unknown) | null;
  getAsFile?: (() => File | null) | null;
}

interface EntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (onSuccess: (file: File) => void, onError?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (onSuccess: (entries: EntryLike[]) => void, onError?: (error: unknown) => void) => void;
  };
}

function asEntry(value: unknown): EntryLike | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["isFile"] !== "boolean" ||
    typeof candidate["isDirectory"] !== "boolean" ||
    typeof candidate["fullPath"] !== "string"
  ) {
    return null;
  }
  if (candidate["file"] !== undefined && typeof candidate["file"] !== "function") return null;
  if (candidate["createReader"] !== undefined && typeof candidate["createReader"] !== "function") return null;
  return candidate as unknown as EntryLike;
}

// readEntries yields one batch per call and an empty batch at the end, so a
// single call can silently drop files from large folders.
async function readAllEntries(
  reader: NonNullable<ReturnType<NonNullable<EntryLike["createReader"]>>>,
): Promise<EntryLike[]> {
  const entries: EntryLike[] = [];
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve, reject) => {
      try {
        reader.readEntries(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}

// Unreadable entries resolve to nothing: one locked file must not kill a
// whole folder drop. The import summary covers what arrived.
async function collectEntry(entry: EntryLike, into: FolderImportFile[]): Promise<void> {
  if (entry.isFile) {
    const read = entry.file;
    if (!read) return;
    const file = await new Promise<File | null>((resolve) => {
      try {
        read(
          (found) => resolve(found),
          () => resolve(null),
        );
      } catch {
        resolve(null);
      }
    });
    if (file) into.push({ file, relativePath: entry.fullPath.replace(/^\/+/, "") });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  let reader: ReturnType<NonNullable<EntryLike["createReader"]>>;
  try {
    reader = entry.createReader();
  } catch {
    return;
  }
  const nested = await readAllEntries(reader).catch((): EntryLike[] => []);
  for (const child of nested) await collectEntry(child, into);
}

// Flatten a drop into files with folder context. Entries win when any item
// resolves one (dataTransfer.files would double-count those same files);
// items without entries degrade to getAsFile, and when nothing resolves —
// no entry support, or a non-file drop — the fallback files are used as-is.
export async function collectDroppedFiles(
  items: ArrayLike<DroppedItem> | null | undefined,
  fallbackFiles: ArrayLike<File>,
): Promise<FolderImportFile[]> {
  const collected: FolderImportFile[] = [];
  let sawEntry = false;
  if (items) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item) continue;
      const entry = asEntry(item.webkitGetAsEntry?.() ?? null);
      if (entry) {
        sawEntry = true;
        await collectEntry(entry, collected);
        continue;
      }
      const file = item.getAsFile?.() ?? null;
      if (file) collected.push({ file, relativePath: "" });
    }
  }
  if (!sawEntry && !collected.length) {
    for (let index = 0; index < fallbackFiles.length; index++) {
      const file = fallbackFiles[index];
      if (file) collected.push({ file, relativePath: "" });
    }
  }
  return collected;
}

import type { Album } from "./types.js";

// Sidebar album order: albums with a cover thumbnail first, then the rest —
// each group sorted by name (numeric-aware, so "Trip 9" precedes "Trip 10"),
// with the id as a final tiebreak so the order is deterministic.
export function compareSidebarAlbums(a: Album, b: Album): number {
  const coverA = a.cover ? 0 : 1;
  const coverB = b.cover ? 0 : 1;
  if (coverA !== coverB) return coverA - coverB;
  return (
    a.name.localeCompare(b.name, undefined, { numeric: true }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// Non-mutating client sort for the sidebar album list.
export function sortSidebarAlbums<T extends Album>(albums: T[]): T[] {
  return [...albums].sort(compareSidebarAlbums);
}

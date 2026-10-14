// Deep-link scheme for the library: which view the URL points at.
//
// - Inside a photo (editor view) the URL names the photo:
//   /photo/<id>/<tool>. The album is inferred from the photo (see
//   collections.ts), so the photo segment alone restores sidebar, toolbar,
//   and filmstrip agreement. The tool segment may be omitted
//   (/photo/<id>), which opens the default tool.
// - In an album (library/grid view) the URL names the collection instead:
//   /album/<collectionId>. There is no open photo to infer from, so a
//   stale photo id would lie about what's on screen.
// - Bare (/) and unknown paths open the default view; the app normalizes
//   them to the canonical path for the resolved state.
// - Legacy query-string links (?photo=, ?album=, ?collection= alias,
//   ?tool=) still parse when the path carries no route, so old shared
//   links keep working; the app rewrites them to the path form, which
//   strips them.
// - When both a photo and an album are present (legacy query pairs), the
//   photo wins (editor view): opening a photo keeps working, and stale
//   pairs resolve to it.

import type { Tool } from "./types.js";

/** Tools valid in the /photo/<id>/<tool> segment: anything else falls back to the current/default. */
export const LIBRARY_URL_TOOLS: readonly Tool[] = ["adjust", "crop", "repair"];

export interface ParsedLibraryUrl {
  /** /photo/<id> segment (legacy ?photo=), or null when absent/empty. Wins over collectionId. */
  photoId: string | null;
  /** /album/<id> segment (legacy ?album=, ?collection= alias), or null when absent/empty. */
  collectionId: string | null;
  /** Valid tool segment (legacy ?tool=), or null when absent/invalid. */
  tool: Tool | null;
}

function nonEmpty(value: string | null | undefined): string | null {
  return value !== null && value !== undefined && value !== "" ? value : null;
}

function validTool(value: string | null): Tool | null {
  return value !== null && (LIBRARY_URL_TOOLS as readonly string[]).includes(value) ? (value as Tool) : null;
}

function decodeSegment(segment: string): string | null {
  try {
    return nonEmpty(decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/**
 * Split a URL pathname (plus an optional legacy query string) into its
 * deep-link parts. Never throws on malformed input: unparseable values
 * read as null. The path wins; the legacy query params (?photo=, ?album=,
 * ?collection= alias, ?tool=) are only read when the path carries no
 * route, so old shared links keep working.
 */
export function parseLibraryUrl(pathname: string, search = ""): ParsedLibraryUrl {
  const empty = { photoId: null, collectionId: null, tool: null };
  let segments: string[];
  try {
    segments = (pathname || "").split("/").filter((segment) => segment !== "");
  } catch {
    return empty;
  }
  const [head, id, tool] = segments;
  if (head === "photo" && id !== undefined) {
    const photoId = decodeSegment(id);
    if (photoId) return { photoId, collectionId: null, tool: validTool(tool ?? null) };
    return empty;
  }
  if (head === "album" && id !== undefined) {
    const collectionId = decodeSegment(id);
    if (collectionId) return { photoId: null, collectionId, tool: null };
    return empty;
  }
  if (segments.length > 0) return empty;
  return parseLegacyQuery(search);
}

/** Parse the pre-path legacy query scheme (?photo=, ?album=, ?collection=, ?tool=). */
function parseLegacyQuery(search: string): ParsedLibraryUrl {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { photoId: null, collectionId: null, tool: null };
  }
  return {
    photoId: nonEmpty(params.get("photo")),
    collectionId: nonEmpty(params.get("album")) ?? nonEmpty(params.get("collection")),
    tool: validTool(params.get("tool")),
  };
}

export type LibraryUrlState =
  | { view: "editor"; photoId: string; tool: Tool }
  | { view: "library"; collectionId: string };

/**
 * Build the canonical path for a view state. Each view writes only its
 * own segments, so switching views strips the other's.
 */
export function buildLibraryUrl(state: LibraryUrlState): string {
  if (state.view === "library") {
    return `/album/${encodeURIComponent(state.collectionId)}`;
  }
  return `/photo/${encodeURIComponent(state.photoId)}/${state.tool}`;
}

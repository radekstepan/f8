// Deep-link scheme for the library: which view the URL points at.
//
// - Inside a photo (editor view) the URL names the photo:
//   ?photo=<id>&tool=<tool>. The album is inferred from the photo (see
//   collections.ts), so the photo param alone restores sidebar, toolbar,
//   and filmstrip agreement.
// - In an album (library/grid view) the URL names the collection instead:
//   ?album=<collectionId>. There is no open photo to infer from, so a stale
//   photo id would lie about what's on screen.
// - A legacy ?collection= param is accepted as an alias of ?album= when
//   ?album= is absent, so old shared grid links still open the right album.
// - When both ?photo= and ?album= are present, the photo wins (editor
//   view): opening a photo keeps working, and stale pairs resolve to it.

import type { Tool } from "./types.js";

/** Tools valid in ?tool=: anything else falls back to the current/default. */
export const LIBRARY_URL_TOOLS: readonly Tool[] = ["adjust", "crop", "repair"];

export interface ParsedLibraryUrl {
  /** ?photo= value, or null when absent/empty. Wins over collectionId. */
  photoId: string | null;
  /** ?album= value (legacy ?collection= alias), or null when absent/empty. */
  collectionId: string | null;
  /** Valid ?tool= value, or null when absent/invalid. */
  tool: Tool | null;
}

function nonEmpty(value: string | null): string | null {
  return value !== null && value !== "" ? value : null;
}

/**
 * Split a query string (with or without leading '?') into its deep-link
 * parts. Never throws on malformed input: unparseable values read as null.
 */
export function parseLibraryUrl(search: string): ParsedLibraryUrl {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { photoId: null, collectionId: null, tool: null };
  }
  const tool = params.get("tool");
  return {
    photoId: nonEmpty(params.get("photo")),
    collectionId: nonEmpty(params.get("album")) ?? nonEmpty(params.get("collection")),
    tool: tool !== null && (LIBRARY_URL_TOOLS as readonly string[]).includes(tool) ? (tool as Tool) : null,
  };
}

export type LibraryUrlState =
  | { view: "editor"; photoId: string; tool: Tool }
  | { view: "library"; collectionId: string };

/**
 * Build the query string (leading '?' included) for a view state. Each
 * view writes only its own params, so switching views strips the other's.
 */
export function buildLibraryUrl(state: LibraryUrlState): string {
  const params = new URLSearchParams();
  if (state.view === "library") {
    params.set("album", state.collectionId);
  } else {
    params.set("photo", state.photoId);
    params.set("tool", state.tool);
  }
  return `?${params.toString()}`;
}

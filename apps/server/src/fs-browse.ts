import { promises as fs } from "node:fs";
import path from "node:path";
import { isImportableFilename } from "@photomator/core";
import type { BrowseListing } from "@photomator/core";

export class BrowseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowseError";
  }
}

// Resolve a user-supplied path and confine it to the allowed roots. Symlinks
// resolve via realpath, so `..` segments and links cannot escape.
export async function resolveWithinRoots(requested: string, roots: string[]): Promise<string> {
  const resolved = path.resolve(requested);
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    throw new BrowseError("This location could not be found.");
  }
  for (const root of roots) {
    if (real === root || real.startsWith(root + path.sep)) return real;
  }
  throw new BrowseError("This location is outside the allowed folders.");
}

const MAX_ENTRIES = 5000;

export async function browse(requested: string | undefined, roots: string[]): Promise<BrowseListing> {
  const confined = await resolveWithinRoots(requested ?? roots[0] ?? "/", roots);
  const stat = await fs.stat(confined).catch(() => null);
  if (!stat) throw new BrowseError("This location could not be found.");
  const dir = stat.isDirectory() ? confined : path.dirname(confined);
  const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => {
    throw new BrowseError("This folder could not be read.");
  });
  const entries = dirents
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => {
      const isDir = entry.isDirectory();
      const full = path.join(dir, entry.name);
      return {
        name: entry.name,
        path: full,
        isDir,
        importable: !isDir && isImportableFilename(entry.name),
      };
    })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    .slice(0, MAX_ENTRIES);
  const atRoot = roots.some((root) => root === dir);
  return { path: dir, parent: atRoot ? null : path.dirname(dir), entries };
}

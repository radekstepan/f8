/** Persisted action stack for the Adjust-tool whole-photo enhance.
 *
 * Whole-photo enhance (classic + scene + taste) used to keep its pre-apply
 * snapshot in a session-only ref: after a reload the recipe still held the
 * enhanced values, but the revert was gone. The stack below is the
 * persisted replacement — one entry carrying the snapshot its revert
 * restores — so the enhance stays revertible across a hard reload.
 *
 * The per-category autos (white balance, lightness, color) deliberately
 * keep no entries: their header toggles read dirtiness straight from the
 * recipe (on = non-default values, whether auto-applied or hand-tweaked),
 * so they need no highlight bookkeeping — and toggle-off resets to the
 * section defaults, which needs no snapshot. Only the enhance reverts to
 * its pre-apply look instead of defaults, so only it keeps a snapshot.
 * Legacy persisted stacks may still carry category entries; the sanitizer
 * drops them on load (they were always ignored the same way).
 *
 * The stack rides with the recipe (PUT /api/photos/:id/edit persists
 * `{ present, actions }` together) but is provenance, not look: it never
 * affects `edited`, presets, copy/paste, or export. At most one entry per
 * kind exists; re-applying an action refreshes its entry while keeping the
 * earliest snapshot, so revert always returns to the pre-auto recipe.
 */

import { DEFAULT_EDIT, patchBreaksEnhancePure } from "./data.js";
import { ML_CATEGORIES, touchedMlCategories } from "./mlCategories.js";
import type { MlCategory } from "./mlCategories.js";
import type { EditState } from "./types.js";

/**
 * Whole-photo enhance modes sharing the single enhance stack slot: the
 * classic histogram auto, the scene-aware auto, and the taste auto (the
 * user's learned medians — see tasteProfile.ts).
 */
export type EnhanceMode = "classic" | "scene" | "taste";

/** Auto actions with a persisted revert: the enhance, plus the per-category autos as legacy stack values only. */
export type AutoActionKind = "enhance" | MlCategory;

/** All stackable auto-action kinds, oldest-slot order. */
export const AUTO_ACTION_KINDS: readonly AutoActionKind[] = ["enhance", ...ML_CATEGORIES];

/** One applied auto action plus the snapshot its revert restores. */
export interface ActionStackEntry {
  kind: AutoActionKind;
  /** Enhance only: which mode applied last (classic and scene share one slot). */
  mode?: EnhanceMode;
  /** True while the recipe still holds exactly the auto values. Manual edits clear it; the snapshot stays for the revert. */
  pure: boolean;
  /** Pre-apply values the revert restores (full look for enhance, category keys for the autos). */
  snapshot: Partial<EditState>;
  /** ISO timestamp of the latest apply. */
  appliedAt: string;
}

/** A photo's applied auto actions, oldest first, at most one entry per kind. */
export type ActionStack = ActionStackEntry[];

/** The entry for one kind, if that auto action is on the stack. */
export function actionEntry(stack: ActionStack, kind: AutoActionKind): ActionStackEntry | undefined {
  return stack.find((entry) => entry.kind === kind);
}

/**
 * Push an applied action: a new kind appends, a repeat refreshes the entry
 * in place while keeping the earliest snapshot (revert always returns to
 * the pre-auto recipe, never to an intermediate re-apply).
 */
export function pushAction(stack: ActionStack, entry: ActionStackEntry): ActionStack {
  const existing = actionEntry(stack, entry.kind);
  if (!existing) return [...stack, entry];
  return stack.map((candidate) =>
    candidate.kind === entry.kind ? { ...entry, snapshot: existing.snapshot } : candidate,
  );
}

/**
 * Pop one action for its revert: returns the stack without it plus the
 * snapshot to restore, or null when the kind is not on the stack.
 */
export function revertAction(
  stack: ActionStack,
  kind: AutoActionKind,
): { stack: ActionStack; snapshot: Partial<EditState> } | null {
  const existing = actionEntry(stack, kind);
  if (!existing) return null;
  return { stack: stack.filter((entry) => entry.kind !== kind), snapshot: existing.snapshot };
}

/** Drop the whole-photo enhance entry (wholesale recipe changes). */
export function clearEnhanceAction(stack: ActionStack): ActionStack {
  return stack.some((entry) => entry.kind === "enhance") ? stack.filter((entry) => entry.kind !== "enhance") : stack;
}

/** Drop legacy per-category auto entries (the enhance transition sheds them; the sanitizer drops them on load). */
export function clearCategoryActions(stack: ActionStack): ActionStack {
  return stack.some((entry) => entry.kind !== "enhance") ? stack.filter((entry) => entry.kind === "enhance") : stack;
}

/**
 * Whole-photo enhance stack transition: drop stale per-category entries
 * (legacy pre-toggle stacks may still carry them; nothing pushes them
 * anymore), then push the enhance entry. No per-category entries follow:
 * the enhance writes non-default values, so the dirty-driven section
 * toggles light on their own — and each toggle-off resets its section to
 * defaults rather than to the pre-enhance values. Re-applying an enhance
 * mode refreshes its entry in place (earliest snapshot wins, via
 * pushAction), so the whole-photo revert always returns to the
 * un-enhanced recipe.
 */
export function pushEnhanceAction(stack: ActionStack, mode: EnhanceMode, edit: EditState, appliedAt: string): ActionStack {
  const next = clearCategoryActions(stack);
  return pushAction(next, { kind: "enhance", mode, pure: true, snapshot: snapshotForEnhance(edit), appliedAt });
}

/**
 * Clear `pure` for entries a manual edit patch moves off the auto values:
 * touched categories plus whole-photo enhance on any look change. Returns
 * the input untouched when no flag flips. Auto applies skip this (their
 * patch IS the auto values).
 */
export function clearPureOnPatch(stack: ActionStack, patch: Partial<EditState>): ActionStack {
  if (!stack.length) return stack;
  const touched = new Set<AutoActionKind>(touchedMlCategories(patch));
  if (patchBreaksEnhancePure(patch)) touched.add("enhance");
  if (stack.every((entry) => !touched.has(entry.kind) || !entry.pure)) return stack;
  return stack.map((entry) => (touched.has(entry.kind) && entry.pure ? { ...entry, pure: false } : entry));
}

/**
 * Capture the pre-enhance look: everything enhance overwrites. Geometry and
 * retouches are excluded (the revert keeps the current ones), as are the
 * face/selective/denoise states (enhance never touches them, so restoring a
 * stale copy would wipe newer work applied after the enhance).
 */
export function snapshotForEnhance(edit: EditState): Partial<EditState> {
  const excluded = new Set([
    "rotation",
    "flipH",
    "flipV",
    "straighten",
    "cropRatio",
    "retouches",
    "faceAdjust",
    "selectiveAdjust",
    "denoise",
  ]);
  const snapshot: Partial<EditState> = {};
  const record = snapshot as Record<string, unknown>;
  for (const key of Object.keys(edit) as (keyof EditState)[]) {
    if (!excluded.has(key)) record[key] = edit[key];
  }
  return snapshot;
}


/** Whole-photo enhance UI state derived from the stack (null when no enhance revert exists). */
export function enhanceFromStack(stack: ActionStack): { mode: EnhanceMode; pure: boolean } | null {
  const entry = actionEntry(stack, "enhance");
  return entry ? { mode: entry.mode ?? "classic", pure: entry.pure } : null;
}

const EDIT_STATE_KEYS = new Set<string>([
  ...Object.keys(DEFAULT_EDIT),
  "sceneEnhance",
  "faceAdjust",
  "selectiveAdjust",
  "denoise",
]);

/**
 * Sanitize a stack across the persistence boundary (server load/save, seed).
 * Drops unknown kinds, legacy per-category entries (nothing pushes them
 * since the header-toggle conversion — the toggles read the recipe, not
 * the stack), entries without a usable snapshot or timestamp, and
 * duplicate kinds (first wins, preserving application order); unknown
 * snapshot keys are stripped. Never throws — garbage in, empty stack out.
 */
export function sanitizeActionStack(value: unknown): ActionStack {
  if (!Array.isArray(value)) return [];
  const stack: ActionStack = [];
  const seen = new Set<AutoActionKind>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    if (record.kind !== "enhance") continue;
    const kind = record.kind as AutoActionKind;
    if (seen.has(kind)) continue;
    const snapshot = record.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) continue;
    const clean: Partial<EditState> = {};
    const target = clean as Record<string, unknown>;
    for (const [key, entry] of Object.entries(snapshot as Record<string, unknown>)) {
      if (EDIT_STATE_KEYS.has(key)) target[key] = entry;
    }
    if (!Object.keys(clean).length) continue;
    if (typeof record.appliedAt !== "string" || !record.appliedAt) continue;
    seen.add(kind);
    stack.push({
      kind,
      ...(kind === "enhance" ? { mode: record.mode === "scene" || record.mode === "taste" ? record.mode : "classic" } : {}),
      pure: record.pure === true,
      snapshot: clean,
      appliedAt: record.appliedAt,
    });
  }
  return stack;
}

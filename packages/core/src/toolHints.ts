/** Canvas tool help messages: show once per photo visit, then fade away (PhotoCanvas).
 *
 * Each tool hint (repair, and any future canvas hint) appears when its tool
 * opens, stays readable for a couple of seconds, then fades out and stays
 * hidden until the user navigates away from the photo and back. The timing
 * constants live here so the component and its CSS transition stay in sync,
 * and the dismissal record lives here as a framework-free tracker so the
 * once-per-visit rule is unit-testable without a DOM.
 */

/** How long a tool hint stays fully visible after its tool opens. */
export const TOOL_HINT_VISIBLE_MS = 2500;

/** How long the fade-out transition runs (must match the .tool-hint CSS transition). */
export const TOOL_HINT_FADE_MS = 500;

export interface ToolHintTracker {
  /** True when this hint already faded out during the current photo visit. */
  isDismissed: (photoId: string, hintId: string) => boolean;
  /** Record that this hint faded out during the current photo visit. */
  dismiss: (photoId: string, hintId: string) => void;
}

/** Dismissal record for tool hints, scoped to one photo visit at a time.
 *
 * The editor shows a single photo, so the tracker keeps one photo's
 * dismissals: touching a different photo clears the record and every hint
 * becomes eligible again. Dismissal is recorded when the fade completes —
 * never on mount — so re-renders and StrictMode remounts can't consume it.
 */
export function createToolHintTracker(): ToolHintTracker {
  let photoId: string | null = null;
  const dismissed = new Set<string>();
  const sync = (next: string) => {
    if (next !== photoId) {
      photoId = next;
      dismissed.clear();
    }
  };
  return {
    isDismissed: (photo: string, hintId: string) => {
      sync(photo);
      return dismissed.has(hintId);
    },
    dismiss: (photo: string, hintId: string) => {
      sync(photo);
      dismissed.add(hintId);
    },
  };
}

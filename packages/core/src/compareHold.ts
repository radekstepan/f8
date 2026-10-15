/**
 * Press-and-hold Compare: a quick click on a Compare button toggles the
 * side-by-side split, while holding the button down previews the full
 * original until release (the same view the `\` key holds). This machine
 * owns that distinction so both Compare buttons (toolbar + canvas status)
 * share one behavior; the scheduler is injectable so tests drive the delay
 * without timers.
 *
 * Protocol: `press()` on pointer down, `release()` on pointer up / leave /
 * cancel, and `click()` in the click handler — it returns false when a hold
 * just fired so the release click does not also toggle the split.
 */
export const COMPARE_HOLD_DELAY_MS = 400;

export interface CompareHold {
  press: () => void;
  release: () => void;
  /** True when the click should toggle the split (no hold fired). */
  click: () => boolean;
}

export function createCompareHold(options: {
  onHoldChange: (holding: boolean) => void;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
  delay?: number;
}): CompareHold {
  const { onHoldChange } = options;
  const delay = options.delay ?? COMPARE_HOLD_DELAY_MS;
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = options.cancel ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let holding = false;
  let suppressClick = false;
  const clearTimer = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };
  return {
    press: () => {
      // Re-press while armed or holding (multi-touch, repeat events)
      // keeps the first press's outcome: never double-arm or re-fire.
      if (timer !== null || holding) return;
      suppressClick = false;
      timer = schedule(() => {
        timer = null;
        holding = true;
        onHoldChange(true);
      }, delay);
    },
    release: () => {
      clearTimer();
      if (!holding) return;
      holding = false;
      // The pointer-up click that follows a hold must not toggle the
      // split — the hold already showed (and hid) the original.
      suppressClick = true;
      onHoldChange(false);
    },
    click: () => {
      if (!suppressClick) return true;
      suppressClick = false;
      return false;
    },
  };
}

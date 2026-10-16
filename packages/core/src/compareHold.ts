/**
 * Press-and-hold Compare: pressing a Compare button shows the full original
 * immediately (synchronously on pointer down — no delay, no debounce),
 * while a quick press-and-release clicks through to the normal side-by-side
 * split toggle. This machine owns that distinction so both Compare buttons
 * (toolbar + canvas status) share one behavior; the scheduler is injectable
 * so tests drive the click window without timers.
 *
 * Protocol: `press()` on pointer down, `release()` on pointer up / leave /
 * cancel, and `click()` in the click handler — it returns false when the
 * press outlasted the click window, so the release click does not also
 * toggle the split.
 */
export const COMPARE_CLICK_WINDOW_MS = 400;

export interface CompareHold {
  press: () => void;
  release: () => void;
  /** True when the click should toggle the split (quick press, no hold). */
  click: () => boolean;
}

export function createCompareHold(options: {
  onHoldChange: (holding: boolean) => void;
  schedule?: (callback: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
  delay?: number;
}): CompareHold {
  const { onHoldChange } = options;
  const delay = options.delay ?? COMPARE_CLICK_WINDOW_MS;
  const schedule = options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel = options.cancel ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let holding = false;
  let held = false;
  let suppressClick = false;
  const clearTimer = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };
  return {
    press: () => {
      // Re-press while showing (multi-touch, repeat events) keeps the
      // first press's outcome: never re-fire or re-arm the window.
      if (holding) return;
      suppressClick = false;
      held = false;
      holding = true;
      onHoldChange(true);
      timer = schedule(() => {
        timer = null;
        held = true;
      }, delay);
    },
    release: () => {
      clearTimer();
      if (!holding) return;
      holding = false;
      // A release past the click window is a hold: the release click
      // must not toggle the split — the hold already showed (and hid)
      // the original. A quick release hides it and clicks through.
      suppressClick = held;
      held = false;
      onHoldChange(false);
    },
    click: () => {
      if (!suppressClick) return true;
      suppressClick = false;
      return false;
    },
  };
}

import { useEffect, useRef } from 'react';
import { createCompareHold, type CompareHold } from '@f8/core';

/**
 * Wires press-and-hold preview onto a Compare button: holding past
 * COMPARE_HOLD_DELAY_MS calls `onHoldChange(true)` (App shows the full
 * original) until release calls it with false, and the release click is
 * swallowed so the split does not toggle. Spread `holdProps` onto the
 * button and route its click through `filterClick`.
 */
export function useCompareHold(onHoldChange?: (holding: boolean) => void): {
  holdProps: {
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
  };
  filterClick: (next: () => void) => () => void;
} {
  const callbackRef = useRef(onHoldChange);
  callbackRef.current = onHoldChange;
  const holdRef = useRef<CompareHold | null>(null);
  if (!holdRef.current) {
    holdRef.current = createCompareHold({ onHoldChange: (holding) => callbackRef.current?.(holding) });
  }
  useEffect(() => () => {
    // Unmount mid-hold clears the timer and hides the original.
    holdRef.current?.release();
  }, []);
  return {
    holdProps: {
      onPointerDown: () => holdRef.current?.press(),
      onPointerUp: () => holdRef.current?.release(),
      onPointerLeave: () => holdRef.current?.release(),
      onPointerCancel: () => holdRef.current?.release(),
    },
    filterClick: (next: () => void) => () => {
      if (holdRef.current?.click()) next();
    },
  };
}

import { useEffect, useRef } from 'react';
import { createCompareHold, type CompareHold } from '@f8/core';

/** Smallest event surface the Compare gesture needs (pointer-down + click). */
export interface ComparePressEvent {
  shiftKey?: boolean;
  button?: number;
}

/**
 * Wires press-and-hold preview plus Shift+click whole-original toggle onto
 * a Compare button: pressing shows the full original immediately (App shows
 * it via `onHoldChange(true)`) until release hides it, and the release
 * click after a hold is swallowed so the split does not toggle — while a
 * quick press-and-release clicks through to the split toggle. Shift+click
 * instead fires `onShiftClick` (App pins the full original until toggled
 * off) without ever arming the hold. Spread `holdProps` onto the button
 * and route its click through `filterClick`.
 */
export function useCompareHold(
  onHoldChange?: (holding: boolean) => void,
  onShiftClick?: () => void,
): {
  holdProps: {
    onPointerDown: (event: ComparePressEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
  };
  filterClick: (next: () => void) => (event?: ComparePressEvent) => void;
} {
  const callbackRef = useRef(onHoldChange);
  callbackRef.current = onHoldChange;
  const shiftRef = useRef(onShiftClick);
  shiftRef.current = onShiftClick;
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
      onPointerDown: (event) => {
        // Shift+click is the pinned whole-original toggle, not a hold:
        // skip the press so release stays a no-op and the original does
        // not flash. Non-primary buttons (right/middle click) never peek.
        if (event.shiftKey || (event.button ?? 0) !== 0) return;
        holdRef.current?.press();
      },
      onPointerUp: () => holdRef.current?.release(),
      onPointerLeave: () => holdRef.current?.release(),
      onPointerCancel: () => holdRef.current?.release(),
    },
    filterClick: (next: () => void) => (event?: ComparePressEvent) => {
      if (event?.shiftKey) {
        shiftRef.current?.();
        return;
      }
      if (holdRef.current?.click()) next();
    },
  };
}

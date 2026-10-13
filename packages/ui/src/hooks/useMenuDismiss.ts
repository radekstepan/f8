import { useEffect, useRef } from 'react';

/** Minimal shape the dismiss check reads: anything with a DOM contains() check. */
export interface DismissTarget {
  readonly current: { contains(node: unknown): boolean } | null;
}

/** True when the event target sits outside every dismiss target. Null targets never contain. */
export function isOutsideTargets(targets: ReadonlyArray<DismissTarget | null | undefined>, target: unknown): boolean {
  return !targets.some((entry) => entry?.current?.contains(target) ?? false);
}

/**
 * The single shared menu-dismiss behavior: a pointer-down outside every
 * target or an Escape dismisses. Viewport moves (scroll/resize) only dismiss
 * for floating menus measured into place, which would otherwise strand away
 * from their trigger. Replaces the per-menu document listeners.
 */
export function useMenuDismiss(
  refs: DismissTarget | ReadonlyArray<DismissTarget>,
  onDismiss: () => void,
  options?: { enabled?: boolean; dismissOnViewportChange?: boolean },
): void {
  const targets = Array.isArray(refs) ? refs : [refs];
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const { enabled = true, dismissOnViewportChange = false } = options ?? {};
  useEffect(() => {
    if (!enabled) return;
    const onPointer = (event: PointerEvent) => {
      if (isOutsideTargets(targetsRef.current, event.target)) dismissRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current();
    };
    const onViewport = () => dismissRef.current();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    if (dismissOnViewportChange) {
      document.addEventListener('scroll', onViewport, true);
      window.addEventListener('resize', onViewport);
    }
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      if (dismissOnViewportChange) {
        document.removeEventListener('scroll', onViewport, true);
        window.removeEventListener('resize', onViewport);
      }
    };
  }, [enabled, dismissOnViewportChange]);
}

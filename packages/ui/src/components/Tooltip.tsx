import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect.js';

// The app's custom tooltip system (no native `title` tooltips anywhere):
// triggers carry a `data-tooltip` attribute and a single <TooltipHost/>
// renders one floating bubble, flipped and clamped so it never leaves the
// viewport. Styling lives in apps/web/src/index.css (.f8-tooltip) so the
// bubble matches the dropdown/menu theme.

/** Attribute read off hovered/focused elements; the value is the tooltip text. */
export const TOOLTIP_ATTRIBUTE = 'data-tooltip';
/** Optional per-trigger preferred side; the host still flips when space is short. */
export const TOOLTIP_PLACEMENT_ATTRIBUTE = 'data-tooltip-placement';
/** Hover dwell before the bubble appears (native-like, avoids flicker). */
export const TOOLTIP_SHOW_DELAY_MS = 350;
/** Gap between the trigger edge and the bubble. */
export const TOOLTIP_GAP = 8;
/** Minimum distance kept between the bubble and the viewport edges. */
export const TOOLTIP_VIEWPORT_PADDING = 8;

export type TooltipPlacement = 'top' | 'bottom';

export interface TooltipAnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipPosition {
  x: number;
  y: number;
  placement: TooltipPlacement;
}

/** Props helper for tooltip triggers: renders `data-tooltip` only when text is non-empty. */
export function tooltipProps(text?: string | null): { [TOOLTIP_ATTRIBUTE]?: string } {
  return text ? { [TOOLTIP_ATTRIBUTE]: text } : {};
}

/**
 * Viewport-safe tooltip position: centers the bubble on the trigger,
 * prefers `placement` (default top), flips to the other side when the
 * preferred side overflows, and clamps both axes into the viewport with
 * `padding`. Pure (no DOM) so the geometry is unit-testable.
 */
export function positionTooltip(
  trigger: TooltipAnchorRect,
  tooltip: TooltipSize,
  viewport: TooltipSize,
  options?: { placement?: TooltipPlacement; gap?: number; padding?: number },
): TooltipPosition {
  const placement = options?.placement ?? 'top';
  const gap = options?.gap ?? TOOLTIP_GAP;
  const padding = options?.padding ?? TOOLTIP_VIEWPORT_PADDING;
  const maxX = Math.max(padding, viewport.width - padding - tooltip.width);
  const x = Math.min(Math.max(trigger.x + trigger.width / 2 - tooltip.width / 2, padding), maxX);
  const fits = (y: number): boolean => y >= padding && y + tooltip.height <= viewport.height - padding;
  const above = trigger.y - gap - tooltip.height;
  const below = trigger.y + trigger.height + gap;
  // Preferred side first, then the flip side, then the roomier side clamped.
  const ordered = placement === 'top' ? (['top', 'bottom'] as const) : (['bottom', 'top'] as const);
  for (const side of ordered) {
    const y = side === 'top' ? above : below;
    if (fits(y)) return { x, y, placement: side };
  }
  // Neither side fits whole (tiny viewport or tall bubble): take the side
  // with more room and clamp inside, so the bubble is always reachable.
  const roomAbove = trigger.y - gap - padding;
  const roomBelow = viewport.height - padding - (trigger.y + trigger.height + gap);
  const side: TooltipPlacement = roomBelow >= roomAbove ? 'bottom' : 'top';
  const y = side === 'top' ? above : below;
  const maxY = Math.max(padding, viewport.height - padding - tooltip.height);
  return { x, y: Math.min(Math.max(y, padding), maxY), placement: side };
}

interface PendingTip {
  text: string;
  preferred: TooltipPlacement;
  rect: TooltipAnchorRect;
}

/**
 * The single global tooltip renderer. Mount once near the app root; it
 * listens for hover/focus on any `[data-tooltip]` descendant of the
 * document and portals one themed bubble to <body>. Server render is
 * null (effects never run there), so SSR markup keeps only the
 * `data-tooltip` attributes.
 */
export function TooltipHost() {
  const [pending, setPending] = useState<PendingTip | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const hide = () => {
      clearTimer();
      setPending(null);
    };
    const readTrigger = (target: EventTarget | null): PendingTip | null => {
      const element = (target as Element | null)?.closest?.(`[${TOOLTIP_ATTRIBUTE}]`) ?? null;
      if (!(element instanceof HTMLElement)) return null;
      const text = element.getAttribute(TOOLTIP_ATTRIBUTE);
      if (!text) return null;
      const rect = element.getBoundingClientRect();
      const preferred = element.getAttribute(TOOLTIP_PLACEMENT_ATTRIBUTE) === 'bottom' ? 'bottom' : 'top';
      return { text, preferred, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } };
    };
    const onMouseOver = (event: MouseEvent) => {
      const found = readTrigger(event.target);
      if (!found) {
        hide();
        return;
      }
      clearTimer();
      // Hover dwells briefly before showing, like a native tooltip; the
      // rect is re-read on fire so a moved trigger still anchors right.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const fresh = readTrigger(event.target);
        setPending(fresh && fresh.text === found.text ? fresh : found);
      }, TOOLTIP_SHOW_DELAY_MS);
    };
    const onMouseOut = (event: MouseEvent) => {
      const from = (event.target as Element | null)?.closest?.(`[${TOOLTIP_ATTRIBUTE}]`) ?? null;
      const to = (event.relatedTarget as Element | null)?.closest?.(`[${TOOLTIP_ATTRIBUTE}]`) ?? null;
      if (from && from !== to) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const found = readTrigger(event.target);
      if (found) {
        clearTimer();
        setPending(found);
      }
    };
    const onFocusOut = () => hide();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    // The bubble is fixed-positioned, so any scroll/resize/click would
    // strand it: hide instead of chasing (native tooltips do the same).
    const onPointerDown = () => hide();
    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimer();
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  // Two-pass positioning: the bubble renders once to be measured, then
  // moves to its viewport-safe spot before paint (layout effect, so no
  // first-frame flash at the origin).
  useIsomorphicLayoutEffect(() => {
    setPosition(null);
    const node = nodeRef.current;
    if (!pending || !node || typeof window === 'undefined') return;
    setPosition(
      positionTooltip(
        pending.rect,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { placement: pending.preferred },
      ),
    );
  }, [pending]);

  if (!pending || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={nodeRef}
      className="f8-tooltip"
      role="tooltip"
      data-placement={position?.placement ?? pending.preferred}
      style={{
        left: position?.x ?? -10000,
        top: position?.y ?? -10000,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {pending.text}
    </div>,
    document.body,
  );
}

/** Opt-in wrapper for triggers that cannot carry props themselves. */
export function Tooltip({ content, placement, children }: { content: string; placement?: TooltipPlacement; children: ReactNode }) {
  return (
    <span className="tooltip-anchor" {...tooltipProps(content)} {...(placement ? { [TOOLTIP_PLACEMENT_ATTRIBUTE]: placement } : {})}>
      {children}
    </span>
  );
}

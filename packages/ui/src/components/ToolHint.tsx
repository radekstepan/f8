import { useEffect, useState, type ReactNode } from 'react';
import { TOOL_HINT_FADE_MS, TOOL_HINT_VISIBLE_MS, createToolHintTracker } from '@f8/core';

/** Session-wide dismissal record: each hint shows once per photo visit. */
const toolHintTracker = createToolHintTracker();

interface ToolHintProps {
  /** Photo the hint belongs to; navigating away and back re-arms every hint. */
  photoId: string;
  /** Stable id per hint slot (e.g. the tool name); each id fades independently. */
  hintId: string;
  children: ReactNode;
}

/** Canvas help message: fully readable for 5s, then fades away over 0.5s.
 *
 * Render every canvas tool hint through this wrapper so they all share the
 * once-per-photo-visit rule: the hint shows when its tool opens, fades after
 * TOOL_HINT_VISIBLE_MS, and stays hidden until the photo changes. Message
 * updates (e.g. repair warming up, then ready) swap the text while visible
 * without restarting the timer.
 */
export function ToolHint({ photoId, hintId, children }: ToolHintProps) {
  const [phase, setPhase] = useState<'visible' | 'fading' | 'gone'>(() =>
    toolHintTracker.isDismissed(photoId, hintId) ? 'gone' : 'visible');

  useEffect(() => {
    if (toolHintTracker.isDismissed(photoId, hintId)) {
      setPhase('gone');
      return;
    }
    setPhase('visible');
    const fadeTimer = setTimeout(() => setPhase('fading'), TOOL_HINT_VISIBLE_MS);
    const goneTimer = setTimeout(() => {
      toolHintTracker.dismiss(photoId, hintId);
      setPhase('gone');
    }, TOOL_HINT_VISIBLE_MS + TOOL_HINT_FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(goneTimer);
    };
  }, [photoId, hintId]);

  if (phase === 'gone') return null;
  return <div className={`tool-hint${phase === 'fading' ? ' is-fading' : ''}`} data-testid="tool-hint" role="status">{children}</div>;
}

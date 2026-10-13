import { useEffect, useLayoutEffect } from 'react';

// The open menu is measured before paint so its first frame already sits at
// the anchored position; on the server (test renders) this degrades to a
// plain effect.
export const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

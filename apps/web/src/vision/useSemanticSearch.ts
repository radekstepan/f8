// React binding for local semantic search / smart albums: debounced
// server-side text search. (Labeling needs no hook: every import embeds +
// labels itself in a server background queue.)
//
// Search: every keystroke re-queries the server after a short debounce; the
// ranked photo ids drive the grid order. A null rank means "no server
// answer" (empty query, or the server is down), and the grid falls back to
// its client-side substring filter over the loaded library.

import { useCallback, useEffect, useRef, useState } from "react";
import { runRemoteSemanticSearch } from "./remoteSemanticSearch";

export const SEMANTIC_SEARCH_DEBOUNCE_MS = 300;

export interface SemanticRank {
  /** The trimmed query this rank answers (stale ranks never apply). */
  query: string;
  /** Ranked photo ids, best first. */
  ids: string[];
  mode: "semantic" | "keyword";
  /** Vocabulary labels the query mapped onto (empty in keyword mode). */
  matched: string[];
}

export function useSemanticSearch() {
  const [rank, setRank] = useState<SemanticRank | null>(null);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const search = useCallback((query: string) => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) {
      setRank(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const trimmed = query.trim();
    timerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await runRemoteSemanticSearch(trimmed);
          if (requestRef.current !== request) return;
          setRank({
            query: trimmed,
            ids: response.results.map((entry) => entry.photoId),
            mode: response.mode,
            matched: response.matched,
          });
        } catch {
          // Server down or search failed: the grid falls back to its
          // client-side filter instead of showing an error per keystroke.
          if (requestRef.current !== request) return;
          setRank(null);
        } finally {
          if (requestRef.current === request) setSearching(false);
        }
      })();
    }, SEMANTIC_SEARCH_DEBOUNCE_MS);
  }, []);

  return { rank, searching, search };
}

export type SemanticSearch = ReturnType<typeof useSemanticSearch>;

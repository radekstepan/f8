// React binding for local semantic search / smart albums: debounced
// server-side text search plus the album "label unlabeled" action.
//
// Search: every keystroke re-queries the server after a short debounce; the
// ranked photo ids drive the grid order. A null rank means "no server
// answer" (empty query, or the server is down), and the grid falls back to
// its client-side substring filter over the loaded library.
//
// Labeling: the album menu action embeds + labels every photo that lacks ML
// labels yet. When the weights are missing the hook downloads them once
// (with progress) and retries automatically, so one menu click always gets
// the job done.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LabelAlbumReport } from "@f8/core";
import {
  SemanticWeightsMissingError,
  runRemoteLabelAlbum,
  runRemoteSemanticSearch,
  warmupRemoteSemanticSearch,
} from "./remoteSemanticSearch";

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

export interface LabelAlbumProgress {
  fraction: number;
  stage: string;
  updatedAt: number;
}

export function useSemanticSearch() {
  const [rank, setRank] = useState<SemanticRank | null>(null);
  const [searching, setSearching] = useState(false);
  const [labeling, setLabeling] = useState(false);
  const [labelProgress, setLabelProgress] = useState<LabelAlbumProgress | null>(null);
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

  const report = useCallback((fraction: number, stage: string) => {
    setLabelProgress({ fraction: Math.max(0, Math.min(1, fraction)), stage, updatedAt: Date.now() });
  }, []);

  const labelAlbum = useCallback(
    async (albumId: string): Promise<LabelAlbumReport> => {
      setLabeling(true);
      setLabelProgress(null);
      try {
        try {
          report(0, "Labeling unlabeled photos…");
          return await runRemoteLabelAlbum(albumId);
        } catch (error) {
          // First run: download the weights once, then retry the same run.
          if (!(error instanceof SemanticWeightsMissingError)) throw error;
          await warmupRemoteSemanticSearch({ onProgress: report });
          report(0, "Labeling unlabeled photos…");
          return await runRemoteLabelAlbum(albumId);
        }
      } finally {
        setLabeling(false);
        setLabelProgress(null);
      }
    },
    [report],
  );

  return { rank, searching, search, labeling, labelProgress, labelAlbum };
}

export type SemanticSearch = ReturnType<typeof useSemanticSearch>;

// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref } from "vue";

/** Stream stats as the stream list returns them: sizes in MB, times in microseconds. */
export interface StreamSizeStats {
  storage_size?: number;
  doc_time_min?: number;
  doc_time_max?: number;
}

export interface LargeStreamGateInput {
  mode: "stream" | "agent";
  agentSelected: boolean;
  searchQuery: string;
  stream: string;
  /** Streams known to hold LLM spans only; the notice never shows for them. */
  agentStreams: string[];
  stats: StreamSizeStats | undefined;
  start: number;
  end: number;
}

export const DEFAULT_LARGE_STREAM_BYTES = 200 * 1024 ** 3;
const BYTES_PER_MB = 1024 ** 2;
const RUN_ANYWAY_KEY_PREFIX = "llmInsights_runAnyway:";

/** Bytes the window is likely to scan: the stream's stored size times the share of its span the window covers. */
export function estimateWindowBytes(
  stats: StreamSizeStats | undefined,
  start: number,
  end: number,
): number | null {
  const size = Number(stats?.storage_size);
  const min = Number(stats?.doc_time_min);
  const max = Number(stats?.doc_time_max);
  if (!(size > 0) || !(min > 0) || !(max > min) || !(end > start)) return null;
  const overlap = Math.max(0, Math.min(end, max) - Math.max(start, min));
  return size * BYTES_PER_MB * (overlap / (max - min));
}

/** The per-window threshold: `zoConfig.llm_insights_large_stream_bytes` when the server sends one. */
export function largeStreamThreshold(zoConfig: unknown): number {
  const configured = Number(
    (zoConfig as { llm_insights_large_stream_bytes?: unknown } | undefined)
      ?.llm_insights_large_stream_bytes,
  );
  return configured > 0 ? configured : DEFAULT_LARGE_STREAM_BYTES;
}

function readRunAnyway(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

/** Holds the Insights queries on a large non-agent stream until the user picks an agent or runs anyway. */
export function useLargeStreamGate(org: () => string, threshold: () => number) {
  // Bumped on "Run anyway" so callers that read the choice re-evaluate.
  const choiceTick = ref(0);
  const chosen = new Set<string>();
  const runAnywayKey = (stream: string) => `${RUN_ANYWAY_KEY_PREFIX}${org()}:${stream}`;

  const ranAnyway = (stream: string) => {
    void choiceTick.value;
    const key = runAnywayKey(stream);
    return chosen.has(key) || readRunAnyway(key);
  };

  const runAnyway = (stream: string) => {
    chosen.add(runAnywayKey(stream));
    try {
      sessionStorage.setItem(runAnywayKey(stream), "1");
    } catch {
      // Without storage the in-memory choice still holds for this page.
    }
    choiceTick.value++;
  };

  /** The estimated scan when the notice applies, else null. Missing stats never hold the page. */
  const heldBytes = (input: LargeStreamGateInput): number | null => {
    if (!input.stream || input.searchQuery.trim()) return null;
    if (input.mode === "agent" && input.agentSelected) return null;
    if (input.agentStreams.includes(input.stream) || ranAnyway(input.stream)) return null;
    const bytes = estimateWindowBytes(input.stats, input.start, input.end);
    return bytes !== null && bytes >= threshold() ? bytes : null;
  };

  return { heldBytes, runAnyway, ranAnyway };
}

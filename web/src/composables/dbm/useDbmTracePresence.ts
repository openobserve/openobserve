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

import { ref, type Ref } from "vue";

/**
 * Has this org EVER sent a trace? — answered from the session-cached stream
 * catalog, for DbmEmptyState's `traceCount` check.
 *
 * The distinction this feeds: an org that has never sent a trace needs to be
 * told "database monitoring is built from traces, and you haven't sent any",
 * where an org that has traces but no numbers yet needs "we haven't finished
 * counting". Without this signal the empty state cannot tell them apart and
 * diagnoses the never-instrumented org as merely lagging — indefinitely.
 *
 * Why the stream catalog and not a count query: a trace stream exists exactly
 * because a trace arrived, so "no trace streams" IS "no traces ever", read
 * from a list the session has usually already fetched for the stream pickers.
 * A real per-range count would cost a search per page load to improve a screen
 * that only appears when there is nothing to show.
 *
 * The three honest answers, in `traceCount` form:
 * - `0`      — the org provably has no trace data (no trace streams, or every
 *              stream reports zero documents). The check may fail.
 * - `null`   — traces exist, or we could not read the catalog. We never
 *              counted THIS RANGE, so the check stays absent rather than
 *              claiming a pass or a failure it has not observed.
 *
 * A positive per-range number is deliberately never produced here: the check's
 * passing copy says "{count} recorded in this time range", and an all-time
 * document total is not that number.
 */

/** The slice of `useStreams().getStreams` this probe consumes. */
export type DbmGetStreamsFn = (
  streamName: string,
  schema: boolean,
  notify?: boolean,
) => Promise<unknown>;

interface TraceStreamEntry {
  name?: string;
  stats?: { doc_num?: number };
}

/**
 * `0` when the list proves the org has no trace data, `null` when it cannot.
 *
 * Exported bare so the derivation is testable without a stream service: the
 * composable adds only the fetch and the ref.
 */
export const traceCountFromStreamList = (payload: unknown): number | null => {
  const list = (payload as { list?: TraceStreamEntry[] } | null | undefined)?.list;
  // A malformed or absent list is "we don't know", never "we observed zero" —
  // claiming zero here would send an instrumented org to re-instrument itself.
  if (!Array.isArray(list)) return null;
  if (list.length === 0) return 0;
  // Streams exist. Only when every one of them REPORTS a document count and
  // all of those counts are zero is "no traces ever" observed rather than
  // assumed; a single missing stats block makes the answer unknown.
  const docNums = list.map((stream) => stream?.stats?.doc_num);
  if (docNums.every((n) => typeof n === "number") && docNums.every((n) => n === 0)) {
    return 0;
  }
  return null;
};

export const useDbmTracePresence = (
  getStreams: DbmGetStreamsFn,
): {
  /** Bind this straight to DbmEmptyState's `trace-count`. */
  traceCount: Ref<number | null>;
  /**
   * Resolve `traceCount`. Callers run this only when the empty state is about
   * to render — the answer is irrelevant while there are rows — and may run it
   * repeatedly: the stream catalog underneath is session-cached, so repeats
   * cost nothing.
   */
  probeTracePresence: () => Promise<void>;
} => {
  const traceCount = ref<number | null>(null);

  const probeTracePresence = async (): Promise<void> => {
    try {
      traceCount.value = traceCountFromStreamList(await getStreams("traces", false, false));
    } catch {
      // The catalog being unreadable (a 403, an outage) says nothing about
      // traces; the check stays absent rather than guessing.
      traceCount.value = null;
    }
  };

  return { traceCount, probeTracePresence };
};

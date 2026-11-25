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

/** What one _search_stream reply does to the rows held so far. */
export type HitsStep = "append" | "replace" | "keep";

/** Reads a _search_stream reply by reply: under streaming_aggs every batch with rows is the running answer, so it replaces, as in Logs. */
export function createStreamingHits() {
  let streamingAggs = false;
  return (response: any): HitsStep => {
    const content = response?.content;
    streamingAggs ||= !!(content?.streaming_aggs ?? content?.results?.streaming_aggs);
    if (response?.type !== "search_response_hits") return "keep";
    const batch = content?.results?.hits ?? content?.hits ?? [];
    // An empty batch under streaming_aggs means no change, so the last answer stays.
    if (!batch.length) return "keep";
    return streamingAggs ? "replace" : "append";
  };
}

export function mergeHits<T>(held: T[], batch: T[], step: HitsStep): T[] {
  if (step === "replace") return [...batch];
  if (step === "append") return [...held, ...batch];
  return held;
}

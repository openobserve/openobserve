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

import { ref, watch, type Ref } from "vue";
import type { HistogramTitleParts } from "@/composables/useLogs/searchState";

export interface SummaryInput {
  loading: boolean;
  loadingHistogram: boolean;
  parts: HistogramTitleParts | null;
  hasHits: boolean;
  failed: boolean;
  pageCount: number;
}

export interface SummaryView {
  parts: HistogramTitleParts | null;
  /** The run is still settling, so the values shown are not this run's final ones. */
  updating: boolean;
  pageCount: number;
}

export interface SettledSummary {
  parts: HistogramTitleParts | null;
  pageCount: number | null;
}

export interface HistogramViewInput {
  showHistogram: boolean;
  hasChart: boolean;
  loading: boolean;
  loadingHistogram: boolean;
  histogramPoints: number;
  liveMode: boolean;
}

export type HistogramPhase = "hidden" | "chart" | "placeholder" | "empty";

export interface HistogramView {
  phase: HistogramPhase;
  /** The chart on screen belongs to the previous run and is being replaced. */
  stale: boolean;
}

export const EMPTY_SETTLED: SettledSummary = { parts: null, pageCount: null };

const settledView = (parts: HistogramTitleParts | null, pageCount: number): SummaryView => ({
  parts,
  updating: false,
  pageCount,
});

/** Decides what the status bar shows: values change only when a run settles, never per partition. */
export const resolveSummary = (
  input: SummaryInput,
  settled: SettledSummary,
): { view: SummaryView; settled: SettledSummary } => {
  const busy = input.loading || input.loadingHistogram;
  if (!busy && (input.failed || (!input.parts && !input.hasHits))) {
    return {
      view: settledView(null, input.pageCount),
      settled: { parts: null, pageCount: input.pageCount },
    };
  }
  if (!busy && input.parts) {
    return {
      view: settledView(input.parts, input.pageCount),
      settled: { parts: input.parts, pageCount: input.pageCount },
    };
  }
  const pageCount = settled.pageCount ?? 1;
  if (settled.parts) {
    return { view: { parts: settled.parts, updating: true, pageCount }, settled };
  }
  return { view: { parts: null, updating: true, pageCount }, settled };
};

/** Picks one histogram state per run so partitions never repaint the chart or flash "No data". */
export const resolveHistogramView = (input: HistogramViewInput): HistogramView => {
  if (!input.showHistogram) return { phase: "hidden", stale: false };
  const busy = input.loading || input.loadingHistogram;
  // A new run clears the histogram points, so an idle run without points has no chart of its own.
  const chartIsCurrent = input.hasChart && (busy || input.histogramPoints > 0);
  if (chartIsCurrent) {
    const replacing = input.loadingHistogram || (input.loading && input.histogramPoints === 0);
    return { phase: "chart", stale: !input.liveMode && replacing };
  }
  return { phase: busy ? "placeholder" : "empty", stale: false };
};

/** Holds the last settled status-bar values and exposes what to render for the live inputs. */
export const useSettledSummary = (read: () => SummaryInput): Ref<SummaryView> => {
  let settled: SettledSummary = EMPTY_SETTLED;
  const view = ref<SummaryView>(settledView(null, 1));
  watch(
    read,
    (input) => {
      const next = resolveSummary(input, settled);
      settled = next.settled;
      view.value = next.view;
    },
    { immediate: true },
  );
  return view;
};

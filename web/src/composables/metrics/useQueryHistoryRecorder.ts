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

import { nextTick, watch } from "vue";
import { useRecentSearches } from "@/composables/queryHistory/useRecentSearches";
import {
  buildMetricsRecord,
  metricsRunError,
  withRunResult,
  type MetricsPanelState,
  type PanelErrorDetail,
} from "@/utils/queryHistory/metrics";
import { runResultFromError, type RunError } from "@/utils/queryHistory/recentSearches";
import type { QueryHistoryRecordBody } from "@/services/query_history";
import type { SelectedDate } from "@/utils/dashboard/urlTimeParams";

interface RecordedPanel extends MetricsPanelState {
  meta?: { dateTime?: { start_time?: unknown; end_time?: unknown } };
}

interface PendingRun {
  body: QueryHistoryRecordBody;
  started: boolean;
}

// Panel pages build these Dates from microseconds, so getTime() is already microseconds.
const toMicros = (value: unknown): number | null => {
  const us = value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isFinite(us) ? us : null;
};

/** Records a user's Run once the panel request settles; a failed record never reaches the run. */
export const useQueryHistoryRecorder = (isLoading: () => boolean) => {
  const recent = useRecentSearches();
  let pending: PendingRun | null = null;
  // Mirrors the panel's error: the panel emits only on change, so a repeat of the same error keeps it.
  let panelError: RunError | null = null;

  const settle = (body: QueryHistoryRecordBody) => {
    const result = panelError ? runResultFromError(panelError) : { status: "ok" as const };
    if (result) recent.record(withRunResult(body, result));
  };

  watch(isLoading, (loading) => {
    if (!pending) return;
    if (loading) {
      pending.started = true;
      return;
    }
    if (!pending.started) return;
    const { body } = pending;
    pending = null;
    // The panel's error arrives through its own watcher in the same flush as the loading change.
    nextTick(() => settle(body));
  });

  /** Captures the run as dispatched; it is recorded when the panel's request settles. */
  const record = (
    dashboardPanelData: RecordedPanel,
    selectedDate: Partial<SelectedDate> | null,
  ) => {
    const startUs = toMicros(dashboardPanelData?.meta?.dateTime?.start_time);
    const endUs = toMicros(dashboardPanelData?.meta?.dateTime?.end_time);
    const body = buildMetricsRecord({
      panel: dashboardPanelData,
      selectedDate,
      window: startUs !== null && endUs !== null ? { startUs, endUs } : null,
    });
    pending = body ? { body, started: isLoading() } : null;
  };

  const onPanelError = (detail: PanelErrorDetail | string | null | undefined) => {
    panelError = metricsRunError(detail);
  };

  /** A cancelled run is never recorded. */
  const cancel = () => {
    pending = null;
  };

  return { record, onPanelError, cancel };
};

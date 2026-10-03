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

// Metrics panel <-> query history entry. The panel itself travels as the
// metrics_data blob, so an entry reopens exactly what was run.

import { encodeMetricsConfig, getMetricsConfig } from "@/composables/metrics/metricsUrlState";
import {
  queryParamsToSelectedDate,
  selectedDateToQueryParams,
  type SelectedDate,
  type TimeQueryParams,
} from "@/utils/dashboard/urlTimeParams";

export interface QueryHistoryContext {
  time_range: TimeQueryParams;
  step: string | null;
  chart_type: string;
  metrics_data: string;
}

export interface QueryHistoryRecord {
  query: string;
  context: QueryHistoryContext;
}

/** The entry an explicit run records, or null when no visible query has text. */
export const buildHistoryEntry = (
  dashboardPanelData: any,
  selectedDate: Partial<SelectedDate> | null | undefined,
): QueryHistoryRecord | null => {
  const hidden: number[] = dashboardPanelData?.layout?.hiddenQueries ?? [];
  const queries: any[] = dashboardPanelData?.data?.queries ?? [];
  const query = queries
    .filter((_, index) => !hidden.includes(index))
    .map((q) => (typeof q?.query === "string" ? q.query.trim() : ""))
    .filter(Boolean)
    .join("\n");
  if (!query) return null;

  return {
    query,
    context: {
      time_range: selectedDateToQueryParams(selectedDate as SelectedDate),
      step: dashboardPanelData?.data?.config?.step_value ?? null,
      chart_type: dashboardPanelData?.data?.type ?? "",
      metrics_data: encodeMetricsConfig(getMetricsConfig(dashboardPanelData)),
    },
  };
};

/** What loading an entry applies: the panel blob and the picker's range. */
export const historyEntryToLoad = (
  context: Partial<QueryHistoryContext> | null | undefined,
): { metricsData: string; timeRange: SelectedDate } | null => {
  if (!context?.metrics_data) return null;
  return {
    metricsData: context.metrics_data,
    timeRange: queryParamsToSelectedDate(context.time_range ?? {}),
  };
};

/** A picker model in the shape DateTime's `setSavedDate` takes (absolute times in microseconds). */
export const pickerSavedDate = (date: SelectedDate) =>
  date.valueType === "absolute"
    ? { type: "absolute", startTime: Number(date.startTime), endTime: Number(date.endTime) }
    : { type: "relative", relativeTimePeriod: date.relativeTimePeriod };

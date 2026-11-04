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

import {
  buildPrefillFromPanel,
  dateToMicros,
  executedPanelQuery,
  alertableQueryIndexes,
  panelQueryChoices,
  type PanelQueryShape,
} from "@/utils/alerts/prefill/fromPanel";
import { requestAlertCreation, useAlertCreation } from "@/composables/alerts/useAlertCreation";
import {
  firstAggregateAlias,
  needsConfirmation,
  normalizePrefill,
  warn,
} from "@/utils/alerts/alertPrefill";
import type { AlertBuildOptions, AlertPrefill } from "@/ts/interfaces/alertPrefill";
import {
  FORECAST_FREQUENCY_MINUTES,
  FORECAST_PERIOD_MINUTES,
  buildForecastAlertPromql,
  forecastAlertFromChart,
} from "@/utils/alerts/forecastAlert";
import { ref } from "vue";
import { downloadFile } from "@/utils/dom";
import { getNumberLocale } from "@/locales/numberFormat";
import type { TranslateFn } from "@/types/i18n";

const PERIOD_WARNINGS = ["absoluteToRolling", "periodClamped"];

// Helper function to properly wrap CSV values
export const wrapCsvValue = (val: any): string => {
  if (val === null || val === undefined) {
    return "";
  }

  // Convert to string and escape any quotes
  const str = String(val).replace(/"/g, '""');

  // Wrap in quotes if the value contains comma, quotes, or newlines
  const needsQuotes =
    str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r");
  return needsQuotes ? `"${str}"` : str;
};

/** Times in seconds; the line starts at its fit at the range end, past the points closing its seam. */
export const forecastPointOf = (series: any, dataIndex: number | undefined) => {
  const times: number[] = series?._timestamps ?? [];
  const data: any[] = series?.data ?? [];
  const start = series?._fitStartIndex ?? data.findIndex((point) => point?.[1] != null);
  if (start < 0) return undefined;
  const end = data.findLastIndex((point) => point?.[1] != null);
  return {
    rangeEndValue: series?._rangeEndValue,
    startTime: times[start],
    startValue: Number(data[start][1]),
    endValue: Number(data[end][1]),
    clickedTime: times[dataIndex ?? -1] ?? times[times.length - 1],
  };
};

/** Flattens a panel query response into rows plus their columns in first-seen order. */
export const flattenPanelResult = (
  data: any,
  queryType?: string,
): { columns: string[]; rows: Record<string, any>[] } => {
  const rows: Record<string, any>[] = [];
  if (queryType === "promql") {
    (data ?? []).forEach((promData: any) => {
      if (!Array.isArray(promData?.result)) return;
      promData.result.forEach((series: any) => {
        // Instant queries return one `value` pair instead of a `values` range.
        const points = series.values ?? (series.value ? [series.value] : []);
        points.forEach((point: any) => {
          rows.push({ timestamp: point[0], value: point[1], ...(series.metric ?? {}) });
        });
      });
    });
  } else {
    (data ?? []).forEach((dataset: any) => {
      if (!Array.isArray(dataset)) return;
      rows.push(...dataset);
    });
  }
  const columns = new Set<string>();
  rows.forEach((row) => Object.keys(row).forEach((key) => columns.add(key)));
  return { columns: Array.from(columns), rows };
};

/** The SQL column a right-clicked threshold applies to, read off the query's y-axis or its SQL. */
const sqlYAxisColumnOf = (
  query: any,
  executedQuery: string | undefined,
  clickedSeriesName: string | undefined,
  yFieldIndex = 0,
): string | null => {
  let yAxisColumn = null;
  const sqlQuery = executedQuery || query.query;

  // First, try to get from query.fields.y if available (most reliable for query builder)
  if (query.fields?.y && query.fields.y.length > 0) {
    // For query builder queries, use the Y-axis field
    const yField = query.fields.y[yFieldIndex];
    const aliasOrColumn = yField.alias || yField.column;

    // Extract from SQL to get the exact case (without quotes)
    if (sqlQuery) {
      // Look for pattern: aggregation_func(...) as "alias" or aggregation_func(...) as alias
      const escapedAlias = aliasOrColumn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\s+as\\s+(["']?${escapedAlias}["']?)(?:\\s|,|\\)|$)`, "i");
      const match = sqlQuery.match(regex);
      if (match && match[1]) {
        // Strip quotes - the parser will add them back if needed
        yAxisColumn = match[1].replace(/^["']|["']$/g, "");
      } else {
        yAxisColumn = aliasOrColumn;
      }
    } else {
      yAxisColumn = aliasOrColumn;
    }
  } else if (clickedSeriesName && sqlQuery) {
    // Fallback: try to match the clicked series name in the SQL
    // First try exact match with the series name
    const regex = new RegExp(
      `\\s+as\\s+["']?(${clickedSeriesName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})["']?(?:\\s|,|\\)|$)`,
      "i",
    );
    const match = sqlQuery.match(regex);
    if (match && match[1]) {
      yAxisColumn = match[1];
    } else {
      // Last resort: extract any aggregation column from SQL (first one found)
      yAxisColumn = firstAggregateAlias(sqlQuery) ?? clickedSeriesName;
    }
  }
  return yAxisColumn;
};

/** A query's own y-axis column, for a query the user picked rather than clicked. */
const ownYAxisColumnOf = (
  query: PanelQueryShape | undefined,
  executedQuery: string | undefined,
): string | null =>
  query?.fields?.y?.length
    ? sqlYAxisColumnOf(query, executedQuery, undefined)
    : firstAggregateAlias(executedQuery || query?.query || "");

export function usePanelAlertCreation({
  panelSchema,
  allowAlertCreation,
  metadata,
  selectedTimeObj,
  contextMenuData,
  store,
  router,
  emit,
  visibleQueryIndexes,
  hideChartTooltip,
  alertSource,
}: {
  panelSchema: any;
  allowAlertCreation: any;
  metadata: any;
  selectedTimeObj: any;
  contextMenuData: any;
  store: any;
  router: any;
  emit: any;
  /** Panel queries not hidden in the editor; all of them when absent. */
  visibleQueryIndexes?: { value: number[] };
  hideChartTooltip?: () => void;
  alertSource?: { value: string };
}) {
  // Context menu state for alert creation
  const contextMenuVisible = ref(false);
  const contextMenuPosition = ref({ x: 0, y: 0 });
  const contextMenuValue = ref(0);

  const onChartContextMenu = (event: any) => {
    // Emit contextmenu event for general usage (drilldowns, annotations, etc.)
    emit("contextmenu", {
      ...event,
      panelTitle: panelSchema.value.title,
      panelId: panelSchema.value.id,
    });
  };

  const onChartDomContextMenu = (event: any) => {
    // Handle DOM contextmenu event specifically for alert creation
    if (!allowAlertCreation.value) {
      return;
    }

    // The chart tooltip sits above every menu, so it would cover the alert items.
    hideChartTooltip?.();
    contextMenuVisible.value = true;
    contextMenuPosition.value = { x: event.x, y: event.y };
    contextMenuValue.value = event.value;
    contextMenuData.value = event;
  };

  const hideContextMenu = () => {
    contextMenuVisible.value = false;
  };

  const forecastPrefill = (
    base: AlertPrefill,
    T: number,
    point: Omit<Parameters<typeof forecastAlertFromChart>[0], "U" | "T" | "rangeSeconds">,
  ): AlertPrefill => {
    const { start_time, end_time } = selectedTimeObj.value ?? {};
    const rangeSeconds =
      start_time instanceof Date && end_time instanceof Date
        ? (dateToMicros(end_time) - dateToMicros(start_time)) / 1e6
        : 0;
    const forecast = forecastAlertFromChart({ U: base.promql ?? "", T, rangeSeconds, ...point });
    return {
      ...base,
      // The forecast reads its own history window, so the chart's range says nothing about its period.
      warnings: base.warnings.filter((w) => !PERIOD_WARNINGS.includes(w.key)),
      promql: buildForecastAlertPromql(forecast),
      promqlCondition: { column: "value", operator: "<=", value: forecast.H },
      promqlMultiAlert: true,
      periodMinutes: FORECAST_PERIOD_MINUTES,
      frequencyMinutes: FORECAST_FREQUENCY_MINUTES,
    };
  };

  const handleCreateAlert = (selection: {
    condition: string;
    threshold: number;
    panelQueryIndex?: number;
    seriesRole?: string;
  }) => {
    hideContextMenu();

    const queries: any[] = panelSchema.value.queries ?? [];
    const visible = alertableQueryIndexes(
      queries,
      visibleQueryIndexes?.value ?? queries.map((_, index) => index),
    );
    const point = contextMenuData.value?.forecastPoint;
    const isForecast = selection.condition === "forecast" && !!point;
    // A forecast is fitted to the clicked series, so it cannot move to another query.
    const offerChoice = visible.length > 1 && !isForecast;
    const named = selection.panelQueryIndex;
    // A hidden query draws nothing, so a series naming one was mislabelled and counts as no series; a forecast keeps its query.
    const clicked =
      named !== undefined && (isForecast || visible.includes(named)) ? named : undefined;
    const queryIndex = clicked ?? visible[0];
    const query = queries[queryIndex];
    if (!query) {
      return;
    }

    // Determine query type based on panel configuration
    // Only care about SQL vs PromQL distinction
    let queryType = "sql"; // Default to SQL
    if (panelSchema.value.queryType === "promql") {
      queryType = "promql";
    }

    const executedQueryOf = (index: number) =>
      executedPanelQuery(metadata.value?.queries, index) || queries[index]?.query;
    const clickedYField = contextMenuData.value?.yField;
    // Single-query series carry no query index, so the lone query owns the click.
    const clickOwner = clicked ?? (offerChoice ? undefined : queryIndex);
    // The y field the clicked series drew; with several and none named, the first is only a guess.
    const yFieldOf = (index: number): { field: number; guessed: boolean } => {
      const count = queries[index]?.fields?.y?.length ?? 0;
      return index === clickOwner && typeof clickedYField === "number" && clickedYField < count
        ? { field: clickedYField, guessed: false }
        : { field: 0, guessed: count > 1 };
    };
    // Only a SQL threshold needs the y-axis column; PromQL compares the series value.
    const yAxisColumnOf = (index: number) => {
      if (queryType !== "sql") return null;
      // Right-click events carry no series name, so a query falls back to its own SQL alias.
      return (
        (index === clickOwner
          ? sqlYAxisColumnOf(
              queries[index],
              executedQueryOf(index),
              contextMenuData.value?.seriesName,
              yFieldOf(index).field,
            )
          : null) ?? ownYAxisColumnOf(queries[index], executedQueryOf(index))
      );
    };
    // The clicked value is on that series' scale, so a query the user switched to gets the form's default.
    const carriesThreshold = (index: number) => clicked === undefined || index === clicked;
    const thresholdFor = (index: number) =>
      carriesThreshold(index)
        ? { threshold: selection.threshold, condition: selection.condition as "above" | "below" }
        : {};
    const shownThreshold = selection.threshold.toLocaleString(getNumberLocale(), {
      maximumFractionDigits: 2,
    });
    // Both cases change what the chart click asked for, so the form's banner has to say so.
    const thresholdWarnings = (prefill: AlertPrefill, index: number) => {
      if (!carriesThreshold(index)) {
        return [warn("thresholdNotCarried", "warning", { value: shownThreshold })];
      }
      const having = prefill.meta?.sqlHaving as { column?: string } | undefined;
      return queryType === "sql" && yFieldOf(index).guessed && having?.column
        ? [warn("thresholdColumnGuessed", "warning", { column: having.column })]
        : [];
    };

    // The menu already chose the threshold, so the dialog is only for which query, which stream, or why not.
    const queryChoices = offerChoice
      ? panelQueryChoices(queries, metadata.value?.queries, visible)
      : undefined;
    const build = (options: AlertBuildOptions = {}) => {
      const index = options.queryIndex ?? queryIndex;
      const prefill = buildPrefillFromPanel({
        panelTitle: panelSchema.value.title || "Unnamed Panel",
        panelId: panelSchema.value.id,
        queries,
        queryType,
        queryIndex: index,
        queryChoices,
        timeRange: selectedTimeObj.value,
        ...thresholdFor(index),
        yAxisColumn: yAxisColumnOf(index),
        executedQuery: executedQueryOf(index),
        metadataQueries: metadata.value?.queries,
      });
      prefill.warnings.push(...thresholdWarnings(prefill, index));
      return alertSource?.value ? { ...prefill, source: alertSource.value } : prefill;
    };

    const prefill = normalizePrefill(
      isForecast ? forecastPrefill(build(), selection.threshold, point) : build(),
    );
    if (needsConfirmation(prefill)) {
      requestAlertCreation(prefill, {}, build);
      return;
    }
    useAlertCreation({ router, store }).openAlertCreation(prefill);
  };

  return {
    contextMenuVisible,
    contextMenuPosition,
    contextMenuValue,
    onChartContextMenu,
    onChartDomContextMenu,
    hideContextMenu,
    handleCreateAlert,
  };
}

export function usePanelDownload({
  panelSchema,
  data,
  filteredData,
  tableRendererRef,
  showErrorNotification,
  showPositiveNotification,
  t,
}: {
  panelSchema: any;
  data: any;
  filteredData: any;
  tableRendererRef: any;
  showErrorNotification: any;
  showPositiveNotification: any;
  t: TranslateFn;
}) {
  const downloadDataAsCSV = (title: string) => {
    // if panel type is table then download data as csv
    if (panelSchema.value.type == "table") {
      tableRendererRef?.value?.downloadTableAsCSV(title);
    } else {
      // For non-table charts
      try {
        // Check if data exists
        if (!data?.value || data?.value?.length === 0) {
          showErrorNotification(t("dashboard.noDataAvailableToDownload"));
          return;
        }

        const isPromql = panelSchema.value.queryType === "promql";
        // PromQL reads filteredData so hidden queries stay out of the export.
        const { columns, rows } = flattenPanelResult(
          isPromql ? filteredData?.value : data?.value,
          panelSchema.value.queryType,
        );

        if (rows.length === 0) {
          showErrorNotification(t("dashboard.noDataAvailableToDownload"));
          return;
        }

        const headers = isPromql
          ? columns.sort((a, b) => {
              if (a === "timestamp") return -1;
              if (b === "timestamp") return 1;
              if (a === "value") return -1;
              if (b === "value") return 1;
              return a.localeCompare(b);
            })
          : columns.sort();

        const csvContent = [
          headers.join(","),
          ...rows.map((row) => headers.map((key) => wrapCsvValue(row[key] ?? "")).join(",")),
        ].join("\r\n");

        const status = downloadFile((title ?? "chart-export") + ".csv", csvContent, "text/csv");

        if (status === true) {
          showPositiveNotification(t("dashboard.chartDataDownloadedCsv"), {
            timeout: 2000,
          });
        } else {
          showErrorNotification(t("dashboard.browserDeniedFileDownload"));
        }
      } catch (error) {
        showErrorNotification(t("dashboard.failedToDownloadCsv"));
      }
    }
  };

  const downloadDataAsJSON = (title: string) => {
    try {
      // Handle table type charts
      if (panelSchema?.value?.type === "table") {
        tableRendererRef?.value?.downloadTableAsJSON(title);
      } else {
        // Handle non-table charts
        // Use filteredData for PromQL to exclude hidden queries, otherwise use data
        const chartData =
          panelSchema.value.queryType === "promql" ? filteredData.value : data.value;

        if (!chartData || !chartData.length) {
          showErrorNotification(t("dashboard.noDataAvailableToDownload"));
          return;
        }

        // Export the data as JSON
        const content = JSON.stringify(chartData, null, 2);

        const status = downloadFile(
          (title ?? "data-export") + ".json",
          content,
          "application/json",
        );

        if (status === true) {
          showPositiveNotification(t("dashboard.chartDataDownloadedJson"), {
            timeout: 2000,
          });
        } else {
          showErrorNotification(t("dashboard.browserDeniedFileDownload"));
        }
      }
    } catch (error) {
      showErrorNotification(t("dashboard.failedToDownloadJson"));
    }
  };

  /**
   * Returns the CSV string for the panel's current data without triggering a
   * file download. Used by the report server via window.oo_getAllPanelsCsv().
   */
  const getPanelCsvString = (): string | null => {
    if (panelSchema.value.type === "table") {
      return tableRendererRef?.value?.getTableCsvString() ?? null;
    }

    if (!data?.value || data?.value?.length === 0) return null;

    if (panelSchema.value.queryType === "promql") {
      const flattenedData: any[] = [];

      filteredData?.value?.forEach((promData: any) => {
        if (!promData?.result || !Array.isArray(promData.result)) return;

        promData.result.forEach((series: any) => {
          const metricLabels = series.metric || {};
          series.values.forEach((point: any) => {
            flattenedData.push({
              timestamp: point[0],
              value: point[1],
              ...metricLabels,
            });
          });
        });
      });

      if (flattenedData.length === 0) return null;

      const allKeys = new Set<string>();
      flattenedData.forEach((row) => Object.keys(row).forEach((k) => allKeys.add(k)));
      const keys = Array.from(allKeys).sort((a, b) => {
        if (a === "timestamp") return -1;
        if (b === "timestamp") return 1;
        if (a === "value") return -1;
        if (b === "value") return 1;
        return a.localeCompare(b);
      });

      return [
        keys.join(","),
        ...flattenedData.map((row) => keys.map((key) => wrapCsvValue(row[key] ?? "")).join(",")),
      ].join("\r\n");
    } else {
      const flattenedData: any[] = [];

      data?.value?.forEach((dataset: any) => {
        if (!dataset || !Array.isArray(dataset) || dataset.length === 0) return;
        dataset.forEach((row: any) => flattenedData.push({ ...row }));
      });

      if (flattenedData.length === 0) return null;

      const allKeys = new Set<string>();
      flattenedData.forEach((row) => Object.keys(row).forEach((k) => allKeys.add(k)));
      const headers = Array.from(allKeys).sort();

      return [
        headers.join(","),
        ...flattenedData.map((row) => headers.map((h) => wrapCsvValue(row[h] ?? "")).join(",")),
      ].join("\r\n");
    }
  };

  return {
    downloadDataAsCSV,
    downloadDataAsJSON,
    getPanelCsvString,
  };
}

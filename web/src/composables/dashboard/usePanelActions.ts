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
import { exportFile } from "quasar";

// Helper function to properly wrap CSV values
export const wrapCsvValue = (val: any): string => {
  if (val === null || val === undefined) {
    return "";
  }

  // Convert to string and escape any quotes
  const str = String(val).replace(/"/g, '""');

  // Wrap in quotes if the value contains comma, quotes, or newlines
  const needsQuotes =
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r");
  return needsQuotes ? `"${str}"` : str;
};

export function usePanelAlertCreation({
  panelSchema,
  allowAlertCreation,
  metadata,
  selectedTimeObj,
  contextMenuData,
  store,
  router,
  emit,
}: {
  panelSchema: any;
  allowAlertCreation: any;
  metadata: any;
  selectedTimeObj: any;
  contextMenuData: any;
  store: any;
  router: any;
  emit: any;
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

    contextMenuVisible.value = true;
    contextMenuPosition.value = { x: event.x, y: event.y };
    contextMenuValue.value = event.value;
    contextMenuData.value = event;
  };

  const hideContextMenu = () => {
    contextMenuVisible.value = false;
  };

  const handleCreateAlert = (selection: {
    condition: string;
    threshold: number;
  }) => {
    hideContextMenu();

    // Prepare panel data to pass to alert creation
    const query = panelSchema.value.queries?.[0];
    if (!query) {
      return;
    }

    // Determine query type based on panel configuration
    // Only care about SQL vs PromQL distinction
    let queryType = "sql"; // Default to SQL
    if (panelSchema.value.queryType === "promql") {
      queryType = "promql";
    }

    // Get the executed query with variables replaced from metadata
    // Only use metadata if it's available and has queries
    const executedQuery =
      metadata.value?.queries && metadata.value.queries.length > 0
        ? metadata.value.queries[0]?.query || query.query
        : query.query;

    // Get the Y-axis column for threshold comparison
    // Only needed for SQL queries, not for PromQL
    let yAxisColumn = null;

    if (queryType === "sql") {
      const clickedSeriesName = contextMenuData.value?.seriesName;
      const sqlQuery = executedQuery || query.query;

      // First, try to get from query.fields.y if available (most reliable for query builder)
      if (query.fields?.y && query.fields.y.length > 0) {
        // For query builder queries, use the Y-axis field
        const yField = query.fields.y[0];
        const aliasOrColumn = yField.alias || yField.column;

        // Extract from SQL to get the exact case (without quotes)
        if (sqlQuery) {
          // Look for pattern: aggregation_func(...) as "alias" or aggregation_func(...) as alias
          const escapedAlias = aliasOrColumn.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          const regex = new RegExp(
            `\\s+as\\s+(["']?${escapedAlias}["']?)(?:\\s|,|\\)|$)`,
            "i",
          );
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
          // Pattern: count(...) as alias, avg(...) as alias, etc.
          const aggRegex =
            /(?:count|sum|avg|min|max|median)\s*\([^)]+\)\s+as\s+["']?([^"',\s)]+)["']?/i;
          const aggMatch = sqlQuery.match(aggRegex);
          if (aggMatch && aggMatch[1]) {
            yAxisColumn = aggMatch[1];
          } else {
            yAxisColumn = clickedSeriesName;
          }
        }
      }
    }

    const panelDataToPass = {
      panelTitle: panelSchema.value.title || "Unnamed Panel",
      panelId: panelSchema.value.id,
      queries: panelSchema.value.queries,
      queryType: queryType,
      timeRange: selectedTimeObj.value,
      threshold: selection.threshold,
      condition: selection.condition,
      // Pass the Y-axis column name for threshold comparison
      yAxisColumn: yAxisColumn,
      // Pass the executed query with variables already replaced
      executedQuery: executedQuery,
    };

    // Navigate to alert creation page
    router.push({
      name: "addAlert",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        fromPanel: "true",
        panelData: encodeURIComponent(JSON.stringify(panelDataToPass)),
      },
    });
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
}: {
  panelSchema: any;
  data: any;
  filteredData: any;
  tableRendererRef: any;
  showErrorNotification: any;
  showPositiveNotification: any;
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
          showErrorNotification("No data available to download");
          return;
        }

        let csvContent;

        // Check if this is a PromQL query type panel
        if (panelSchema.value.queryType === "promql") {
          // Handle PromQL data format
          const flattenedData: any[] = [];

          // Iterate through each response item (multiple queries can produce multiple responses)
          // Use filteredData to exclude hidden queries
          filteredData?.value?.forEach((promData: any, queryIndex: number) => {
            if (!promData?.result || !Array.isArray(promData.result)) return;

            // Iterate through each result (time series)
            promData.result.forEach((series: any, seriesIndex: number) => {
              const metricLabels = series.metric || {};

              // Iterate through values array (timestamp, value pairs)
              series.values.forEach((point: any) => {
                const timestamp = point[0];
                const value = point[1];

                // Create a row with timestamp, value, and all metric labels
                const row = {
                  timestamp: timestamp,
                  value: value,
                  ...metricLabels,
                };

                flattenedData.push(row);
              });
            });
          });

          // Get all unique keys across all data points
          const allKeys = new Set();
          flattenedData.forEach((row: any) => {
            Object.keys(row).forEach((key: any) => allKeys.add(key));
          });

          // Convert Set to Array and ensure timestamp and value come first
          const keys = Array.from(allKeys);
          keys.sort((a: any, b: any) => {
            if (a === "timestamp") return -1;
            if (b === "timestamp") return 1;
            if (a === "value") return -1;
            if (b === "value") return 1;
            return a.localeCompare(b);
          });

          // Create CSV content
          csvContent = [
            keys.join(","), // Headers row
            ...flattenedData.map((row: any) =>
              keys.map((key: any) => wrapCsvValue(row[key] ?? "")).join(","),
            ),
          ].join("\r\n");
        } else {
          // Handle standard SQL format - now supporting multiple arrays
          const flattenedData: any[] = [];

          // Iterate through all datasets/arrays in the response
          data?.value?.forEach((dataset: any, datasetIndex: number) => {
            // Skip if dataset is empty or not an array
            if (!dataset || !Array.isArray(dataset) || dataset.length === 0)
              return;

            dataset.forEach((row: any) => {
              flattenedData.push({
                ...row,
              });
            });
          });

          // If after flattening we have no data, show notification and return
          if (flattenedData.length === 0) {
            showErrorNotification("No data available to download");
            return;
          }

          // Collect all possible keys from all objects
          const allKeys = new Set();
          flattenedData.forEach((row: any) => {
            Object.keys(row).forEach((key: any) => allKeys.add(key));
          });

          // Convert Set to Array and sort for consistent order
          const headers = Array.from(allKeys).sort();

          // Create CSV content with headers and data rows
          csvContent = [
            headers?.join(","), // Headers row
            ...flattenedData?.map((row: any) =>
              headers
                ?.map((header: any) => wrapCsvValue(row[header] ?? ""))
                .join(","),
            ),
          ].join("\r\n");
        }

        const status = exportFile(
          (title ?? "chart-export") + ".csv",
          csvContent,
          "text/csv",
        );

        if (status === true) {
          showPositiveNotification("Chart data downloaded as a CSV file", {
            timeout: 2000,
          });
        } else {
          showErrorNotification("Browser denied file download...");
        }
      } catch (error) {
        showErrorNotification("Failed to download data as CSV");
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
          panelSchema.value.queryType === "promql"
            ? filteredData.value
            : data.value;

        if (!chartData || !chartData.length) {
          showErrorNotification("No data available to download");
          return;
        }

        // Export the data as JSON
        const content = JSON.stringify(chartData, null, 2);

        const status = exportFile(
          (title ?? "data-export") + ".json",
          content,
          "application/json",
        );

        if (status === true) {
          showPositiveNotification("Chart data downloaded as a JSON file", {
            timeout: 2000,
          });
        } else {
          showErrorNotification("Browser denied file download...");
        }
      }
    } catch (error) {
      showErrorNotification("Failed to download data as JSON");
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
        ...flattenedData.map((row) =>
          keys.map((key) => wrapCsvValue(row[key] ?? "")).join(","),
        ),
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
        ...flattenedData.map((row) =>
          headers.map((h) => wrapCsvValue(row[h] ?? "")).join(","),
        ),
      ].join("\r\n");
    }
  };

  return {
    downloadDataAsCSV,
    downloadDataAsJSON,
    getPanelCsvString,
  };
}

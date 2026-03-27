// Copyright 2023 OpenObserve Inc.
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

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
import { convertSQLChartData } from "./sql";
import { applySeriesColorMappings } from "./chartColorUtils";

export const convertMultiSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
) => {
  if (!Array.isArray(searchQueryData) || searchQueryData.length === 0) {
    // this sets a blank object until it loads
    // because of this, it will go to UI and draw something, even 0 or a blank chart
    // this will give a sence of progress to the user
    searchQueryData = [[]];
  }

  // C1: loop on all search query data with per-query schema
  const options: any = [];
  for (let i = 0; i < searchQueryData.length; i++) {
    // Get the original query index from metadata (handling time-shifts gracefully)
    const panelQueryIndex = metadata?.queries?.[i]?.panelQueryIndex ?? i;

    // Create a per-query schema view: set queries[0] to the current query
    // so contextBuilder.ts reads the correct query's fields
    const querySchema = {
      ...panelSchema,
      queries: [panelSchema.queries[panelQueryIndex]],
    };

    options.push(
      await convertSQLData(
        querySchema,
        [searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        resultMetaData.value?.[i] ?? [],
        { queries: [metadata.queries[i]] },
        chartPanelStyle,
        annotations,
      ),
    );
  }

  const isAnnotationSeries = (series: any) => {
    // check if series name is available
    // if series name is not available then that is anotation series
    if (!series.name) return true;
  };

  const chartType = panelSchema.type;

  // Helper: build labeled name with promql_legend template + time shift suffix
  const buildLabeledName = (
    name: string,
    queryConfig: any,
    queryIndex: number,
    periodAsStr?: string,
  ) => {
    let labeled = name;

    // Apply template replacement if query_label is provided
    if (queryConfig?.query_label) {
      // Replace any {placeholder} with the generated series name
      labeled = queryConfig.query_label.replace(/\{[^}]+\}/g, name);
    }

    return periodAsStr ? `${labeled} (${periodAsStr})` : labeled;
  };

  // C5: Pie/Donut — merge data arrays into single series (not series concat)
  if (
    (chartType === "pie" || chartType === "donut") &&
    options.length > 1
  ) {
    const mergedData: any[] = [];

    options.forEach((opt: any, execIndex: number) => {
      const panelQueryIndex = metadata?.queries?.[execIndex]?.panelQueryIndex ?? execIndex;
      const queryConfig = panelSchema.queries[panelQueryIndex]?.config;

      opt?.options?.series?.[0]?.data?.forEach((d: any) => {
        const labeledName = buildLabeledName(
          d.name,
          queryConfig,
          execIndex,
        );
        mergedData.push({ ...d, name: labeledName });
      });
    });

    if (options[0]?.options?.series?.[0]) {
      options[0].options.series[0].data = mergedData;
    }

    applySeriesColorMappings(
      options[0]?.options?.series,
      panelSchema?.config?.color?.colorBySeries,
      store.state.theme,
    );
    return options[0];
  }

  // C6: Metric — collect values from all queries for grid display
  if (chartType === "metric" && options.length > 1) {
    const additionalValues = options.slice(1).map((opt: any, idx: number) => {
      // slice(1) means execIndex is idx + 1
      const execIndex = idx + 1;
      const panelQueryIndex = metadata?.queries?.[execIndex]?.panelQueryIndex ?? execIndex;
      const qConfig = panelSchema.queries[panelQueryIndex]?.config;
      return {
        options: opt.options,
        queryLabel: qConfig?.query_label || "",
      };
    });
    options[0].extras = {
      ...options[0].extras,
      additionalMetricValues: additionalValues,
    };
    return options[0];
  }

  // C6: Gauge — collect all dials and recalculate grid positions
  if (chartType === "gauge" && options.length > 1) {
    const allSeries: any[] = [];
    options.forEach((opt: any) => {
      if (opt?.options?.series) {
        allSeries.push(...opt.options.series);
      }
    });
    const total = allSeries.length;
    allSeries.forEach((s: any, idx: number) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      s.center = [
        `${(col + 1) * 25}%`,
        `${(row + 1) * (100 / (Math.ceil(total / 3) + 1))}%`,
      ];
      s.gridIndex = idx;
    });
    options[0].options.series = allSeries;
    applySeriesColorMappings(
      options[0].options.series,
      panelSchema?.config?.color?.colorBySeries,
      store.state.theme,
    );
    return options[0];
  }

  // C3: X-axis merge + reindex for time-series charts
  const needsXAxisMerge =
    options.length > 1 &&
    options[0]?.options?.xAxis?.[0]?.data &&
    !["pie", "donut", "metric", "gauge"].includes(chartType);

  if (needsXAxisMerge) {
    // Save each query's original xAxis BEFORE merging
    const originalXAxes = options.map(
      (opt: any) => [...(opt?.options?.xAxis?.[0]?.data || [])],
    );

    // Build merged xAxis (union of all queries' values)
    const mergedXAxisSet = new Set<any>();
    originalXAxes.forEach((xData: any[]) => {
      xData.forEach((v: any) => mergedXAxisSet.add(v));
    });

    // Sort: timestamps numerically, categorical strings alphabetically
    const mergedXAxis = Array.from(mergedXAxisSet).sort((a: any, b: any) =>
      typeof a === "number" ? a - b : String(a).localeCompare(String(b)),
    );

    // Optimization: skip reindexing if merged === original Q1 xAxis
    const q1Unchanged =
      mergedXAxis.length === originalXAxes[0].length &&
      mergedXAxis.every((v: any, idx: number) => v === originalXAxes[0][idx]);

    // Apply merged xAxis to result
    options[0].options.xAxis[0].data = mergedXAxis;

    // Reindex every query's series data to align with merged xAxis
    options.forEach((opt: any, queryIdx: number) => {
      if (queryIdx === 0 && q1Unchanged) return;

      const originalXAxis = originalXAxes[queryIdx];
      if (!originalXAxis?.length) return;

      // Build value→mergedIndex lookup
      const valueToMergedIdx = new Map<any, number>();
      mergedXAxis.forEach((val: any, idx: number) =>
        valueToMergedIdx.set(val, idx),
      );

      // Reindex each series' data array
      opt?.options?.series?.forEach((series: any) => {
        if (!Array.isArray(series.data)) return;
        const newData = new Array(mergedXAxis.length).fill(null);
        series.data.forEach((val: any, origIdx: number) => {
          const mergedIdx = valueToMergedIdx.get(originalXAxis[origIdx]);
          if (mergedIdx !== undefined) newData[mergedIdx] = val;
        });
        series.data = newData;
      });
    });
  }

  // C2: Series labeling + C4: Stack collision fix — apply to ALL queries when multi-query
  if (options && options.length > 1 && options[0]?.options) {
    // Label Q1 series
    if (options[0].options.series) {
      const pIdx0 = metadata?.queries?.[0]?.panelQueryIndex ?? 0;
      const q1Config = panelSchema.queries[pIdx0]?.config;
      const q1Period =
        metadata?.queries[0]?.timeRangeGap?.periodAsStr || "";

      options[0].options.series = options[0].options.series.map(
        (it: any) => {
          if (isAnnotationSeries(it)) return it;
          return {
            ...it,
            name: buildLabeledName(it.name, q1Config, pIdx0, q1Period),
            _queryIndex: 0,
          };
        },
      );
    }

    // Label + merge Q2+ series
    for (let i = 1; i < options.length; i++) {
      if (options[i]?.options?.series) {
        const panelQueryIndex = metadata?.queries?.[i]?.panelQueryIndex ?? i;
        const qConfig = panelSchema.queries[panelQueryIndex]?.config;
        const periodAsStr =
          metadata?.queries[i]?.timeRangeGap?.periodAsStr || "";

        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: buildLabeledName(it.name, qConfig, panelQueryIndex, periodAsStr),
              _queryIndex: i,
              // C4: prefix stack names to prevent cross-query stacking
              stack: it.stack ? `q${i}-${it.stack}` : it.stack,
            };
          }),
        ];
      }
    }
  } else if (options && options[0] && options[0].options) {
    // Single query with time shift: preserve existing time shift naming
    for (let i = 1; i < options.length; i++) {
      if (options[i] && options[i].options && options[i].options.series) {
        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: metadata?.queries[i]?.timeRangeGap?.periodAsStr
                ? `${it.name} (${metadata?.queries[i]?.timeRangeGap.periodAsStr})`
                : it.name,
            };
          }),
        ];
      }
    }
  }

  // Re-apply color mappings on the fully merged+renamed series
  if (options[0]?.options?.series) {
    applySeriesColorMappings(
      options[0].options.series,
      panelSchema?.config?.color?.colorBySeries,
      store.state.theme,
    );
  }

  return options[0];
};

export const convertSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
) => {
  return convertSQLChartData(
    panelSchema,
    searchQueryData,
    store,
    chartPanelRef,
    hoveredSeriesState,
    resultMetaData,
    metadata,
    chartPanelStyle,
    annotations,
  );

};

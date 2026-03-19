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
import { applyChartConversionsToCtx } from "./sql/convertSQLChartData";
import { buildSQLContextFromSerializable } from "./sql/shared/contextBuilder";
import { applySeriesColorMappings } from "./chartColorUtils";
import { toRaw } from "vue";
import type {
  SQLWorkerInput,
  SerializableDataContext,
  SQLDataWorker,
} from "./sql/shared/workerContract";

/**
 * Snapshots all non-serializable arguments into a plain SQLWorkerInput object.
 * Called on the main thread inside convertMultiSQLData before postMessage.
 * None of the inputs here are Vue Proxies, DOM refs, or reactive wrappers ΓÇö
 * the result is safe to pass through structured clone (postMessage).
 */
export const buildSQLWorkerInput = (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
): SQLWorkerInput => ({
  panelSchema: toRaw(panelSchema),
  searchQueryData: toRaw(searchQueryData),
  resultMetaData: resultMetaData?.value?.map((item: any) => toRaw(item)) ?? [],
  metadata: toRaw(metadata),
  annotationsValue: toRaw(annotations?.value ?? []),
  chartPanelStyle: toRaw(chartPanelStyle),
  chartDimensions: {
    width: chartPanelRef?.value?.offsetWidth ?? 0,
    height: chartPanelRef?.value?.offsetHeight ?? 0,
  },
  storeSnapshot: {
    theme: store.state.theme,
    timezone: store.state.timezone,
    timestampColumn: store.state.zoConfig?.timestamp_column ?? "_timestamp",
    maxDashboardSeries: store.state.zoConfig?.max_dashboard_series ?? 100,
  },
  hoveredSeriesSnapshot: hoveredSeriesState?.value
    ? {
        panelId: hoveredSeriesState.value.panelId ?? null,
        hoveredSeriesName: hoveredSeriesState.value.hoveredSeriesName ?? null,
      }
    : null,
});

// ---------------------------------------------------------------------------
// Feature flag ΓÇö set to false to instantly revert to the main-thread path.
// ---------------------------------------------------------------------------
const USE_SQL_WORKER = true;

// ---------------------------------------------------------------------------
// assembleMultiSQLOptions
//
// Worker-path assembler: receives SerializableDataContext[] from the worker,
// reconstructs the full SQLContext (options phase only ΓÇö no data re-processing),
// runs the chart-type handler + post-processing, then merges multi-query series.
// Mirrors the structure of convertMultiSQLData but skips processData /
// fillMissingValues since the worker already ran them.
// ---------------------------------------------------------------------------
export const assembleMultiSQLOptions = async (
  panelSchema: any,
  dataContexts: (SerializableDataContext | null)[],
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  chartPanelStyle: any,
  annotations: any,
  metadata: any,
  searchQueryData: any,
): Promise<any> => {
  const options: any[] = [];

  for (let i = 0; i < dataContexts.length; i++) {
    const dataCtx = dataContexts[i];
    if (!dataCtx) {
      options.push(null);
      continue;
    }

    // Rebuild the full SQLContext (ECharts options + formatter closures) from
    // the plain serializable data context returned by the worker.
    const ctx = buildSQLContextFromSerializable(
      dataCtx,
      panelSchema,
      store,
      chartPanelRef,
      hoveredSeriesState,
      chartPanelStyle,
      annotations,
      // Match the single-query metadata slice used in the non-worker path:
      { queries: [metadata.queries[i]] },
      searchQueryData,
    );

    if (!ctx) {
      options.push(null);
      continue;
    }

    // Run chart-type handler + post-processing (formatters, legend, colors, etc.)
    const result = await applyChartConversionsToCtx(
      ctx,
      panelSchema,
      store,
      chartPanelRef,
      hoveredSeriesState,
      { queries: [metadata.queries[i]] },
    );
    options.push(result);
  }

  const isAnnotationSeries = (series: any) => !series.name;

  // Merge series from all query slots (same as convertMultiSQLData)
  if (options && options[0] && options[0].options) {
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
  worker?: SQLDataWorker,
) => {
  // ---- Worker path --------------------------------------------------------
  const canUseWorker =
    USE_SQL_WORKER &&
    worker != null &&
    typeof globalThis.Worker !== "undefined";

  if (canUseWorker) {
    const input = buildSQLWorkerInput(
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
    const dataContexts = await worker!.computeAsync(panelSchema.id, input);
    return assembleMultiSQLOptions(
      panelSchema,
      dataContexts,
      store,
      chartPanelRef,
      hoveredSeriesState,
      chartPanelStyle,
      annotations,
      metadata,
      searchQueryData,
    );
  }

  // ---- Original main-thread path (unchanged) ------------------------------
  if (!Array.isArray(searchQueryData) || searchQueryData.length === 0) {
    // this sets a blank object until it loads
    // because of this, it will go to UI and draw something, even 0 or a blank chart
    // this will give a sence of progress to the user
    searchQueryData = [[]];
  }

  // loop on all search query data
  const options: any = [];
  for (let i = 0; i < searchQueryData.length; i++) {
    options.push(
      await convertSQLData(
        panelSchema,
        [searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        [resultMetaData.value?.[i]?.[0]],
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

  // loop on all options
  if (options && options[0] && options[0].options) {
    for (let i = 1; i < options.length; i++) {
      if (options[i] && options[i].options && options[i].options.series) {
        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: metadata?.queries[i]?.timeRangeGap.periodAsStr
                ? `${it.name} (${metadata?.queries[i]?.timeRangeGap.periodAsStr})`
                : it.name,
            };
          }),
        ];
      }
    }
  }

  // Re-apply color mappings on the fully merged+renamed series so that
  // comparison-against series (which now carry the "(X ago)" suffix) match
  // any user-configured colorBySeries entries that include the suffix.
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

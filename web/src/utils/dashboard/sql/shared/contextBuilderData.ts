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
 * Worker-safe data-processing phase of the SQL chart pipeline.
 *
 * This file MUST NOT import anything that transitively imports Quasar,
 * DOM APIs, or Vue reactivity ΓÇö it runs inside a Web Worker.
 *
 * Imports allowed: pure utility functions (date-fns, aliasUtils, colorPalette,
 * chartDimensionUtils, sqlProcessData, sqlMissingValueFiller, etc.)
 *
 * NOTE: sqlMissingValueFiller imports dateTimeUtils which imports { date } from
 * "quasar". Vite's tree-shaking removes it as long as no side-effect-only
 * imports are used, but to be safe this file is kept in a separate module so
 * that the worker bundle only includes this module's dependency tree.
 */

import {
  calculateWidthText,
  calculateDynamicNameGap,
  calculateRotatedLabelBottomSpace,
} from "../../chartDimensionUtils";
import { ColorModeWithoutMinMax, getSQLMinMaxValue } from "../../colorPalette";
import { getDataValue } from "../../aliasUtils";
import { getPropsByChartTypeForSeries } from "../../sqlChartSeriesProps";
import { processData } from "../../sqlProcessData";
import { fillMissingValues } from "../../sqlMissingValueFiller";
import { type SerializableDataContext } from "./workerContract";

/**
 * Finds the largest label in the given data array.
 */
export const largestLabel = (data: any) => {
  const largestlabel = data.reduce((largest: any, label: any) => {
    return label?.toString().length > largest?.toString().length
      ? label
      : largest;
  }, "");

  return largestlabel;
};

/**
 * DATA-PROCESSING PHASE ΓÇö pure computation, no ECharts options, no formatters.
 *
 * This is the CPU-heavy part of the pipeline. It is designed to run inside a
 * Web Worker: every input is a plain serializable value (no Vue Proxies, no
 * DOM refs) and the returned `SerializableDataContext` contains only plain
 * objects / arrays / primitives ΓÇö no Function values.
 *
 * `buildSQLContext` calls this internally so the non-worker path is unchanged.
 */
export function buildSQLDataContext(
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
): SerializableDataContext | null {
  const showGridlines =
    panelSchema?.config?.show_gridlines !== undefined
      ? panelSchema.config.show_gridlines
      : true;
  const extras: any = {};

  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema.queries[0].fields.x ||
    !panelSchema.queries[0].fields.y
  ) {
    return null;
  }

  const xAxisKeys: string[] = panelSchema?.queries[0]?.fields?.x?.length
    ? panelSchema.queries[0].fields.x.map((it: any) => it.alias)
    : [];

  const yAxisKeys: string[] = panelSchema?.queries[0]?.fields?.y?.length
    ? panelSchema.queries[0].fields.y.map((it: any) => it.alias)
    : [];

  const zAxisKeys: string[] = panelSchema?.queries[0]?.fields?.z?.length
    ? panelSchema.queries[0].fields.z.map((it: any) => it.alias)
    : [];

  const breakDownKeys: string[] = panelSchema?.queries[0]?.fields?.breakdown
    ?.length
    ? panelSchema.queries[0].fields.breakdown.map((it: any) => it.alias)
    : [];

  const noValueConfigOption = panelSchema?.config?.no_value_replacement ?? "";

  const processedData = processData(
    searchQueryData,
    panelSchema,
    store,
    yAxisKeys,
    breakDownKeys,
    xAxisKeys,
    extras,
  );

  const missingValueData = fillMissingValues(
    processedData,
    panelSchema,
    resultMetaData,
    metadata,
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    noValueConfigOption,
  );

  const isHorizontalChart =
    panelSchema.type === "h-bar" || panelSchema.type === "h-stacked";

  const hasTimestampField = panelSchema.queries[0].fields?.x?.some(
    (it: any) =>
      it?.args?.[0]?.value?.field == store.state?.zoConfig?.timestamp_column ||
      ["histogram", "date_bin"].includes(it.aggregationFunction),
  );

  // Label rotation / width ΓÇö needed for dynamicXAxisNameGap and additionalBottomSpace
  const labelRotation =
    hasTimestampField || isHorizontalChart
      ? 0
      : panelSchema.config?.axis_label_rotate || 0;

  // getAxisDataFromKey is needed here only to compute labelWidth from data
  // It is a pure function of missingValueData so we can define it locally
  const getAxisDataFromKeyLocal = (key: string) => {
    const data =
      missingValueData?.filter((item: any) => {
        return (
          xAxisKeys.every((k: any) => getDataValue(item, k) != null) &&
          yAxisKeys.every((k: any) => getDataValue(item, k) != null) &&
          breakDownKeys.every((k: any) => getDataValue(item, k) != null)
        );
      }) || [];
    const keys = Object.keys((data.length && data[0]) || {});
    const keyArrays: any = {};
    for (const k of keys) {
      keyArrays[k] = data.map((obj: any) => getDataValue(obj, k));
    }
    return getDataValue(keyArrays, key) || [];
  };

  let labelWidth =
    hasTimestampField || isHorizontalChart
      ? 0
      : panelSchema.config?.axis_label_truncate_width || 0;

  if (
    !hasTimestampField &&
    !isHorizontalChart &&
    labelWidth === 0 &&
    xAxisKeys.length > 0
  ) {
    const longestLabelStr = largestLabel(getAxisDataFromKeyLocal(xAxisKeys[0]));
    labelWidth = calculateWidthText(longestLabelStr, "12px");
  } else if (!hasTimestampField && !isHorizontalChart && labelWidth === 0) {
    labelWidth = 120;
  }

  const labelFontSize = 12;
  const labelMargin = 10;

  const dynamicXAxisNameGap =
    hasTimestampField || isHorizontalChart
      ? 25
      : calculateDynamicNameGap(
          labelRotation,
          labelWidth,
          labelFontSize,
          25,
          labelMargin,
        );

  const additionalBottomSpace =
    hasTimestampField || isHorizontalChart
      ? 0
      : calculateRotatedLabelBottomSpace(
          labelRotation,
          labelWidth,
          labelFontSize,
          !!panelSchema.queries[0]?.fields?.x[0]?.label,
          dynamicXAxisNameGap,
        );

  const defaultGrid = {
    containLabel: true,
    left: "10%",
    right: "10%",
    top: "15%",
    bottom: "15%",
  };

  const [min, max] = getSQLMinMaxValue(yAxisKeys, missingValueData);

  const defaultSeriesProps = getPropsByChartTypeForSeries(panelSchema);

  let chartMin: any = Infinity;
  let chartMax: any = -Infinity;
  if (
    !Object.values(ColorModeWithoutMinMax).includes(
      panelSchema.config?.color?.mode,
    )
  ) {
    if (panelSchema.type == "heatmap") {
      chartMin = null;
      chartMax = null;
    } else {
      [chartMin, chartMax] = getSQLMinMaxValue(yAxisKeys, missingValueData);
    }
  }

  const markLineData =
    panelSchema?.config?.mark_line?.map((markLine: any) => ({
      name: markLine.name,
      type: markLine.type,
      xAxis: markLine.type == "xAxis" ? markLine.value : null,
      yAxis: markLine.type == "yAxis" ? markLine.value : null,
      label: {
        formatter: markLine.name ? "{b}:{c}" : "{c}",
        position: "insideEndTop",
      },
    })) ?? [];

  const convertedTimeStampToDataFormat = new Date(
    annotations?.value?.[0]?.start_time / 1000,
  ).toString();

  return {
    xAxisKeys,
    yAxisKeys,
    zAxisKeys,
    breakDownKeys,
    missingValueData,
    extras,
    showGridlines,
    hasTimestampField,
    isHorizontalChart,
    dynamicXAxisNameGap,
    additionalBottomSpace,
    convertedTimeStampToDataFormat,
    defaultSeriesProps,
    chartMin,
    chartMax,
    min,
    max,
    defaultGrid,
    labelRotation,
    labelWidth,
    markLineData,
    noValueConfigOption,
  };
}
